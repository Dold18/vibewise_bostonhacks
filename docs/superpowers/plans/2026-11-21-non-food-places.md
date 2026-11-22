# Non-food Places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put museums, parks, landmarks and entertainment venues into the Supabase catalog, each in its own table, linked through a shared `places` registry. Collect them with the same pipeline as food places, run every script with `--type`, and show them on the map from the catalog.

**Architecture:** A forward migration adds `places` (one row per place, across all types) and moves `restaurants` onto it with unchanged ids. It repoints the four shared tables (`student_reviews`, `place_photos`, `place_vibe_inputs`, `place_deals`) from `restaurant_id` to `place_ref → places.id`, and adds four type tables and two union views. A type config (`pipeline/src/placeTypes.ts`) drives Overpass/Foursquare collection, classification and per-type options. Every script resolves its table and filters from `--type`. The web catalog reads its pin index from the `catalog_places` view and its details from each pin's type table.

**Tech Stack:** Node ≥ 24 with type stripping (`node --test`), TypeScript ~7, supabase-js 2, DuckDB (Foursquare parquet), Postgres/PostGIS on Supabase (local stack via `npx supabase`, pgTAP via `npx supabase test db`), Vite + Vitest web app.

**Spec:** `docs/superpowers/specs/2026-11-21-non-food-places-design.md`

## Global Constraints

- Type names, also the table names and `places.place_type` values, in precedence order: `restaurants`, `museums`, `entertainment`, `parks`, `landmarks`.
- Food behavior must not change: `--type restaurants` gives the same rows as today's ingest (spec §7).
- `--type` is required on `ingest`, `enrich:media`, `enrich:photos`, `enrich:deals` and `enrich:price`. A missing value fails with `missing --type (expected one of restaurants, museums, entertainment, parks, landmarks)`. An unknown value fails with `invalid --type '<v>' (expected one of restaurants, museums, entertainment, parks, landmarks)`.
- `enrich:price` with any type but `restaurants` fails with `price estimates only apply to restaurants`.
- No Gemini calls in any step this plan touches. Free sources only. Existing `USER_AGENT`, robots and polite fetcher.
- Forward migrations only. Existing restaurant ids, photo rows, stored copy paths (`pipeline/<id>/…`), vibe inputs and deals keep their values.
- Ingest never moves a place to another type. Cross-type duplicates and type conflicts are skipped and listed in the run summary.
- Commits: conventional style (`feat(places): …`), **no** `Co-Authored-By` or Claude attribution lines.
- Branches: PR 1 (Tasks 1–8) on `feature/non-food-places` (already created from `origin/main`, holds the spec). PR 2 (Task 9) on `feature/non-food-layers`, cut from PR 1's branch. Never commit to `main`.
- Do not modify `catalogSemanticCandidates` or anything from `origin/feature/vibe-engine-live`. That code belongs to the Vibe workstream.
- Hosted Supabase writes (migration push, ingest/enrich without `--dry-run`) happen only in Task 10, after the user says so.

## Review Focus

1. **Upsert sending a null `id`.** Ingest upserts existing and new rows together. A row without `id` would set the type row's `id` to null on conflict, or fail the insert. Every row passed to `upsertRows` carries a numeric `id`. *(Test in Task 4.)*
2. **A typed deals run wiping other types' curated deals.** `replaceCuratedDeals` deletes every visible curated row. If `--type museums` validates the curated file against museums only, restaurant entries become "unknown place_id" and get deleted. The curated step resolves `place_id`s across all types, whatever `--type` is. *(Test in Task 6.)*
3. **A place id already registered under another type.** For example, `osm:way/5` is in `landmarks` and the `parks` ingest now claims it. This gets skipped and listed as a type conflict. It never throws a unique-violation error halfway through the run. *(Test in Task 4.)*
4. **A park that is a single OSM node** (no bounds) and has no Wikidata tag. It is dropped, and a missing `bounds` must not crash. *(Test in Task 2.)*
5. **Food layers showing other types.** Once `catalog_places` returns museum pins, a museum must never appear under Restaurants/Coffee/Bars, even if its `kind` string matches a food category. *(Test in Task 7.)*

---

## PR 1 — registry, typed pipeline, catalog compatibility

### Task 1: Registry migration, seed and database tests

**Files:**
- Create: `supabase/migrations/20261122120000_place_registry.sql`
- Create: `supabase/tests/place_registry.test.sql`
- Modify: `supabase/seed.sql`

**Interfaces:**
- Produces (used by every later task):
  - `places(id bigint identity pk, place_id text unique not null, place_type text not null check in (5 names), created_at)`; RLS on, `select` for `anon, authenticated`.
  - `restaurants.id`: no identity; FK → `places(id) on delete cascade`.
  - `student_reviews.place_ref`, `place_photos.place_ref`, `place_vibe_inputs.place_ref` (pk `(place_ref, source)`), `place_deals.place_ref`: each FK → `places(id) on delete cascade`. Indexes renamed `*_place_ref_*` / `*_place_idx`.
  - Tables `museums`, `parks`, `landmarks`, `entertainment` with the spec §5.4 columns (`kind text not null`), RLS read for `anon, authenticated`, gist index on `location`, gin on `fts`.
  - Triggers on all five type tables: `after delete` → delete the `places` row; `after update of place_id` → copy to `places.place_id`.
  - View `place_points` (service_role only; security_invoker): `place_type, id, place_id, name, lat, lng, website, address, osm_tags, media_checked_at, deals_checked_at, last_seen_at`.
  - View `catalog_places` (select for `anon, authenticated`; security_invoker): `id, place_id, place_type, source, source_id, name, location, kind, description, embedding`. For `restaurants`, `kind` is `category`.
  - `restaurant_points` is dropped.

- [ ] **Step 1: Write the pgTAP test** `supabase/tests/place_registry.test.sql` (`begin; select plan(N); … select * from finish(); rollback;`) with these assertions:
  - `has_table('places')`, each of the four new tables, `has_view('place_points')`, `has_view('catalog_places')`, `hasnt_view('restaurant_points')`.
  - `has_column('place_photos','place_ref')` and `hasnt_column('place_photos','restaurant_id')`, the same for the other three shared tables.
  - Seeded cafe: `select place_type from places where place_id = 'osm:node/990000001'` is `'restaurants'`; its `places.id = restaurants.id`; the two seeded deals have `place_ref` = that id.
  - Insert a `places` row plus a `museums` row with the same id and a `place_photos` row for it. `delete from museums where id = …` leaves 0 rows in `places` and `place_photos` for that id.
  - `update restaurants set place_id = 'osm:node/990000002' where …` leaves `places.place_id = 'osm:node/990000002'`.
  - `select count(*) from catalog_places where place_type = 'restaurants'` equals `select count(*) from restaurants`.
  - As `authenticated` (`set local role authenticated; set local request.jwt.claims …`), insert into `student_reviews (place_ref, rating, body, vibe_tags)` succeeds (column grant followed the rename).
  - A new `places` insert without an explicit id gets an id greater than every existing restaurant id.

- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx supabase start` (Docker must be running), then `npx supabase test db`
  Expected: FAIL (no `places` table).

- [ ] **Step 3: Write the migration** in the spec §5 order: create `places` → insert restaurants with their ids → `setval(pg_get_serial_sequence('public.places','id'), (select coalesce(max(id),0) from places) + 1, false)` → `alter table restaurants alter column id drop identity` + FK → for each shared table, drop its `*_restaurant_id_fkey`, rename the column, add the FK and rename the indexes → trigger functions `places_sync_delete()` / `places_sync_place_id()` and triggers on `restaurants` → the four type tables (explicit `create table` each, with triggers, RLS, grants, indexes) → drop `restaurant_points`, create both views → grants (`revoke all … from anon, authenticated` on `place_points`, `grant select … to service_role`; `grant select on catalog_places, places to anon, authenticated`).

- [ ] **Step 4: Update `supabase/seed.sql`.** First insert the `places` row (`'osm:node/990000001'`, `'restaurants'`) returning id, then insert `restaurants` with that `id`, then `place_deals` with `place_ref`.

- [ ] **Step 5: Run the tests and confirm they pass**

  Run: `npx supabase db reset && npx supabase test db`
  Expected: `All tests successful`.

- [ ] **Step 6: Commit**

  `git add supabase/ && git commit -m "feat(places): places registry, per-type tables and union views"`

### Task 2: Type config and `--type` parsing

**Files:**
- Create: `pipeline/src/placeTypes.ts`
- Test: `pipeline/test/placeTypes.test.ts`

**Interfaces:**
- Consumes: `osmCategory`, `fsqCategory` (`normalize.ts`), `metersBetween` (`geo.ts`), `OSM_AMENITIES` (`config.ts`).
- Produces:
  ```ts
  export const PLACE_TYPES = ['restaurants', 'museums', 'entertainment', 'parks', 'landmarks'] as const;
  export type PlaceType = (typeof PLACE_TYPES)[number];
  export interface OsmBounds { minlat: number; minlon: number; maxlat: number; maxlon: number }
  export interface PlaceTypeConfig {
    type: PlaceType;
    overpassFilters: string[];      // each a tag filter, e.g. '["tourism"~"^(museum|gallery)$"]'
    overpassOut: 'center' | 'bb';   // restaurants 'center' (unchanged query); others 'bb'
    osmKind(tags: Record<string, string>): string | null;   // ignores precedence
    fsqTopLevels: string[];         // first segment(s) for the DuckDB WHERE
    fsqKind(primaryLabel: string): string | null;            // ignores precedence
    keepOsm(tags: Record<string, string>, bounds: OsmBounds | null): boolean;
    keepFsq: boolean;               // false for parks: an unmatched FSQ park has no size or Wikidata
    osmTagKeys: ReadonlySet<string>;
    genericNameWords: ReadonlySet<string>;
    dealsWebsiteScan: boolean;
    priceEstimates: boolean;
  }
  export const PLACE_TYPE_CONFIG: Record<PlaceType, PlaceTypeConfig>;
  export function parseTypeOption(value: string | undefined): PlaceType;
  export function classifyOsm(tags: Record<string, string>): { type: PlaceType; kind: string } | null;   // first type in PLACE_TYPES order
  export function classifyFsq(primaryLabel: string): { type: PlaceType; kind: string } | null;
  export function boundsAreaHa(b: OsmBounds): number;
  ```

**Pinned values.** The Foursquare labels were checked against the Boston extract of release `2026-01-12` on 2026-11-21. Put that note in the file, as in `config.ts`.

| Type | `overpassFilters` → `kind` | Foursquare primary label (exact segments; kind = last segment snake_cased) | Keep |
|---|---|---|---|
| restaurants | `["amenity"~"^(restaurant\|fast_food\|cafe\|bar\|pub\|ice_cream\|food_court)$"]` → `osmCategory(amenity)` | `fsqCategory(label)` (unchanged); top level `Dining and Drinking` | `keepOsm`: no `disused:amenity` / `was:amenity` (today's rule) |
| museums | `["tourism"~"^(museum\|gallery)$"]` → tourism value | `Arts and Entertainment > Museum` (+ any third segment), `Arts and Entertainment > Art Gallery`, `Arts and Entertainment > Planetarium` | no `disused:tourism` / `was:tourism` |
| entertainment | `["amenity"~"^(theatre\|cinema\|arts_centre\|music_venue\|events_venue\|nightclub)$"]`, `["leisure"~"^(bowling_alley\|amusement_arcade\|escape_game\|miniature_golf\|trampoline_park\|ice_rink\|stadium)$"]`, `["tourism"~"^(zoo\|aquarium\|theme_park)$"]` → matched value | Under `Arts and Entertainment`: Amusement Park (+ Attraction), Aquarium, Arcade, Bowling Alley, Circus, Comedy Club, Country Dance Club, Escape Room, Gaming Cafe, Laser Tag Center, Mini Golf Course, Movie Theater (+ sub), Night Club, Performing Arts Venue (+ any sub), Pool Hall, Roller Rink, Salsa Club, Stadium (+ any sub), Water Park, Zoo (not `Zoo Exhibit`). Under `Sports and Recreation`: `Skating > Skating Rink`, `Gym and Studio > Climbing Gym`, `Paintball Field`, `Skating > Skate Park` | no `disused:`/`was:` on the matched key |
| parks | `["leisure"~"^(park\|garden\|nature_reserve)$"]`, `["natural"="beach"]` → value | Under `Landmarks and Outdoors`: Park, `Park > National Park`, `Park > Natural Park`, `Park > State or Provincial Park`, `Park > Urban Park`, Garden, Botanical Garden, Sculpture Garden, Beach, Nature Preserve, Forest (**not** Playground, Dog Park, Picnic Area) | `keepOsm`: `access` ≠ `private`, and (`wikidata` or `wikipedia` tag, or `boundsAreaHa(bounds) >= 0.5`); `keepFsq: false` |
| landmarks | `["tourism"~"^(attraction\|viewpoint)$"]`, `["historic"]["wikidata"]` → tourism value, else historic value | Under `Landmarks and Outdoors`: Historic and Protected Site, Monument, Memorial Site, Scenic Lookout, Bridge, Plaza, Pedestrian Plaza, Lighthouse, Castle, Palace, Fountain | `historic` only counts with a `wikidata` tag (in `osmKind`) |

`osmTagKeys`: restaurants keep today's set in `normalize.ts`. The others use that set plus `tourism, leisure, historic, natural, wikipedia, fee, charge, description, museum, museum_type, theatre:genre, sport, capacity, dog, lit, access, heritage, start_date, architect, toilets`. `genericNameWords`: empty for restaurants. The others get `park, parks, garden, gardens, museum, gallery, theatre, theater, cinema, playground, field, square, memorial, monument, center, centre, stadium, arena, hall, beach, reservation, reserve`. `dealsWebsiteScan`: true for all types; Task 10 may flip it per type. `priceEstimates`: restaurants only.

- [ ] **Step 1: Write the failing tests** in `pipeline/test/placeTypes.test.ts`:
  - `parseTypeOption` returns `'parks'` for `'parks'`, and throws the two exact Global Constraints messages for `undefined` and `'zoo'`.
  - `classifyOsm({ amenity: 'cafe', name: 'X' })` → `{ type: 'restaurants', kind: 'cafe' }`.
  - Precedence: `{ tourism: 'museum', historic: 'building', wikidata: 'Q1' }` → `museums`; `{ leisure: 'park', tourism: 'attraction' }` → `parks`; `{ amenity: 'restaurant', tourism: 'attraction' }` → `restaurants`.
  - `{ historic: 'memorial' }` → `null`; `{ historic: 'memorial', wikidata: 'Q2' }` → `{ type: 'landmarks', kind: 'memorial' }`.
  - `{ leisure: 'playground' }` → `null`.
  - `classifyFsq('Arts and Entertainment > Museum > Art Museum')` → `{ type: 'museums', kind: 'art_museum' }`. `'Landmarks and Outdoors > Park > Playground'` → `null`. `'Arts and Entertainment > Zoo > Zoo Exhibit'` → `null`. `'Dining and Drinking > Bar'` → `{ type: 'restaurants', kind: 'nightlife' }`. `'Arts and Entertainment > Night Club'` → `{ type: 'entertainment', kind: 'night_club' }`.
  - Parks `keepOsm`: a node with `{ leisure: 'park' }` and `bounds = null` → `false` (no throw). `{ leisure: 'park', wikidata: 'Q3' }` with `null` → `true`. A ~0.6 ha box (`minlat 42.35, maxlat 42.3506, minlon -71.06, maxlon -71.0588`) → `true`. A ~0.1 ha box → `false`. `{ leisure: 'garden', access: 'private', wikidata: 'Q4' }` → `false`.
  - `boundsAreaHa` of the 0.6 ha box is within 0.05 of the value from `metersBetween`.

- [ ] **Step 2: Run and confirm they fail**

  Run (from `pipeline/`): `node --test test/placeTypes.test.ts`
  Expected: FAIL (`Cannot find module '../src/placeTypes.ts'`).

- [ ] **Step 3: Implement `pipeline/src/placeTypes.ts`** with the interfaces and pinned values above. `fsqKind` matches segments exactly (split on `' > '`), never substrings, like `fsqCategory`.

- [ ] **Step 4: Run and confirm they pass**

  Run: `node --test test/placeTypes.test.ts && npm run typecheck`
  Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

  `git add pipeline/src/placeTypes.ts pipeline/test/placeTypes.test.ts && git commit -m "feat(places): place type config and --type parsing"`

### Task 3: Typed collection (Overpass, Foursquare, rows, merge)

**Files:**
- Modify: `pipeline/src/types.ts`, `pipeline/src/osm.ts`, `pipeline/src/foursquare.ts`, `pipeline/src/sources.ts`, `pipeline/src/normalize.ts`, `pipeline/src/merge.ts`
- Test: `pipeline/test/osm.test.ts`, `pipeline/test/foursquare.test.ts`, `pipeline/test/sources.test.ts`, `pipeline/test/normalize.test.ts`, `pipeline/test/merge.test.ts`

**Interfaces:**
- Consumes: Task 2's `PlaceTypeConfig`, `classifyOsm`, `classifyFsq`, `OsmBounds`.
- Produces:
  ```ts
  // types.ts
  export interface BaseRow { id?: number; place_id; source; source_id; name; location; address; website; phone;
    hours_raw: string | null; osm_tags: Record<string, string> | null; fsq_place_id: string | null; attribution: string; last_seen_at: string }
  export interface FoodRow extends BaseRow { category: Category; source_cuisines: string[] }
  export interface KindRow extends BaseRow { kind: string }
  export type PlaceRow = FoodRow | KindRow;
  export type RestaurantRow = FoodRow;           // kept so untouched code compiles
  export interface OsmPlace { osmId; name; lat; lng; tags; bounds: OsmBounds | null }
  // osm.ts
  export function buildOverpassQuery(bbox: Bbox, cfg: PlaceTypeConfig): string;
  export function loadOsmElements(opts: { refresh; cacheDir; today; cfg: PlaceTypeConfig }, deps?): Promise<{ elements; fromCache }>;  // cache: osm-<type>-<today>.json
  // foursquare.ts
  export function buildFsqQuery(release: string, bbox: Bbox, cfg: PlaceTypeConfig): string;
  export function loadFsqRows(opts: { hfToken; release; refresh; cacheDir; cfg: PlaceTypeConfig }): Promise<…>;  // cache: fsq-<type>-<release>.json
  // sources.ts
  export function parseOverpass(elements: OverpassElement[], cfg: PlaceTypeConfig): OsmPlace[];
  export function parseFsqRows(rows: Record<string, unknown>[], cfg: PlaceTypeConfig): FsqPlace[];
  export function osmRow(p: OsmPlace, runStart: string, cfg: PlaceTypeConfig): PlaceRow;
  export function fsqRow(p: FsqPlace, runStart: string, cfg: PlaceTypeConfig): PlaceRow;
  // normalize.ts
  export function pickOsmTags(tags: Record<string, string>, keys: ReadonlySet<string>): Record<string, string>;  // diet:* kept for any keys set, as today
  // merge.ts
  export function mergePlaces(osm, fsq, opts: { runStart; today; cfg: PlaceTypeConfig }): { rows: PlaceRow[]; … };
  ```
  - `OverpassElement` gains `bounds?: OsmBounds`. For `overpassOut: 'bb'`, the query ends `out tags bb;` and a way's or relation's position is the midpoint of `bounds`, which is the same point Overpass's `center` gives.
  - `parseOverpass` keeps an element only when `classifyOsm(tags)?.type === cfg.type && cfg.keepOsm(tags, bounds ?? null)`. It keeps today's name, position and study-area rules.
  - `parseFsqRows` keeps a row only when `cfg.keepFsq && classifyFsq(labels[0])?.type === cfg.type`.
  - Merging an OSM row with its Foursquare match: food rows keep today's field fill and cuisine union. Kind rows fill address/website/phone the same way and keep the OSM `kind`.

- [ ] **Step 1: Capture the food baseline before changing code.** From `pipeline/` on the unmodified code, run `npm run ingest -- --dry-run` (it uses the cached `osm-<today>.json` and `fsq-2026-01-12.json`, or fetches them). Then `cp .cache/rows.json .cache/rows-baseline.json` and `cp .cache/osm-$(date -u +%F).json .cache/osm-restaurants-$(date -u +%F).json` and `cp .cache/fsq-2026-01-12.json .cache/fsq-restaurants-2026-01-12.json`. Ingest names the cache by the UTC date, hence `-u`. Run the comparison in Step 5 on the same UTC day, or repeat these copies. Nothing to commit; `.cache` is git-ignored.

- [ ] **Step 2: Write the failing tests:**
  - `osm.test.ts`: `buildOverpassQuery(STUDY_BBOX, PLACE_TYPE_CONFIG.restaurants)` equals today's exact string, `[out:json][timeout:180];nwr["amenity"~"^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court)$"]["name"](42.227,-71.191,42.418,-70.986);out center tags;`. For `parks` it is `[out:json][timeout:180];(nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"](…);nwr["natural"="beach"]["name"](…););out tags bb;`. `loadOsmElements` with `cfg: museums` writes `osm-museums-<today>.json`. Update the existing tests to pass `cfg`.
  - `foursquare.test.ts` (new, or extend an existing one): `buildFsqQuery('2026-01-12', STUDY_BBOX, PLACE_TYPE_CONFIG.restaurants)` equals today's exact string. For `entertainment` the last line is `"  and (starts_with(fsq_category_labels[1], 'Arts and Entertainment') or starts_with(fsq_category_labels[1], 'Sports and Recreation'))"`.
  - `sources.test.ts`: `parseOverpass` with `cfg: parks` reads a way with `bounds` and no `center` at the bounds midpoint. It drops `{ leisure: 'park', tourism: 'museum' }` (claimed by museums), and a 0.1 ha park without Wikidata. `parseFsqRows` with `cfg: parks` returns `[]`. With `cfg: museums` it keeps `'Arts and Entertainment > Museum > History Museum'` and drops `'Dining and Drinking > Cafe'`. `osmRow` for a museum gives `kind: 'museum'`, has no `category` or `source_cuisines`, and `osm_tags` contains `fee` and `wikipedia`. Update the existing tests to pass `PLACE_TYPE_CONFIG.restaurants`.
  - `normalize.test.ts`: update the `pickOsmTags` tests to pass the restaurants key set. Add one with the museums set, keeping `tourism` and dropping `name`.
  - `merge.test.ts`: a matched museum pair fills `website` from Foursquare and keeps `kind` from OSM. Update the existing tests to pass `cfg`.

- [ ] **Step 3: Run and confirm the new tests fail**

  Run: `npm test`
  Expected: FAIL in the files above (signature or missing behavior).

- [ ] **Step 4: Implement** the interfaces above. `OSM_AMENITIES` stays in `config.ts` and is used by the restaurants config. `ingest.ts` passes `PLACE_TYPE_CONFIG.restaurants` for now, so it still compiles. Task 4 adds `--type`.

- [ ] **Step 5: Run the tests and the food regression check**

  Run: `npm test && npm run typecheck && npm run ingest -- --dry-run`, then `node -e "const assert=require('node:assert');const strip=(f)=>require(f).map((r)=>({...r,last_seen_at:''}));assert.deepStrictEqual(strip('./.cache/rows.json'),strip('./.cache/rows-baseline.json'));console.log('identical')"`
  Expected: all tests pass, then `identical`. `deepStrictEqual` ignores key order, and `last_seen_at` is blanked because it is the run's start time.

- [ ] **Step 6: Commit**

  `git commit -am "feat(places): collect OSM and Foursquare places per type"`

### Task 4: Ingest writes through the registry

**Files:**
- Create: `pipeline/src/crossType.ts`
- Modify: `pipeline/src/ingest.ts`, `pipeline/src/db.ts`
- Test: `pipeline/test/crossType.test.ts`, `pipeline/test/ingest.test.ts`, `pipeline/test/db.test.ts` (new, using the `fakeClient` pattern from `test/media/db.test.ts`)

**Interfaces:**
- Consumes: Task 3's `PlaceRow`, `mergePlaces`; Task 2's `parseTypeOption`, `PLACE_TYPE_CONFIG`; `MATCH_*` constants; `nameKey`; `parsePoint`-style EWKB decoding (copy the small decoder from `apps/web/src/catalog.ts` into `pipeline/src/geo.ts` as `parseEwkbPoint(hex: string): { lat: number; lng: number } | null`).
- Produces:
  ```ts
  // crossType.ts
  export interface OtherPlace { placeId: string; placeType: PlaceType; name: string; lat: number; lng: number }
  export function findCrossTypeDuplicates(rows: PlaceRow[], others: OtherPlace[]):
    { kept: PlaceRow[]; duplicates: Array<{ placeId: string; otherPlaceId: string; otherType: PlaceType; meters: number }> };
  // Same rules as matchSources: same nameKey ≤ MATCH_SAME_NAME_METERS, or Jaccard ≥ MATCH_SIMILARITY_THRESHOLD ≤ MATCH_SIMILAR_NAME_METERS.
  export function splitTypeConflicts(rows: PlaceRow[], registered: Map<string, PlaceType>, type: PlaceType):
    { kept: PlaceRow[]; conflicts: Array<{ placeId: string; registeredAs: PlaceType }> };
  // db.ts (table = PlaceType everywhere)
  export function fetchExisting(client, table: PlaceType): Promise<ExistingRow[]>;
  export function applyRekey(client, table: PlaceType, actions: RekeyAction[]): Promise<void>;   // collapse → delete from places by id
  export function fetchOtherTypePlaces(client, type: PlaceType): Promise<OtherPlace[]>;          // catalog_places, place_type <> type, paged
  export function fetchRegisteredTypes(client, placeIds: string[]): Promise<Map<string, PlaceType>>;  // places, chunks of 200
  export function registerPlaces(client, type: PlaceType, placeIds: string[]): Promise<Map<string, number>>;  // insert … select('id, place_id'), batches of UPSERT_BATCH_SIZE
  export function upsertRows(client, table: PlaceType, rows: Array<PlaceRow & { id: number }>, batchSize?): Promise<void>;
  export function listNotSeen(client, table: PlaceType, runStart: string): Promise<string[]>;
  // ingest.ts
  export interface CliArgs { type: PlaceType; dryRun; sources; refresh; allowPartial? }
  export function assignIds(rows: PlaceRow[], idByKey: Map<string, number>, newIds: Map<string, number>): Array<PlaceRow & { id: number }>;  // throws naming the place_id if a row has no id
  ```
- Write order in `main()` (non-dry): `fetchExisting` → `planRekey` → `applyRekey` → `fetchExisting` again (gives `idByKey` keyed `source:source_id`, including promoted rows) → new rows = rows not in `idByKey` → `fetchOtherTypePlaces` + `findCrossTypeDuplicates` on new rows → `fetchRegisteredTypes` + `splitTypeConflicts` on what's left → `registerPlaces` → `assignIds` → `upsertRows` → `listNotSeen`.
- `summarize` adds the lines `Cross-type duplicates skipped: <n>` and `Type conflicts skipped: <n>`. The skipped rows are written to `.cache/skipped-<type>.json`. `Rows missing cuisine` is printed only for `restaurants`. All dry-run and cache output files get the `-<type>` suffix.

- [ ] **Step 1: Write the failing tests:**
  - `crossType.test.ts`: a new museum row 30 m from a landmark with the same name → in `duplicates`, not `kept`. Similar name (Jaccard 0.67) at 20 m → duplicate. The same at 40 m → kept. An empty name key → kept. `splitTypeConflicts` with `registered = { 'osm:way/5': 'landmarks' }` and type `parks` puts `osm:way/5` in `conflicts`. With `registered = { 'osm:way/5': 'parks' }` it is kept.
  - `ingest.test.ts`: `parseCliArgs(['--type','museums','--dry-run'])` gives `type: 'museums'`. `parseCliArgs([])` throws `missing --type …`. **Review Focus 1:** `assignIds` with one existing key and one new place_id returns two rows whose `id`s are both numbers. With a row in neither map it throws an error containing that row's `place_id`. `summarize` prints the two new lines, and omits `Rows missing cuisine` for a non-food type.
  - `db.test.ts`: `applyRekey(client, 'parks', [{ kind: 'collapse', id: 7, fsqId: 'f' }])` calls `from('places').delete().eq('id', 7)`. `registerPlaces(client, 'parks', ['osm:way/1'])` inserts `{ place_id: 'osm:way/1', place_type: 'parks' }` and returns its id from the fake result. `upsertRows(client, 'museums', …)` targets `from('museums')` with `onConflict: 'source,source_id'`.

- [ ] **Step 2: Run and confirm they fail**

  Run: `npm test`
  Expected: FAIL (new module and functions missing; `parseCliArgs([])` doesn't throw).

- [ ] **Step 3: Implement** the interfaces and the write order above.

- [ ] **Step 4: Run the tests and a local end-to-end check**

  Run: `npm test && npm run typecheck`. Then, against the local stack (`npx supabase db reset`, with `SUPABASE_URL`/`SUPABASE_SECRET_KEY` set to the local values from `npx supabase status` for this shell only), run `npm run ingest -- --type restaurants --sources osm --allow-partial`, then `npm run ingest -- --type museums --sources osm --allow-partial`.
  Expected: tests pass. Both runs print summaries. `select place_type, count(*) from places group by 1` shows `restaurants` and `museums`. Re-running the museums command reports `Inserted: 0`.

- [ ] **Step 5: Commit**

  `git commit -am "feat(places): ingest --type writes through the places registry"`

### Task 5: Media and photo copies by type

**Files:**
- Modify: `pipeline/src/media/db.ts`, `pipeline/src/enrichMedia.ts`, `pipeline/src/enrichPhotos.ts`, `pipeline/src/media/wikimedia.ts`, `pipeline/src/media/wikivoyage.ts`, `pipeline/src/media/photoStore.ts` (parameter rename only)
- Test: `pipeline/test/media/db.test.ts`, `pipeline/test/media/enrichMedia.test.ts`, `pipeline/test/media/enrichPhotos.test.ts`, `pipeline/test/media/wikimedia.test.ts`

**Interfaces:**
- Consumes: Task 2's `parseTypeOption`, `PLACE_TYPE_CONFIG`.
- Produces:
  ```ts
  // media/db.ts — every restaurantId parameter becomes placeRef; column restaurant_id → place_ref
  export interface PhotoToStore { id: number; placeRef: number; url: string }
  export function fetchPhotosToStore(client, opts: { limit: number | null; type: PlaceType }): Promise<PhotoToStore[]>;
    // select('id, place_ref, url, places!inner(place_type)') … .eq('places.place_type', type)
  export function fetchEnrichPlaces(client, opts: { refresh: boolean; type: PlaceType }): Promise<EnrichPlace[]>;  // place_points .eq('place_type', type)
  export function writePlaceMedia(client, table: PlaceType, placeRef: number, photos, inputs, checkedAt, keepSources?): Promise<void>;
    // place_vibe_inputs upsert onConflict 'place_ref,source'; media_checked_at updated on `table`
  // wikimedia.ts / wikivoyage.ts
  export function isDistinctiveName(name: string, extraGeneric?: ReadonlySet<string>): boolean;
  export function nameMatches(haystack: string, name: string, extraGeneric?: ReadonlySet<string>): boolean;
  export function geosearchPhotos(place: EnrichPlace, http: PoliteFetcher, extraGeneric?: ReadonlySet<string>): Promise<PhotoCandidate[]>;
  // matchListing(…, opts) gains opts.extraGeneric, passed to isDistinctiveName
  // enrichMedia.ts / enrichPhotos.ts
  export interface MediaArgs { type: PlaceType; … }   // parseMediaArgs reads --type
  export interface PhotoArgs { type: PlaceType; … }   // parsePhotoArgs reads --type
  ```
- `OSM_TAGS_LEFT_OUT` in `enrichMedia.ts` gains `tourism, leisure, historic, natural, wikipedia`. Restaurants never keep those tags, so food output is unchanged. `nameCounts` counts within the run's type. `ctx.geosearch` and the Wikivoyage match pass `PLACE_TYPE_CONFIG[type].genericNameWords`.

- [ ] **Step 1: Write and update the failing tests:**
  - `media/db.test.ts`: change `restaurant_id` to `place_ref` in every expectation. `fetchEnrichPlaces(client, { refresh: false, type: 'parks' })` reads `place_points` with `eq('place_type','parks')` and `is('media_checked_at', null)`. `writePlaceMedia(client, 'museums', 9, …)` ends with `from('museums').update({ media_checked_at }).eq('id', 9)`. `fetchPhotosToStore(client, { limit: null, type: 'parks' })` calls `eq('places.place_type','parks')`.
  - `enrichMedia.test.ts` / `enrichPhotos.test.ts`: `parseMediaArgs(['--type','parks']).type === 'parks'`, and `parseMediaArgs([])` throws `missing --type …`. The same for `parsePhotoArgs`.
  - `wikimedia.test.ts`: `isDistinctiveName('The Park')` stays as today. `isDistinctiveName('Museum Park', PLACE_TYPE_CONFIG.parks.genericNameWords)` is `false`. `isDistinctiveName('Franklin Park', …parks…)` is `true`.

- [ ] **Step 2: Run and confirm they fail**

  Run: `npm test`
  Expected: FAIL in the files above.

- [ ] **Step 3: Implement** the interfaces above.

- [ ] **Step 4: Run and confirm they pass; local smoke run**

  Run: `npm test && npm run typecheck`, then on the local stack from Task 4: `npm run enrich:media -- --type museums --limit 3 --dry-run`.
  Expected: tests pass. The dry run prints a summary for 3 museums and writes `.cache/media-dry-run.json`.

- [ ] **Step 5: Commit**

  `git commit -am "feat(places): enrich:media and enrich:photos by --type"`

### Task 6: Deals and price by type

**Files:**
- Modify: `pipeline/src/deals/db.ts`, `pipeline/src/deals/curated.ts`, `pipeline/src/enrichDeals.ts`, `pipeline/src/enrichPrice.ts`, `pipeline/src/db.ts` (`fetchPriceCandidates`/`writePriceBands` keep table `restaurants`)
- Test: `pipeline/test/deals/enrichDeals.test.ts`, `pipeline/test/deals/curated.test.ts`, `pipeline/test/enrichPrice.test.ts`, `pipeline/test/deals/db.test.ts` (new, `fakeClient` pattern)

**Interfaces:**
- Produces:
  ```ts
  // deals/db.ts — restaurant_id → place_ref everywhere
  export function fetchDealPlaces(client, type?: PlaceType): Promise<DealPlace[]>;   // place_points; no type = all types (curated step)
  export function fetchPlaceRefsWithVisibleDeals(client, source: DealSource): Promise<Set<number>>;  // renamed from fetchRestaurantIdsWithVisibleDeals
  export function replaceDeals(client, placeRef: number, source, rows): Promise<void>;
  export function replaceCuratedDeals(client, rows: Array<DealRow & { placeRef: number }>): Promise<void>;
  export function markDealsChecked(client, table: PlaceType, placeRef: number, at: string): Promise<void>;
  // deals/curated.ts
  export type CuratedRow = DealRow & { placeRef: number };
  export function validateCurated(raw, placeIds: Map<string, number>, now?): { rows: CuratedRow[]; errors: string[] };
  // enrichDeals.ts: DealsArgs gains type: PlaceType. The website scan is skipped when !PLACE_TYPE_CONFIG[type].dealsWebsiteScan.
  // enrichPrice.ts: PriceArgs gains type: PlaceType; the parser throws 'price estimates only apply to restaurants' for others.
  ```
- The curated step builds its `placeIds` map from `fetchDealPlaces(client)` with **no** type, so it covers all types (Review Focus 2). The OSM `happy_hours` step and the website scan use `fetchDealPlaces(client, args.type)`.

- [ ] **Step 1: Write and update the failing tests:**
  - `enrichDeals.test.ts`: `parseDealsArgs(['--type','museums']).type === 'museums'`; `parseDealsArgs([])` throws `missing --type …`.
  - `enrichPrice.test.ts`: `parsePriceArgs(['--type','parks'])` throws `price estimates only apply to restaurants`; `['--type','restaurants']` parses.
  - `deals/db.test.ts` **(Review Focus 2):** `fetchDealPlaces(client)` makes no `eq('place_type', …)` call, and `fetchDealPlaces(client, 'museums')` makes exactly one. `markDealsChecked(client, 'parks', 4, at)` updates `from('parks')`. `replaceDeals` deletes by `eq('place_ref', …)`.
  - `curated.test.ts`: rename `restaurantId` → `placeRef` in the expectations.

- [ ] **Step 2: Run and confirm they fail**

  Run: `npm test`
  Expected: FAIL in the files above.

- [ ] **Step 3: Implement** the interfaces above.

- [ ] **Step 4: Run and confirm they pass**

  Run: `npm test && npm run typecheck && grep -rn "restaurant_id\|restaurant_points\|restaurantId" src`
  Expected: tests pass, and the grep prints nothing.

- [ ] **Step 5: Commit**

  `git commit -am "feat(places): enrich:deals by --type; price stays restaurants-only"`

### Task 7: Web catalog reads through the registry (food only)

**Files:**
- Modify: `apps/web/src/catalog.ts`
- Test: `apps/web/src/catalog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DEALS_EMBED = 'places(place_deals(kind, title, timing, schedule, source, source_url, checked_at))';
  export interface CatalogPin { placeId; placeType: string; source; sourceId; name; kind: string; lat; lon }   // `category` renamed `kind`
  /** Map layer id → which catalog rows back it. PR 1 holds only the food layers. */
  export const CATALOG_LAYERS: Record<string, { placeType: string; kind?: string }> = {
    restaurants: { placeType: 'restaurants', kind: 'restaurant' },
    coffee: { placeType: 'restaurants', kind: 'cafe' },
    bars: { placeType: 'restaurants', kind: 'nightlife' },
  };
  ```
  - `fetchIndex` reads `catalog_places` with `INDEX_COLUMNS = 'place_id, place_type, source, source_id, name, kind, location'`.
  - `nearestByCategory` keeps pins whose `placeType` **and** (when set) `kind` match the layer.
  - Details are fetched from `pin.placeType`'s table (PR 1: only `restaurants`). The embedded deals arrive as `row.places.place_deals`, are passed to `toDeals`, and the embed-unavailable fallback is unchanged.

- [ ] **Step 1: Update and write the failing tests** in `catalog.test.ts`:
  - The `toPin` fixture rows gain `place_type` and `kind`, and the pins carry `placeType`.
  - `fetchDetailsWith` requests a column list ending in the new `DEALS_EMBED`. It parses `{ place_id, …, places: { place_deals: [validDeal, malformed] } }` into one deal.
  - **Review Focus 5:** `nearestByCategory` with a pin `{ placeType: 'entertainment', kind: 'cafe' }` next to a restaurants cafe returns only the restaurants pin for `coffee`.
  - `isCatalogCategory({ id: 'museums', … })` is `false` in PR 1.

- [ ] **Step 2: Run and confirm they fail**

  Run (from `apps/web/`): `npx vitest run src/catalog.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** the changes above.

- [ ] **Step 4: Run and confirm they pass; check in the browser on the local stack**

  Run: `npm test && npm run build` (from `apps/web/`). Then point the web app at the local stack: copy the local URL and publishable key from `npx supabase status` into `apps/web/.env.localdb.local`, the existing local-db env file. Start the preview and open a food card near Kenmore. The seeded "TEST ONLY — Deal Marker Cafe" shows its two test deals.
  Expected: tests and build pass. The card shows the deals, and the console has no `[catalog] deals unavailable` warning.

- [ ] **Step 5: Commit**

  `git commit -am "feat(places): web catalog reads the registry; food layers unchanged"`

### Task 8: Docs, coverage query, full verification, PR 1

**Files:**
- Modify: `docs/DATA_MODEL.md` (new §3d; `restaurant_id` → `place_ref` in §3b/§3c; `restaurant_points` → `place_points`), `docs/DECISIONS.md` (P-016: per-type tables, `places` registry, `--type`, vibe ranking left to the Vibe workstream), `README.md` and any runbook lines (`npm run ingest` → `npm run ingest -- --type restaurants`, likewise for each enrich script)
- Create: `pipeline/sql/coverage.sql`: one row per `place_type` with `rows`, `with_address`, `with_website`, `with_hours`, `with_photo` (at least one visible `place_photos` row), `with_vibe_inputs`. Built from `catalog_places`, the type tables, `place_photos` and `place_vibe_inputs`.

- [ ] **Step 1: Write the docs and `coverage.sql`.** Run `coverage.sql` on the local stack (`npx supabase db reset`, then the Task 4 ingest commands, then `psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" -f pipeline/sql/coverage.sql`). Expected: one row each for `restaurants` and `museums`.

- [ ] **Step 2: Full verification**

  Run: `npx supabase db reset && npx supabase test db`; in `pipeline/`: `npm test && npm run typecheck`; in `apps/web/`: `npm test && npm run build`.
  Expected: every command passes. Record the pass counts for the PR description.

- [ ] **Step 3: Commit and open PR 1**

  `git add -A docs pipeline/sql README.md && git commit -m "docs(places): data model, P-016 and --type runbook"`. Push `feature/non-food-places` and open a PR against `main`. Use the WORKSTREAMS.md template. State that **the migration must not be pushed to the hosted project until this PR merges**, and that `catalog.ts` overlaps with `origin/feature/vibe-engine-live` (`catalogSemanticCandidates` should read `catalog_places` when the Vibe workstream is ready).

---

## PR 2 — new map layers (Map/discovery owners review)

### Task 9: Landmarks and entertainment layers; museums and parks from the catalog

Branch: `git switch -c feature/non-food-layers feature/non-food-places`.

**Files:**
- Modify: `apps/web/src/osm.ts` (`CATEGORIES`), `apps/web/src/pinColors.ts`, `apps/web/src/catalog.ts`, `apps/web/src/discovery/mapLayers.ts`
- Test: `apps/web/src/catalog.test.ts`, `apps/web/src/osm.test.ts`, `apps/web/src/discovery/__tests__/mapLayers.test.ts`

**Interfaces:**
- Consumes: Task 7's `CATALOG_LAYERS`, `CatalogPin`, `DEALS_EMBED`.
- Produces:
  - `CATEGORIES` gains `{ id: 'landmarks', label: 'Landmarks', icon: '🗿', selector: '["tourism"~"^(attraction|viewpoint)$"]', tileSubclasses: ['attraction', 'viewpoint'] }` and `{ id: 'entertainment', label: 'Entertainment', icon: '🎭', selector: '["amenity"~"^(theatre|cinema|arts_centre|music_venue|nightclub)$"]', tileSubclasses: ['theatre', 'cinema', 'arts_centre', 'nightclub'] }`.
  - `PIN_COLORS` gains `landmarks: '#8e24aa'` and `entertainment: '#f9a825'`. Run the vibe-theme contrast tests; if they flag either color, pick the nearest that passes.
  - `CATALOG_LAYERS` gains `museums: { placeType: 'museums' }`, `parks: { placeType: 'parks' }`, `landmarks: { placeType: 'landmarks' }`, `entertainment: { placeType: 'entertainment' }`.
  - Non-food details use `KIND_DETAIL_COLUMNS = 'place_id, address, website, phone, kind, hours_raw, osm_tags, attribution'` plus `DEALS_EMBED`, from the pin's table. `CatalogDetails.price_band`/`price_source`/`cuisines` become optional. `pinToPlace` labels a non-food place `humanize(kind)` and sets no `catalog:price_*` tags.
  - `ACTIVITY_TYPE_LAYERS` gains `sightseeing: ['landmarks']`, `games_entertainment: ['entertainment']`, `sports_recreation: ['entertainment']`, `live_music: ['entertainment']`.

- [ ] **Step 1: Write the failing tests:**
  - `catalog.test.ts`: `isCatalogCategory` is true for `museums`, `parks`, `landmarks` and `entertainment`. `pinToPlace` of a museum pin with details `{ kind: 'art_museum', website: 'https://x' }` gives `category: 'Art museum'`, `tags.website`, and no `catalog:price_band` tag. Details for a mixed list of restaurant and park ids make one query per type table.
  - `osm.test.ts`: `matchesSelector({ tourism: 'viewpoint' }, landmarks.selector)` and `matchesSelector({ amenity: 'cinema' }, entertainment.selector)` are true.
  - `mapLayers.test.ts`: choosing `sightseeing` and `live_music` yields layers `['landmarks', 'entertainment']` and no `unsupportedActivityTypes`. `shopping` is still unsupported.

- [ ] **Step 2: Run and confirm they fail**

  Run (from `apps/web/`): `npm test`
  Expected: FAIL in the three files.

- [ ] **Step 3: Implement** the changes above.

- [ ] **Step 4: Run, build and check in the browser**

  Run: `npm test && npm run build`. Start the preview against the local stack with museums ingested (Task 4). Choose *Activities & entertainment → Museums & galleries*, open a museum card, and screenshot it. Also confirm that a Landmarks layer falls back to Overpass with the catalog env unset.
  Expected: tests and build pass. The museum card shows its address/website from the catalog with no price row. The fallback shows Overpass landmarks.

- [ ] **Step 5: Commit and open PR 2**

  `git commit -am "feat(map): landmarks and entertainment layers; non-food places from the catalog"`. Push and open a PR against `main`, noting that it depends on PR 1 and asks the Map/discovery owners to review.

---

## After PR 1 merges — data runs (ask the user before each hosted write)

### Task 10: Dry runs, hosted migration, ingest and enrichment

- [ ] **Step 1: Dry-run every new type** (no database needed): `npm run ingest -- --type <t> --dry-run --refresh` for `museums`, `entertainment`, `parks`, `landmarks`, in that order. Read each summary and sample 20 rows from `.cache/rows-<t>.json`. Tune the Task 2 lists only where samples are clearly wrong. Check the parks count (expect hundreds, not thousands) and the OSM↔Foursquare match rate for `parks` and `landmarks`. If clear matches are missed, raise `MATCH_SAME_NAME_METERS` for those types only. Commit any config changes with their test updates.
- [ ] **Step 2: With the user's go-ahead, push the migration to the hosted project** (`npx supabase db push`). Then run a `--type restaurants` dry run and confirm `Inserted: 0`.
- [ ] **Step 3: With the user's go-ahead, ingest** each type in precedence order (`museums`, `entertainment`, `parks`, `landmarks`) and record each summary's cross-type duplicates and type conflicts.
- [ ] **Step 4: `npm run enrich:media -- --type <t>`** for each type, then `enrich:photos -- --type <t>`.
- [ ] **Step 5: `npm run enrich:deals -- --type <t> --dry-run`** for each type. Review the website-scan matches. Set `dealsWebsiteScan: false` for any type with false positives (commit with a test), then run without `--dry-run`.
- [ ] **Step 6: Run `pipeline/sql/coverage.sql`** on the hosted project. Add a "Run record" section to the spec with the per-type numbers. Photos and vibe inputs should be in the restaurants' range; address/website/hours are recorded, not gated.
