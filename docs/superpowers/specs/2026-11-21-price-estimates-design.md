# Price estimates for the catalog — design

> **Status:** Draft for approval (builder check done) · 2026-11-21
> **Implements:** DECISIONS.md P-009 (price) and DATA_MODEL.md §5 step 4, estimate half only. Menu scraping (§5 steps 2–3) is a later pass.
> **Workstream:** catalog = D — Integration; place card = A — Map & Cards (WORKSTREAMS.md). P-009 and DATA_MODEL.md are still *proposed*.

## 1. Intent

Students filter and choose places by price, but every one of the 7,864 rows in Supabase `restaurants` has `price_band = 'unknown'`. OpenStreetMap and Foursquare OS Places carry no prices. This work gives most places an **honest, labeled price estimate**:
- `$`–`$$$$` from an LLM judging name, category and cuisine;
- recorded as `price_source = 'estimate'`;
- shown on the place card as, for example, "$$ (est.)".

Places the model can't judge stay `'unknown'` and the card says "Price unknown".

A later menu-scraping pass can replace estimates with real menu prices (`price_source = 'menu'`). This step must never overwrite those.

## 2. Goals, non-goals, anti-goals

**Goals**
- `npm run enrich:price` in `pipeline/` estimates a price band for catalog rows that have no price yet and writes only the price columns.
- After one run on the hosted project, most rows have `price_band <> 'unknown'` with `price_source = 'estimate'`.
- The place card shows the band, "(est.)" for estimates, and "Price unknown" otherwise.
- The rules for building requests, validating responses and choosing rows are unit-tested.

**Non-goals**
- Scraping websites or menus. `median_entree_price_cents` is not filled.
- Price filtering in the UI or a search RPC.
- Changing `Place` in CONTRACTS.md. Price reaches the card through the web app's own `Place.tags` (see §5.6).
- Limiting the run to places near T stations. There is no stations table, and the full run is cheap (§4).

**Anti-goals: these would make the work a failure even if it ran**
- Showing an estimate as if it were known. Every estimate is labeled "(est.)".
- Overwriting `price_source = 'menu'` rows, or any column other than the three price columns.
- Inventing a dollar amount. Estimates never write `median_entree_price_cents`, which is reserved for prices read from a menu.
- Any Google or Yelp data. In particular, Gemini's Google Search grounding stays **off**.
- The Gemini key or the Supabase secret key reaching `apps/web` or git.
- Writing a band the model didn't return for that exact row (for example, from a shifted or partial response).

## 3. Constraints

- Node 24 + TypeScript in `pipeline/`, the same conventions as `npm run ingest`:
  - `node --env-file-if-exists=.env`;
  - `node:test`;
  - `parseArgs`;
  - no build step.
- Secrets in `pipeline/.env`: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and the new `GEMINI_API_KEY`. Document them in `pipeline/.env.example`.
- `npm run ingest` upserts never send price columns, and its re-key actions don't touch them, so ingest re-runs keep estimates. No change to ingest is needed.
- Gemini free-tier rate limits are low (on the order of 10 requests per minute for Flash models). The step must pace itself and back off on HTTP 429/503.
- Running against the hosted project needs the user's go-ahead. `--dry-run` must be possible first.

## 4. Approaches considered

1. **Batched LLM bands (chosen).**
   - Gemini Flash gets about 100 places per request and returns one band or `unknown` per place, as schema-constrained JSON, using a written rubric.
   - About 80 requests cover the catalog: minutes of runtime and well under a dollar.
   - It handles chains and price-revealing names even for the 2,870 rows with no cuisine.
2. **Rules first, then the LLM.**
   - A hand-written cuisine/amenity → band table plus a chain list, with the LLM only for leftovers.
   - Cheaper and deterministic, but coarse and needs upkeep, and most rows without a cuisine would still need the LLM.
   - Rejected by the user in favour of 1.
3. **Gemini with Google Search grounding.** More accurate, but brings Google data into the catalog (brief §11, DATA_MODEL §7). Ruled out.

Menu scraping before estimates was also considered. The user chose estimates first: fast, and covers every row. Scraping comes later and wins over estimates.

## 5. Design

### 5.1 Rubric

The band describes what **one person typically spends on a normal meal or visit there, before tip**, in Boston, in 2026 dollars. The cut-offs match the budget filter the app already has (`BUDGET_OPTIONS` in `apps/web/src/discovery/preferences.ts`, per person, in cents). The user chose this so a later price filter maps cleanly:
- "Under $15" → `$`;
- "Under $25" → `$`–`$$`;
- "Under $40" → `$`–`$$$`.

"Under $60" can't be told apart from "No limit", because `$$$$` has no upper bound. That's accepted.

| Band | Per person, before tip | Examples |
|---|---|---|
| `$` | under $15 | slice shop, food truck, fast food, bakery, most coffee shops, bubble tea |
| `$$` | $15–25 | casual sit-down, ramen, pho, pub food |
| `$$$` | $25–40 | upscale casual, nicer bistros, cocktail bars with food |
| `$$$$` | over $40 | fine dining, steakhouses, tasting menus |

- For cafes, a visit is a drink plus a pastry.
- For bars and pubs, it is a couple of drinks plus a snack.

The model answers `unknown` when it has no real signal, for example a generic name with no cuisine. **`unknown` is a correct answer, not a failure.** The prompt says so explicitly, so it doesn't spread guesses evenly across bands.

The rubric lives in one exported constant so the UI copy and a later menu pass can share the same cut-offs: 1500 / 2500 / 4000 cents per person. A later menu pass turns menu prices into a per-person figure before applying them.

### 5.2 What the model sees per place

`{ id, name, category, cuisines, amenity }`:
- `id`: the table's bigint `id`, sent as a short string;
- `category`: `restaurant`, `cafe` or `nightlife`;
- `cuisines`: the generated `cuisines` array, possibly empty;
- `amenity`: `osm_tags.amenity` when present, e.g. `fast_food`, `pub`, `ice_cream`.

Names of the same chain are not specially handled. The model recognises chains by name.

No address or website is sent: they add tokens without much signal, and website contents would mean scraping.

### 5.3 Request and response

- Gemini `generateContent` over plain `fetch`, so no SDK dependency:
  - `responseMimeType: application/json` plus a `responseSchema`: an array of `{ id: string, band: '$'|'$$'|'$$$'|'$$$$'|'unknown' }`;
  - temperature 0;
  - no tools (no grounding).
- The model is set by `GEMINI_MODEL`. Its default is a current Flash model; the builder confirms the name exists with the ListModels endpoint.
- **Validation** (pure function, unit-tested). A response is parsed and then, per batch:
  - an entry whose `id` isn't in the batch is dropped;
  - for a duplicated `id`, the first entry wins;
  - an entry whose band isn't one of the five values is treated as missing;
  - rows missing from the response get **no write**.
- If more than half of a batch is missing or the JSON doesn't parse, the batch is retried once. If the retry fails too, it is skipped and counted in the summary.
- **Pacing:**
  - sequential requests with a minimum interval of 6 s by default (`--rpm`, default 10);
  - on 429/503, exponential backoff starting at 10 s, up to 4 attempts. If a request still fails after that (usually the key's daily quota is used up), the run **stops** instead of skipping batch after batch. It prints the summary so far and exits non-zero. Rows it didn't reach still have `price_source is null`, so the next run picks them up. *(Builder-check call.)*
  - any other 4xx stops the run, which usually means a bad key or model name.

### 5.4 Which rows, and what gets written

- **Selected:** rows with `price_source is null`.
- **With `--force`:** rows where `price_source is null or price_source = 'estimate'`.
- `price_source = 'menu'` is **never** selected.
- Rows are paged by `id` (PostgREST 1,000-row pages) and batched 100 at a time (`--batch-size`). Bigger batches keep the request count low for free-tier daily caps..

**Writes per batch**, grouped by band, using one `update ... where id in (...)` per band:
- **`$`–`$$$$`:** `price_band = <band>`, `price_source = 'estimate'`, `median_entree_price_cents = null`. Every update also has `and price_source is distinct from 'menu'`, so a menu result written between read and write is never overwritten.
- **`unknown`:** no write. The row keeps `'unknown'` / `null` and is asked again on the next run. That is cheap and lets a better model or prompt pick it up later.
- **With `--force`, a row that had an estimate and now gets `unknown`:** reset to `'unknown'` / `null`, so a stale guess isn't kept.

### 5.5 CLI

`npm run enrich:price -- [flags]`

| Flag | Default | Effect |
|---|---|---|
| `--dry-run` | off | Calls Gemini, writes nothing, prints the summary and 20 sample `name → band` lines. |
| `--limit N` | all | Process at most N selected rows. Useful as a cost cap and for a first look. |
| `--force` | off | Re-estimate rows that already have an estimate. |
| `--batch-size N` | 100 | Places per request. |
| `--rpm N` | 10 | Maximum requests per minute. |

**Summary output:** rows selected, requests made, batches skipped, count per band, count `unknown`, rows written.

A secret key or Gemini key that is missing fails fast with a clear message, before any request.

### 5.6 Place card (separate branch off `maps-supabase`)

`apps/web/src/catalog.ts` and the catalog-aware `openCard` exist only on `maps-supabase`, which is pushed (tip `8a34c8f`) but not merged into main. The card change is a second small branch on top of it, and it lands after that branch.

At `8a34c8f`, the catalog loads in two steps:
- a small pin index for every row (`INDEX_COLUMNS`);
- per-place details fetched only for pins in range (`DETAIL_COLUMNS` → `CatalogDetails`, merged by `pinToPlace(pin, details?)`).

Price is a detail, not something pins are coloured or filtered by yet, so it goes in the details. *(Builder-check call.)*

`catalog.ts`:
- add `price_band, price_source` to `DETAIL_COLUMNS` and to `CatalogDetails`;
- in `pinToPlace`, when details are present, set `tags['catalog:price_band']` and, when present, `tags['catalog:price_source']`. This is the same pattern as `catalog:attribution`, so the web `Place` type doesn't change.

A pure, tested `priceLabel(band, source)` returns:

| Band | Source | Label |
|---|---|---|
| `$`–`$$$$` | `estimate` | `"$$ (est.)"` |
| `$`–`$$$$` | `menu` | `"$$"` |
| `'unknown'`, missing, or any value outside the five | any | `"Price unknown"` |

`openCard` adds a 💲 row with that label to the details list. The row is added **only when the catalog details loaded** (`tags['catalog:price_band']` present). If the details request failed, the card shows no price row rather than a wrong "Price unknown". *(Builder-check call.)* Overpass places (parks, libraries, …) have no price data and price doesn't apply to most of them, so they show no price row rather than "Price unknown".

### 5.7 Files

On the pipeline branch, off `origin/main`:
- `pipeline/src/price.ts`: pure logic (rubric constant, row → prompt input, prompt text, response validation, grouping writes by band, row-selection filter).
- `pipeline/src/gemini.ts`: `fetch` client with pacing and backoff; the HTTP layer is injectable for tests.
- `pipeline/src/enrichPrice.ts`: CLI (args, summary, orchestration).
- `pipeline/src/db.ts`: `fetchPriceCandidates`, `writePriceBands`.
- `pipeline/test/price.test.ts`, `pipeline/test/enrichPrice.test.ts`.
- `pipeline/package.json`: `enrich:price` script.
- `pipeline/.env.example`: `GEMINI_API_KEY`, `GEMINI_MODEL`.

On the card branch, off `maps-supabase`: `apps/web/src/catalog.ts`, `apps/web/src/catalog.test.ts`, `apps/web/src/main.ts` (`openCard` only).

## 6. Verification

- `npm test` and `npm run typecheck` in `pipeline/`, and the web app's tests and typecheck on the card branch.
- With the user's go-ahead: `--dry-run --limit 100` against the hosted project, review the samples, then the full run.
- Afterwards, read-only counts per `price_band` / `price_source`. Done = most rows priced.
- The card is checked in the browser on a known estimate and on a known-unknown place.

## 7. Left to the builder

- Exact prompt wording within the rubric above.
- The default `GEMINI_MODEL` name, verified with ListModels.
- Internal module boundaries beyond §5.7, and the test fixtures.
