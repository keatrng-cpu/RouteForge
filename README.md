# RouteForge

Road trips, forged honestly. A road-trip planner that **never invents your
facts**: unlimited stops, live-checked suggestions, honest unknowns
(`?` instead of a made-up number), automatic day-splitting, and one-tap
export of each day into Google Maps. No account, no paywall, nothing
auto-renews.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Marketing landing page |
| `app.html` | The planner — everything happens here |
| `signup.html` | Email signup (Supabase-backed) |
| `api/forge.js` | Serverless route-intelligence proxy (holds the Anthropic key) |
| `supabase/migrations/` | Database schema for signups + share codes |

Plain HTML/CSS/JS — no framework, no build step. Open `index.html` in a
browser or run `npm run dev` (serves on `http://localhost:4173`).

## Architecture

```
browser (static pages)
  ├── AI route generation ──► /api/forge ──► Anthropic API (claude-opus-4-8,
  │        │                                 structured outputs + web search)
  │        └── fallback: direct call (only works inside the Claude
  │            artifact runtime, where the API is proxied keylessly)
  ├── saved trips ──► localStorage (or the artifact KV store)
  ├── share codes ──► Supabase (insert-only table + code-lookup RPC)
  └── signups ──► Supabase (insert-only table, unique email)
```

### The honesty contract

The model is structurally constrained, not just prompted:

- The response schema (enforced with structured outputs) has **no field**
  for opening hours, prices, or open/closed status.
- Every drive time is `number | null`. `null` renders as `?` — never as a
  guessed number.
- Every AI stop carries a confidence gauge and a "verify on map" link.

## Deploying

### Static-only (GitHub Pages, Netlify, any web server)

Everything works except AI generation: manual stops, day-splitting,
Google Maps export, save/load, `.json` download/import, share codes, and
signup. The Forge button will explain that the AI proxy isn't deployed.

### With AI generation (Vercel or compatible)

1. Deploy the repo to Vercel (the static pages and `api/forge.js` are
   picked up automatically; `@anthropic-ai/sdk` installs from
   `package.json`).
2. Set the `ANTHROPIC_API_KEY` environment variable.

That's it — the app calls `api/forge` first and only falls back to the
direct path inside Claude artifacts.

### Supabase

The two tables live in project `lamdouidiiuqtplqhsdz` (already applied);
`supabase/migrations/` holds the SQL for reproducing them elsewhere:

- `routeforge_signups` — RLS: anon may **insert only** (with email format
  checks); a unique index on `lower(email)` makes duplicate signups return
  409, which the signup page turns into "you're already on the list".
  Emails are never readable with the publishable key.
- `routeforge_trips` — share codes. RLS: anon may **insert only**
  (code-format + size checks). Reads happen exclusively through the
  `routeforge_get_trip(share_code)` RPC, so the table can't be listed,
  scraped, updated, or deleted with the publishable key. Codes are
  crypto-random (`RF-` + 6 chars from an unambiguous alphabet).

The publishable (`sb_publishable_…`) key in the HTML is designed to be
public; RLS is the security boundary.

## Design principles (the short version)

- **Unknowns stay unknown.** `EST` marks a model estimate; `?` marks a gap.
  We show the gap instead of filling it.
- **Complement the giant.** Discovery, day logic, and persistence are ours;
  turn-by-turn is Google Maps', exported in per-day links chunked under the
  waypoint cap.
- **The viral loop is never taxed.** Share codes are free for everyone.
- **Your trips stay yours.** Everything exports to a plain `.json` file.

The full competitive rationale is in the "Design ledger" at the bottom of
the planner.
