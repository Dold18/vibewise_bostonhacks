# Vibenta — BostonHacks 2026

**Working product name:** Vibenta (branding may change)  
**Track:** Bos(tons) of Eats and Streets  
**Status:** Early planning and parallel implementation setup

> **Find places by how you want to feel.** Vibenta learns a student's desired aesthetic from images, text, music, movies and a generative vibe quiz. A Living Map of Boston converges on real recommendations, then shows how to reach them on the MBTA. The full vision includes group planning, Recreate Mode, student-friendly places and authorized campus events.

## What we are building
- **Living Map:** Boston basemap, real venue pins and cards, dynamic filters and map atmosphere reacting to preference changes.
- **Vibe Engine:** image/text/media references, a 10-question generative vibe quiz, Vibe DNA and embedding-based recommendation ranking.
- **Transit connection:** a selected destination produces walking/MBTA legs and travel information on the same map.
- **Group / student features:** fair joint discovery, real student discounts/feedback, public or organizer-authorized events.
- **Recreate Mode:** match visual inspiration to authentic photos of locations that can actually be visited.

This is the **full product vision**, not a claim that every feature is already coded. Start with the smallest complete experience: verified Boston places → map cards → selected-place MBTA route.

## Documentation: source of truth
| File | Read it for |
|---|---|
| [Product brief](docs/PRODUCT.md) | Goals, complete features, what judges should experience |
| [Architecture](docs/ARCHITECTURE.md) | Modules and data flow; proposed tech choices |
| [Contracts](docs/CONTRACTS.md) | `Place`, `TransitRequest`, `TransitResponse`, map ↔ route handoff |
| [Data model](docs/DATA_MODEL.md) | Proposed Supabase schema, enrichment pipeline, review/data compliance |
| [Workstreams](docs/WORKSTREAMS.md) | Who owns map, transit, vibe and integration; branch rules |
| [Roadmap](docs/ROADMAP.md) | Ordered milestones and acceptance tests |
| [Decision log](docs/DECISIONS.md) | What's accepted vs still proposed |
| [Agent instructions](AGENTS.md) | Instructions for all coding agents |
| [Claude entrypoint](CLAUDE.md) | Claude Code pointer to the same instructions |

**Before parallel development:** map and transit owners must both approve `docs/CONTRACTS.md`. Implement one shared executable type module. Don't let each agent invent its own schema.

## Initial workstreams
- **Map/cards teammate:** render Boston, verified place markers, detail cards, selected place event, and eventually normalized route overlays.
- **MBTA teammate:** implement a transit-routing adapter using the agreed request/response interface, with real provider data and explicit failure handling.
- **Integration lead:** maintain place fixture/contracts, wire selection to routing, resolve data sources and verify the end-to-end journey.
- **Vibe workstream (later):** quiz + ranking + map themes, built on the same place model.

## Getting started
Requires Node 24 or newer (the API runs TypeScript directly) and Google Chrome only for the optional browser checks.

1. **Install:** `cd apps/web && npm ci`.
2. **Server settings:** copy `.env.example` to `.env` at the repository root and fill in what you have:
   - `GEMINI_API_KEY` and `VIBE_GEMINI_MODEL`: live quiz questions. Without a key the quiz uses its labeled local question director.
   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: catalog-wide restaurant search (`POST /api/vibe/search`). The **publishable** key only; read-only search never needs the secret/service-role key. If you leave these out, the API reuses the `VITE_SUPABASE_*` pair from `apps/web/.env`.
   - `MBTA_API_KEY` (optional): keyless MBTA requests work but are limited to 20/min.
3. **Browser settings:** copy `apps/web/.env.example` to `apps/web/.env` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_CATALOG_EMBEDDING_MODEL_KEY` (the exact fingerprint in that file). Everything in this file is shipped to the browser.
4. **Run:** `npm run dev:all` in `apps/web` (Vite on http://localhost:5173 plus the API on 8787), then describe a vibe, answer a few questions and choose **Show My Matches**.
5. **Check:** `npm test` and `npm run build` in `apps/web`.

The API reads, in order, an optional `VIBENTA_ENV_FILE` (a file kept outside the repository), the root `.env`, then `apps/web/.env`; the first value wins and real environment variables beat all files. Both `.env` files are gitignored: never commit them. The first MiniLM embed downloads the pinned model (about 90 MB) into `VIBENTA_MODEL_CACHE` (default: the OS temp directory).

Work in separate feature branches and open pull requests into `main`; read the documentation above before larger changes.

### Place photos and vibe inputs (pipeline)
`npm run enrich:media --prefix pipeline -- --type restaurants` finds free photos for each place (its website, Wikimedia Commons, Mapillary) and collects free vibe inputs (website text, Wikipedia/Wikivoyage, OSM tags, Boston license data, student reviews) into Supabase. Flags: `--dry-run`, `--tiers 1,2`, `--limit N`, `--concurrency N`, `--refresh`. It needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `pipeline/.env` and the migration `20261121200000_create_place_media.sql` applied. `MAPILLARY_TOKEN` is optional, and an optional `pipeline/demo-places.txt` (one `place_id` per line) is processed first. Design: `docs/superpowers/specs/2026-11-21-place-photos-vibe-sources-design.md`. Then `npm run enrich:photos --prefix pipeline -- --type restaurants` stores an 800 px WebP copy of each photo in the `place-photos` bucket (`--max-mb`, default 800, caps total storage; `--dry-run`, `--limit N`, `--concurrency N`).

### Place types (pipeline)
Every pipeline script (`ingest`, `enrich:media`, `enrich:photos`, `enrich:deals`, `enrich:price`) requires `--type <restaurants|museums|entertainment|parks|landmarks>`, for example `npm run ingest --prefix pipeline -- --type museums`. `enrich:price` accepts only `restaurants`. Design: `docs/superpowers/specs/2026-11-21-non-food-places-design.md`; coverage per type: `pipeline/sql/coverage.sql`.

Ingest cache files are now per type (`osm-<type>-<date>.json`, `fsq-<type>-<release>.json`); an existing `fsq-2026-01-12.json` can be renamed to `fsq-restaurants-2026-01-12.json` to avoid a refetch.

To correct a single place's address, website, phone or hours, add an entry to `pipeline/place-overrides.json` (`place_id`, `set`, `reason`, `source_url`, `checked_on`); ingest applies it on every run, and `null` clears a field.

## Deploying to Vercel
The web app (`apps/web`) deploys as one Vercel project: Vite builds the static site, and `apps/web/api/index.ts` runs the same Express app as `npm run server` (`apps/web/server/app.ts`) as a Vercel Function. `apps/web/vercel.json` sends every `/api/*` request to it. The `pipeline/` scripts are not deployed; run them locally against the hosted Supabase project.

1. **Import the repo** in Vercel and set **Root Directory** to `apps/web`. `vercel.json` sets the framework (Vite), build command and output directory.
2. **Environment variables** (Project → Settings → Environment Variables):
   - Public, shipped to the browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and optionally `VITE_CATALOG_EMBEDDING_MODEL_KEY` (only once the catalog owner verifies it). Locally these live in `apps/web/.env`; on Vercel they come from the dashboard, which makes them available both to the build (baked into the bundle, so changing them needs a redeploy) and to the API at runtime, where the signed-in photo route uses the Supabase pair to verify users. Apply them to Production and Preview.
   - Server only (never `VITE_`): `MBTA_API_KEY`, `GEMINI_API_KEY`, `VIBE_GEMINI_MODEL`, optionally `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (catalog search falls back to the `VITE_SUPABASE_*` pair; never a secret key), `VIBENTA_MODEL_CACHE=/tmp/vibenta-minilm-cache`, and `ONNXRUNTIME_NODE_INSTALL=skip` (stops `npm install` downloading CUDA binaries the function can't use).
   - Never set on Vercel: `VIBE_IMAGE_UNLIMITED` (a local dev switch that lifts the per-user daily photo cap) and `VIBENTA_ENV_FILE` / `TRANSIT_API_PORT` / `VITE_PORT` (local dev only).
3. **Supabase:** apply `supabase/migrations/` to the hosted project (`supabase db push`), then add the Vercel domain under Auth → URL Configuration (Site URL and redirect allowlist; a wildcard such as `https://*-<team>.vercel.app/**` for preview deploys), since sign-up confirmation links return to `window.location.origin`.

Known limits: MiniLM (`/api/vibe/embed`) downloads its model into `/tmp` on every cold start, so the first embed after a cold start is slow, and the ONNX runtime is the bulk of the function size (`vercel.json` excludes the non-Linux-x64 binaries to stay under the 250 MB limit). The vibe API's rate limit is per function instance, not global (the daily photo quota is kept in Supabase, so it is global). Vercel caps request bodies at 4.5 MB, above the photo route's 2 MB limit.

## Demo integrity
No fake venues, student demographics, discounts, live transit journeys, or private event details. Clearly distinguish live provider responses from labeled sample fixtures. Don't publish secrets or scrape protected business databases.

## Definition of the first complete milestone
A user opens the Boston map, filters real places, selects a card, chooses a starting point and sees a **valid transit itinerary**—or a truthful no-route/error state—on the same map.
