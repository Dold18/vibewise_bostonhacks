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
