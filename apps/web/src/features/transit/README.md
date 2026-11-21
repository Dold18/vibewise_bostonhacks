# Transit engine (Tier 0 / Tier 1, subway only)

Spec: [PROJECT_BRIEF.md §9](../../../../../PROJECT_BRIEF.md), decision D-007 (proposed). Pure functions over committed JSON; no network, no API key.

- `engine.ts` — `nearestStop`, `sharedPatterns`, `direction`, `buildLeg`, `planTripSkeleton` (+ `planTier1`, which also reports the chosen pattern).
- `types.ts` — CONTRACTS.md types (verbatim copies) plus `*Draft` variants where `durationSec` may be `null` (timing layer not built yet).
- `data/{stops,patterns,shapes}.json` — generated; do not edit by hand.

## Re-download the raw feed and rebuild
The raw GTFS (`data/gtfs/`, ~280 MB) and any `*.zip` are gitignored and never committed.

    bash apps/web/scripts/transit/fetch-gtfs.sh     # downloads https://cdn.mbta.com/MBTA_GTFS.zip, unzips to data/gtfs/, rebuilds JSON
    node apps/web/scripts/transit/build-transit-data.ts   # rebuild only, from an existing data/gtfs/

Needs Node >= 22 (runs TypeScript directly). Test: `node apps/web/scripts/transit/test-engine.ts`.

## Live layer (needs MBTA V3; key optional)
- `mbta.ts` — client (`https://api-v3.mbta.com`, `x-api-key` header, 429 wait/retry, no fabricated data) and Boston service-day helpers.
- `departures.ts` — `departures(stop)`: `/predictions`, else `/schedules` (labeled `scheduled`), else `[]`. `departuresWithStatus` also says ok/empty/error.
- `ride.ts` — `planTripLive(origin, destination, {now})`: Tier 1 + real ride time from `/schedules` + the service-running gate. Returns `ok | no_tier1_route | no_service | error`; only `ok` is drawable. Branch-agnostic trips are queried by `route_id + direction_id` (D-008).
- Key: set `MBTA_API_KEY` in `.env` (copy `/.env.example`); server-side only. Keyless works at 20 req/min. Live test: `node apps/web/scripts/transit/test-live.ts`.
- Time labels: `live_predicted` (/predictions), `scheduled` (/schedules), walk legs are straight-line estimates. Option total excludes the wait for the train.

## Tier 2 (one transfer, greedy)
- `hubs.ts` — the line-pair → hub table (data only; audit/correct here).
- `tier2.ts` — `tier2Candidates` (all pattern-valid transfers, greedy order) and `planTier2` (the first): for each relevant line pair, first hub where BOTH legs validate by route pattern (`validateHub` → `selectRideablePattern`, the same function Tier 1 uses). First valid wins; no comparison of hubs. No candidate/valid hub → `no_tier1_route` with reason `no_candidate_hub` / `no_valid_hub` (Tier 0 fallback).
- P-012 (Proposed): one walk transfer, Orange@Haymarket ↔ Green@Government Center (≤ 400 m straight-line, labeled estimate), tried after in-station hubs. The live layer moves to the next pattern-valid hub when one fails the service gate.
- `planTripLive` tries Tier 1, then Tier 2 only when the stops share no pattern. Each leg is service-gated independently; leg B is gated at leg A's scheduled arrival + transfer walk + `TRANSFER_BUFFER_SEC` (120 s). Results carry `lastTrainBack` for the final leg.
- Tests: `node apps/web/scripts/transit/test-tier2.ts` (hub audit, validation proofs, live cases).
