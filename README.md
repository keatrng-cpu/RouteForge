# RouteForge

Road trips researched, not invented. Pick two points and RouteForge reads
Reddit, X, forums and trip reports for the stops travelers actually rave
about — with real photos, real sources, honest unknowns (`?` instead of a
made-up number), automatic day-splitting, and one-tap export of each day
into Google Maps. Every stop opens as its own **storybook page**.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Marketing landing page |
| `app.html` | The planner — research a route, split days, export to Maps |
| `place.html` | A destination's **storybook**: hero photo, "are we there yet?" ticker, gallery, food / adventures / stays with photos, traveler whispers, live-price links, and the growing library |
| `signup.html` | Email signup (Supabase-backed) |
| `api/forge.js` | Route research (web search over Reddit/forums; sourced stops) |
| `api/place.js` | Destination research — checks the brain first, researches on a miss, locks the result into the brain |
| `supabase/migrations/` | Database schema: signups, share codes, and the brain |

Plain HTML/CSS/JS — no framework, no build step.

## Architecture

```
browser
  ├── /app.html   route research ──► /api/forge ──► Anthropic API
  │                                   (claude-opus-4-8 + web search,
  │                                    structured outputs)
  ├── /place.html storybooks ──► /api/place
  │        │                        ├── 1) the BRAIN (Supabase
  │        │                        │      routeforge_places) — instant
  │        │                        └── 2) miss → live research → result
  │        │                               locked into the brain forever
  │        ├── photos: Wikimedia API (client-side, keyless, credited)
  │        └── prices: live links out (Google Maps / Google Hotels) —
  │                    never AI-generated numbers
  └── signups ──► Supabase (insert-only, unique email)
```

### The brain

`routeforge_places` is an append-only public library: the first traveler to
open a destination pays the research cost once; everyone after gets the
storybook instantly. Rows are immutable (insert-only RLS, size-capped,
public read). Seeded with six iconic destinations so the experience works
before any API key is configured.

### The honesty contract

- Response schemas have **no field** for prices, rates, or hours — the UI
  links to live listings for real numbers.
- Drive times are `number | null`; `null` renders as `?`, never a guess.
- Whispers (traveler quotes) must carry the real URL they came from.
- Photos come from Wikimedia, credited and linked; a place with no photo
  says so instead of faking one.

## Deploying

1. Deploy to Vercel (static pages + the two `api/` functions are picked up
   automatically; `@anthropic-ai/sdk` installs from `package.json`).
2. Set `ANTHROPIC_API_KEY` to enable live research. Without it: seeded and
   previously-researched storybooks, photos, day-splitting, Maps export,
   saved trips, and all live-price links still work.

## Supabase

Project `lamdouidiiuqtplqhsdz` (all migrations applied; SQL kept in
`supabase/migrations/` for reproduction):

- `routeforge_signups` — insert-only RLS + unique `lower(email)`
- `routeforge_trips` — share codes (insert-only, read via RPC)
- `routeforge_places` — the brain (public read, insert-only, immutable)

The publishable (`sb_publishable_…`) key in the HTML is designed to be
public; RLS is the security boundary.
