# Place Media Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a batch step, `npm run enrich:media`, that finds and ranks free photos for every place and collects free vibe inputs into Supabase, plus the tables later steps and the app will read.

**Architecture:** One new migration adds `place_photos`, `place_vibe_inputs`, `student_reviews`, a `place-photos` storage bucket and a service-only `restaurant_points` view. In `pipeline/src/media/`, each source has its own module with injected `fetch`: website, Wikimedia (Commons, Wikidata, Wikipedia), Wikivoyage, Mapillary and Boston city licenses. A pure ranking module and a priority module feed one CLI that processes places in priority order, a few at a time, and writes per place. No Gemini calls.

**Tech Stack:** Node ≥ 24 running TypeScript directly, `node:test`, `@supabase/supabase-js`, plus `node-html-parser` (HTML) and `proj4` (Massachusetts State Plane → WGS84). Postgres/PostGIS on Supabase.

**Spec:** `docs/superpowers/specs/2026-11-21-place-photos-vibe-sources-design.md` (build scope is its §0).

## Global Constraints

- Every outbound request sends `USER_AGENT` from `pipeline/src/config.ts`. Wikimedia's API policy requires it.
- Website crawling obeys `robots.txt` for that User-Agent, waits at least 1000 ms between requests to the same host, and times out after 15 s.
- Licensed photos: allow CC0, Public Domain, CC BY and CC BY-SA (any version) only. Reject anything with NC or ND.
- Never store copies of website images. Store the URL, the page it came from and the domain as credit.
- Store only `https:` image URLs. Cards load on an https page, and browsers block or upgrade http images.
- At most 5 pipeline photos per place, and at most 5 website photos per place.
- Display rank (`place_photos.rank`) by source: 1 upload, 2 OSM/Wikidata-linked Commons photo, 3 website photo, 4 Commons geosearch match, 5 Mapillary.
- Commons geosearch radius 50 m. Mapillary: within 30 m, and the camera heading points at the place within ±45°. Wikivoyage: within 100 m.
- Website `<img>` elements count only if their width and height attributes both say ≥ 400 px, or their `srcset` lists a width ≥ 800w.
- City license data: store only license type, DBA name, closing or end time, capacity, unit type and the premises description (`location_comments`). Never applicant, manager or phone fields.
- No Gemini or other paid calls. Free tiers only. `MAPILLARY_TOKEN` is optional; Mapillary is skipped without it.
- The `place_vibe_inputs` sources written here: `website`, `wiki`, `osm_tags`, `city_licenses`, `student_reviews`.
- Secrets stay in `pipeline/.env`. Never commit them.
- Commits: conventional style as in `git log`, with no Co-Authored-By or Claude attribution lines.

## Review Focus

1. **A generic place name** ("Cafe", "Pizza") matching unrelated Commons files or Wikivoyage listings → it must not match. Geosearch name matching needs a distinctive name: at least 2 tokens, or one token of ≥ 5 characters. Test in Task 5.
2. **A photo the team hid** (`hidden = true`) coming back on the next run → hidden rows survive re-runs, and a candidate whose URL matches a hidden row is dropped. Test in Task 10.
3. **A website that's down, slow, a redirect loop, non-HTML or disallowed by robots** → that place gets no website inputs, the run continues, and the summary counts it. Test in Task 3.
4. **Student uploads and reviews wiped by a re-run** → the pipeline only deletes and replaces rows with `kind <> 'student'`. Test in Task 9.
5. **Relative, protocol-relative, http, data: or logo/icon/svg image URLs** on websites → resolved against the page URL, kept only if https and not a logo, icon, svg, gif or data: URI. Test in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261121200000_create_place_media.sql` | New tables, view, bucket, RLS, `restaurants.media_checked_at` |
| `pipeline/src/normalize.ts` (modify) | Keep the extra OSM tags |
| `pipeline/src/media/types.ts` | Shared media types |
| `pipeline/src/media/http.ts` | Polite fetch: User-Agent, timeout, per-host spacing, robots check |
| `pipeline/src/media/robots.ts` | Parse `robots.txt`, decide whether a path is allowed |
| `pipeline/src/media/website.ts` | Extract text and image candidates from HTML |
| `pipeline/src/media/wikimedia.ts` | Commons file info, geosearch, Wikidata P18/sitelinks, Wikipedia extract, license allowlist |
| `pipeline/src/media/wikivoyage.ts` | Load and parse Wikivoyage listings, match a place |
| `pipeline/src/media/mapillary.ts` | Find a facing street photo |
| `pipeline/src/media/cityLicenses.ts` | Load Boston license data, project coordinates, match a place |
| `pipeline/src/media/rank.ts` | Order, dedupe and cap photo candidates |
| `pipeline/src/media/priority.ts` | Priority tier per place |
| `pipeline/src/media/db.ts` | Supabase reads and writes for this step |
| `pipeline/src/enrichMedia.ts` | CLI: orchestration, concurrency, summary |
| `pipeline/test/media/*.test.ts` | One test file per module above |

---

### Task 1: Migration and decision record

**Files:**
- Create: `supabase/migrations/20261121200000_create_place_media.sql`
- Modify: `docs/DECISIONS.md` (append P-013), `docs/DATA_MODEL.md` (add a §4b pointing at the new tables)

**Interfaces:**
- Produces:
  - Tables `place_photos`, `place_vibe_inputs` and `student_reviews` exactly as in spec §7, plus `student_reviews.hidden boolean not null default false`.
  - Column `restaurants.media_checked_at timestamptz` (null means never processed).
  - View `public.restaurant_points (id, place_id, name, lat, lng, website, address, osm_tags, media_checked_at)`, using `ST_Y` and `ST_X` of `location::geometry`.
  - Storage bucket `place-photos`.

- [ ] **Step 1: Write the migration.**
  - Follow the style of `20261121180000_create_accounts.sql`: `public.` prefixes, a comment header citing the spec, RLS enabled on every table.
  - **Policies:**
    - `place_photos` and `student_reviews`: `anon` and `authenticated` can select rows where `hidden = false`.
    - `authenticated` can insert and delete only their own rows. For `place_photos` that means `author_id = auth.uid()` and `kind = 'student'`; for `student_reviews` it means `author_id = auth.uid()`.
    - `place_vibe_inputs`: no grants to `anon` or `authenticated`.
    - `restaurant_points`: revoke all from `anon` and `authenticated`; grant select to `service_role`.
  - **Constraints:**
    - `place_photos.review_id` references `student_reviews(id) on delete cascade`.
    - A check that `url` is not null when `source` is not `mapillary` or `upload`.
    - A check that `mapillary_id` is not null when `source = 'mapillary'`.
    - Unique index on `(restaurant_id, url)` where `url is not null`.
  - **Bucket:** `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('place-photos','place-photos',true,5242880,'{image/jpeg,image/png,image/webp}')`.
  - **Bucket policies:** on `storage.objects`, authenticated users can insert and delete where `bucket_id = 'place-photos'` and `(storage.foldername(name))[1] = auth.uid()::text`.

- [ ] **Step 2: Apply it locally.**
  - Run: `npx supabase@2 start` (needs Docker Desktop running), then `npx supabase@2 db reset`.
  - Expected: all three migrations apply with no error.
  - If Docker isn't available, record that in the task report, and ask the user to paste the file into the hosted project's SQL editor. Report the result they get.

- [ ] **Step 3: Check the policies.**
  - Run in `npx supabase@2 db` psql, or in the SQL editor: `set role anon; select count(*) from place_vibe_inputs;`
  - Expected: permission denied.
  - Then: `set role anon; select count(*) from restaurant_points;`
  - Expected: permission denied.

- [ ] **Step 4: Add P-013 to DECISIONS.md**, using the file's template. Context and decision summarize spec §1, §4 and §9. Mark it **Proposed**, and state that showing website photos departs from AGENTS.md §5 and needs team ratification. Add the DATA_MODEL.md §4b pointer.

- [ ] **Step 5: Commit.**
```bash
git add supabase/migrations/20261121200000_create_place_media.sql docs/DECISIONS.md docs/DATA_MODEL.md
git commit -m "feat(db): place photos, vibe inputs and student reviews"
```

### Task 2: Keep the extra OSM tags

**Files:**
- Modify: `pipeline/src/normalize.ts:104-106`
- Test: `pipeline/test/normalize.test.ts`

**Interfaces:**
- Produces: `pickOsmTags` also keeps `live_music`, `smoking`, `wikidata`, `wikimedia_commons` and `image`.

- [ ] **Step 1: Write the failing test.**
```ts
test('pickOsmTags keeps photo-link and vibe tags', () => {
  const out = pickOsmTags({ name: 'X', wikidata: 'Q1', wikimedia_commons: 'File:A.jpg', image: 'https://x/y.jpg', live_music: 'yes', smoking: 'no', brand: 'B' });
  assert.deepEqual(out, { wikidata: 'Q1', wikimedia_commons: 'File:A.jpg', image: 'https://x/y.jpg', live_music: 'yes', smoking: 'no' });
});
```
- [ ] **Step 2:** Run `npm test --prefix pipeline`. Expected: this test fails.
- [ ] **Step 3:** Add the five keys to `OSM_TAG_KEYS`.
- [ ] **Step 4:** Run `npm test --prefix pipeline`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(ingest): keep photo-link and vibe OSM tags`. Ingest is re-run in Task 11.

### Task 3: Shared types, robots and polite fetch

**Files:**
- Create: `pipeline/src/media/types.ts`, `pipeline/src/media/robots.ts`, `pipeline/src/media/http.ts`
- Test: `pipeline/test/media/robots.test.ts`, `pipeline/test/media/http.test.ts`
- Modify: `pipeline/package.json` (add `node-html-parser` and `proj4` at exact current versions, plus `@types/proj4` in devDependencies)

**Interfaces:**
- Produces (`types.ts`):
```ts
export interface EnrichPlace { id: number; placeId: string; name: string; lat: number; lng: number; website: string | null; address: string | null; osmTags: Record<string, string> | null }
export type PhotoKind = 'student' | 'licensed' | 'website';
export type PhotoSource = 'upload' | 'osm' | 'wikidata' | 'commons' | 'mapillary' | 'website';
export type MatchMethod = 'upload' | 'osm_tag' | 'wikidata' | 'name_match' | 'nearest_facing' | 'website';
export interface PhotoCandidate { kind: PhotoKind; source: PhotoSource; matchMethod: MatchMethod; url: string | null; mapillaryId: string | null; pageUrl: string | null; license: string | null; credit: string }
export type VibeSource = 'website' | 'wiki' | 'osm_tags' | 'city_licenses' | 'student_reviews';
export interface VibeInput { source: VibeSource; content: string; sourceUrl: string | null }
export interface FetchDeps { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }
```
- Produces (`robots.ts`): `parseRobots(txt: string, userAgent: string): (path: string) => boolean`. Groups match on the product token `vibenta-ingest` or on `*`. A specific group beats `*`. The longest matching `Allow`/`Disallow` prefix wins, and a tie goes to `Allow`. An empty or missing file allows everything.
- Produces (`http.ts`):
  - `createPoliteFetcher(deps?: FetchDeps & { minIntervalMs?: number; timeoutMs?: number }): PoliteFetcher`
  - `interface PoliteFetcher { getText(url: string, opts?: { checkRobots?: boolean }): Promise<FetchResult>; getJson<T>(url: string): Promise<T> }`
  - `type FetchResult = { ok: true; url: string; contentType: string; body: string } | { ok: false; reason: 'robots' | 'http' | 'timeout' | 'not_html' | 'network'; detail: string }`
  - `getText` with `checkRobots` fetches `/robots.txt` once per origin and caches the result. A robots fetch that fails with a 4xx counts as "allow all"; a 5xx or network error counts as "disallow".
  - It follows at most 5 redirects, and returns `not_html` unless the content type contains `text/html`.
  - `getJson` throws on a non-2xx response (Wikimedia, Mapillary and CKAN calls).
  - Defaults: `minIntervalMs` 1000, `timeoutMs` 15000.

- [ ] **Step 1: Write failing robots tests:**
  - `Disallow: /` under `User-agent: *` blocks `/about`.
  - `User-agent: vibenta-ingest` + `Allow: /` overrides a `*` disallow.
  - `Disallow: /private` + `Allow: /private/menu` allows `/private/menu` and blocks `/private/x`.
  - An empty file allows everything.
- [ ] **Step 2: Write failing http tests** with a harness like `test/osm.test.ts`:
  - Every request carries `USER_AGENT`.
  - Two `getText` calls to the same host wait at least 1000 ms between them, measured on injected `now` and `sleep`. Calls to different hosts don't wait.
  - `robots.txt` is fetched once per origin across two page fetches.
  - A disallowed path returns `{ ok: false, reason: 'robots' }` without fetching the page.
  - `application/pdf` returns `not_html`.
  - A 503 on `robots.txt` returns `reason: 'robots'`.
  - Six chained redirects return `reason: 'http'`.
  - A rejected fetch returns `reason: 'network'`.
  - A fetch rejected with an `AbortError` or `TimeoutError` returns `reason: 'timeout'`.
- [ ] **Step 3:** Run `npm test --prefix pipeline`. Expected: the new tests fail.
- [ ] **Step 4:** Implement both modules, and `npm install` the two dependencies.
- [ ] **Step 5:** Run `npm test --prefix pipeline` and `npm run typecheck --prefix pipeline`. Expected: pass.
- [ ] **Step 6:** Commit: `feat(media): polite fetcher with robots.txt and per-host spacing`.

### Task 4: Website extraction

**Files:**
- Create: `pipeline/src/media/website.ts`
- Test: `pipeline/test/media/website.test.ts`, fixtures in `pipeline/test/media/fixtures/` (`home.html`, `about.html`)

**Interfaces:**
- Consumes: `PoliteFetcher`, `PhotoCandidate`, `VibeInput`.
- Produces:
  - `extractPage(html: string, pageUrl: string): { text: string; description: string | null; images: string[]; aboutUrl: string | null }`
    - `text`: visible text with `script`, `style`, `nav`, `footer`, `header` and `noscript` removed and whitespace collapsed.
    - `description`: the meta description, else `og:description`, else the first JSON-LD `description`.
    - `images`: in order `og:image`, JSON-LD `image` (string, array or `{url}`), then qualifying `<img>` elements. Resolved to absolute URLs and filtered as in Global Constraints. Dropped if the URL matches `/logo|icon|favicon|sprite|placeholder/i`, ends in `.svg` or `.gif`, or starts with `data:`. Deduped.
    - `aboutUrl`: the first same-origin link whose href or text matches `/about|our-story|story|who-we-are/i`.
  - `scrapeWebsite(place: EnrichPlace, http: PoliteFetcher): Promise<{ photos: PhotoCandidate[]; input: VibeInput | null; failure: FetchResult | null }>`
    - Fetches the home page and, when found, the about page. The input content is the description plus the about text (or the home text), capped at 4000 characters, with `sourceUrl` set to the home URL.
    - Photos: at most 5, `kind: 'website'`, `source: 'website'`, `matchMethod: 'website'`. `credit` is the hostname without `www.`, and `pageUrl` is the page the image came from.

- [ ] **Step 1: Write failing tests on the fixtures:**
  - The `og:image` comes first.
  - A relative `/img/room.jpg` resolves to `https://example.com/img/room.jpg`.
  - A `//cdn.example.com/a.jpg` URL resolves to https.
  - An `http://` image is dropped.
  - `logo.png`, `a.svg` and `data:` URIs are dropped.
  - A `200×200` `<img>` is dropped. A `srcset` with `1200w` is kept.
  - Script and nav text don't appear in `text`.
  - `aboutUrl` is found.
  - Text is capped at 4000 characters.
  - `scrapeWebsite` with a robots-blocked site returns no photos, a null input and a `failure` with reason `robots`.
- [ ] **Step 2:** Run the tests. Expected: they fail.
- [ ] **Step 3:** Implement with `node-html-parser`.
- [ ] **Step 4:** Run the tests. Expected: they pass.
- [ ] **Step 5:** Commit: `feat(media): website text and photo extraction`.

### Task 5: Wikimedia (Commons, Wikidata, Wikipedia)

**Files:**
- Create: `pipeline/src/media/wikimedia.ts`
- Test: `pipeline/test/media/wikimedia.test.ts`

**Interfaces:**
- Consumes: `PoliteFetcher.getJson`, `nameKey` and `nameSimilarity` from `src/normalize.ts`.
- Produces:
  - `isAllowedLicense(shortName: string): boolean`
  - `isDistinctiveName(name: string): boolean`. True when `nameKey(name)` has ≥ 2 tokens or one token of ≥ 5 characters.
  - `nameMatches(haystack: string, name: string): boolean`. True only when the name is distinctive and either every token of `nameKey(name)` appears in `nameKey(haystack)` or `nameSimilarity` ≥ 0.8.
  - `commonsFiles(titles: string[], http): Promise<Map<string, { url: string; pageUrl: string; license: string; credit: string; categories: string[] }>>`
    - Batches of up to 50 titles to `https://commons.wikimedia.org/w/api.php`, with `action=query&prop=imageinfo|categories&iiprop=url|extmetadata&iiurlwidth=1024&format=json&formatversion=2`.
    - `url` is `thumburl`, `license` is `LicenseShortName`, and `credit` is `Artist` with HTML stripped (fallback `"Wikimedia Commons"`).
    - Files whose license fails `isAllowedLicense` are left out.
  - `linkedPhotos(place: EnrichPlace, http): Promise<{ photos: PhotoCandidate[]; wikidata: { enwikiTitle: string | null } | null }>`
    - From OSM `wikimedia_commons` (only `File:` values; `Category:` is ignored) and from OSM `image` when its host is `commons.wikimedia.org` or `upload.wikimedia.org` (file name taken from the path). Both give `source: 'osm'`, `matchMethod: 'osm_tag'`.
    - From the OSM `wikidata` tag: `wbgetentities&props=claims|sitelinks&sitefilter=enwiki`. The P18 image gives `source: 'wikidata'`, `matchMethod: 'wikidata'`.
    - All are `kind: 'licensed'`.
  - `geosearchPhotos(place: EnrichPlace, http): Promise<PhotoCandidate[]>`
    - Returns `[]` when the name isn't distinctive.
    - Otherwise runs `list=geosearch&gscoord=lat|lng&gsradius=50&gsnamespace=6&gslimit=50`, then `commonsFiles`. Keeps files whose title or any category passes `nameMatches`. `source: 'commons'`, `matchMethod: 'name_match'`.
  - `wikipediaExtract(title: string, http): Promise<{ text: string; url: string } | null>`
    - `prop=extracts&exintro=1&explaintext=1` on `en.wikipedia.org`.

- [ ] **Step 1: Write failing tests:**
  - **Licenses:** `CC BY-SA 4.0`, `CC0`, `Public domain` and `CC BY 2.0` are allowed. `CC BY-NC 2.0` and `CC BY-ND 4.0` are rejected.
  - **Distinctive names:** false for `"Cafe"` and `"Pizza"`; true for `"Tatte Bakery"` and `"Mamaleh's"`.
  - **Name matching:** `"File:Tatte Bakery Beacon Hill.jpg"` matches `"Tatte Bakery"`. `"File:Cafe sign.jpg"` doesn't match `"Cafe"`.
  - **Linked photos:** with a mocked `getJson`, the OSM tags `wikimedia_commons=File:A.jpg` and `wikidata=Q1` (P18 `B.jpg`) give two candidates with the right sources.
  - **Ignored values:** a `Category:` value is ignored. An `image=https://example.com/x.jpg` tag is ignored.
  - **Geosearch:** a hit titled `"File:Unrelated street.jpg"` is dropped. A file with license `CC BY-NC` is dropped.
- [ ] **Step 2:** Run the tests. Expected: they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: they pass.
- [ ] **Step 5:** Commit: `feat(media): Wikimedia linked and geosearch photos`.

### Task 6: Wikivoyage listings

**Files:**
- Create: `pipeline/src/media/wikivoyage.ts`
- Test: `pipeline/test/media/wikivoyage.test.ts`

**Interfaces:**
- Consumes: `PoliteFetcher.getJson`, `metersBetween` (`src/geo.ts`), `nameKey`, `nameSimilarity`, `isDistinctiveName`.
- Produces:
  - `parseListings(wikitext: string, pageTitle: string): Listing[]`
    - `interface Listing { name: string; lat: number | null; lng: number | null; content: string; pageTitle: string }`
    - Reads `{{eat|…}}`, `{{drink|…}}`, `{{see|…}}`, `{{do|…}}` and `{{listing|…}}` templates, case-insensitive, with nested `{{…}}` and `[[…|…]]` handled.
    - Params split on top-level `|`. Uses the `name`, `lat`, `long` and `content` params.
    - In `content`, `[[a|b]]` becomes `b`, `[[a]]` becomes `a`, and `''` is removed.
  - `loadListings(http, opts: { cacheDir: string; refresh: boolean }): Promise<Listing[]>`
    - Pages: every title from `list=allpages&apprefix=Boston/&apnamespace=0` on `en.wikivoyage.org`, plus `Boston`, `Cambridge (Massachusetts)`, `Somerville` and `Brookline`.
    - Wikitext comes from `action=parse&prop=wikitext`.
    - Cached in `<cacheDir>/wikivoyage.json`.
  - `matchListing(place: EnrichPlace, listings: Listing[]): Listing | null`
    - With coordinates: within 100 m and `nameSimilarity` ≥ 0.8.
    - Without coordinates: `nameKey` is equal, the name is distinctive, and exactly one listing has that key.

- [ ] **Step 1: Write failing tests:**
  - A listing with nested `{{phone|…}}` and `[[Back Bay|the Back Bay]]` parses to content containing "the Back Bay".
  - A matching name 150 m away is rejected; 60 m away it matches.
  - Two coordinate-less listings with the same name don't match.
  - `"Cafe"` without coordinates doesn't match.
- [ ] **Step 2:** Run the tests. Expected: they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: they pass.
- [ ] **Step 5:** Commit: `feat(media): Wikivoyage listing matching`.

### Task 7: Mapillary

**Files:**
- Create: `pipeline/src/media/mapillary.ts`
- Test: `pipeline/test/media/mapillary.test.ts`

**Interfaces:**
- Consumes: `PoliteFetcher.getJson`, `metersBetween`.
- Produces:
  - `bearingDegrees(from: {lat, lng}, to: {lat, lng}): number`, in [0, 360).
  - `angleDiff(a: number, b: number): number`, in [0, 180].
  - `facingPhoto(place: EnrichPlace, token: string, http): Promise<PhotoCandidate | null>`
    - Request: `https://graph.mapillary.com/images?access_token=…&fields=id,computed_compass_angle,computed_geometry&bbox=<minLng,minLat,maxLng,maxLat>&limit=100`, with a bbox of ±0.0003° around the place.
    - Picks the nearest image within 30 m whose `angleDiff(compass, bearing(image → place))` is ≤ 45.
    - Returns `{ kind: 'licensed', source: 'mapillary', matchMethod: 'nearest_facing', url: null, mapillaryId: id, pageUrl: 'https://www.mapillary.com/app/?pKey=' + id, license: 'CC BY-SA 4.0', credit: 'Mapillary contributors' }`.

- [ ] **Step 1: Write failing tests:**
  - **Bearing:** due north is 0, due east is about 90.
  - **Angle diff:** `angleDiff(350, 10)` is 20.
  - **Facing photo:** an image 10 m south facing north is chosen over one 5 m away facing away. Nothing within 30 m returns null.
- [ ] **Step 2:** Run the tests. Expected: they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: they pass.
- [ ] **Step 5:** Commit: `feat(media): Mapillary facing street photo`.

### Task 8: Boston city licenses

**Files:**
- Create: `pipeline/src/media/cityLicenses.ts`
- Test: `pipeline/test/media/cityLicenses.test.ts`
- Modify: `pipeline/src/config.ts` (add the constants below)

**Interfaces:**
- Consumes: `PoliteFetcher.getJson`, `metersBetween`, `nameSimilarity`, `proj4`.
- Produces:
  - Constants: `BOSTON_ENTERTAINMENT_RESOURCE = 'eb683641-e358-4c2c-95de-c84f32c09147'` and `BOSTON_ALCOHOL_RESOURCE = 'aab353c1-c797-4053-a3fc-e893f5ccf547'`. Both are read through `https://data.boston.gov/api/3/action/datastore_search?resource_id=…&limit=1000&offset=…`, paged until a short page.
  - `stateplaneToWgs84(x: number, y: number): { lat: number; lng: number }`. EPSG:2249 (`+proj=lcc +lat_1=42.68333333333333 +lat_2=41.71666666666667 +lat_0=41 +lon_0=-71.5 +x_0=200000.0001016002 +y_0=750000 +ellps=GRS80 +datum=NAD83 +units=us-ft +no_defs`).
  - `interface CityLicense { dataset: 'entertainment' | 'alcohol'; name: string; lat: number; lng: number; licenseType: string; closing: string | null; capacity: string | null; unitType: string | null; premises: string | null }`
    - Only `status = 'Active'` rows. `name` is `dba_name`, falling back to `business_name`.
    - `closing` comes from `end_time` for entertainment and `closing` for alcohol. `premises` comes from `location_comments` (alcohol only).
    - Rows without `gpsx`/`gpsy` are skipped. No personal fields are kept.
  - `loadCityLicenses(http, opts: { cacheDir: string; refresh: boolean }): Promise<CityLicense[]>`, cached in `<cacheDir>/city-licenses.json`.
  - `matchCityLicenses(place: EnrichPlace, all: CityLicense[]): CityLicense[]`. Matches within 60 m with `nameSimilarity` ≥ 0.5.
  - `cityLicenseInput(matches: CityLicense[]): VibeInput | null`
    - One line per license, e.g. `Entertainment license: Live Entertainment (Live Music), until 2:00AM, capacity 49.`, or `Alcohol license: … closes 9:00 PM. Premises: …`.
    - `sourceUrl`: `https://data.boston.gov/dataset/liquor-licenses` or the entertainment dataset page.

- [ ] **Step 1: Write failing tests:**
  - `stateplaneToWgs84(780647.69, 2960179.33)` is within 0.005° of `{ lat: 42.369, lng: -71.039 }` (Maverick Square).
  - Row mapping drops `applicant`, `manager` and `day_phone`, and skips an `Inactive` row.
  - A license 40 m away named "The Spur" matches a place named "The Spur Bar". One 200 m away doesn't.
  - The input text contains `until 2:00AM`.
- [ ] **Step 2:** Run the tests. Expected: they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: they pass.
- [ ] **Step 5:** Commit: `feat(media): Boston entertainment and alcohol license inputs`.

### Task 9: Ranking, priority and database access

**Files:**
- Create: `pipeline/src/media/rank.ts`, `pipeline/src/media/priority.ts`, `pipeline/src/media/db.ts`
- Test: `pipeline/test/media/rank.test.ts`, `pipeline/test/media/priority.test.ts`, `pipeline/test/media/db.test.ts`

**Interfaces:**
- Produces (`rank.ts`):
  - `SOURCE_RANK: Record<PhotoSource, number>`, set to `{ upload: 1, osm: 2, wikidata: 2, website: 3, commons: 4, mapillary: 5 }`.
  - `rankPhotos(candidates: PhotoCandidate[], hiddenUrls: Set<string>): Array<PhotoCandidate & { rank: number }>`
    - Drops candidates whose `url` is in `hiddenUrls`.
    - Dedupes by `url`, or by `mapillaryId` for Mapillary. Within a duplicate, the lower rank wins.
    - Sorts stably by rank and keeps at most 5.
- Produces (`priority.ts`):
  - `type Tier = 1 | 2 | 3`
  - `loadDemoIds(file: string): Promise<Set<string>>`. One `place_id` per line; `#` comments and blank lines are ignored. A missing file gives an empty set.
  - `loadCampuses(): Promise<Array<{ lat: number; lng: number }>>`. Imports `BOSTON_LOCATIONS` from `../../../apps/web/src/discovery/data/bostonLocations.generated.ts` and filters `kind === 'university'`.
  - `loadStops(): Promise<Array<{ lat: number; lng: number }>>`. Reads `apps/web/src/features/transit/data/stops.json`.
  - `tierOf(place: EnrichPlace, ctx: { demo: Set<string>; stops: …; campuses: … }): Tier`
    - 1 if the place is in the demo list.
    - 2 if it's within 800 m of a stop and within 1500 m of a campus.
    - Otherwise 3.
- Produces (`db.ts`), all using the client from `src/db.ts` `connect()`:
  - `fetchEnrichPlaces(client, opts: { refresh: boolean }): Promise<EnrichPlace[]>`. Reads from `restaurant_points`, paged by `id` 1,000 at a time. Unless `refresh`, only rows with `media_checked_at is null`.
  - `fetchHiddenUrls(client, restaurantId: number): Promise<Set<string>>`
  - `fetchStudentReviewText(client, restaurantId: number): Promise<string[]>`. Bodies of non-hidden reviews; seeded reviews included.
  - `writePlaceMedia(client, restaurantId: number, photos: Array<PhotoCandidate & { rank: number }>, inputs: VibeInput[], checkedAt: string): Promise<void>`
    - Deletes `place_photos` where `restaurant_id` matches, `kind <> 'student'` and `hidden = false`, then inserts the photos with `checked_at`.
    - Upserts the inputs on `(restaurant_id, source)`.
    - Sets `restaurants.media_checked_at`.

- [ ] **Step 1: Write failing tests:**
  - **Ranking:**
    - A website photo and a Commons photo with the same URL keep `rank` 3.
    - A hidden URL is dropped.
    - Eight candidates give 5.
    - Mapillary sorts last.
  - **Priority:**
    - A demo ID gives tier 1.
    - A place 300 m from a stop and 1 km from a campus gives tier 2.
    - A place near a stop but 3 km from any campus gives tier 3.
    - A missing demo file gives an empty set.
  - **Database:** `writePlaceMedia` against a fake client that records calls:
    - The delete filter includes `kind <> 'student'` (`.neq('kind', 'student')`) and `hidden = false`.
    - The upsert uses `onConflict: 'restaurant_id,source'`.
- [ ] **Step 2:** Run the tests. Expected: they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: they pass.
- [ ] **Step 5:** Commit: `feat(media): photo ranking, priority tiers and media writes`.

### Task 10: `enrich:media` CLI

**Files:**
- Create: `pipeline/src/enrichMedia.ts`
- Test: `pipeline/test/media/enrichMedia.test.ts`
- Modify: `pipeline/package.json` (script `"enrich:media": "node --env-file-if-exists=.env src/enrichMedia.ts"`), `pipeline/.env.example` (add `MAPILLARY_TOKEN=` with a comment that it's optional)

**Interfaces:**
- Consumes: everything from Tasks 3–9.
- Produces:
  - `parseMediaArgs(argv: string[]): { dryRun: boolean; refresh: boolean; limit: number | null; concurrency: number; tiers: Tier[] }`. Defaults: `concurrency` 4, `tiers` `[1,2,3]`. Flags: `--dry-run`, `--refresh`, `--limit N`, `--concurrency N`, `--tiers 1,2`.
  - `enrichPlace(place: EnrichPlace, ctx: EnrichContext): Promise<PlaceResult>`
    - `interface PlaceResult { photos: Array<PhotoCandidate & { rank: number }>; inputs: VibeInput[]; websiteFailure: string | null; errors: string[] }`
    - `EnrichContext` holds the fetchers, the loaded listings and licenses, the Mapillary token, a `hiddenUrls` lookup and a `studentReviews` lookup.
  - `summarizeMedia(results: PlaceResult[], skippedTiers: number): string`

- [ ] **Step 1: Write failing tests for `enrichPlace`,** with every source stubbed through `ctx`:
  - A failure in one source (Wikivoyage throws) is recorded in `errors`, and the other sources' results are still returned.
  - Inputs:
    - The OSM tags input is built from `osmTags` without `name` or `amenity`.
    - `student_reviews` appears only when reviews exist, joined with `\n---\n`.
    - `wiki` combines the Wikipedia extract and the Wikivoyage content.
  - A hidden URL from `ctx.hiddenUrls` doesn't appear in `photos`.
  - `summarizeMedia` reports:
    - places processed;
    - places with ≥ 1 photo;
    - photo counts per source;
    - counts per vibe-input source;
    - website failures by reason;
    - places with errors.
- [ ] **Step 2:** Run the tests. Expected: they fail.
- [ ] **Step 3: Implement `main()`.**
  - Same pattern as `src/ingest.ts`, with `import.meta.filename` guarding the entry point.
  - Two fetchers: a website fetcher (`minIntervalMs` 1000, robots on) and an API fetcher (`minIntervalMs` 200).
  - Load the listings and city licenses once into `pipeline/.cache`.
  - Fetch the places, compute tiers, filter to `--tiers`, and sort by tier then `id`. Apply `--limit`.
  - Process with a simple pool of `concurrency` workers.
  - Per place: `enrichPlace`, then `writePlaceMedia`, unless `--dry-run`. In a dry run, write `pipeline/.cache/media-dry-run.json` instead.
  - Print `summarizeMedia` at the end, and also on SIGINT.
  - The process exits non-zero only on setup failure (environment, Supabase connection). Per-place errors are counted, not fatal.
- [ ] **Step 4:** Run `npm test --prefix pipeline` and `npm run typecheck --prefix pipeline`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(media): enrich:media CLI`.

### Task 11: Run it and record coverage

**Files:**
- Modify: `pipeline/README` section in `README.md` (if one exists; otherwise add a short "Enrichment" section to `README.md`), and spec §11 results

- [ ] **Step 1: Re-run ingest** so the new OSM tags land: `npm run ingest --prefix pipeline`. Expected: the summary prints, and the "Updated" count is about the existing row count.
- [ ] **Step 2: Do a dry run** on 50 tier-2 places: `npm run enrich:media --prefix pipeline -- --dry-run --tiers 2 --limit 50`. Expected: the summary prints with non-zero photo and input counts.
- [ ] **Step 3: Spot-check by eye.** Open 10 photo URLs from `.cache/media-dry-run.json`. Each must show the right place, or be plausible for its rank. Write the hit rate per source in the task report. If geosearch or Mapillary is below about 7/10, report it to the user before the real run, rather than changing thresholds silently.
- [ ] **Step 4: Do the real run** for tiers 1–2: `npm run enrich:media --prefix pipeline -- --tiers 1,2`. Expected: the summary prints, and rows appear in `place_photos` and `place_vibe_inputs`. Then start tier 3 in the background if time allows.
- [ ] **Step 5: Record the coverage.** Put the summary numbers and spot-check rates into spec §11 under a "Run record" heading, plus the README command. Commit: `docs(media): enrich:media usage and first run record`.
