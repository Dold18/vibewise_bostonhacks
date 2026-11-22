# Place Photo Copies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run enrich:photos`, which stores an 800 px WebP copy of each visible pipeline photo in the `place-photos` bucket, and keep those copies across `enrich:media` re-runs.

**Architecture:**
- A pure image module (`sharp`) resizes images or rejects them.
- The polite fetcher gains a byte download.
- Database helpers select, record and clean up copies.
- A CLI with a worker pool ties them together.
- `writePlaceMedia` carries copies over to re-inserted rows with the same URL, and removes files whose rows are gone.

**Tech Stack:** Node ≥ 24 TypeScript, `node:test`, `@supabase/supabase-js` (Storage), `sharp@0.35.5`.

**Spec:** `docs/superpowers/specs/2026-11-21-place-photo-copies-design.md`

## Global Constraints

- Bucket `place-photos`, object path `pipeline/<restaurant_id>/<first 16 hex of sha256(url)>.webp`, content type `image/webp`, `upsert: true`.
- Resize so the longest side is at most 800 px, never upscaled. WebP quality 75. Metadata stripped (sharp's default; don't call `withMetadata`).
- Reject when the decoded short side is under 400 px (`too_small`) or the bytes can't be decoded (`not_image`). A rejected row is deleted.
- Download: `USER_AGENT`, 15 s timeout, 15 MB cap, 200 ms per-host spacing, no robots.txt check for images.
- Default `--concurrency 8` and `--max-mb 800`. The budget counts `stored_bytes` already in `place_photos` plus this run.
- Row selection: `hidden = false`, `kind in (website, licensed)`, `source <> mapillary`, `url is not null`, `storage_path is null`.
- Failures (http, timeout, network, too_large) set `store_error` and leave `storage_path` null.
- No embeddings. No card UI changes.
- Commits: conventional style, no Co-Authored-By or Claude lines.

## Review Focus

1. **A re-run of `enrich:media` after copies exist** → copies must survive for unchanged URLs; no orphaned files for dropped URLs. Test in Task 3.
2. **A huge or endless image response** → stop at 15 MB and record `too_large`, without buffering everything. Test in Task 1.
3. **SVG, HTML error pages or GIFs served under an image URL** → `not_image` (or resized if sharp decodes a real raster), never a crash. Test in Task 2.
4. **Budget reached mid-run** → workers stop taking new photos; finished uploads stay recorded. Test in Task 4.
5. **A hidden photo between selection and upload** → never re-shown, because selection filters `hidden = false` and cards filter hidden rows. No extra test.

---

### Task 1: Byte download in the polite fetcher

**Files:** Modify `pipeline/src/media/http.ts`. Test `pipeline/test/media/http.test.ts`.

**Interfaces:**
- Produces:
  - `PoliteFetcher.getBytes(url: string, opts?: { maxBytes?: number }): Promise<BytesResult>`
  - `type BytesResult = { ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: 'http' | 'timeout' | 'network' | 'too_large'; detail: string }`
  - Default `maxBytes` 15 MB. Follows redirects (fetch default), with the same User-Agent and spacing as other requests.

- [ ] **Step 1: Write failing tests:**
  - returns bytes and content type;
  - a 404 gives `http`;
  - a body over `maxBytes` gives `too_large`, with the stream cancelled before it's fully read (count the chunks pulled);
  - a `Content-Length` over the cap gives `too_large` without reading the body;
  - a timeout error gives `timeout`.
- [ ] **Step 2:** `node --test test/media/http.test.ts`. Expected: the new tests fail.
- [ ] **Step 3:** Implement. Read `res.body` with a reader, accumulate up to the cap, and call `reader.cancel()` when it's exceeded.
- [ ] **Step 4:** Run the tests. Expected: pass.
- [ ] **Step 5:** Commit: `feat(media): polite byte download with size cap`.

### Task 2: Image processing

**Files:** Create `pipeline/src/media/photoStore.ts`. Test `pipeline/test/media/photoStore.test.ts`. Modify `pipeline/package.json` (`sharp@0.35.5`, exact).

**Interfaces:**
- Produces:
  - `storagePathFor(restaurantId: number, url: string): string`
  - `processImage(bytes: Uint8Array): Promise<{ ok: true; webp: Uint8Array; width: number; height: number } | { ok: false; reason: 'too_small' | 'not_image' }>`. `width` and `height` are the output size.

- [ ] **Step 1: Write failing tests** (generate input images with sharp in the test):
  - `storagePathFor(7, 'https://a/x.jpg')` matches `/^pipeline\/7\/[0-9a-f]{16}\.webp$/`, is stable, and differs per URL;
  - a 2000×1000 JPEG becomes 800×400 WebP (check the `RIFF…WEBP` magic bytes);
  - a 600×500 PNG stays 600×500 (no upscaling);
  - a 1000×300 image gives `too_small`;
  - random bytes and an HTML string give `not_image`;
  - EXIF is stripped: an input with EXIF orientation metadata gives output where `sharp(out).metadata()` has no `exif`.
- [ ] **Step 2:** Run the tests. Expected: fail.
- [ ] **Step 3:** Implement:
  - `sharp(bytes, { failOn: 'error' })`;
  - `.rotate()` to honor EXIF orientation before stripping;
  - read metadata, then check the short side;
  - `.resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 })`.
- [ ] **Step 4:** Run the tests. Expected: pass.
- [ ] **Step 5:** Commit: `feat(media): resize photos to 800px WebP`.

### Task 3: Migration and database helpers, including carry-over

**Files:**
- Create `supabase/migrations/20261121220000_place_photo_copies.sql`.
- Modify `pipeline/src/media/db.ts`.
- Test `pipeline/test/media/db.test.ts`.

**Interfaces:**
- **Migration:** `alter table public.place_photos add column stored_at timestamptz, add column stored_bytes integer check (stored_bytes > 0), add column store_error text;`
- **Produces** (`db.ts`):
  - `interface PhotoToStore { id: number; restaurantId: number; url: string }`
  - `fetchPhotosToStore(client, opts: { limit: number | null }): Promise<PhotoToStore[]>`. Paged by `id`, filtered per Global Constraints, ordered by `id`.
  - `storedBytesTotal(client): Promise<number>`. Pages `stored_bytes` where it isn't null and sums them.
  - `uploadCopy(client, path: string, webp: Uint8Array): Promise<void>`. `storage.from('place-photos').upload(path, webp, { contentType: 'image/webp', upsert: true })`.
  - `recordStored(client, id: number, path: string, bytes: number, at: string): Promise<void>`. Sets `storage_path`, `stored_bytes` and `stored_at`, and clears `store_error`.
  - `recordStoreError(client, id: number, error: string): Promise<void>`
  - `deletePhotoRow(client, id: number): Promise<void>`
- **Modifies** `writePlaceMedia`:
  - Before its delete, select the place's existing non-student, non-hidden rows: `url, storage_path, stored_at, stored_bytes`.
  - New photo rows whose URL matches carry those three values.
  - After the insert, `storage.from('place-photos').remove([...])` the old `storage_path`s whose URL isn't among the new photos. A remove failure is thrown like other write errors.

- [ ] **Step 1:** Write the migration. Apply locally with `npx supabase@2 db reset`. Expected: 4 migrations applied.
- [ ] **Step 2: Write failing tests,** extending the fake client with a `storage.from(bucket)` recorder:
  - **Carry-over:** an old row with `{url:'https://a/1.jpg', storage_path:'pipeline/7/aa.webp', stored_bytes: 50000, stored_at:'t'}` plus a new photo with the same URL gives an insert row with those three values.
  - **Orphan removal:** an old row with URL `https://a/2.jpg` absent from the new photos gives `remove(['pipeline/7/bb.webp'])`. No remove call when nothing is orphaned.
  - **Selection filters:** `fetchPhotosToStore` filters `hidden=false`, `kind in (website,licensed)`, `source neq mapillary`, `url not null` and `storage_path is null`.
  - **Record helpers:** `recordStored` writes the four fields; `storedBytesTotal` sums pages.
- [ ] **Step 3:** Run the tests. Expected: fail.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** `npm test` and `npm run typecheck`. Expected: all pass.
- [ ] **Step 6:** Commit: `feat(media): photo copy columns, helpers and carry-over on re-run`.

### Task 4: `enrich:photos` CLI

**Files:**
- Create `pipeline/src/enrichPhotos.ts`.
- Test `pipeline/test/media/enrichPhotos.test.ts`.
- Modify `pipeline/package.json` (script `enrich:photos`) and `README.md` (one sentence in the pipeline section).

**Interfaces:**
- **Produces:**
  - `parsePhotoArgs(argv): { dryRun: boolean; limit: number | null; concurrency: number; maxMb: number }`
  - `storeOne(photo: PhotoToStore, ctx: StoreContext): Promise<StoreOutcome>`
    - `type StoreOutcome = { kind: 'stored'; bytes: number } | { kind: 'rejected'; reason: 'too_small' | 'not_image' } | { kind: 'failed'; reason: string }`
    - `StoreContext` holds `download(url)`, `upload(path, webp)`, `recordStored`, `recordError`, `deleteRow`, `dryRun` and `now()`.
  - `runPool(photos, ctx, opts: { concurrency: number; budgetBytes: number; usedBytes: number }): Promise<{ outcomes: StoreOutcome[]; stoppedForBudget: boolean }>`
  - `summarizePhotos(r): string`

- [ ] **Step 1: Write failing tests,** with all dependencies stubbed:
  - a good image is uploaded at `storagePathFor`, then recorded;
  - a too-small image gives `deleteRow` with no upload;
  - a download failure gives `recordError('http: …')`;
  - a dry run gives no upload, record or delete;
  - in `runPool` with `budgetBytes` reached after 2 stores (each about 100 KB, budget 250 KB, `usedBytes` 0), no more downloads start and `stoppedForBudget` is true;
  - `summarizePhotos` counts stored, rejected by reason, failed and MB.
- [ ] **Step 2:** Run the tests. Expected: fail.
- [ ] **Step 3: Implement** `main()` like `enrichMedia.ts`:
  - fetcher with `minIntervalMs: 200`;
  - `storedBytesTotal`, then fetch photos, then `runPool`;
  - print the summary, also on SIGINT.
- [ ] **Step 4:** Run the tests and typecheck. Expected: pass.
- [ ] **Step 5:** Run locally (local DB has data from the earlier smoke run): `npm run enrich:photos -- --limit 30`. Expected: copies in local storage; check one public URL returns `image/webp`.
- [ ] **Step 6:** Commit: `feat(media): enrich:photos CLI`.

### Task 5: Hosted run (after `enrich:media` finishes)

- [ ] **Step 1:** `npx supabase@2 db push --linked --dry-run`. Expected: only `20261121220000_place_photo_copies.sql`. Then push it.
- [ ] **Step 2:** `npm run enrich:photos` (background).
- [ ] **Step 3:** Expected: a summary with MB stored under 800. Spot-check 3 stored copies' public URLs.
- [ ] **Step 4:** Add a run record to the copies spec, commit, and push.
