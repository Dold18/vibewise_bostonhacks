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
The repository currently contains only a minimal starting README and planning documentation; the application framework and package manager have **not** been chosen yet.

1. Read the documentation above.
2. Confirm pending decisions in `docs/DECISIONS.md` (framework, map, routing source).
3. Create the minimal app scaffold and canonical TypeScript types.
4. Work in separate feature branches; integrate into `develop` (once created/approved), not `main`.
5. Keep the app runnable and verify each [roadmap](docs/ROADMAP.md) milestone before advancing.

Setup, run, lint and test commands will be added **after** the scaffold exists. No sample command in this README should be mistaken for a working command today.

### Place photos and vibe inputs (pipeline)
`npm run enrich:media --prefix pipeline -- --type restaurants` finds free photos for each place (its website, Wikimedia Commons, Mapillary) and collects free vibe inputs (website text, Wikipedia/Wikivoyage, OSM tags, Boston license data, student reviews) into Supabase. Flags: `--dry-run`, `--tiers 1,2`, `--limit N`, `--concurrency N`, `--refresh`. It needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `pipeline/.env` and the migration `20261121200000_create_place_media.sql` applied. `MAPILLARY_TOKEN` is optional, and an optional `pipeline/demo-places.txt` (one `place_id` per line) is processed first. Design: `docs/superpowers/specs/2026-11-21-place-photos-vibe-sources-design.md`. Then `npm run enrich:photos --prefix pipeline -- --type restaurants` stores an 800 px WebP copy of each photo in the `place-photos` bucket (`--max-mb`, default 800, caps total storage; `--dry-run`, `--limit N`, `--concurrency N`).

### Place types (pipeline)
Every pipeline script (`ingest`, `enrich:media`, `enrich:photos`, `enrich:deals`, `enrich:price`) requires `--type <restaurants|museums|entertainment|parks|landmarks>`, for example `npm run ingest --prefix pipeline -- --type museums`. `enrich:price` accepts only `restaurants`. Design: `docs/superpowers/specs/2026-11-21-non-food-places-design.md`; coverage per type: `pipeline/sql/coverage.sql`.

Ingest cache files are now per type (`osm-<type>-<date>.json`, `fsq-<type>-<release>.json`); an existing `fsq-2026-01-12.json` can be renamed to `fsq-restaurants-2026-01-12.json` to avoid a refetch.

## Demo integrity
No fake venues, student demographics, discounts, live transit journeys, or private event details. Clearly distinguish live provider responses from labeled sample fixtures. Don't publish secrets or scrape protected business databases.

## Definition of the first complete milestone
A user opens the Boston map, filters real places, selects a card, chooses a starting point and sees a **valid transit itinerary**—or a truthful no-route/error state—on the same map.
