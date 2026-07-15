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
| `place.html` | A destination's **storybook**: hero photo, "are we there yet?" ticker, **live weather + golden-hour arrival timing**, gallery, food / adventures / stays with photos, traveler whispers, live-price links, **read-aloud narration**, **one-tap shareable postcard**, and the growing library |
| `signup.html` | Email signup (Supabase-backed) |
| `api/forge.js` | Route research (web search over Reddit/forums; sourced stops) |
| `api/place.js` | Destination research — checks the brain first, researches on a miss, locks the result into the brain |
| `api/photo.js` | Exact-business photo resolver (Google Places) — optional; the client falls back to keyless free sources without it |
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
  │        ├── photos: a never-blank chain, most-exact first —
  │        │      1) /api/photo (Google Places, exact business) if keyed
  │        │      2) Wikipedia article  ─┐ title-verified (deterministic
  │        │      3) Wikimedia Commons  ─┘ token match — never an LLM URL)
  │        │      4) a real photo of the AREA, tagged "NEARBY · <town>"
  │        │      5) a "see real photos ↗" link to the venue on Maps
  │        ├── prices: live links out (Google Maps / Google Hotels) —
  │        │          never AI-generated numbers
  │        ├── weather + light: Open-Meteo forecast (keyless) + exact
  │        │          sunrise/sunset/golden-hour astronomy computed in-browser
  │        ├── narration: Web Speech reads the story aloud (keyless)
  │        └── postcard: Canvas share card from the real verified photo
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
- Photos are never invented and never mismatched. Every candidate — from
  Wikipedia or Commons — must pass a **deterministic** title-token check
  before it is shown (no LLM ever supplies an image URL). When only an area
  photo is available it is shown tagged `NEARBY · <town>`, honestly; when
  nothing verified exists, the card links to the venue's real photos instead
  of faking one. Exact-business photos come from Google Places when a
  `GOOGLE_MAPS_API_KEY` is configured.
- Weather is a real Open-Meteo **forecast**, labelled as a forecast (never a
  promise) and only shown inside the 16-day window. Sunrise, sunset and
  golden-hour times are **exact astronomy** (SunCalc algorithm) computed in
  the browser for the date the traveler picks — real for any date, keyless,
  never guessed.

## Deploying

1. Deploy to Vercel (static pages + the `api/` functions are picked up
   automatically; `@anthropic-ai/sdk` installs from `package.json`).
2. Set `ANTHROPIC_API_KEY` to enable live research. Without it: seeded and
   previously-researched storybooks, photos, day-splitting, Maps export,
   saved trips, and all live-price links still work.
3. Optional: set `GOOGLE_MAPS_API_KEY` (Places API enabled) to turn on
   exact-business photos via `api/photo.js`. Without it the photo chain
   still never goes blank — it uses the keyless free sources above.

## Supabase

Project `lamdouidiiuqtplqhsdz` (all migrations applied; SQL kept in
`supabase/migrations/` for reproduction):

- `routeforge_signups` — insert-only RLS + unique `lower(email)`
- `routeforge_trips` — share codes (insert-only, read via RPC)
- `routeforge_places` — the brain (public read, insert-only, immutable)

The publishable (`sb_publishable_…`) key in the HTML is designed to be
public; RLS is the security boundary.
