// RouteForge — destination storybook research, backed by "the brain".
//
// Flow: check the brain (Supabase routeforge_places) → on a miss, research
// the destination live (Reddit, X, forums, travel blogs via web search) →
// lock the result into the brain so every traveler after gets it instantly.
// The library only ever grows.
//
// The honesty contract is enforced by schema: there is no field for prices,
// nightly rates, or opening hours — the client links out to live listings
// for the real numbers. Whispers must carry the real URL they came from.

import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 90 };

const SB_BASE = "https://lamdouidiiuqtplqhsdz.supabase.co/rest/v1";
const SB_KEY = "sb_publishable_RrMGUSXa0vGBXTzQ4ueORg_IjTLFRv-";
const SB_HEADERS = {
  "Content-Type": "application/json",
  apikey: SB_KEY,
  Authorization: "Bearer " + SB_KEY,
};

const PICK = {
  type: "object",
  additionalProperties: false,
  required: ["name", "area", "why", "confidence"],
  properties: {
    name: { type: "string" },
    area: { type: "string" },
    why: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const PLACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tagline", "story", "eat", "do", "stay", "whispers"],
  properties: {
    tagline: { type: "string" },
    story: { type: "string" },
    eat: { type: "array", items: PICK },
    do: { type: "array", items: PICK },
    stay: { type: "array", items: PICK },
    whispers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "source", "url"],
        properties: {
          quote: { type: "string" },
          source: { type: "string" },
          url: { type: "string" },
        },
      },
    },
  },
};

function buildPrompt({ name, area, vehicle }) {
  const where = [name, area].filter(Boolean).join(", ");
  return `You are RouteForge's storybook researcher. A road-tripper is about to stop at "${where}" and this page must feel like the opening of an exciting storybook — while staying rigorously honest.

Research the destination with web search: Reddit threads, X posts, travel forums, trip reports, local blogs. Find what travelers genuinely rave about.

Return:
- tagline: one cinematic line (max 18 words) that makes the backseat sit up. Vivid but true — no invented facts.
- story: 2-3 sentences of storybook intro. Concrete, evocative, honest. No numbers, no invented claims.
- eat: 3-5 real, named places to eat/drink near the stop that travelers actually recommend.
- do: 3-5 real, named things to do/see/experience (trails, viewpoints, attractions, entertainment).
- stay: 3-5 real, named places to stay. ${vehicle === "rv" ? "Vehicle is a large RV/trailer — favor RV parks, campgrounds, and big-rig-friendly lodging." : ""}
- whispers: 2-4 short paraphrases of what real travelers said, each with the REAL source url you found it at and a short source label (e.g. "Reddit r/roadtrip"). NEVER fabricate a quote or a URL — if you can't find real ones, return fewer or none.

HARD RULES (violating any = failure):
- Every named place must be REAL. Never pad with invented names — return fewer instead.
- NEVER include prices, nightly rates, opening hours, or open/closed status. No dollar amounts anywhere.
- "why": max 14 words, concrete, drawn from what people actually say.
- "area": that pick's own town/area.
- "confidence": "high" | "medium" | "low" — how sure you are it exists as described.`;
}

/* ---- brain (cache) ---- */
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const keyFor = (n, a) => (norm(n) + "|" + norm(a)).slice(0, 240);

async function brainGet(keys) {
  for (const k of keys) {
    try {
      const r = await fetch(
        SB_BASE + "/routeforge_places?key=eq." + encodeURIComponent(k) + "&select=data,created_at&limit=1",
        { headers: SB_HEADERS }
      );
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j) && j[0] && j[0].data) return j[0];
    } catch {}
  }
  return null;
}

async function brainPut(key, name, area, data) {
  try {
    await fetch(SB_BASE + "/routeforge_places?on_conflict=key", {
      method: "POST",
      headers: { ...SB_HEADERS, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ key, name, area, data }),
    });
  } catch {}
}

/* ---- sanitize ---- */
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sPick = (p) => ({
  name: str(p && p.name, 100),
  area: str(p && p.area, 100),
  why: str(p && p.why, 160),
  confidence: ["high", "medium", "low"].includes(p && p.confidence) ? p.confidence : "low",
});
const sWhisper = (w) => ({
  quote: str(w && w.quote, 240),
  source: str(w && w.source, 60) || "source",
  url: /^https?:\/\//.test(String((w && w.url) || "")) ? str(w.url, 500) : "",
});
function sData(d) {
  d = d && typeof d === "object" ? d : {};
  return {
    origin: "research",
    tagline: str(d.tagline, 180),
    story: str(d.story, 700),
    eat: (Array.isArray(d.eat) ? d.eat : []).slice(0, 6).map(sPick).filter((p) => p.name),
    do: (Array.isArray(d.do) ? d.do : []).slice(0, 6).map(sPick).filter((p) => p.name),
    stay: (Array.isArray(d.stay) ? d.stay : []).slice(0, 6).map(sPick).filter((p) => p.name),
    whispers: (Array.isArray(d.whispers) ? d.whispers : []).slice(0, 5).map(sWhisper).filter((w) => w.quote && w.url),
  };
}

/* ---- rate limit (best effort per instance) ---- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60_000) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  hits.set(ip, rec);
  return rec.n > 10;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method-not-allowed" });
  }

  const body = req.body || {};
  const name = str(body.name, 120);
  const area = str(body.area, 120);
  const vehicle = body.vehicle === "rv" ? "rv" : "car";
  if (!name) return res.status(400).json({ error: "missing-name" });

  // 1) The brain remembers.
  const exactKey = keyFor(name, area);
  const nameKey = keyFor(name, "");
  const hit = await brainGet(area ? [exactKey, nameKey] : [nameKey]);
  if (hit) {
    return res.status(200).json({ ...hit.data, cached: true, researched_at: hit.created_at });
  }

  // 2) A new place — research it live, if the key is wired up.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "not-configured" });

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress || "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "rate-limited" });

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: PLACE_SCHEMA },
      },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: buildPrompt({ name, area, vehicle }) }],
    });
    const textBlocks = response.content.filter((b) => b.type === "text");
    const text = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      data = a >= 0 && b > a ? (() => { try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; } })() : null;
    }
    if (!data) return res.status(502).json({ error: "no-story", stop_reason: response.stop_reason });

    const clean = sData(data);
    if (!clean.eat.length && !clean.do.length && !clean.stay.length) {
      return res.status(502).json({ error: "empty-story" });
    }

    // 3) Lock it into the brain — the library grows.
    await brainPut(exactKey, name, area, clean);

    return res.status(200).json({ ...clean, cached: false });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "upstream-rate-limited" });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream", status: err.status });
    return res.status(502).json({ error: "upstream-unreachable" });
  }
}
