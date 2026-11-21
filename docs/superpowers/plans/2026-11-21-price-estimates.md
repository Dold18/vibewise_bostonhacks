# Price Estimates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run enrich:price` fills `price_band` / `price_source = 'estimate'` in Supabase `restaurants` from batched Gemini estimates, and the place card shows the band honestly.

**Architecture:**
- Pure logic lives in `pipeline/src/price.ts`: rubric, prompt input, response validation and the write plan.
- `pipeline/src/gemini.ts` is the HTTP client, with pacing and backoff.
- `pipeline/src/enrichPrice.ts` is the CLI. It orchestrates with injected dependencies, so the whole run is testable without the network.
- The card change is a separate branch off `origin/maps-supabase`. It touches `catalog.ts` details and `openCard`.

**Tech Stack:**
- Pipeline: Node 24 running TypeScript directly (type stripping), `node:test`, `@supabase/supabase-js`, Gemini REST `generateContent` over `fetch`.
- Web: Vite + TypeScript + vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-price-estimates-design.md`

## Global Constraints

- **Allowed TypeScript:** `erasableSyntaxOnly` is on, so no `enum`, no `namespace` and no constructor parameter properties. Imports use `.ts` extensions, and type-only imports use `import type`.
- **Columns written:** only `price_band`, `price_source` and `median_entree_price_cents`. Estimates always write `median_entree_price_cents = null`.
- **Menu rows are protected:** never select or update a row with `price_source = 'menu'`. Every update carries `price_source is null or <> 'menu'`.
- **Bands:** `'$' | '$$' | '$$$' | '$$$$'`, plus `'unknown'`. Cut-offs are per person, before tip, in cents: `[1500, 2500, 4000]`.
- **Gemini request:** no tools, so no Google Search grounding. Temperature 0, JSON response with a `responseSchema`. The key is sent as the `x-goog-api-key` header, never in the URL.
- **Secrets:** `GEMINI_API_KEY`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` come from `pipeline/.env` and never reach `apps/web` or git. `GEMINI_MODEL` is optional.
- **Card copy:** `"$$ (est.)"` for an estimate, `"$$"` for a menu price, `"Price unknown"` otherwise.
- **Commits:** no Co-Authored-By or Claude attribution lines.
- **Hosted runs:** nothing runs against the hosted Supabase project without the user's explicit go-ahead in chat.

## Review Focus

1. **The model returns ids as numbers or with whitespace.** `parseEstimates` matches on `String(id).trim()`. Test: `"accepts numeric ids"`.
2. **The model echoes a band in another form** (`"$$ "` or `"moderate"`). Treat it as missing, never coerce. Test: `"treats non-enum bands as missing"`.
3. **A batch response is cut off mid-JSON** (MAX_TOKENS). `parseEstimates` returns `ok: false`, the batch is retried once, then skipped. Test: `"retries a truncated batch once then skips it"`.
4. **The daily quota runs out mid-run.** The run stops with the summary so far and exit code 1, and pending rows are left untouched. Test: `"stops on quota error and reports partial summary"`.
5. **The card's details request failed.** There's no price row, never "Price unknown". Test: `"omits price tags without details"`.

---

## Branch A: `feature/price-estimates` (off `origin/main`, this worktree)

### Task 1: Price logic (`price.ts`)

**Files:**
- Create: `pipeline/src/price.ts`
- Test: `pipeline/test/price.test.ts`

**Interfaces:**
- Produces:
  - `type PriceBand = '$' | '$$' | '$$$' | '$$$$'`
  - `type PriceAnswer = PriceBand | 'unknown'`
  - `const PRICE_BANDS: readonly PriceBand[]`
  - `const PRICE_CUTOFFS_CENTS = [1500, 2500, 4000] as const`
  - `interface PriceCandidate { id: number; name: string; category: string; cuisines: string[] | null; osm_tags: Record<string, string> | null; price_source: 'estimate' | null }`
  - `interface PromptPlace { id: string; name: string; category: string; cuisines: string[]; amenity?: string }`
  - `function toPromptPlace(c: PriceCandidate): PromptPlace`
  - `const PRICE_SYSTEM_PROMPT: string`: the rubric from spec §5.1. It is written with the cut-offs from `PRICE_CUTOFFS_CENTS` and says "unknown is a correct answer".
  - `function candidateFilter(force: boolean): string`: the PostgREST `or` filter.
  - `function parseEstimates(raw: string, batchIds: string[]): { ok: boolean; answers: Map<string, PriceAnswer> }`
  - `function needsRetry(result: { ok: boolean; answers: Map<string, PriceAnswer> }, batchSize: number): boolean`
  - `interface WritePlan { bands: Record<PriceBand, number[]>; reset: number[] }`
  - `function planWrites(batch: PriceCandidate[], answers: Map<string, PriceAnswer>): WritePlan`

- [ ] **Step 1: Write failing tests** in `pipeline/test/price.test.ts`:

```ts
test('toPromptPlace keeps name, category, cuisines and amenity only', () => {
  assert.deepEqual(
    toPromptPlace({ id: 7, name: 'Tatte', category: 'cafe', cuisines: null, osm_tags: { amenity: 'cafe', wifi: 'yes' }, price_source: null }),
    { id: '7', name: 'Tatte', category: 'cafe', cuisines: [], amenity: 'cafe' });
});
test('candidateFilter never selects menu rows', () => {
  assert.equal(candidateFilter(false), 'price_source.is.null');
  assert.equal(candidateFilter(true), 'price_source.is.null,price_source.eq.estimate');
});
test('parseEstimates keeps only batch ids and valid bands, first wins', () => {
  const r = parseEstimates(JSON.stringify([
    { id: '1', band: '$' }, { id: '1', band: '$$$$' }, { id: '2', band: 'unknown' }, { id: '99', band: '$$' },
  ]), ['1', '2', '3']);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.answers], [['1', '$'], ['2', 'unknown']]);
});
test('accepts numeric ids', () => {
  assert.deepEqual([...parseEstimates('[{"id":5,"band":"$$"}]', ['5']).answers], [['5', '$$']]);
});
test('treats non-enum bands as missing', () => {
  assert.equal(parseEstimates('[{"id":"1","band":"$$ "},{"id":"2","band":"moderate"}]', ['1', '2']).answers.size, 0);
});
test('parseEstimates reports truncated or non-array JSON as not ok', () => {
  assert.equal(parseEstimates('[{"id":"1","band":"$"', ['1']).ok, false);
  assert.equal(parseEstimates('{"id":"1"}', ['1']).ok, false);
});
test('needsRetry when not ok or more than half missing', () => {
  const answers = new Map<string, PriceAnswer>([['1', '$']]);
  assert.equal(needsRetry({ ok: true, answers }, 2), false);
  assert.equal(needsRetry({ ok: true, answers }, 3), true);
  assert.equal(needsRetry({ ok: false, answers: new Map() }, 1), true);
});
test('planWrites groups bands, resets stale estimates on unknown, skips missing', () => {
  const c = (id: number, price_source: 'estimate' | null = null): PriceCandidate =>
    ({ id, name: 'x', category: 'restaurant', cuisines: [], osm_tags: null, price_source });
  const plan = planWrites([c(1), c(2), c(3), c(4, 'estimate'), c(5)],
    new Map<string, PriceAnswer>([['1', '$'], ['2', '$'], ['3', 'unknown'], ['4', 'unknown']]));
  assert.deepEqual(plan.bands, { '$': [1, 2], '$$': [], '$$$': [], '$$$$': [] });
  assert.deepEqual(plan.reset, [4]);
});
test('system prompt states the per-person cut-offs and allows unknown', () => {
  for (const s of ['$15', '$25', '$40', 'per person', 'unknown']) assert.ok(PRICE_SYSTEM_PROMPT.includes(s), s);
});
```

- [ ] **Step 2: Run** `cd pipeline && node --test test/price.test.ts`. Expected: FAIL, because the module can't be found.
- [ ] **Step 3: Implement `pipeline/src/price.ts`** to the interfaces above. In `parseEstimates`:
  - anything other than an array, or a `JSON.parse` failure, returns `ok: false` with an empty map;
  - ids are `String(e.id).trim()`;
  - a band must be strictly one of the five strings.
- [ ] **Step 4: Run** `node --test test/price.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** with `feat(pipeline): price rubric, response validation and write plan`.

### Task 2: Gemini client (`gemini.ts`)

**Files:**
- Create: `pipeline/src/gemini.ts`
- Test: `pipeline/test/gemini.test.ts`

**Interfaces:**
- Consumes: `PromptPlace`, `PRICE_SYSTEM_PROMPT` from Task 1.
- Produces:
  - `class GeminiQuotaError extends Error {}`: still 429/503 after all attempts.
  - `class GeminiRequestError extends Error {}`: any other non-2xx, or a response with no text.
  - `interface GeminiOptions { apiKey: string; model: string; rpm: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }`
  - `function createPriceEstimator(o: GeminiOptions): (places: PromptPlace[]) => Promise<string>`: returns the raw JSON text from `candidates[0].content.parts[*].text`, joined.
  - `const DEFAULT_GEMINI_MODEL: string`: set in Task 4 Step 1 after ListModels. Use `'gemini-2.5-flash'` until then.

**Request:**
- `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, headers `x-goog-api-key` and `content-type: application/json`.
- Body:
  - `systemInstruction.parts[0].text = PRICE_SYSTEM_PROMPT`;
  - `contents[0] = { role: 'user', parts: [{ text: JSON.stringify(places) }] }`;
  - `generationConfig = { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, band: { type: 'STRING', enum: ['$', '$$', '$$$', '$$$$', 'unknown'] } }, required: ['id', 'band'] } } }`;
  - no `tools`.
- **Pacing:** request starts are at least `60000 / rpm` ms apart, measured with `now()`.
- **Backoff:** on 429/503, wait 10 s, 20 s, then 40 s (4 attempts in total), then throw `GeminiQuotaError`.

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl` that records calls, a fake `sleep` that records ms, and a fake `now`:
  - `"sends key in header, no tools, temperature 0, schema"`: assert the URL contains `:generateContent` and no `key=`, the header `x-goog-api-key === 'k'`, `body.tools === undefined`, `body.generationConfig.temperature === 0`, and that the band enum is in the schema.
  - `"returns joined text of first candidate"`: the response `{candidates:[{content:{parts:[{text:'[{"id"'},{text:':"1","band":"$"}]'}]}}]}` gives `'[{"id":"1","band":"$"}]'`.
  - `"paces requests to rpm"`: with `rpm: 10` and `now` fixed at 0, two calls give sleeps that include `6000`.
  - `"backs off 10/20/40s on 429 then throws GeminiQuotaError"`: 4 responses with status 429; the sleeps include `[10000, 20000, 40000]`, and the call rejects with `GeminiQuotaError`.
  - `"recovers after one 503"`
  - `"throws GeminiRequestError on 400 without retry"`: exactly 1 fetch call.
- [ ] **Step 2: Run** `node --test test/gemini.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `pipeline/src/gemini.ts`.**
- [ ] **Step 4: Run** `node --test test/gemini.test.ts`. Expected: pass.
- [ ] **Step 5: Commit** with `feat(pipeline): Gemini client with pacing and backoff for price estimates`.

### Task 3: CLI, database access, script (`enrichPrice.ts`, `db.ts`)

**Files:**
- Create: `pipeline/src/enrichPrice.ts`, `pipeline/test/enrichPrice.test.ts`
- Modify: `pipeline/src/db.ts` (append), `pipeline/package.json` (script), `pipeline/.env.example` (two keys)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces, in `db.ts`:
  - `fetchPriceCandidates(client, force: boolean, limit: number | null): Promise<PriceCandidate[]>`:
    - select `id, name, category, cuisines, osm_tags, price_source`, filtered with `.or(candidateFilter(force))`;
    - ordered by `id`, paged 1000 at a time, stopping at `limit`.
  - `writePriceBands(client, plan: WritePlan): Promise<number>`, which returns the number of ids sent:
    - per non-empty band: `update({ price_band, price_source: 'estimate', median_entree_price_cents: null }).in('id', ids).or('price_source.is.null,price_source.neq.menu')`;
    - for `reset`: `update({ price_band: 'unknown', price_source: null, median_entree_price_cents: null }).in('id', ids).eq('price_source', 'estimate')`;
    - id lists are chunked at 200;
    - throws on `error`.
- Produces, in `enrichPrice.ts`:
  - `interface PriceArgs { dryRun: boolean; limit: number | null; force: boolean; batchSize: number; rpm: number }`
  - `parsePriceArgs(argv: string[]): PriceArgs`. Defaults are `false, null, false, 100, 10`. It throws on a non-positive or non-integer `--limit`, `--batch-size` or `--rpm`.
  - `interface PriceSummary { selected: number; requests: number; skippedBatches: number; counts: Record<PriceAnswer, number>; missing: number; written: number; stoppedEarly: string | null; samples: string[] }`
  - `runPriceEnrichment(deps: { candidates: PriceCandidate[]; estimate: (p: PromptPlace[]) => Promise<string>; write: ((plan: WritePlan) => Promise<number>) | null; batchSize: number }): Promise<PriceSummary>`. Here `write: null` means a dry run. `samples` holds the first 20 `"name → band"` lines.
  - `formatPriceSummary(s: PriceSummary, dryRun: boolean): string`
  - `main()`, guarded like `ingest.ts` (`import.meta.filename === path.resolve(process.argv[1])`):
    - requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `GEMINI_API_KEY`, failing before any request if one is missing;
    - uses `GEMINI_MODEL || DEFAULT_GEMINI_MODEL`;
    - sets `process.exitCode = 1` when `stoppedEarly`.
- Script: `"enrich:price": "node --env-file-if-exists=.env src/enrichPrice.ts"`.

**Run loop (per batch):**
- estimate → `parseEstimates` → if `needsRetry`, estimate once more and use the retry result;
- if it still `needsRetry` with `ok: false`, count it as a skipped batch and write nothing;
- otherwise `planWrites` → `write`.
- `GeminiQuotaError` sets `stoppedEarly` to its message and ends the loop.
- `GeminiRequestError` propagates, which fails the run.

- [ ] **Step 1: Write failing tests**, using fake `estimate` / `write`:
  - `"parsePriceArgs defaults and flags"`: `[]` → `{dryRun:false,limit:null,force:false,batchSize:100,rpm:10}`; `['--dry-run','--limit=5','--force','--batch-size=20','--rpm=4']` sets each one.
  - `"parsePriceArgs rejects bad numbers"`: `--limit=0` and `--rpm=x` throw.
  - `"batches candidates and writes per batch"`: with 5 candidates, `batchSize: 2` gives 3 estimate calls and 3 writes. The counts match the returned bands.
  - `"dry run never writes"`: with `write: null`, `written === 0` and the counts are still filled.
  - `"retries a truncated batch once then skips it"`: `estimate` always returns `'[{"id"'`, giving 2 calls, `skippedBatches === 1` and no write.
  - `"stops on quota error and reports partial summary"`: the second call throws `GeminiQuotaError`. `stoppedEarly` is non-null, `requests === 2`, there is only the first batch's write, and later batches are not called.
  - `"missing rows are counted and not written"`
- [ ] **Step 2: Run** `node --test test/enrichPrice.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `enrichPrice.ts` and the `db.ts` additions; add the script and the `.env.example` lines (`# Gemini API key for npm run enrich:price` / `GEMINI_API_KEY=` / `# Optional model override` / `GEMINI_MODEL=`).
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass, with no type errors.
- [ ] **Step 5: Commit** with `feat(pipeline): enrich:price step writes estimated price bands`.

### Task 4: Model check, dry run, hosted run (needs the user's go-ahead)

- [ ] **Step 1:** List the Flash models available to the key: `GET /v1beta/models` with the `x-goog-api-key` header, keeping models that support `generateContent`. Set `DEFAULT_GEMINI_MODEL` to the current stable Flash model. If it is a thinking model, set its thinking to the minimum the model allows in `generationConfig.thinkingConfig`. Re-run the tests and commit.
- [ ] **Step 2:** **Ask the user**, then run `npm run enrich:price -- --dry-run --limit 100`. Show them the summary and the samples.
- [ ] **Step 3:** **Ask the user**, then run `npm run enrich:price` (in the background, since it takes minutes). If it stops early on quota, report it. Re-running resumes.
- [ ] **Step 4:** Count rows read-only by `price_band` and `price_source`, and record the counts in the PR. Done = most rows priced.

## Branch B: `feature/price-on-card` (off `origin/maps-supabase`, at `8a34c8f` or later)

Create it as its own worktree (`git worktree add ../price-on-card -b feature/price-on-card origin/maps-supabase`). It must not be touched from the main checkout.

### Task 5: Price on the place card

**Files:**
- Modify: `apps/web/src/catalog.ts` (`DETAIL_COLUMNS`, `CatalogDetails`, `pinToPlace`, plus the new `priceLabel`)
- Modify: `apps/web/src/main.ts` (`openCard` rows only)
- Test: `apps/web/src/catalog.test.ts`

**Interfaces:**
- Produces:
  - `priceLabel(band: string | undefined, source: string | undefined): string`
  - the tags `catalog:price_band` (always set when details are present; the column is never null) and `catalog:price_source` (only when not null).

- [ ] **Step 1: Write failing tests:**

```ts
it('labels estimates, menu prices and unknown', () => {
  expect(priceLabel('$$', 'estimate')).toBe('$$ (est.)');
  expect(priceLabel('$$$$', 'menu')).toBe('$$$$');
  expect(priceLabel('unknown', undefined)).toBe('Price unknown');
  expect(priceLabel(undefined, undefined)).toBe('Price unknown');
  expect(priceLabel('$$$$$', 'estimate')).toBe('Price unknown');
  expect(priceLabel('$', undefined)).toBe('Price unknown'); // a band with no source is not trusted
});
it('puts price into tags from details', () => {
  const p = pinToPlace(pin(), { ...details(), price_band: '$', price_source: 'estimate' });
  expect(p.tags['catalog:price_band']).toBe('$');
  expect(p.tags['catalog:price_source']).toBe('estimate');
});
it('omits price tags without details', () => {
  expect(pinToPlace(pin()).tags['catalog:price_band']).toBeUndefined();
});
```

  (`pin()` already exists in the test file. Add a `details()` helper if there isn't one.)
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - add `price_band, price_source` to `DETAIL_COLUMNS`;
  - add `price_band: string; price_source: string | null` to `CatalogDetails`;
  - set the tags in `pinToPlace`;
  - in `openCard`, add the row `['💲', place.tags['catalog:price_band'] ? priceLabel(place.tags['catalog:price_band'], place.tags['catalog:price_source']) : undefined]` after the hours row.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: pass.
- [ ] **Step 5:** Check in the browser (`npm run dev`, with the `.env` copied from the main checkout's `apps/web/.env`): open one estimated place and one unknown place, and confirm the labels.
- [ ] **Step 6: Commit** with `feat(web): show price band on the place card, labeled when estimated`.
