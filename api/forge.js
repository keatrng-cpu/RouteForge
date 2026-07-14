// RouteForge — server-side route intelligence.
//
// Deployed as a serverless function (Vercel-style: /api/forge). Holds the
// Anthropic API key server-side so the static app never ships a secret.
// Returns the same JSON shape the client renders: {stops, last_leg_min,
// route_summary}. Uses structured outputs so the plan is guaranteed to be
// valid JSON — "the model returned an unreadable plan" is not a failure
// mode this endpoint can produce.

import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 60 };

// The anti-hallucination contract, enforced by schema: drive times are
// number-or-null (null = "I don't know", rendered as "?"), and there is no
// field for opening hours, prices, or open/closed status at all.
const ROUTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stops", "last_leg_min", "route_summary"],
  properties: {
    stops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "area",
          "why",
          "category",
          "drive_min_from_prev",
          "detour_min",
          "confidence",
        ],
        properties: {
          name: { type: "string" },
          area: { type: "string" },
          why: { type: "string" },
          category: { type: "string" },
          drive_min_from_prev: { anyOf: [{ type: "number" }, { type: "null" }] },
          detour_min: { anyOf: [{ type: "number" }, { type: "null" }] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    last_leg_min: { anyOf: [{ type: "number" }, { type: "null" }] },
    route_summary: { type: "string" },
  },
};

function buildPrompt({ start, end, vibe, stops, vehicle }) {
  return `You are RouteForge's route intelligence. Plan driving-corridor stops between "${start}" and "${end}".
Traveler interests: ${vibe || "general — scenic, memorable, worth a detour"}. Vehicle: ${
    vehicle === "rv"
      ? "large RV/trailer — strongly prefer stops with big-vehicle parking and easy access"
      : "car"
  }.

HARD RULES (violating any = failure):
- Exactly ${stops} stops, ordered along the realistic driving corridor from start to end.
- NEVER invent opening hours, prices, or open/closed status. Do not include them at all.
- drive_min_from_prev = estimated driving minutes from the previous point (from "${start}" for the first stop); last_leg_min = estimated minutes from the final stop to "${end}". If you are not reasonably confident in a number, use null instead of guessing.
- confidence: "high" | "medium" | "low" — how sure you are this place exists as described and sits near the corridor.
- why: max 12 words, concrete, no marketing fluff.
- Keep every string short.`;
}

// Best-effort per-instance rate limit; serverless instances are ephemeral,
// so this is a speed bump, not a wall.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60_000) {
    rec.n = 0;
    rec.t = now;
  }
  rec.n += 1;
  hits.set(ip, rec);
  return rec.n > 8;
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method-not-allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // The client treats this as "no proxy available" and falls back.
    return res.status(503).json({ error: "not-configured" });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "rate-limited" });
  }

  const body = req.body || {};
  const params = {
    start: str(body.start, 200),
    end: str(body.end, 200),
    vibe: str(body.vibe, 300),
    stops: Math.min(Math.max(parseInt(body.stops, 10) || 4, 1), 8),
    vehicle: body.vehicle === "rv" ? "rv" : "car",
    live: body.live === true,
  };
  if (!params.start || !params.end) {
    return res.status(400).json({ error: "missing-endpoints" });
  }

  const client = new Anthropic({ apiKey });
  const request = {
    model: "claude-opus-4-8",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: ROUTE_SCHEMA },
    },
    messages: [{ role: "user", content: buildPrompt(params) }],
  };
  if (params.live) {
    request.tools = [
      { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    ];
  }

  try {
    const response = await client.messages.create(request);
    // With web search enabled the response interleaves tool blocks with
    // text; the final text block carries the schema-conforming plan.
    const textBlocks = response.content.filter((b) => b.type === "text");
    const text = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      // Lenient fallback in case a refusal or truncation produced prose.
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a >= 0 && b > a) {
        try {
          plan = JSON.parse(text.slice(a, b + 1));
        } catch {
          plan = null;
        }
      }
    }
    if (!plan || !Array.isArray(plan.stops) || !plan.stops.length) {
      return res.status(502).json({ error: "no-plan", stop_reason: response.stop_reason });
    }
    return res.status(200).json(plan);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "upstream-rate-limited" });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: "upstream", status: err.status });
    }
    return res.status(502).json({ error: "upstream-unreachable" });
  }
}
