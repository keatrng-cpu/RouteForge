// RouteForge — route research.
//
// Given a start + destination, researches the driving corridor with live web
// search and returns real, sourced stops in the exact shape app.html renders:
//   { stops:[{name, area, why, locals_say, secret_score, confidence,
//             drive, detour, evidence:[{source, url}]}],
//     research:{queries:[...], sources:[{title, url}]},
//     route_summary }
//
// The honesty contract is enforced by the schema: drive/detour are
// number-or-null (null renders as "?"), and there is no field for prices or
// hours. The research log (queries + sources) is built from the searches that
// ACTUALLY ran — read out of the response's tool-use blocks, not claimed by
// the model.
//
// Requires ANTHROPIC_API_KEY; without it, returns 503 not-configured and the
// client shows a friendly "research service isn't wired up" message.

import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 120 };

const STOP = {
  type: "object",
  additionalProperties: false,
  required: ["name", "area", "why", "locals_say", "secret_score", "confidence", "drive", "detour", "evidence"],
  properties: {
    name: { type: "string" },
    area: { type: "string" },
    why: { type: "string" },
    locals_say: { type: "string" },
    secret_score: { type: "integer", enum: [1, 2, 3, 4, 5] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    drive: { anyOf: [{ type: "number" }, { type: "null" }] },
    detour: { anyOf: [{ type: "number" }, { type: "null" }] },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "url"],
        properties: { source: { type: "string" }, url: { type: "string" } },
      },
    },
  },
};

const FORGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stops", "route_summary"],
  properties: {
    stops: { type: "array", items: STOP },
    route_summary: { type: "string" },
  },
};

function buildPrompt({ start, end, vibe, stops, vehicle }) {
  return `You are RouteForge's route researcher. Plan driving-corridor stops between "${start}" and "${end}".
Traveler interests: ${vibe || "general — scenic, memorable, worth pulling over for"}. Vehicle: ${vehicle === "rv" ? "large RV/trailer — favor stops with big-vehicle parking and easy access" : "car"}.

Use web search across Reddit, forums, and trip reports to find the stops travelers actually rave about — not the ones with an ad budget.

HARD RULES (violating any = failure):
- Exactly ${stops} stops, ordered along the realistic driving corridor from start to end.
- Every stop must be a REAL, named place. For each, include "evidence": 1-2 links to the actual page(s) you found it on (source = short label like "Reddit r/roadtrip" or "AtlasObscura"; url = the real URL).
- NEVER invent opening hours, prices, or open/closed status. Do not mention dollar amounts anywhere.
- drive = estimated driving minutes from the previous point (from "${start}" for the first stop). If not reasonably confident, use null instead of guessing.
- detour = estimated extra minutes off the main route to reach it, or null.
- secret_score 1-5: 1 = everyone stops here, 5 = you'd only know from a local or a buried comment.
- confidence: "high" | "medium" | "low" — how sure you are this place exists as described and sits near the corridor.
- why: max 14 words, concrete. locals_say: one short line paraphrasing what travelers actually said (or "" if none found).
- route_summary: one short honest sentence.`;
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60_000) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  hits.set(ip, rec);
  return rec.n > 6;
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Pull the queries and result URLs out of the blocks that actually ran, so the
// research log reflects real activity rather than the model's claims.
function extractResearch(content) {
  const queries = [];
  const sources = [];
  const seen = new Set();
  for (const b of content) {
    if (b.type === "server_tool_use" && b.name === "web_search" && b.input && b.input.query) {
      queries.push(String(b.input.query).slice(0, 120));
    }
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r && r.type === "web_search_result" && r.url && !seen.has(r.url)) {
          seen.add(r.url);
          sources.push({ title: String(r.title || r.url).slice(0, 160), url: String(r.url) });
        }
      }
    }
  }
  return { queries: queries.slice(0, 24), sources: sources.slice(0, 40) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method-not-allowed", message: "Method not allowed." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "not-configured",
      message: "Route research isn't wired up on this host yet — set ANTHROPIC_API_KEY to enable it. You can still add stops by hand below.",
    });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "rate-limited", message: "Easy on the bellows — too many routes in a minute. Wait a moment and try again." });
  }

  const body = req.body || {};
  const params = {
    start: str(body.start, 200),
    end: str(body.end, 200),
    vibe: str(body.vibe, 300),
    stops: Math.min(Math.max(parseInt(body.stops, 10) || 4, 1), 8),
    vehicle: body.vehicle === "rv" ? "rv" : "car",
  };
  if (!params.start || !params.end) {
    return res.status(400).json({ error: "missing-endpoints", message: "Enter both a start and a destination." });
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: FORGE_SCHEMA },
      },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages: [{ role: "user", content: buildPrompt(params) }],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const text = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      plan = a >= 0 && b > a ? (() => { try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; } })() : null;
    }
    if (!plan || !Array.isArray(plan.stops) || !plan.stops.length) {
      return res.status(502).json({ error: "no-plan", message: "The research came back unreadable. Forge again — it usually lands on retry." });
    }
    return res.status(200).json({
      stops: plan.stops,
      route_summary: typeof plan.route_summary === "string" ? plan.route_summary : "Route researched.",
      research: extractResearch(response.content),
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "upstream-rate-limited", message: "The research service is busy. Try again in a moment." });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream", message: "The research service hit an error. Forge again." });
    return res.status(502).json({ error: "upstream-unreachable", message: "Couldn't reach the research service. Check your connection and try again." });
  }
}
