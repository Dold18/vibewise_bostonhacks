# OSM + Foursquare Catalog Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline `npm run ingest` job in `pipeline/` that loads Boston-area food and drink places from OpenStreetMap and Foursquare OS Places into the Supabase `restaurants` table, merging duplicates, safe to re-run.

**Architecture:**
- **Pure core:** every rule is a plain, unit-tested function: name normalization, category and cuisine mapping, conversion to rows, de-duplication, cross-source matching, merge, re-key planning.
- **Thin I/O shells around the core:**
  - Overpass fetch with mirrors, backoff and a cache.
  - DuckDB reading Foursquare's Hugging Face Parquet.
  - A supabase-js writer.
  - A CLI that wires them together.
- **Schema:** one migration creates `restaurants`.

**Tech Stack:**
- Node 24 (runs `.ts` directly via type stripping) and TypeScript `~7.0.2` (same as `apps/web`), used for type-checking only.
- Tests: `node:test` and `node:assert/strict`.
- Libraries: `@supabase/supabase-js`, `@duckdb/node-api`.
- Database: Supabase Postgres with PostGIS and pgvector.

**Spec:** [docs/superpowers/specs/2026-11-21-osm-foursquare-ingest-design.md](../specs/2026-11-21-osm-foursquare-ingest-design.md). Read it alongside this plan.

## Global Constraints

**Scope and dependencies**
- Runtime dependencies: only `@supabase/supabase-js` and `@duckdb/node-api`. Dev dependencies: only `typescript ~7.0.2` and `@types/node`.
- Erasable TypeScript syntax only: no `enum`, `namespace` or constructor parameter properties. Use `import type` for types. Relative imports include the `.ts` extension.
- Do not modify anything under `apps/web/`. Do not change `docs/CONTRACTS.md`.

**Secrets**
- Secrets come only from `pipeline/.env`: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `HF_TOKEN`, `FSQ_RELEASE`.
- Never log a secret value. Never commit `.env`.

**Pinned values (put them in `pipeline/src/config.ts`)**
- Study-area bbox: south `42.227`, west `-71.191`, north `42.418`, east `-70.986`.
- OSM amenities: `restaurant, fast_food, cafe, bar, pub, ice_cream, food_court`.
- User-Agent: `vibenta-ingest/0.1 (+https://github.com/Dold18/vibenta_bostonhacks)`.
- Matching thresholds: same name ≤ `50` m; similar name (token Jaccard ≥ `0.6`) ≤ `25` m. Within-source duplicates: same name ≤ `50` m.
- `FSQ_MAX_AGE_DAYS = 730`. Upsert batch size `500`. Overpass retries: max `4` attempts per mirror, backoff starting at `5000` ms and doubling.
- Default `FSQ_RELEASE = 2026-01-12`.

**Attribution strings (exact)**
- OSM: `© OpenStreetMap contributors (ODbL)`
- Foursquare: `Foursquare OS Places (Apache 2.0)`
- Merged: `© OpenStreetMap contributors (ODbL); Foursquare OS Places (Apache 2.0)`

**Writing to the database**
- `place_id` is `osm:<type>/<id>` (e.g. `osm:node/123`) or `fsq:<fsq_place_id>`.
- Ingest sends only these columns: `place_id, source, source_id, name, location, address, website, phone, category, source_cuisines, hours_raw, osm_tags, fsq_place_id, attribution, last_seen_at`. Never `cuisines` (generated), `menu_cuisines`, or any enrichment column.
- Unknown values stay unknown: `null` / `[]`. Never invent values.

**Commits**
- Commits carry **no** Claude/Co-Authored-By attribution (user instruction).

## Review Focus

These are failure modes the spec implies but doesn't spell out. Each has a test in the task named.

1. **Names that normalize to nothing.** Names like `"The"` or `"!!!"` normalize to `""`, and two such places must never match or collapse. The tests are in Task 1 (`nameKey`, `nameSimilarity`) and Task 4 (`dedupeWithin`, `matchSources`).
2. **Overpass errors disguised as success.** Overpass can return HTTP 200 with a `remark` saying a runtime error happened, or with zero elements. That must count as a failed attempt. Otherwise a run would load nothing and report the whole catalog as "not seen". The test is in Task 7.
3. **Messy OSM cuisine values.** For example `"Pizza; Italian ;;"` must give `["pizza", "italian"]`. The test is in Task 2.
4. **Incomplete records.** An OSM relation with no `center`, or a Foursquare record with null name or coordinates, is skipped, not turned into a row at (0, 0). The tests are in Task 3.
5. **Foursquare record with `dateRefreshed: null`.** It counts as stale for Foursquare-only rows but may still fill gaps on a matched OSM place. The test is in Task 4.

---

## File Structure

```
pipeline/
├── package.json            scripts + deps
├── tsconfig.json           noEmit, erasableSyntaxOnly, allowImportingTsExtensions
├── .env.example            variable names only
├── .gitignore              node_modules/, .cache/
├── src/
│   ├── types.ts            shared record types (no logic)
│   ├── config.ts           every pinned value above
│   ├── geo.ts              metersBetween, toEwkt
│   ├── normalize.ts        nameKey, nameSimilarity, category/cuisine/address/tag mapping
│   ├── sources.ts          Overpass element → OsmPlace; raw FSQ row → FsqPlace; place → RestaurantRow
│   ├── merge.ts            dedupeWithin, matchSources, mergePlaces
│   ├── rekey.ts            planRekey (pure)
│   ├── osm.ts              Overpass fetch: mirrors, backoff, error detection, cache
│   ├── foursquare.ts       buildFsqQuery (pure) + DuckDB loader
│   ├── db.ts               Supabase reads/writes
│   └── ingest.ts           CLI: parseArgs, orchestration, summary, dry-run output
└── test/
    ├── normalize.test.ts
    ├── sources.test.ts
    ├── merge.test.ts
    ├── rekey.test.ts
    ├── osm.test.ts
    ├── foursquare.test.ts
    └── ingest.test.ts
supabase/migrations/20261121120000_create_restaurants.sql
docs/DATA_MODEL.md          (§4 updated to match the migration)
```

## Shared types (`pipeline/src/types.ts`, created in Task 1)

```ts
export type Bbox = { south: number; west: number; north: number; east: number };
export type Category = 'restaurant' | 'cafe' | 'nightlife';
export type Source = 'osm' | 'foursquare';

export interface OsmPlace { osmId: string; name: string; lat: number; lng: number; tags: Record<string, string> } // osmId 'node/123'
export interface FsqPlace {
  fsqId: string; name: string; lat: number; lng: number;
  address: string | null; locality: string | null; postcode: string | null;
  tel: string | null; website: string | null;
  categoryLabels: string[];          // e.g. 'Dining and Drinking > Restaurant > Asian Restaurant > Japanese Restaurant'
  dateRefreshed: string | null;      // 'YYYY-MM-DD'
}
export interface RestaurantRow {
  place_id: string; source: Source; source_id: string; name: string;
  location: string;                  // EWKT 'SRID=4326;POINT(lng lat)'
  address: string | null; website: string | null; phone: string | null;
  category: Category; source_cuisines: string[]; hours_raw: string | null;
  osm_tags: Record<string, string> | null; fsq_place_id: string | null;
  attribution: string; last_seen_at: string;   // ISO timestamp of run start
}
export interface MatchPair { osmId: string; fsqId: string; meters: number; similarity: number }
export interface DroppedDuplicate { source: Source; keptId: string; droppedId: string }
export interface ExistingRow { id: number; source: Source; source_id: string; fsq_place_id: string | null }
export type RekeyAction =
  | { kind: 'clear_fsq'; id: number }
  | { kind: 'promote'; id: number; sourceId: string; placeId: string }
  | { kind: 'collapse'; id: number; fsqId: string };
```

---

### Task 1: Package scaffold, geo helpers, name normalization

**Files:**
- Create: `pipeline/package.json`, `pipeline/tsconfig.json`, `pipeline/.env.example`, `pipeline/.gitignore`, `pipeline/src/types.ts`, `pipeline/src/config.ts`, `pipeline/src/geo.ts`, `pipeline/src/normalize.ts`
- Test: `pipeline/test/normalize.test.ts`

**Interfaces:**
- Produces:
  - `metersBetween(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number` (equirectangular, Earth radius 6_371_000, same formula as `apps/web/src/osm.ts`)
  - `toEwkt(lat: number, lng: number): string`, which returns `SRID=4326;POINT(${lng} ${lat})`
  - `nameKey(name: string): string`
  - `nameSimilarity(a: string, b: string): number`, the token-set Jaccard of the two name keys, `0` if either key is empty
  - all constants from Global Constraints, exported from `config.ts`
  - every type in "Shared types"

- [ ] **Step 1: Create the package files**

`package.json`: `"type": "module"`, `"private": true`, `"engines": {"node": ">=24"}`. Scripts:
- `"ingest": "node --env-file-if-exists=.env src/ingest.ts"`
- `"test": "node --test \"test/**/*.test.ts\""`
- `"typecheck": "tsc --noEmit -p ."`

`tsconfig.json`: `target`/`module` `esnext`, `moduleResolution` `bundler`, `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `types: ["node"]`, `include: ["src", "test"]`.

`.gitignore`: `node_modules/` and `.cache/`.

`.env.example`: the four variable names with empty values and a one-line comment on each. `SUPABASE_SECRET_KEY` gets "secret key, never put in apps/web".

Then run `npm install @supabase/supabase-js @duckdb/node-api` and `npm install -D typescript@~7.0.2 @types/node` inside `pipeline/`.

- [ ] **Step 2: Write the failing tests** in `test/normalize.test.ts`

```ts
test('nameKey folds accents, &, leading "the", punctuation, whitespace', () => {
  assert.equal(nameKey('Café  Nero'), 'cafe nero');
  assert.equal(nameKey('The Friendly Toast'), 'friendly toast');
  assert.equal(nameKey('Joe’s Pizza & Subs!'), 'joes pizza and subs');
  assert.equal(nameKey('Theater Café'), 'theater cafe');   // "the" only as a whole leading word
});
test('nameKey of a name with no letters or digits is empty', () => {
  assert.equal(nameKey('The'), '');
  assert.equal(nameKey('&'), 'and');   // & becomes a word
  assert.equal(nameKey('!!!'), '');
});
test('nameSimilarity is token Jaccard and 0 for empty keys', () => {
  assert.equal(nameSimilarity('Tatte Bakery & Cafe', 'Tatte Bakery and Café'), 1);
  assert.equal(nameSimilarity('Tatte Bakery', 'Tatte Bakery Cafe'), 2 / 3);
  assert.equal(nameSimilarity('!!!', '!!!'), 0);
});
test('metersBetween and toEwkt', () => {
  assert.ok(Math.abs(metersBetween({ lat: 42.35, lng: -71.06 }, { lat: 42.351, lng: -71.06 }) - 111.2) < 1);
  assert.equal(toEwkt(42.35, -71.06), 'SRID=4326;POINT(-71.06 42.35)');
});
```

- [ ] **Step 3: Run to verify failure**

Run `npm test` in `pipeline/`. Expected: FAIL, because the modules don't exist.

- [ ] **Step 4: Implement `geo.ts`, `normalize.ts` (`nameKey`, `nameSimilarity`), `types.ts`, `config.ts`**

`nameKey` order:
1. NFKD, then strip `\p{M}`.
2. Lowercase.
3. Delete `'` and `’`.
4. `&` → ` and `.
5. Replace `[^\p{L}\p{N}]+` with a space.
6. Trim.
7. Drop a leading whole word `the`.
8. Collapse spaces.

- [ ] **Step 5: Run `npm test` and `npm run typecheck`.** Expected: all pass, no type errors.

- [ ] **Step 6: Commit**: `feat(pipeline): scaffold package with name normalization and geo helpers`

---

### Task 2: Category, cuisine, address and tag mapping

**Files:**
- Modify: `pipeline/src/normalize.ts`
- Test: `pipeline/test/normalize.test.ts`

**Interfaces:**
- Consumes: `Category` from `types.ts`.
- Produces:
  - `osmCategory(amenity: string): Category | null`
  - `fsqCategory(primaryLabel: string): Category | null`. Returns `null` when the label isn't under `Dining and Drinking`.
  - `osmCuisines(tags: Record<string,string>): string[]`
  - `fsqCuisines(labels: string[]): string[]`
  - `osmAddress(tags: Record<string,string>): string | null`
  - `fsqAddress(p: {address: string|null; locality: string|null; postcode: string|null}): string | null`
  - `pickOsmTags(tags: Record<string,string>): Record<string,string>`

**Rules:**
- **`fsqCategory`:** split on `' > '` and look only at segment `[1]`.
  - `Cafe, Coffee, and Tea House` → `cafe`.
  - `Bar`, `Brewery`, `Lounge`, `Night Club` → `nightlife`.
  - Any other segment under `Dining and Drinking` → `restaurant`.
  - These segment names live in `config.ts` as `FSQ_CAFE_SEGMENTS` and `FSQ_NIGHTLIFE_SEGMENTS`.
- **`fsqCuisines`:** for every label whose segment `[1]` is `Restaurant` and that has at least 3 segments, take the **last** segment, remove a trailing ` Restaurant`, then lowercase and snake_case it. De-duplicate across labels.
- **Cuisine format (both sources):** lowercase, trimmed, spaces → `_`, empties dropped, de-duplicated, in first-seen order.
- **`pickOsmTags`:** keep `outdoor_seating, internet_access, takeaway, delivery, wheelchair, opening_hours, amenity, cuisine` and any key starting with `diet:`.

- [ ] **Step 1: Write the failing tests**

```ts
test('osmCategory maps every allowed amenity', () => {
  assert.equal(osmCategory('cafe'), 'cafe');
  for (const a of ['bar', 'pub']) assert.equal(osmCategory(a), 'nightlife');
  for (const a of ['restaurant', 'fast_food', 'ice_cream', 'food_court']) assert.equal(osmCategory(a), 'restaurant');
  assert.equal(osmCategory('bank'), null);
});
test('fsqCategory uses the second segment exactly, never substrings', () => {
  const dd = (s: string) => `Dining and Drinking > ${s}`;
  assert.equal(fsqCategory(dd('Restaurant > Steakhouse')), 'restaurant');
  assert.equal(fsqCategory(dd('Restaurant > BBQ Joint')), 'restaurant');
  assert.equal(fsqCategory(dd('Restaurant > Japanese Restaurant > Sushi Restaurant')), 'restaurant');
  assert.equal(fsqCategory(dd('Bar > Cocktail Bar')), 'nightlife');
  assert.equal(fsqCategory(dd('Cafe, Coffee, and Tea House > Coffee Shop')), 'cafe');
  assert.equal(fsqCategory(dd('Bakery')), 'restaurant');
  assert.equal(fsqCategory('Retail > Grocery Store'), null);
});
test('osmCuisines splits, trims and snake_cases messy values', () => {
  assert.deepEqual(osmCuisines({ cuisine: 'Pizza; Italian ;;' }), ['pizza', 'italian']);
  assert.deepEqual(osmCuisines({ cuisine: 'ice cream;ice_cream' }), ['ice_cream']);
  assert.deepEqual(osmCuisines({}), []);
});
test('fsqCuisines takes the deepest segment under Restaurant', () => {
  assert.deepEqual(fsqCuisines([
    'Dining and Drinking > Restaurant > Asian Restaurant > Japanese Restaurant',
    'Dining and Drinking > Restaurant > Pizzeria',
    'Dining and Drinking > Restaurant',
    'Dining and Drinking > Bar > Cocktail Bar',
  ]), ['japanese', 'pizzeria']);
});
test('addresses format from available parts, else null', () => {
  assert.equal(osmAddress({ 'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'Boston', 'addr:postcode': '02115' }), '12 Main St, Boston 02115');
  assert.equal(osmAddress({ 'addr:street': 'Main St' }), 'Main St');
  assert.equal(osmAddress({}), null);
  assert.equal(fsqAddress({ address: '12 Main St', locality: 'Boston', postcode: '02115' }), '12 Main St, Boston 02115');
  assert.equal(fsqAddress({ address: null, locality: null, postcode: null }), null);
});
test('pickOsmTags keeps only vibe-relevant keys', () => {
  assert.deepEqual(pickOsmTags({ amenity: 'cafe', outdoor_seating: 'yes', 'diet:vegan': 'yes', name: 'X', 'addr:street': 'Y' }),
    { amenity: 'cafe', outdoor_seating: 'yes', 'diet:vegan': 'yes' });
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, functions not exported.
- [ ] **Step 3: Implement the functions in `normalize.ts`**, with the segment lists in `config.ts`.
- [ ] **Step 4: Verify the Foursquare segment names.** This needs `HF_TOKEN` and Hugging Face access. If access isn't approved yet, skip this step and leave a `TODO(verify)` comment next to the lists. Otherwise:
  1. Read the categories parquet: `hf://datasets/foursquare/fsq-os-places/release/dt=2026-01-12/categories/parquet/*.parquet`. A one-off DuckDB query from a scratch script works.
  2. Confirm the four nightlife names and the café name exist exactly under `Dining and Drinking`.
  3. Fix `config.ts` if they differ.
- [ ] **Step 5: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 6: Commit**: `feat(pipeline): map categories, cuisines, addresses and OSM tags`

---

### Task 3: Source records → places → rows

**Files:**
- Create: `pipeline/src/sources.ts`
- Test: `pipeline/test/sources.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 functions, `config.ts` attribution strings.
- Produces:
  - `parseOverpass(elements: OverpassElement[]): OsmPlace[]`, where `OverpassElement = {type:'node'|'way'|'relation'; id:number; lat?:number; lon?:number; center?:{lat:number;lon:number}; tags?:Record<string,string>}` (exported)
  - `parseFsqRows(rows: Record<string, unknown>[]): FsqPlace[]`
  - `osmRow(p: OsmPlace, runStart: string): RestaurantRow`, where `source='osm'` and `fsq_place_id=null`
  - `fsqRow(p: FsqPlace, runStart: string): RestaurantRow`

**Rules:**
- **`parseOverpass` skips an element when:** it has no `tags.name`, no coordinate (`lat/lon`, or `center` for ways and relations), an amenity outside the allowed list, or a `disused:amenity` / `was:amenity` tag.
- **`parseFsqRows` reads** columns `fsq_place_id, name, latitude, longitude, address, locality, postcode, tel, website, fsq_category_labels, date_refreshed`. It skips rows with a null or empty name, a null coordinate, or an empty label list.
- **`osmRow` contents:**
  - `website`: the `website` tag, else `contact:website`.
  - `phone`: the `phone` tag, else `contact:phone`.
  - `hours_raw`: the `opening_hours` tag, else `null`.
  - `osm_tags`: `pickOsmTags(tags)`.
- **`fsqRow` contents:**
  - Identity: `source='foursquare'`, `source_id = fsq_place_id = fsqId`, `place_id = 'fsq:' + fsqId`.
  - Category: `fsqCategory(categoryLabels[0])`.
  - `osm_tags`, `hours_raw`: `null`.
- **Trimming:** both trim strings and turn empty strings into `null`.

- [ ] **Step 1: Write the failing tests**

```ts
const runStart = '2026-11-21T12:00:00.000Z';
test('parseOverpass reads nodes and ways-with-center, skips incomplete or disused', () => {
  const places = parseOverpass([
    { type: 'node', id: 1, lat: 42.35, lon: -71.06, tags: { name: 'A', amenity: 'cafe' } },
    { type: 'way', id: 2, center: { lat: 42.36, lon: -71.07 }, tags: { name: 'B', amenity: 'pub' } },
    { type: 'relation', id: 3, tags: { name: 'C', amenity: 'restaurant' } },              // no center
    { type: 'node', id: 4, lat: 42.35, lon: -71.06, tags: { amenity: 'cafe' } },          // no name
    { type: 'node', id: 5, lat: 42.35, lon: -71.06, tags: { name: 'E', amenity: 'cafe', 'disused:amenity': 'cafe' } },
    { type: 'node', id: 6, lat: 42.35, lon: -71.06, tags: { name: 'F', amenity: 'bank' } },
  ]);
  assert.deepEqual(places.map((p) => p.osmId), ['node/1', 'way/2']);
  assert.deepEqual([places[1].lat, places[1].lng], [42.36, -71.07]);
});
test('parseFsqRows skips rows with no name, coordinates or labels', () => {
  const base = { fsq_place_id: 'f1', name: 'X', latitude: 42.35, longitude: -71.06, fsq_category_labels: ['Dining and Drinking > Bakery'], date_refreshed: '2026-01-01' };
  const out = parseFsqRows([base, { ...base, fsq_place_id: 'f2', name: null }, { ...base, fsq_place_id: 'f3', latitude: null }, { ...base, fsq_place_id: 'f4', fsq_category_labels: [] }]);
  assert.deepEqual(out.map((p) => p.fsqId), ['f1']);
});
test('osmRow builds the ingest-owned columns', () => {
  const row = osmRow({ osmId: 'node/1', name: ' Tatte ', lat: 42.35, lng: -71.06,
    tags: { amenity: 'cafe', cuisine: 'coffee_shop', 'contact:website': 'https://x', opening_hours: 'Mo-Su 07:00-19:00' } }, runStart);
  assert.deepEqual(row, {
    place_id: 'osm:node/1', source: 'osm', source_id: 'node/1', name: 'Tatte',
    location: 'SRID=4326;POINT(-71.06 42.35)', address: null, website: 'https://x', phone: null,
    category: 'cafe', source_cuisines: ['coffee_shop'], hours_raw: 'Mo-Su 07:00-19:00',
    osm_tags: { amenity: 'cafe', cuisine: 'coffee_shop', opening_hours: 'Mo-Su 07:00-19:00' },
    fsq_place_id: null, attribution: '© OpenStreetMap contributors (ODbL)', last_seen_at: runStart,
  });
});
test('fsqRow uses fsq identity, primary label category and Apache attribution', () => {
  const row = fsqRow({ fsqId: 'abc', name: 'Sushi Bar X', lat: 42.35, lng: -71.06, address: null, locality: null, postcode: null,
    tel: '617', website: null, dateRefreshed: '2026-01-01',
    categoryLabels: ['Dining and Drinking > Restaurant > Japanese Restaurant > Sushi Restaurant'] }, runStart);
  assert.equal(row.place_id, 'fsq:abc');
  assert.equal(row.fsq_place_id, 'abc');
  assert.equal(row.category, 'restaurant');
  assert.deepEqual(row.source_cuisines, ['sushi']);
  assert.equal(row.attribution, 'Foursquare OS Places (Apache 2.0)');
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `sources.ts`.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(pipeline): convert OSM and Foursquare records to rows`

---

### Task 4: De-duplicate, match and merge

**Files:**
- Create: `pipeline/src/merge.ts`
- Test: `pipeline/test/merge.test.ts`

**Interfaces:**
- Consumes: `nameKey`, `nameSimilarity`, `metersBetween`, `osmRow`, `fsqRow`, and config thresholds.
- Produces:
  - `dedupeWithin<T>(items: T[], idOf: (t: T) => string, source: Source, fieldsOf: (t: T) => number): { kept: T[]; dropped: DroppedDuplicate[] }`
  - `matchSources(osm: OsmPlace[], fsq: FsqPlace[]): MatchPair[]`
  - `mergePlaces(osm: OsmPlace[], fsq: FsqPlace[], opts: { runStart: string; today: string }): { rows: RestaurantRow[]; matches: MatchPair[]; dropped: DroppedDuplicate[]; staleFsqDropped: number }`

**Rules:**
- **`dedupeWithin`:**
  - Two items are duplicates when their name keys are equal and **non-empty** and they're ≤ 50 m apart.
  - Within each duplicate group, keep the item with the most non-empty fields (`fieldsOf`).
  - Tie-break for OSM: a `node/` id beats a `way/` id, which beats a `relation/` id. Then the smaller numeric id wins.
  - Tie-break for Foursquare: the lexicographically smallest id wins. *(Plan's call: the spec says "oldest", but ids carry no age, so this keeps the rule deterministic.)*
- **`matchSources`:**
  - Candidate pairs meet either `(nameKey equal && non-empty && meters ≤ 50)` or `(nameSimilarity ≥ 0.6 && meters ≤ 25)`.
  - Sort candidates by meters ascending, then greedily assign one-to-one.
- **`mergePlaces`:**
  1. Dedupe each source, then match.
  2. For each matched pair, start from `osmRow` and fill `address`, `website` and `phone` from Foursquare where OSM has `null`. Set `source_cuisines` to the OSM ∪ Foursquare union (OSM first), `fsq_place_id = fsqId`, and the merged attribution.
  3. Every unmatched OSM place becomes `osmRow`.
  4. An unmatched Foursquare place becomes `fsqRow` only if `dateRefreshed` is non-null and ≤ 730 days before `today`. Otherwise count it in `staleFsqDropped`.

- [ ] **Step 1: Write the failing tests.** Use helpers `osm(id, name, lat, lng, tags?)` and `fsq(id, name, lat, lng, extra?)`. A latitude offset of `0.00027°` is about 30 m.

```ts
test('dedupeWithin collapses same-name records within 50 m, keeps the fullest', ...);       // node/1 bare + way/2 with website → keeps way/2
test('dedupeWithin never collapses empty name keys', ...);                                    // two "!!!" at the same spot → both kept
test('dedupeWithin tie prefers node over way', ...);
test('matchSources: same name at 30 m matches, at 80 m does not', ...);
test('matchSources: similar name at 20 m matches, at 40 m does not', ...);                   // "Tatte Bakery" vs "Tatte Bakery Cafe" (0.67)
test('matchSources: nearest candidate wins and pairing is one-to-one', ...);                  // fsq f1 at 10 m and 40 m from two same-name OSM → pairs with the 10 m one; the other OSM stays unmatched
test('matchSources: empty name keys never match', ...);
test('mergePlaces: OSM wins, FSQ fills gaps, cuisines union, merged attribution', ...);       // OSM website kept; FSQ phone fills null phone; ['pizza'] ∪ ['pizzeria','pizza'] = ['pizza','pizzeria']
test('mergePlaces: unmatched FSQ refreshed 1 year ago kept, 3 years ago dropped, null dropped', ...);  // staleFsqDropped === 2
test('mergePlaces: a stale FSQ record still fills gaps on its OSM match', ...);
```

Each test asserts the exact ids, `fsq_place_id`, attribution string and counts described in its comment. `today = '2026-11-21'`.

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `merge.ts`.** A pairwise scan is fine at this size; no spatial index is needed.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(pipeline): de-duplicate, match and merge OSM and Foursquare places`

---

### Task 5: Re-key planning

**Files:**
- Create: `pipeline/src/rekey.ts`
- Test: `pipeline/test/rekey.test.ts`

**Interfaces:**
- Consumes: `ExistingRow`, `RestaurantRow`, `RekeyAction`.
- Produces: `planRekey(existing: ExistingRow[], rows: RestaurantRow[]): RekeyAction[]`. Actions come back ordered: all `clear_fsq`, then `promote`, then `collapse`.

**Rules** (spec §6.7). Let `newBySourceId` map OSM `source_id` to the new row, and `newOsmByFsq` map `fsq_place_id` to the OSM row that now carries it.
- **`clear_fsq`:** an existing `source='osm'` row whose `fsq_place_id` F is non-null, when either:
  - its new row exists and carries a different value (or `null`); or
  - F now belongs to a different OSM row in `newOsmByFsq`.
- **`promote`:** an existing `source='foursquare'` row whose F is in `newOsmByFsq` (pointing at OSM row R), when no existing `source='osm'` row has `source_id = R.source_id`. It becomes `{sourceId: R.source_id, placeId: R.place_id}`.
- **`collapse`:** the same as promote, but an existing OSM row with that `source_id` does exist.
- **Otherwise:** nothing. That covers a Foursquare-only row that is still Foursquare-only, and a row absent from this run.

- [ ] **Step 1: Write the failing tests**

```ts
test('no-op when nothing moved', ...);                                    // existing osm node/1 with fsq f1, new merged node/1+f1 → []
test('promote: fsq-only row now matches an OSM place with no row', ...); // existing {id:7, foursquare, f1}; new node/1 carries f1 → [{kind:'promote', id:7, sourceId:'node/1', placeId:'osm:node/1'}]
test('collapse: fsq-only row now matches an OSM place that has a row', ...); // + existing {id:3, osm, node/1, null} → [{kind:'collapse', id:7, fsqId:'f1'}]
test('clear: fsq id moved to another OSM row', ...);                     // existing {id:3, osm, node/1, f1}; new node/2 carries f1, node/1 carries null → [{kind:'clear_fsq', id:3}]
test('clear: OSM row vanished but its fsq id is now used elsewhere', ...); // existing {id:3, osm, node/1, f1}, node/1 absent; node/2 carries f1 → clear id 3
test('actions are ordered clear, promote, collapse', ...);
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `planRekey`.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(pipeline): plan row re-keying between runs`

---

### Task 6: Migration and DATA_MODEL update

**Files:**
- Create: `supabase/migrations/20261121120000_create_restaurants.sql`
- Modify: `docs/DATA_MODEL.md` (§4 `restaurants` block, and the §2 row for "Cuisine")

**Interfaces:**
- Produces: the `restaurants` table with exactly the columns `db.ts` writes (Global Constraints), plus `id`, `menu_cuisines`, the generated `cuisines` and `fts`, and every enrichment column from DATA_MODEL §4.

- [ ] **Step 1: Write the migration** as DATA_MODEL.md §4's `restaurants` block, with these edits:
  - **Extensions:** `create extension if not exists postgis with schema extensions;` and `create extension if not exists vector with schema extensions;`
  - **Qualified types:** `extensions.geography(Point, 4326)` and `extensions.vector(n)`.
  - **Cuisine columns:** replace the `cuisines` line with:
    ```sql
    source_cuisines text[] not null default '{}',
    menu_cuisines   text[] not null default '{}',
    cuisines        text[] generated always as (source_cuisines || menu_cuisines) stored,
    ```
  - **New columns:** `fsq_place_id text unique,` and `last_seen_at timestamptz,`.
  - **Indexes:** keep the four indexes from §4.
  - **Access:** append:
    ```sql
    alter table restaurants enable row level security;
    create policy "restaurants are readable by everyone" on restaurants
      for select to anon, authenticated using (true);
    ```
  - **Leave out:** `stations`, `restaurant_stations` and `student_reviews`.
- [ ] **Step 2: Update DATA_MODEL.md §4** with the same column changes. Add a line under the block: "`source_cuisines` is written by ingest, `menu_cuisines` by the menu step; filters read the generated `cuisines`." In §2, change the Cuisine row's field to `cuisines` (generated from `source_cuisines` + `menu_cuisines`).
- [ ] **Step 3: Verify locally.** From the repo root, with Docker running: `npx supabase start`, then `npx supabase db reset`.
  - Expected: "Finished supabase db reset", no errors.
  - Then in local Studio (`http://127.0.0.1:54323`) or psql (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), run:
    ```sql
    insert into restaurants (place_id, source, source_id, name, location, category, source_cuisines, attribution)
    values ('osm:node/1','osm','node/1','T','SRID=4326;POINT(-71.06 42.35)','cafe','{coffee}','x')
    returning cuisines;
    ```
    Expected: `{coffee}`. Then delete the row.
  - If running the Supabase CLI is blocked in this environment, stop and ask the user to run these two commands and report the output.
- [ ] **Step 4: Commit**: `feat(db): create restaurants table for the catalog ingest`

---

### Task 7: Overpass fetcher

**Files:**
- Create: `pipeline/src/osm.ts`
- Test: `pipeline/test/osm.test.ts`

**Interfaces:**
- Consumes: `config.ts` (bbox, amenities, user agent, retry values), `OverpassElement` from `sources.ts`.
- Produces:
  - `buildOverpassQuery(bbox: Bbox, amenities: string[]): string`
  - `fetchOverpass(query: string, deps?: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; mirrors?: string[] }): Promise<OverpassElement[]>`
  - `loadOsmElements(opts: { refresh: boolean; cacheDir: string; today: string }): Promise<{ elements: OverpassElement[]; fromCache: boolean }>`

**Rules:**
- **Query:** `[out:json][timeout:180];nwr["amenity"~"^(a|b|…)$"]["name"](south,west,north,east);out center tags;`
- **Request:** POST `data=<query>` form body, with the User-Agent header from config.
- **Failed attempt:** a non-2xx status, a network error, a response whose `remark` contains `error` (case-insensitive), or `elements.length === 0`.
- **Retry schedule:** up to 4 attempts per mirror, with `sleep(5000 * 2^(attempt-1))` between attempts, then move to the next mirror. If every mirror fails, throw an `Error` naming the last failure.
- **Cache:** the file `pipeline/.cache/osm-<today>.json` is read unless `refresh` is set, and written after a successful fetch.

- [ ] **Step 1: Write the failing tests** with a fake `fetchImpl` and a no-op `sleep`:

```ts
test('buildOverpassQuery pins bbox order south,west,north,east and the amenity regex', ...);  // contains '(42.227,-71.191,42.418,-70.986)' and '^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court)$'
test('sends the descriptive User-Agent', ...);
test('retries a 429 then succeeds; sleeps 5000 then 10000', ...);
test('a 200 with a runtime-error remark is a failed attempt', ...);           // remark: 'runtime error: Query timed out ...'
test('a 200 with zero elements is a failed attempt', ...);
test('falls back to the second mirror after 4 failures on the first', ...);
test('throws after all mirrors fail', ...);
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `osm.ts`.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(pipeline): fetch OSM places from Overpass with retries and cache`

---

### Task 8: Foursquare loader

**Files:**
- Create: `pipeline/src/foursquare.ts`
- Test: `pipeline/test/foursquare.test.ts`

**Interfaces:**
- Consumes: `config.ts` (bbox), `parseFsqRows` from `sources.ts`.
- Produces:
  - `buildFsqQuery(release: string, bbox: Bbox): string`
  - `loadFsqRows(opts: { hfToken: string | undefined; release: string; refresh: boolean; cacheDir: string }): Promise<{ rows: Record<string, unknown>[]; skipped: boolean; fromCache: boolean }>`

**Rules:**
- **Query:** selects the columns `parseFsqRows` reads, from `read_parquet('hf://datasets/foursquare/fsq-os-places/release/dt=${release}/places/parquet/*.parquet')`. Its filter:
  - `latitude between south and north and longitude between west and east`
  - `and date_closed is null`
  - `and starts_with(fsq_category_labels[1], 'Dining and Drinking')` (primary label only, matching the category rule)
- **Release value:** `release` must match `/^\d{4}-\d{2}-\d{2}$/`. Throw otherwise, so the value interpolated into SQL is safe.
- **Loader:**
  - If there's no `hfToken`, return `{ rows: [], skipped: true }` and log one warning line.
  - Otherwise it creates a `DuckDBInstance` in memory and runs `INSTALL httpfs; LOAD httpfs; CREATE SECRET hf (TYPE huggingface, TOKEN '<token>')`. The token is passed as a value and never logged.
  - It runs the query, converts rows to JSON (`getRowObjectsJson()`), and caches them to `.cache/fsq-<release>.json`.

- [ ] **Step 1: Write the failing tests**

```ts
test('buildFsqQuery reads the release path and filters bbox, closed, primary label', ...);  // asserts substrings: 'dt=2026-01-12/places/parquet', 'date_closed is null', "starts_with(fsq_category_labels[1], 'Dining and Drinking')", 'between 42.227 and 42.418'
test('buildFsqQuery rejects a malformed release', ...);                                    // "2026-01-12'; drop" → throws
test('loadFsqRows without a token skips', ...);                                            // → { rows: [], skipped: true }
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `foursquare.ts`.** If the live columns differ from §6.4 of the spec, adapt only the `select` list in `buildFsqQuery` and the field reads in `parseFsqRows`.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Live check (needs Hugging Face approval).** Run `node --env-file=.env -e "import('./src/foursquare.ts').then(m=>m.loadFsqRows({hfToken:process.env.HF_TOKEN,release:'2026-01-12',refresh:true,cacheDir:'.cache'})).then(r=>console.log(r.rows.length, Object.keys(r.rows[0]??{})))"`.
  - Expected: a count in the thousands and the column list.
  - If access isn't approved yet, note it in the task report and move on. Task 9 runs with `--sources=osm`.
- [ ] **Step 6: Commit**: `feat(pipeline): load Boston food and drink places from Foursquare OS Places`

---

### Task 9: Database writer and CLI

**Files:**
- Create: `pipeline/src/db.ts`, `pipeline/src/ingest.ts`
- Test: `pipeline/test/ingest.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `db.ts`:
    - `connect(url: string, secretKey: string): SupabaseClient` (with `auth: { persistSession: false }`)
    - `fetchExisting(client): Promise<ExistingRow[]>` (pages with `.range()` in steps of 1000, because `max_rows = 1000`)
    - `applyRekey(client, actions: RekeyAction[]): Promise<void>`: clear sets `fsq_place_id = null`; promote updates `source, source_id, place_id` by `id`; collapse deletes by `id`
    - `upsertRows(client, rows: RestaurantRow[], batchSize = 500): Promise<void>` (`onConflict: 'source,source_id'`)
    - `countNotSeen(client, runStart: string): Promise<number>`
  - `ingest.ts`:
    - `parseCliArgs(argv: string[]): { dryRun: boolean; sources: 'osm' | 'fsq' | 'all'; refresh: boolean }` (`node:util` `parseArgs`; an unknown `--sources` value throws)
    - `summarize(input: { osm: number; fsq: number; matches: number; dropped: number; staleFsqDropped: number; existingKeys: Set<string>; rows: RestaurantRow[]; actions: RekeyAction[]; notSeen: number | null }): string`
    - a `main()` that runs only when the file is the entry point (`import.meta.filename === path.resolve(process.argv[1])`), so tests can import the module without running it

**Rules for `main()`:**
1. `runStart = new Date().toISOString()`, `today = runStart.slice(0, 10)`.
2. Load the sources picked by `--sources`. Foursquare is skipped with a warning if there's no token.
3. Run `mergePlaces`.
4. **Dry run:** write `.cache/rows.json` and `.cache/matches.json` (matches plus dropped duplicates), print the summary with `notSeen: null`, and exit **without** reading `SUPABASE_*` env.
5. **Real run:** require `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and fail with a clear message naming the missing variable. Then `fetchExisting` → `planRekey` → `applyRekey` → `upsertRows` → `countNotSeen` → print the summary.
6. Exit code 1 on any error.

**Summary lines:**
- OSM places, Foursquare places, matched pairs, duplicates dropped, stale Foursquare dropped.
- Inserted (new rows whose `source:source_id` isn't in `existingKeys`), updated (the rest), promoted, collapsed (with each collapsed `fsqId`, logged as a loss), not seen this run.
- Rows missing cuisine, address and website.

- [ ] **Step 1: Write the failing tests**

```ts
test('parseCliArgs defaults and flags', ...);                    // [] → {dryRun:false, sources:'all', refresh:false}; ['--dry-run','--sources=osm','--refresh'] → all set
test('parseCliArgs rejects an unknown source', ...);
test('summarize counts inserted vs updated from existing keys and lists collapsed ids', ...);
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `db.ts` and `ingest.ts`.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Dry run against real OSM.** Run `npm run ingest -- --dry-run --sources=osm`.
  - Expected: the summary prints a few thousand OSM places, and `.cache/rows.json` exists.
  - Open `.cache/matches.json` and spot-check 10 dropped duplicates. Report anything that looks wrong; don't tune thresholds silently.
- [ ] **Step 6: Load local Supabase.** Run `npx supabase start` (from Task 6), put the local URL and the local secret key from `npx supabase status` in `pipeline/.env`, then run `npm run ingest -- --sources=osm`.
  - Expected: all rows inserted.
  - Run it again. Expected: 0 inserted, all updated, 0 promoted or collapsed, 0 not seen.
  - If Foursquare access exists, run `npm run ingest` (all sources) and check that the promoted/collapsed counts are plausible.
- [ ] **Step 7: Commit**: `feat(pipeline): write the catalog to Supabase with an ingest CLI`

---

## After all tasks
- The hosted load waits until the migration is merged to `main`, and that merge needs Integration-owner sign-off. Don't run against the hosted project before then.
- The PR description must list the schema changes beyond DATA_MODEL v0.1 (`fsq_place_id`, `last_seen_at`, the cuisine split) and the open items from spec §8.
