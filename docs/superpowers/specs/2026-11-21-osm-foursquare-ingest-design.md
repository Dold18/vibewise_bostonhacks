# OSM + Foursquare catalog ingest — design

> **Status:** Draft for approval · 2026-11-21 · branch `maps-data`
> **Implements:** DECISIONS.md P-009 (catalog sources), DATA_MODEL.md §4 (`restaurants` table) and §5 step 1 (collect places).
> **Workstream:** the catalog belongs to D — Integration (WORKSTREAMS.md). Its owner reviews the PR. P-009 and DATA_MODEL.md are still *proposed*.

## 1. Intent

Every filter and every later enrichment step (scraping, menu profile, price, vibe, embeddings, transit proximity) needs one stored catalog of real Boston food and drink places. Today the map gets places from live Overpass calls in the browser (`apps/web/src/osm.ts`). Those are unreliable (public servers are often at capacity) and can't be filtered by price, cuisine or hours.

This work builds the **first layer** of that catalog: an offline batch job that collects places from OpenStreetMap and Foursquare OS Places, merges records that describe the same place, and upserts them into Supabase `restaurants`. Later steps fill in the remaining columns.

## 2. Goals, non-goals, anti-goals

**Goals**
- A migration that creates `restaurants` (DATA_MODEL.md §4) plus one new column, `fsq_place_id`.
- `npm run ingest` in `pipeline/` loads all food and drink places in the study area into Supabase. Re-running it is safe.
- The rules for normalizing names, matching records, mapping categories and merging fields are unit-tested.

**Non-goals (later steps or other workstreams)**
- Website scraping, menu profiles, price, normalized `hours` (only `hours_raw` is stored), vibe, embeddings, Yelp IDs.
- `stations` / `restaurant_stations` and the MBTA routing tables (Transit workstream B).
- `student_reviews`.
- Switching the web map from live Overpass to Supabase (Map workstream A; a separate change).
- Deleting places that vanish from the sources. They are logged, not removed (see §6.7).
- Any change to `Place` in CONTRACTS.md. Ingest only writes the database.

**Anti-goals: these would make the work a failure even if it ran**
- Any Google Places content. Any Yelp content beyond an ID (none is collected here at all).
- Hammering public Overpass servers: no anonymous clients, no tight retry loops, no per-place queries.
- Treating unknown as known. Missing hours, price or cuisine stay `null` / empty / `'unknown'`.
- The Supabase secret key reaching the web app or git.
- Re-runs wiping columns that later enrichment steps fill in.
- Duplicate pins for one place (OSM and Foursquare copies both shown).

## 3. Constraints

- **TypeScript** (brief §4, decided). Node 24 is installed.
- **OSM via Overpass:** batch only, a descriptive `User-Agent`, retry with backoff (P-009). Attribution: `© OpenStreetMap contributors (ODbL)`.
- **Foursquare OS Places:** Apache 2.0. Keep the attribution notice. Current releases are gated: Hugging Face dataset `foursquare/fsq-os-places` (approval requested 2026-11-21; latest release `dt=2026-01-12`). The old public S3 bucket stopped receiving releases in October 2025.
- **Supabase GitHub integration:** migrations in `supabase/migrations/` run against **production** when merged into `main`. There are no preview branches (Free plan), so migrations are tested locally first (`supabase db reset`).
- **Secrets** live in `pipeline/.env`, which the root `.gitignore` already ignores. A committed `pipeline/.env.example` lists the variable names only.
- **Hackathon rules:** brief §11 says to check the BostonHacks 2026 rules on pre-collected data before running this against real data. *(Team action, not code.)*

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | **One TypeScript script:** fetch Overpass, read Foursquare's Boston rows with DuckDB, normalize and merge in memory, upsert with `supabase-js`. | Merge logic lives in TypeScript rather than the database. In exchange, the risky matching rules are plain, unit-testable functions, and only one migration is needed. At a few thousand places, in-memory 50 m matching is fast. |
| B | Load raw rows into staging tables, then merge in SQL with PostGIS. | Merge runs next to the data and can be re-run from Studio. It needs more migrations (each one hits production on merge) and SQL rules that are harder to test and change mid-hackathon. |
| C | A scheduled Supabase Edge Function. | No local setup. But Edge Function time and memory limits are tight for Parquet reads plus thousands of rows, and it's harder to debug. The docs call this an offline batch job. |

**Picked: A**, because it matches the TypeScript decision, keeps migrations to one, and makes record matching testable.

## 5. Decisions already made with the team

- **Place types: all food and drink.** OSM `amenity` ∈ {`restaurant`, `fast_food`, `cafe`, `bar`, `pub`, `ice_cream`, `food_court`}. Foursquare places whose category labels sit under `Dining and Drinking`.
- **Foursquare access:** request Hugging Face access now. Build the OSM half first so nothing waits on approval. Fallback if approval doesn't arrive in time: the last public S3 release (stale since 2025), marked as such in the logs.
- **Approach A** (above). Code in a new `pipeline/` folder at the repo root.
- **Foursquare freshness: recently refreshed only.** Places that exist only in Foursquare are kept only if Foursquare refreshed them within about the last two years. This keeps coverage OSM lacks without filling the map with dead venues. Rejected alternatives: Foursquare only filling OSM gaps (misses places OSM lacks), and everything without a closed date (too much junk).

## 6. Design

### 6.1 Layout

```
pipeline/
├── package.json         scripts: ingest, test, typecheck
├── tsconfig.json
├── .env.example         SUPABASE_URL, SUPABASE_SECRET_KEY, HF_TOKEN, FSQ_RELEASE
├── .gitignore           .cache/
├── src/
│   ├── ingest.ts        entry point: flags, orchestration, summary log
│   ├── config.ts        bbox, OSM amenity list, user agent, thresholds
│   ├── osm.ts           Overpass fetch (mirrors, backoff, cache) → OsmPlace[]
│   ├── foursquare.ts    DuckDB read of the HF Parquet → FsqPlace[]
│   ├── normalize.ts     name normalization, category + cuisine mapping, address
│   ├── merge.ts         matching + field merge → RestaurantRow[]
│   └── db.ts            upsert + clean-up against Supabase
└── test/                node:test unit tests with small fixtures
supabase/migrations/<timestamp>_create_restaurants.sql
```

**Runtime:** Node 24 runs `.ts` directly (type stripping), so no build step is needed. Code sticks to erasable TypeScript syntax: no enums or namespaces. Tests use the built-in `node --test`. Env loads with `node --env-file=.env`. Type-checking with `tsc --noEmit` uses the same TypeScript version as `apps/web`.

**Dependencies:** `@supabase/supabase-js` and `@duckdb/node-api`. Nothing else is required.

### 6.2 Study area
One bounding box covering Boston, Cambridge, Somerville and Brookline: **south 42.227, west −71.191, north 42.418, east −70.986**. It lives in `config.ts`. The area isn't limited to station walk radius here. That needs the Transit workstream's `stations` table, and the scraping step can limit itself later.

### 6.3 OSM collection (`osm.ts`)
- **Query:** one Overpass query over the bbox: `nwr["amenity"~"^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court)$"]["name"](bbox); out center tags;` with `[timeout:180]`.
- **Endpoints:** the same mirrors as `apps/web/src/osm.ts`, tried in order.
- **Request headers:** `User-Agent: vibewise-ingest/0.1 (+https://github.com/Dold18/vibewise_bostonhacks)`.
- **Retries:** exponential backoff on 429/5xx/timeouts, max 4 attempts per mirror, starting at 5 s.
- **Cache:** the raw response is saved to `pipeline/.cache/osm-<date>.json`. Re-runs on the same day reuse it unless `--refresh` is passed.
- **Skipped:** elements with `disused:amenity`, `was:amenity`, or no usable coordinate.
- **Output fields:** id (`node/123`), name, lat/lng (`center` for ways and relations), tags.

### 6.4 Foursquare collection (`foursquare.ts`)
- **Reading the data:** DuckDB with the `httpfs` extension and a Hugging Face secret from `HF_TOKEN`. It reads `hf://datasets/foursquare/fsq-os-places/release/dt=${FSQ_RELEASE}/places/parquet/*.parquet`, filtering in SQL to the bbox, `date_closed IS NULL`, and at least one category label starting with `Dining and Drinking`. DuckDB pushes the filter down, so only matching row groups are fetched.
- **Column names to verify:** the expected columns are `fsq_place_id, name, latitude, longitude, address, locality, region, postcode, tel, website, fsq_category_labels, date_closed`. Verify them against the dataset card at build time, since they're not confirmed. If a name differs, adapt the query in this one file.
- **Staleness filter (team decision, §5).** Foursquare OS Places includes many dead or unverified venues that have no `date_closed`.
  - **Foursquare-only rows:** a record that matches no OSM place becomes its own row only if `date_refreshed` is within `FSQ_MAX_AGE_DAYS` (730, about two years) of the run date. The column name is to be verified, like the others.
  - **Filling OSM gaps:** any non-closed record may still match an OSM place and fill gaps there. OSM values win anyway.
  - **Reporting:** stale records that match nothing are dropped and counted in the summary.
- **Cache:** the Boston extract is saved to `pipeline/.cache/fsq-<release>.json`.
- **Missing token:** without `HF_TOKEN`, Foursquare is skipped with a clear warning. Ingest still loads OSM (`--sources=osm` also forces this).

### 6.5 Normalization (`normalize.ts`)
- **Name key** (for matching only, never stored): NFKD fold, then remove accents and lowercase. `&` → `and`. Drop punctuation and a leading `the`. Collapse whitespace.
- **`category`** (CONTRACTS.md `PlaceCategory`). *(Builder's call, from review.)* Foursquare is mapped on the **second segment** of its category path, matched exactly, never by substring. A substring match turns "Steakhouse" into a café and "Barbecue" into a bar. Only the **first** label (Foursquare's primary category) counts.

  | OSM `amenity` | Foursquare 2nd segment under `Dining and Drinking` | `category` |
  |---|---|---|
  | `cafe` | `Cafe, Coffee, and Tea House` (and its children) | `cafe` |
  | `bar`, `pub` | `Bar`, `Brewery`, `Lounge`, `Night Club` | `nightlife` |
  | `restaurant`, `fast_food`, `ice_cream`, `food_court` | everything else (`Restaurant`, `Bakery`, `Dessert Shop`, …) | `restaurant` |

  `nightlife` means places whose main business is drinks. A "Sushi Bar" sits under `Restaurant` in Foursquare's hierarchy, so it stays a restaurant. Check the exact segment names against the dataset's categories file at build time and keep the table in `config.ts`.

- **Cuisines** are lowercase, snake_case and de-duplicated. *(Builder's call, from review: the menu-scraping step later adds cuisines too, so ingest must not own the column a later step writes.)* Ingest writes **`source_cuisines`**:
  - OSM: `cuisine` split on `;`.
  - Foursquare: the deepest label segment under `Restaurant`, with the word `Restaurant` removed (e.g. `… > Japanese Restaurant` → `japanese`).
  - A merged place takes the union of both.

  The menu step later writes `menu_cuisines`. `cuisines` becomes a generated column (`source_cuisines || menu_cuisines`), so the filters in DATA_MODEL §6 still read `cuisines` and neither step can wipe the other's values.
- **`address`:**
  - OSM: `addr:housenumber addr:street, addr:city addr:postcode`.
  - Foursquare: `address, locality postcode`.
  - If neither has an address, store `null`.
- **`phone` / `website`:** stored as received, with trimmed whitespace. An OSM `contact:*` value is used when the plain tag is missing.
- **`hours_raw`:** OSM `opening_hours` as received. `hours` stays `null` in this step.
- **`osm_tags`:** only vibe-relevant keys: `outdoor_seating`, `internet_access`, `takeaway`, `delivery`, `wheelchair`, `diet:*`, `opening_hours`, `amenity`, `cuisine`.

### 6.6 Matching and merge (`merge.ts`)
- **De-duplicate within each source first.** *(Builder's call, from review.)* Foursquare has many duplicate records of one venue, and OSM sometimes tags both a node and its building way. Within each source, records with equal name keys ≤ 50 m apart collapse into one. Keep the record with the most non-empty fields; ties go to the OSM node, or the oldest Foursquare id. The dropped ids appear in the match report.
- **When an OSM and a Foursquare record are the same place:**
  - their name keys are equal and they're ≤ 50 m apart; or
  - token-set Jaccard similarity of the name keys is ≥ 0.6 and they're ≤ 25 m apart.
- **One match per record:** each Foursquare record matches at most one OSM record (the nearest qualifying one), and vice versa.
- **Merged row:**
  - Identity: `source='osm'`, `source_id` = OSM id, `place_id='osm:<id>'`, `fsq_place_id` = the Foursquare id.
  - OSM values win wherever they're present. Foursquare fills a missing `address`, `website` or `phone`.
  - `category` comes from OSM. `cuisines` is the union.
  - `attribution = '© OpenStreetMap contributors (ODbL); Foursquare OS Places (Apache 2.0)'`.
- **OSM-only row:** `source='osm'`, OSM attribution.
- **Foursquare-only row:** `source='foursquare'`, `source_id` = `fsq_place_id` = the Foursquare id, `place_id='fsq:<id>'`, and `attribution = 'Foursquare OS Places (Apache 2.0)'`.
- **Thresholds:** 50 m, 25 m and 0.6 are constants in `config.ts`. Tune them by inspecting the dry-run match report (§6.8).

### 6.7 Writing to Supabase (`db.ts`)
- **Upsert:** batches of 500 on conflict `(source, source_id)`.
- **Columns ingest owns:** the payload contains only these: `place_id, source, source_id, name, location, address, website, phone, category, source_cuisines, hours_raw, osm_tags, fsq_place_id, attribution, last_seen_at`. Columns from later steps (`menu_cuisines`, price, profile, vibe, embeddings, `yelp_business_id`, `last_scraped_at`) are never sent, so re-runs can't overwrite them.
- **`location`:** sent as EWKT `SRID=4326;POINT(lng lat)`, which PostgREST casts to `geography`.
- **Re-keying before the upsert.** *(Builder's call, from review.)* The point is to keep each row's internal `id`, and with it enrichment and anything linked to the row (stations, reviews). `fsq_place_id` is unique, so these steps run **before** the upsert, in this order:
  1. **Foursquare id moved:** an OSM row whose `fsq_place_id` is now matched to a different place has it set to `null`.
  2. **Promote:** a `source='foursquare'` row that now matches an OSM place with no existing row is updated in place to `source='osm'`, with the OSM `source_id` and `place_id`. Its `id` and enrichment survive.
  3. **Collapse:** a `source='foursquare'` row that now matches an OSM place that already has a row is deleted. This is the only delete ingest performs. The id is logged as a loss in the summary, because its attached rows cascade.
  4. **Upsert** as above.

  supabase-js has no transactions. If a run fails partway through, re-running converges, because each step only acts on rows that still need it. Changing `place_id` on promotion is acceptable while nothing outside the database stores place ids yet (pre-launch).
- **`last_seen_at`** is set to the run's start time on every row the run writes. *(Builder's call, from review.)* Rows with an older `last_seen_at` are counted and listed as "not seen this run" in the summary, never deleted. Readers can hide them later with `last_seen_at >= (select max(last_seen_at) from restaurants)`; that's a Map workstream change, not part of this work.

### 6.8 Running it
- `npm run ingest`: fetch (or reuse cache), merge, upsert. The target is whatever `SUPABASE_URL` points at: local (`http://127.0.0.1:54321`) or hosted.
- `--dry-run`: no database writes. It writes `pipeline/.cache/rows.json` and `pipeline/.cache/matches.json`, the matched pairs with distance and similarity, for eyeballing thresholds.
- `--sources=osm|fsq|all` (default `all`). `--refresh` ignores caches.
- **Summary printed at the end:** counts per source, matched pairs, inserted / updated / superseded / vanished, and rows with no cuisine, address or website.
- **Run order:**
  1. Local Supabase (`supabase start`, `supabase db reset`).
  2. `--dry-run` against real data, then inspect the match report.
  3. Load local and check in Studio.
  4. Load the hosted project, once the migration is on `main`.

### 6.9 Migration
`supabase/migrations/<timestamp>_create_restaurants.sql`:
- **Extensions:** `create extension if not exists postgis with schema extensions;` and the same for `vector`.
- **Table:** `restaurants` as DATA_MODEL.md §4, with its four indexes, plus these changes:
  - **add** `fsq_place_id text unique`;
  - **add** `last_seen_at timestamptz`;
  - **replace** `cuisines` with `source_cuisines text[] not null default '{}'`, `menu_cuisines text[] not null default '{}'`, and `cuisines text[] generated always as (source_cuisines || menu_cuisines) stored`. The existing GIN index stays on `cuisines`.
- **Row Level Security:** enabled. One policy allows `select` for `anon` and `authenticated`. There are no write policies, so only the secret key (which bypasses RLS) can write.
- **Excluded:** `stations`, `restaurant_stations` and `student_reviews` (other owners or later steps).

DATA_MODEL.md §4 gets the same changes in this PR, so the doc and schema don't drift.

### 6.10 Tests (`node --test`)
- **Name key:** accents, `&`, a leading "The", punctuation.
- **Category mapping:** for each OSM amenity and for sample Foursquare labels.
- **Cuisine parsing:** for both sources.
- **Category mapping:** "Steakhouse" → `restaurant`, "Barbecue" → `restaurant`, "Sushi Bar" → `restaurant`, "Cocktail Bar" → `nightlife`; only the first label counts.
- **De-duplication within a source:** duplicates collapse; the record with the most fields is kept.
- **Foursquare freshness:** an unmatched record refreshed 3 years ago is dropped; refreshed 1 year ago it is kept; a stale record that matches OSM still fills gaps.
- **Matching:** same name at 30 m matches; same name at 80 m doesn't; similar name at 20 m matches; similar name at 40 m doesn't; two candidates → nearest wins; one-to-one enforced.
- **Field merge:** OSM wins; Foursquare fills gaps; source cuisines union.
- **Element conversion:** OSM element → row (node and way-with-center), skip disused.
- **Re-key planning** (pure function from existing rows + new rows → actions): Foursquare id moved, promote, collapse, no-op.

Network and database calls aren't unit-tested. They're verified by the run order in §6.8.

## 7. Left to the builder
- Exact retry timings, batch size and log formatting.
- Exact Overpass mirrors beyond the two in `apps/web/src/osm.ts`.
- How the Foursquare query adapts if column names differ from §6.4.
- Whether to share a tiny haversine helper or duplicate the one in `apps/web/src/osm.ts` (keep `apps/web` untouched either way).

## 8. Open items for the team (don't block building)
- **Integration owner sign-off.** This is their lane, and it changes the proposed schema: it adds `fsq_place_id` and `last_seen_at`, and splits `cuisines` into source and menu columns.
- **The hackathon rule** on pre-collected data (§3).
- **Hugging Face approval timing.** If it's late, use the stale public release.
