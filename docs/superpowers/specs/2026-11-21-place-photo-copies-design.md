# Stored copies of place photos — design

> **Status:** Approved 2026-11-21. Builds on `2026-11-21-place-photos-vibe-sources-design.md` and decision P-013. P-013 now allows storing website photos.

## Intent

Cards hotlink restaurant websites today, so a photo disappears when a site changes, goes down or blocks hotlinking. Storing our own resized copy keeps cards working. Image embeddings are explicitly **not** part of this change.

## Approaches

- **Store resized copies only (chosen).** Smallest change; fixes broken links now.
- Copies plus CLIP image vectors: rejected for now by the user. It can be added later from the stored copies without downloading again.
- Image vectors only, no copies: doesn't fix broken links.
- Storing originals: rejected. About 2.5 GB, over the free plan's 1 GB of storage.
- A separate bucket: rejected. The existing `place-photos` bucket is already public.

## Design

- **Step:** `npm run enrich:photos` (pipeline), run after `enrich:media`.
- **Which rows:** `place_photos` rows where all of these hold:
  - `hidden = false`;
  - `kind in ('website', 'licensed')`;
  - `source <> 'mapillary'`;
  - `url is not null`;
  - `storage_path is null`.

  Student uploads are already stored, and Mapillary has no stable URL.
- **Copy:**
  - Download the image with the pipeline User-Agent, a 15 s timeout and a 15 MB cap.
  - Resize so the longest side is at most 800 px (no upscaling).
  - Encode WebP at quality 75 with metadata stripped (`sharp`).
  - Upload to bucket `place-photos` at `pipeline/<restaurant_id>/<first 16 hex of sha256(url)>.webp`.
- **Rejects:** an image whose real short side is under 400 px, or a body that isn't a decodable image, has its `place_photos` row deleted. It broke spec §4.2's 400 px rule and slipped past the URL-based check.
- **Failures:** HTTP errors, timeouts and network errors set `store_error` and leave `storage_path` null, so the next run retries.
- **Schema** (new migration): `place_photos` gains:
  - `stored_at timestamptz` and `stored_bytes integer`, set on success;
  - `store_error text`, cleared on success.

  `storage_path` (existing column) holds the object path. The public URL is `<SUPABASE_URL>/storage/v1/object/public/place-photos/<storage_path>`.
- **Cards:** use the stored copy when `storage_path` is set, else `url`. Credit, license and `page_url` are unchanged.
- **Re-runs of `enrich:media`:**
  - When it replaces a place's photos, a new row with the same URL as an old row keeps that row's `storage_path`, `stored_at` and `stored_bytes`.
  - Stored files whose row didn't survive are removed from the bucket.
  - Hidden rows are never deleted, so their files stay.
- **Budget:** the step sums `stored_bytes` already in the table plus this run. It stops before passing `--max-mb` (default 800). The summary prints MB stored.
- **Politeness:**
  - Image hosts get 200 ms spacing (most are shared CDNs such as Wix, Squarespace and Bento), with 8 concurrent workers by default.
  - robots.txt is checked for pages, not for image files, as before.
- **Flags:** `--dry-run` (download and resize, no upload or writes), `--limit N`, `--concurrency N`, `--max-mb N`.

## Non-goals

- Image embeddings.
- Deleting stored files of hidden photos. Their files stay in the public bucket but aren't referenced by visible rows; a cleanup flag can come later.
- Card UI changes (Map workstream).

## Left to the builder

- `sharp` version (pinned, at least two weeks old).
- The exact retry and backoff behavior within one run.
- The summary wording.
