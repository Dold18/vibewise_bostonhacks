# Deal Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a marker on a map pin while one of the place's student discounts or specials is active, fed by a curated list, the OSM `happy_hours` tag and a rule-based website scan.

**Architecture:**
- **Pipeline:** a new pipeline step, `npm run enrich:deals`, fills a new Supabase table `place_deals`. It uses pure parsers in `pipeline/src/deals/` and the existing `PoliteFetcher`.
- **Browser:** the web app loads deals with each place's catalog details. A pure module (`apps/web/src/deals.ts`) decides what is active from the Boston clock. `main.ts` draws the pin chip and the card section, and re-checks every 60 s.

**Tech Stack:**
- **Pipeline:** Node ≥ 24 running `.ts` directly, `node:test`, `node-html-parser`, `@supabase/supabase-js`.
- **Web:** Vite + TypeScript, `vitest`, MapLibre DOM markers.
- **Database:** Supabase Postgres migrations.

**Spec:** `docs/superpowers/specs/2026-11-21-deal-markers-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- **No LLM or paid API, and no new dependencies.** `node-html-parser` is already in the pipeline.
- **Website fetching only through `createPoliteFetcher`** (`pipeline/src/media/http.ts`), with `checkRobots: true`.
- **Boston local time (`America/New_York`) for every schedule.** The web side uses `bostonWallTime` from `apps/web/src/discovery/bostonTime.ts`.
- **Field limits:**
  - `title` ≤ 120 chars, cut on a word boundary with `…`;
  - `quote` ≤ 200 chars;
  - at most 5 website deals per place;
  - at most 2 linked pages fetched per place.
- **Freshness and re-scan windows:**
  - a deal is stale when `checked_at` is more than 90 days old;
  - a website is re-scanned when `deals_checked_at` is null or more than 7 days old.
- **Timing rules:**
  - `timing = 'unconfirmed'` is never active;
  - `timing = 'any_time'` is allowed only for `kind = 'student'`;
  - `schedule` is non-null if and only if `timing = 'scheduled'`.
- **No run deletes a `hidden = true` row.**
- **`pipeline/deals.curated.json` ships as `[]`.** Never add real-looking entries; test data lives only in test fixtures and in clearly labeled `supabase/seed.sql` rows.
- **Commits carry no Co-Authored-By or Claude attribution lines** (user preference).

## Review Focus

1. **A page that is mostly navigation, with the word "Specials" as a menu link.** It must not become a deal. Expect no row from a line that is only a link label. Covered in Task 4.
2. **A device in another time zone, or a DST change.** Markers follow Boston's clock, not the device's. Covered in Task 8.
3. **A window that crosses midnight, viewed just after midnight.** Friday 22:00–01:00 is still active at 00:30 Saturday. Covered in Task 8.
4. **The `place_deals` migration not yet applied to the database the web app uses.** Cards and pins must keep working with no deals. Covered in Task 9.
5. **A venue site that links its specials page to another domain** (a PDF host or ordering platform). Expect no fetch off the venue's origin. Covered in Task 5.

---

### Task 1: Database migration and docs

**Files:**
- Create: `supabase/migrations/20261122090000_create_place_deals.sql`
- Modify: `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/CONTRACTS.md`, `docs/ROADMAP.md`

**Interfaces:**
- **Produces:** table `public.place_deals` exactly as spec §1, including the `timing` column and both `check`s from §1/§2.
- **Produces:** `restaurants.deals_checked_at timestamptz`.
- **Produces:** view `public.restaurant_points` recreated with two columns appended at the end: `deals_checked_at` and `last_seen_at`. Use `create or replace view`, keeping the existing columns in order and `security_invoker = true`.
- **Produces:** RLS on `place_deals`, policy `"deals: read visible"` `for select to anon, authenticated using (not hidden)`, and `grant select on public.place_deals to anon, authenticated`. No insert, update or delete grants.

- [ ] **Step 1: Write the migration** following the style of `20261121200000_create_place_media.sql`: a header comment citing the spec, then the table, index, column, view, RLS and grant.
- [ ] **Step 2: Apply it locally.** Run `npx supabase db reset` from the repo root; it needs Docker. Expected: it finishes with no SQL error. If Docker or the CLI isn't available, record "migration not applied locally: <reason>" in the task report and carry on.
- [ ] **Step 3: Update the docs.**
  - **DECISIONS.md:** add `P-015 · Proposed · Deal markers` (sources, what was ruled out, the 90-day rule; see spec §8).
  - **DATA_MODEL.md:** a `place_deals` section.
  - **CONTRACTS.md:** a "Proposed change" note under `Place` with the `deals` type from spec §8. Leave the existing `studentDiscount` line in place, marked "to be replaced by `deals` once approved".
  - **ROADMAP.md:** under M8, link the spec.
- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/20261122090000_create_place_deals.sql docs/DATA_MODEL.md docs/DECISIONS.md docs/CONTRACTS.md docs/ROADMAP.md
git commit -m "feat(deals): place_deals table, RLS and docs"
```

---

### Task 2: Pipeline deal types and schedule parser

**Files:**
- Create: `pipeline/src/deals/types.ts`, `pipeline/src/deals/schedule.ts`
- Test: `pipeline/test/deals/schedule.test.ts`

**Interfaces:**
- **Produces, in `types.ts`:**

```ts
export type DealKind = 'student' | 'special';
export type DealTiming = 'any_time' | 'scheduled' | 'unconfirmed';
export type DealSource = 'curated' | 'osm' | 'website';
export interface DealWindow { days: number[]; start: string; end: string } // days 0=Sun..6=Sat, "HH:MM"; end may be "24:00"
export interface DealRow {
  kind: DealKind; title: string; quote: string | null; timing: DealTiming;
  schedule: DealWindow[] | null; source: DealSource; sourceUrl: string | null; checkedAt: string;
}
```

- **Produces, in `schedule.ts`:**
  - `parseSchedule(text: string): DealWindow[] | null`
  - `hasTimingWords(text: string): boolean`
  - `timingFor(kind: DealKind, text: string): { timing: DealTiming; schedule: DealWindow[] | null }` — returns `scheduled` when `parseSchedule` succeeds; else `any_time` for a student line without timing words; else `unconfirmed`.

**Pairing algorithm** (the tests don't fully pin it):
1. Find every **day expression** with its position. A day expression is a name or a range, plus lists joined by `,` `&` `and` `/`; or the words `weekdays`, `weekends`, `daily`, `every day`.
2. Find every **time-range expression** with its position.
3. Pair each time range with the nearest unpaired day expression before it. If there is none, use the nearest unpaired one after it.
4. A time range with no day expression is allowed only if the text contains `daily` or `every day`, which gives days 0–6.
5. **Return `null` if any of these happens:**
   - a day expression or time range is left unpaired;
   - any time phrase fails to parse, including an end of `close`, `late` or `till close`;
   - neither time in a range has `am`/`pm` and neither uses a 24-hour clock.
6. **Day ranges wrap.** `Fri-Mon` → `[5, 6, 0, 1]`.

- [ ] **Step 1: Write the failing tests** in `schedule.test.ts`, one `test()` per row:

| Input | Expected `parseSchedule` |
|---|---|
| `Happy Hour Mon–Fri 4–6pm` | `[{days:[1,2,3,4,5],start:'16:00',end:'18:00'}]` |
| `Monday through Friday 4pm-6pm` | same as above |
| `Weekdays 4:30-6:30 pm` | `[{days:[1,2,3,4,5],start:'16:30',end:'18:30'}]` |
| `Tuesdays 11-2pm` | `[{days:[2],start:'11:00',end:'14:00'}]` |
| `Fri & Sat 10pm-1am` | `[{days:[5,6],start:'22:00',end:'01:00'}]` |
| `Daily 16:00-18:00` | `[{days:[0,1,2,3,4,5,6],start:'16:00',end:'18:00'}]` |
| `noon-3pm Sundays` | `[{days:[0],start:'12:00',end:'15:00'}]` |
| `Fri-Mon 5-7pm` | `[{days:[5,6,0,1],start:'17:00',end:'19:00'}]` |
| `Mon-Thu 4-6pm, Fri 3-7pm` | `[{days:[1,2,3,4],start:'16:00',end:'18:00'},{days:[5],start:'15:00',end:'19:00'}]` |
| `Happy hour 4pm to close` | `null` |
| `Mon-Fri 4-6pm, Sun 9pm-close` | `null` |
| `Wednesdays 4-6` | `null` |
| `Happy hour 4-6pm` | `null` |
| `Student night Wednesdays` | `null` |

  Also test:
  - `hasTimingWords('10% off with student ID') === false`;
  - `hasTimingWords('Student night Wednesdays: $5 off') === true`;
  - `hasTimingWords('during finals week') === true`;
  - `timingFor('special','Happy hour daily')` → `{timing:'unconfirmed',schedule:null}`;
  - `timingFor('student','10% off with student ID')` → `{timing:'any_time',schedule:null}`.

  The timing-word list is in spec §4.3.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd pipeline && node --test test/deals/schedule.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `types.ts` and `schedule.ts`** per the interfaces and the pairing algorithm above.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test test/deals/schedule.test.ts && npm run typecheck`. Expected: all pass, no type errors.
- [ ] **Step 5: Commit.** `git add pipeline/src/deals pipeline/test/deals && git commit -m "feat(deals): deal types and schedule parser"`

---

### Task 3: OSM `happy_hours`

**Files:**
- Create: `pipeline/src/deals/osmHappyHours.ts`
- Modify: `pipeline/src/normalize.ts` (add `'happy_hours'` to `OSM_TAG_KEYS`)
- Test: `pipeline/test/deals/osmHappyHours.test.ts`, plus one case in `pipeline/test/normalize.test.ts`

**Interfaces:**
- **Consumes:** `DealRow`, `DealWindow` (Task 2).
- **Produces:**
  - `parseOpeningHoursSubset(value: string): DealWindow[] | null`
  - `osmHappyHourDeal(tag: string, lastSeenAt: string): DealRow` — `kind:'special'`, `title:'Happy hour'`, `quote` = the tag cut to 200 chars, `source:'osm'`, `sourceUrl:null`, `checkedAt: lastSeenAt`. `timing` is `scheduled` when the parse succeeds, else `unconfirmed`.

- [ ] **Step 1: Write the failing tests.**

| Input | Expected `parseOpeningHoursSubset` |
|---|---|
| `Mo-Fr 16:00-18:00` | `[{days:[1,2,3,4,5],start:'16:00',end:'18:00'}]` |
| `Mo,We 16:00-18:00,22:00-24:00` | `[{days:[1,3],start:'16:00',end:'18:00'},{days:[1,3],start:'22:00',end:'24:00'}]` |
| `Mo-Th 16:00-19:00; Fr 15:00-18:00` | two windows, in rule order |
| `Sa-Su 12:00-15:00` | `[{days:[6,0],start:'12:00',end:'15:00'}]` |
| `Mo-Fr 16:00-18:00; PH off` | `null` |
| `sunset-22:00` | `null` |
| `Mo-Fr 16:00-18:00 "drinks only"` | `null` |

  Also test that `osmHappyHourDeal('Mo-Fr 16:00-18:00', '2026-11-01T12:00:00Z').checkedAt === '2026-11-01T12:00:00Z'`. In `normalize.test.ts`, test that `pickOsmTags({happy_hours:'Mo-Fr 16:00-18:00', foo:'x'})` keeps `happy_hours` and drops `foo`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd pipeline && node --test test/deals/osmHappyHours.test.ts test/normalize.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces. Add `'happy_hours'` to `OSM_TAG_KEYS`.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(deals): OSM happy_hours parsing; keep the tag on ingest"`, after `git add` of the new files.

---

### Task 4: Line extraction and deal matching

**Files:**
- Create: `pipeline/src/deals/match.ts`
- Create: `pipeline/test/deals/fixtures/specials.html`, `pipeline/test/deals/fixtures/nav-only.html`
- Test: `pipeline/test/deals/match.test.ts`

**Interfaces:**
- **Consumes:** `timingFor`, `DealRow` (Task 2).
- **Produces:**
  - `interface PageLine { text: string; link: boolean }`
  - `extractLines(html: string): PageLine[]` — the body text with `script, style, noscript, template, svg` removed. Header, nav and footer are kept. It breaks at block elements (`p, div, li, h1–h6, section, article, header, footer, nav, td, tr`), at `<br>` and around each `a` / `button`, then at sentence ends (`. ` `! ` `? `). Whitespace is collapsed and empty lines dropped. `link` is true when the line is the whole text of an `a` or `button` element.
  - `matchDeals(lines: PageLine[], pageUrl: string, checkedAt: string): DealRow[]` — student and special detection per spec §4.3. Results are de-duplicated by lower-cased title, capped at 5 and returned in page order. `source:'website'`, `sourceUrl: pageUrl`.
  - **Link lines (Review Focus 1):** lines with `link: true` never produce a deal. A nav link "Specials" or "Student Deals" is a label, not an offer.
  - **Timing and joining:** timing comes from `timingFor(kind, line.text)` on the matched line alone. There is one exception: when the matched line has no schedule and the **next** non-link line has one (`parseSchedule` non-null) but no student, discount or special term of its own, the two are joined. The joined deal is titled `line · nextLine`, and its timing comes from the joined text. For example, `<h3>Happy Hour</h3><p>Monday–Friday 3–6pm</p>` gives one scheduled special. This is how the spec's "the line right after it" is applied; it keeps a neighboring deal's schedule from leaking onto a line.

- [ ] **Step 1: Write the fixtures.**
  - **`specials.html`:** a small venue page with these lines in separate elements:
    - a nav link "Specials";
    - "10% off with student ID";
    - "Students welcome!";
    - "Student night Wednesdays: $5 off";
    - "Show your college ID for 15% off Mon-Fri 2-5pm";
    - `<h3>Happy Hour</h3><p>Monday–Friday 3–6pm</p>`;
    - "Tuesday specials";
    - a `<script>` containing "happy hour 1-2pm".
  - **`nav-only.html`:** a nav with "Specials", "Happy Hour" and "Student Deals" links and no other deal text.
- [ ] **Step 2: Write the failing tests.**
  - **`specials.html`:** `matchDeals(extractLines(specials), url, at)` returns exactly these 5, in order:
    1. student `any_time` "10% off with student ID";
    2. student `unconfirmed` "Student night Wednesdays: $5 off";
    3. student `scheduled` `[{days:[1..5],start:'14:00',end:'17:00'}]`;
    4. special `scheduled` titled "Happy Hour · Monday–Friday 3–6pm" with `[{days:[1..5],start:'15:00',end:'18:00'}]`;
    5. special `unconfirmed` "Tuesday specials".
  - **`nav-only.html`:** gives `[]`.
  - **Titles:** a 300-char line gives a title ≤ 120 chars ending in `…` and a quote ≤ 200 chars.
  - **De-duplication and cap:** 7 distinct matching lines give 5 rows, and the same line repeated gives 1 row.
  - **Script text:** the `<script>` text never matches.
- [ ] **Step 3: Run the tests and confirm they fail.** Run `cd pipeline && node --test test/deals/match.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `match.ts`.** Export the regexes as named constants (`STUDENT_TERM`, `DISCOUNT_TERM`, `SPECIAL_TERM`) so later tuning has one place to change.
- [ ] **Step 5: Run the tests and confirm they pass.** Same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `git add pipeline/src/deals/match.ts pipeline/test/deals && git commit -m "feat(deals): rule-based deal matching on page text"`

---

### Task 5: Website scan for one place

**Files:**
- Create: `pipeline/src/deals/website.ts`
- Modify: `pipeline/src/media/website.ts` (export the existing `isThirdParty` and `websiteUrl`, no behavior change)
- Test: `pipeline/test/deals/website.test.ts`

**Interfaces:**
- **Consumes:** `PoliteFetcher`, `FetchResult` (`media/http.ts`), `EnrichPlace` (`media/types.ts`), `isThirdParty`, `websiteUrl`, `extractLines`, `matchDeals`.
- **Produces:**

```ts
export type WebsiteScan =
  | { outcome: 'ok'; deals: DealRow[] }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; detail: string };
export const DEAL_LINK: RegExp; // /special|happy[\s_-]?hour|student|deal|promo|discount/i
export function scanWebsite(place: EnrichPlace, http: PoliteFetcher, checkedAt: string): Promise<WebsiteScan>;
```

**Behavior** (spec §4.3 and its builder-check calls):
- **Permanent failures:**
  - an invalid URL;
  - a third-party start URL or redirect target;
  - a home page that fails with `robots`, `http` or `not_html`.
- **Transient failure:** `timeout` or `network` on **any** fetched page.
- **Linked pages:** at most 2, chosen from `a[href]` where `href` or the link text matches `DEAL_LINK`. Each must be on the same origin as the final home URL and not the home URL itself; duplicates are dropped, and links are taken in page order.
- **A linked page failing with `robots`, `http` or `not_html`** is skipped.
- **Deals:** matches from all loaded pages, de-duplicated by title, capped at 5 overall.

- [ ] **Step 1: Write the failing tests**, using a `fakeHttp(pages)` helper like the one in `test/media/website.test.ts`:
  - The home page links `/specials`, `/happy-hour`, `/student-deals` and `https://other.example/specials`. Exactly the first two same-origin links are fetched, and the other host is never requested.
  - The home page loads but `/specials` returns `{ok:false,reason:'timeout'}`. Expect `outcome:'transient'`.
  - The home page returns `reason:'robots'`. Expect `outcome:'permanent'`.
  - The website `https://www.facebook.com/x` gives `outcome:'permanent'` with no fetch made.
  - `/specials` returns `reason:'http'`, and the home page holds "10% off with student ID". Expect `outcome:'ok'` with that one deal, whose `sourceUrl` is the home URL.
  - Each deal's `sourceUrl` is the page it was found on.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd pipeline && node --test test/deals/website.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `scanWebsite`.** Export `isThirdParty` and `websiteUrl` from `media/website.ts`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test "test/**/*.test.ts" && npm run typecheck`. Expected: all pass, including the existing `media/website.test.ts`.
- [ ] **Step 5: Commit.** `git add pipeline/src/deals/website.ts pipeline/src/media/website.ts pipeline/test/deals/website.test.ts && git commit -m "feat(deals): scan a venue site for deals"`

---

### Task 6: Curated list, write planning and DB access

**Files:**
- Create: `pipeline/src/deals/curated.ts`, `pipeline/src/deals/plan.ts`, `pipeline/src/deals/db.ts`, `pipeline/deals.curated.json` (contents `[]`)
- Test: `pipeline/test/deals/curated.test.ts`, `pipeline/test/deals/plan.test.ts`

**Interfaces:**
- **Consumes:** `DealRow` and the other types (Task 2), `parseSchedule`-shaped `DealWindow`, `WebsiteScan` (Task 5).
- **Produces, in `curated.ts`:**
  - `validateCurated(raw: unknown, placeIds: Map<string, number>): { rows: Array<DealRow & { restaurantId: number }>; errors: string[] }`
  - Each error names the entry index and the reason.
  - `checkedAt` = `checked_on` at 12:00 Boston time as ISO with offset, e.g. `"2026-11-21T12:00:00-05:00"`.
  - Timing defaults per spec §4.1; an explicit `"timing":"unconfirmed"` is honored.
- **Produces, in `plan.ts`:**
  - `matchKey(row: Pick<DealRow, 'source' | 'title' | 'quote'>): string` — `curated` uses the title, other sources `quote ?? title`. Lower-cased; runs of non-alphanumerics become one space; trimmed.
  - `withoutHidden(rows: DealRow[], hiddenKeys: Set<string>): DealRow[]`
  - `websiteDecision(scan: WebsiteScan, hiddenKeys: Set<string>): { rows: DealRow[] | null; markChecked: boolean }`
    - `transient` → `{rows:null, markChecked:false}`;
    - `permanent` → `{rows:[], markChecked:true}`;
    - `ok` → `{rows: withoutHidden(deals), markChecked:true}`.
- **Produces, in `db.ts`** (thin Supabase wrappers; integration-tested only by the dry run and the real run):
  - `fetchDealPlaces(client): Promise<DealPlace[]>`, where `DealPlace = EnrichPlace & { dealsCheckedAt: string | null; lastSeenAt: string | null }`. It pages through `restaurant_points` like `fetchEnrichPlaces`.
  - `fetchHiddenDealKeys(client): Promise<Map<string, Set<string>>>` — keyed by `` `${restaurantId}:${source}` ``, read once per run.
  - `fetchRestaurantIdsWithVisibleDeals(client, source: DealSource): Promise<Set<number>>`
  - `replaceDeals(client, restaurantId: number, source: DealSource, rows: DealRow[]): Promise<void>` — deletes the place's `hidden = false` rows for that source, then inserts.
  - `replaceCuratedDeals(client, rows: Array<DealRow & { restaurantId: number }>): Promise<void>` — deletes all `hidden = false` curated rows, then inserts.
  - `markDealsChecked(client, restaurantId: number, at: string): Promise<void>`

- [ ] **Step 1: Write the failing tests.**
  - **`curated.test.ts`:**
    - A valid student entry without a schedule gives `timing:'any_time'`.
    - A special without a schedule gives `unconfirmed`.
    - A student entry with `"timing":"unconfirmed"` stays `unconfirmed`.
    - A bad `days` (`[]` or `[7]`) gives an error that names the index.
    - An unknown `place_id` gives an error and no row.
    - A missing `source_url` gives an error.
    - `checked_on:'2026-11-21'` gives `checkedAt:'2026-11-21T12:00:00-05:00'`, and `'2026-07-01'` gives `'2026-07-01T12:00:00-04:00'`.
    - The committed `deals.curated.json` parses to `[]`.
  - **`plan.test.ts`:**
    - `matchKey` treats `"Happy Hour!  Mon–Fri"` and `"happy hour mon fri"` as equal.
    - A hidden key drops the matching fresh row and keeps others.
    - `websiteDecision` gives the three outcomes above.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd pipeline && node --test test/deals/curated.test.ts test/deals/plan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `curated.ts`, `plan.ts` and `db.ts`.** Follow the `media/db.ts` error style: `throw new Error(\`<fn> failed for <id>: <message>\`)`.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add pipeline/src/deals pipeline/test/deals pipeline/deals.curated.json && git commit -m "feat(deals): curated list, hidden-row planning and DB access"`

---

### Task 7: `enrich:deals` CLI

**Files:**
- Create: `pipeline/src/enrichDeals.ts`
- Modify: `pipeline/package.json` (add the script `"enrich:deals": "node --env-file-if-exists=.env src/enrichDeals.ts"`)
- Test: `pipeline/test/deals/enrichDeals.test.ts`

**Interfaces:**
- **Consumes:** everything from Tasks 3–6; `connect` (`src/db.ts`); `loadDemoIds`, `loadStops`, `loadCampuses`, `tierOf` (`media/priority.ts`); `createPoliteFetcher`.
- **Produces:**
  - `parseDealsArgs(argv: string[]): DealsArgs`, where `DealsArgs = { dryRun: boolean; refresh: boolean; limit: number | null; concurrency: number; only: DealSource | null }`. `concurrency` defaults to 4. `--only` accepts `curated|osm|website`, and anything else throws `invalid --only '<v>'`.
  - `needsWebsiteScan(place: DealPlace, now: Date, refresh: boolean): boolean` — true when the place has a website and either `refresh` is set or `dealsCheckedAt` is null or more than 7 days old.

**Run order:** curated, then OSM, then website. Each stage logs one summary line (`curated: N rows, M errors`, `osm: N places`, `website: N scanned, ok/transient/permanent counts`).
- **OSM stage:** processes the union of places with an `osm_tags.happy_hours` and the ids from `fetchRestaurantIdsWithVisibleDeals(client,'osm')`. A place whose tag is gone gets `replaceDeals(..., [])`.
- **Website stage:** sorts candidates by `tierOf` (1 first), applies `--limit`, and runs a worker pool like the one in `enrichMedia.ts` `main()`.
- **`--dry-run`:** makes no DB writes. It writes `pipeline/.cache/deals-dry-run.json` as an array of `{ placeId, name, source, outcome, deals }`.

- [ ] **Step 1: Write the failing tests.**
  - `parseDealsArgs([])` gives the defaults.
  - `parseDealsArgs(['--only','web'])` throws `/invalid --only/`.
  - `needsWebsiteScan` returns:
    - true for a null check date;
    - false for one checked 6 days ago;
    - true for one checked 8 days ago;
    - false for a place with no website;
    - true with `refresh` on a place checked 1 day ago.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd pipeline && node --test test/deals/enrichDeals.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `enrichDeals.ts`.** Guard `main()` behind the same "run only when executed directly" check that `enrichMedia.ts` uses, so tests can import it.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `node --test "test/**/*.test.ts" && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Dry run against the real catalog** (read-only). Run `npm run enrich:deals -- --dry-run --only website --limit 50`.
  - **Expected:** it prints the summary lines and writes `.cache/deals-dry-run.json`.
  - **Then:** open the file and spot-check 10 deals against their `sourceUrl`; put the hit/miss counts in the task report.
  - **If no `.env` credentials are present:** record "dry run blocked: no Supabase credentials" instead.
  - **Do not run without `--dry-run`.** Writing to the shared database needs the user's go-ahead.
- [ ] **Step 6: Commit.** `git add pipeline/src/enrichDeals.ts pipeline/package.json pipeline/test/deals/enrichDeals.test.ts && git commit -m "feat(deals): enrich:deals CLI"`

---

### Task 8: Web active-deal logic

**Files:**
- Create: `apps/web/src/deals.ts`
- Test: `apps/web/src/deals.test.ts`

**Interfaces:**
- **Consumes:** `bostonWallTime` (`discovery/bostonTime.ts`).
- **Produces:**

```ts
export type DealKind = 'student' | 'special';
export interface DealWindow { days: number[]; start: string; end: string }
export interface Deal {
  kind: DealKind; title: string; timing: 'any_time' | 'scheduled' | 'unconfirmed';
  schedule: DealWindow[] | null; source: 'curated' | 'osm' | 'website'; sourceUrl: string | null; checkedAt: string;
}
export const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
export function isActive(deal: Deal, now: Date): boolean;
export type DealStatus = { kind: 'active' } | { kind: 'next'; label: string } | { kind: 'unconfirmed' } | { kind: 'stale' };
export function dealStatus(deal: Deal, now: Date): DealStatus; // precedence: stale, active, unconfirmed, next
export function activeKinds(deals: readonly Deal[], now: Date): Set<DealKind>;
export function describeSchedule(deal: Deal): string; // "Any time" | "Times not confirmed" | e.g. "Mon–Fri 4–6pm"
export function chipText(kinds: ReadonlySet<DealKind>): string; // "🎓", "%", "🎓 %", or "" when empty
export function toDeals(raw: unknown): Deal[]; // validates PostgREST rows (snake_case); drops malformed rows
```

**Formats and rules:**
- **`describeSchedule`:** consecutive days collapse with an en dash (`Mon–Fri`), others join with `, `, and all 7 days read `Daily`. Times are 12-hour, with the meridiem written once when both match (`4–6pm`), minutes only when non-zero (`4:30–6:30pm`), and both meridiems when they differ (`10pm–1am`, `11am–2pm`). Multiple windows join with `; `.
- **Next label:** `"Next: " + short day + " " + time range`, e.g. `Next: Tue 4–6pm`, for the soonest window start in the next 7 days.
- **Window membership:** start inclusive, end exclusive. A window with `end <= start` belongs to its start day and runs into the next. `"24:00"` means end of day.

- [ ] **Step 1: Write the failing tests** (instants written with explicit offsets):
  - A Mon–Fri 16:00–18:00 special is:
    - active at `2026-11-23T16:00:00-05:00` (Mon, start inclusive);
    - inactive at `…T18:00:00-05:00` (end exclusive);
    - inactive on Saturday `2026-11-28T17:00:00-05:00`.
  - A Fri 22:00–01:00 window is active at `2026-11-28T00:30:00-05:00` (Sat) and inactive at `2026-11-28T01:00:00-05:00`.
  - Boston vs. UTC: `isActive` at `2026-11-23T21:30:00Z` (16:30 Boston) is true.
  - **Boston day differs from the UTC day:** a Mon 22:00–23:00 window at `2026-11-24T03:30:00Z` (Mon 22:30 Boston, already Tue in UTC) is active. The implementation must read day and time only through `bostonWallTime`, never `Date#getDay` or `getHours`.
  - DST end day: a Sun 01:30–02:30 window at `2026-11-01T06:45:00Z` (01:45 EST, second pass) is active.
  - `any_time` student checked 10 days ago: active. Checked 91 days ago: `dealStatus` is `stale` and `isActive` is false.
  - An `unconfirmed` student or special is never active; its `dealStatus` is `unconfirmed`.
  - `dealStatus` for a Tue 16:00–18:00 special on Mon 12:00 gives `{kind:'next',label:'Next: Tue 4–6pm'}`.
  - `describeSchedule` for:
    - `Mon–Fri 4–6pm`;
    - `Fri, Sat 10pm–1am`;
    - `Daily 4:30–6:30pm`;
    - `Mon–Thu 4–6pm; Fri 3–7pm`;
    - `Any time`;
    - `Times not confirmed`.
  - `chipText` returns `''`, `'🎓'`, `'%'` and `'🎓 %'` for its four cases.
  - `toDeals` keeps a valid row, maps `source_url` / `checked_at`, and drops a row with `timing:'scheduled'` and a null schedule, or with an unknown `kind`. `toDeals(null)` gives `[]`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd apps/web && npx vitest run src/deals.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `deals.ts`.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npx vitest run src/deals.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/deals.ts apps/web/src/deals.test.ts && git commit -m "feat(deals): active-deal logic in Boston time"`

---

### Task 9: Load deals with catalog details

**Files:**
- Modify: `apps/web/src/catalog.ts`, `apps/web/src/osm.ts` (add `deals?: Deal[]` to `Place`)
- Test: `apps/web/src/catalog.test.ts`

**Interfaces:**
- **Consumes:** `Deal`, `toDeals` (Task 8).
- **Produces:**
  - `CatalogDetails.deals: Deal[]`.
  - `pinToPlace(pin, details)` sets `place.deals = details.deals` when non-empty, and leaves it undefined otherwise.
  - `DEALS_EMBED = 'place_deals(kind, title, timing, schedule, source, source_url, checked_at)'`, appended to `DETAIL_COLUMNS` in the request.
  - **Fallback (Review Focus 4):** if the details request with the embed errors, `fetchDetails` retries that chunk once without it, logs `console.warn('[catalog] deals unavailable: …')` once per page load, and stores `deals: []`. After that, every request that page load skips the embed.

- [ ] **Step 1: Write the failing tests.**
  - `pinToPlace(pin, {...details, deals:[validDeal]}).deals` equals `[validDeal]`.
  - With `deals: []`, `.deals` is `undefined`.
  - **Fallback:** extract the request into an exported `fetchDetailsWith(query: (columns: string, ids: string[]) => Promise<{data, error}>, placeIds)` so it can be tested without Supabase. A fake query errors when `columns` includes `place_deals` and succeeds otherwise. Expect the details to be cached with `deals: []` and the fake to be called twice for the first chunk and once for a second call.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd apps/web && npx vitest run src/catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `fetchDetails` delegates to `fetchDetailsWith` with the Supabase query.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npx vitest run && npx tsc --noEmit`. Expected: all web tests pass.
- [ ] **Step 5: Commit.** `git add apps/web/src/catalog.ts apps/web/src/catalog.test.ts apps/web/src/osm.ts && git commit -m "feat(deals): load place deals with catalog details"`

---

### Task 10: Pin chip, card section and 60 s tick

**Files:**
- Modify: `apps/web/src/main.ts` (`pinElement`, `showPlaces`, `clearPins`, `openCard`), `apps/web/src/style.css`
- Modify: `supabase/seed.sql` (local-only test rows)

**Interfaces:**
- **Consumes:** `activeKinds`, `chipText`, `dealStatus`, `describeSchedule` (Task 8); `place.deals` (Task 9); the existing `safeHttpUrl` and `osmUrl`.

**Behavior** (spec §7):
- **Chip markup and look:**
  - `pinElement()` adds `<span class="pin-deal" hidden aria-hidden="true"></span>` as the first child of the pin button, above `.pin-body`.
  - `.pin-deal` sits above the pin's top. It has a fixed `#fff` background, `#1f1f1f` text, a 1px `rgba(0,0,0,.35)` outline and a 999px radius, at ~11px font scaled by `--pin-scale`.
  - **No** `transform`, `transition` or `position` on `.pin` itself: see the comment in `style.css` above `.pin`.
- **Update function:** `updateDealChips(now: Date)`, local to `main.ts`. For each current marker it sets the chip's text to `chipText(activeKinds(place.deals ?? [], now))`, sets `hidden` when that text is empty, and sets the button's `aria-label` to `` `${place.name}, deal on now` `` when active and `place.name` otherwise. If the card is open, it re-renders the Deals statuses.
- **Ticking:** `showPlaces` calls `updateDealChips(new Date())` once, then starts a `setInterval(…, 60_000)`. `clearPins` clears that interval.
- **Card Deals section** (`openCard`), added after the details list when `place.deals?.length`:
  - a heading "Deals";
  - one `li` per deal with:
    - the icon (`🎓` student, `%` special) and title;
    - `describeSchedule` and the status text: `Active now`, the `next` label, `Times not confirmed` or `Not recently checked`;
    - a `Source` link: `safeHttpUrl(sourceUrl)`, or `osmUrl(place)` for `source === 'osm'`;
    - `checked <Mon D>`, formatted with `Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'America/New_York'})`;
    - for `source === 'website'`, a small "found on venue site" note.
- **Seed:** `supabase/seed.sql` gets one restaurant named `TEST ONLY — Deal Marker Cafe` near Kenmore (42.3489, -71.0950), with two deals. Both use `source_url 'https://example.com/test'`, and the file comments say they are local test data:
  - a student `any_time` deal, "TEST: 10% off with student ID";
  - a special `scheduled` deal, "TEST: daily happy hour", daily 00:00–24:00 so it is always active for the check.

- [ ] **Step 1: Implement the chip, tick and card section, and the CSS.**
- [ ] **Step 2: Type-check and build.** Run `cd apps/web && npx tsc --noEmit && npm run build`. Expected: success.
- [ ] **Step 3: Check it in the browser against local Supabase.**
  - Run `npx supabase db reset` from the repo root, with `apps/web/.env.local` pointing at the local Supabase. Start the dev server with `preview_start`.
  - Select the Restaurants layer near Kenmore. The TEST pin shows `🎓 %`, and its card lists both deals with "Active now".
  - Screenshot at desktop and at the mobile preset, and check the chip is legible on two vibe themes.
  - **Tick check:** on local Supabase (`npx supabase db query`, or psql from `npx supabase status`), set the test special's schedule to a window that ended earlier today, then reload. Only `🎓` shows.
  - **If Docker or local Supabase isn't available:** report "browser check blocked: <reason>" rather than pointing the app at the shared database.
- [ ] **Step 4: Run every test suite.** Run `cd apps/web && npx vitest run` and `cd ../../pipeline && npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit.** `git add apps/web/src/main.ts apps/web/src/style.css supabase/seed.sql && git commit -m "feat(deals): deal chip on pins and Deals section on cards"`
