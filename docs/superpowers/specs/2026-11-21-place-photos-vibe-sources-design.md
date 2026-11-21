# Place photos and vibe sources — design

> **Status:** Draft for team review, 2026-11-21. Records proposed decision P-013 (to be added to DECISIONS.md on approval). Showing website photos departs from AGENTS.md §5 and PRODUCT.md ("images must be licensed/authorized"); the team must ratify that part before it ships.

## 0. Scope of this build

**Building now:** the pipeline part only (Integration workstream):
- the migration in §7 (`place_photos`, `place_vibe_inputs`, `student_reviews`, the `place-photos` bucket and its policies);
- extending ingest's OSM tag list (§6.1);
- `enrich:media`: finds and ranks photos (§4) and collects vibe inputs (§6.1) into the database.

`enrich:media` makes no Gemini calls, so the 20-requests-a-day limit doesn't constrain it.

**Not building now, kept here as the handoff:**
- the vibe scoring step (§6.2, `enrich:vibe`) → Vibe workstream (C);
- card photo display, the upload form and the `Place` contract change (§4.2, §5, §8) → Map workstream (A), with Integration for the contract.

## 1. Intent

Each place card should show real photos of the place, the way Beli does, and each place should get a vibe profile built from what is said and shown about it. Everything must be free. The same material that fills the card (photos, descriptions, student reviews) is the input to the vibe score (P-010), so the Living Map ranks places on evidence a user can see.

## 2. Goals, non-goals, anti-goals

**Goals**
- Cards show photos from three kinds of source: student uploads, openly licensed photos, and photos from the place's own website. Every photo carries its source and credit.
- Students can upload photos with a review.
- A batch step collects free vibe inputs (text, photo descriptions, tags, city license data, student reviews) and produces `vibe_scores`, `ambience_description`, `vibe_confidence` and `vibe_sources` per DATA_MODEL.md §3 and §5.
- A coverage report shows how many places have photos and vibe data, by source.

**Non-goals**
- Third-party reviews of any kind (Google, Yelp, Tripadvisor, Reddit, Foursquare tips). They are either paid or forbid storage and AI use; see §9.
- Looking photos up live when a card opens. Everything is resolved in the batch job, except Mapillary image links (§4.2).
- Paid APIs, or any free tier that needs a credit card.

**Anti-goals** (failures even if the code works)
- A photo of the wrong place. A card with no photo is better than a card with a neighbour's storefront.
- Team-written reviews or photos presented as real student content. Seeded content is flagged `is_seed` and labeled.
- Storing copies of website images. They are linked, credited and linked back, never re-hosted.
- Vibe scores that claim confidence they don't have. Thin evidence gives `vibe_confidence = 'low'`.

## 3. Constraints

- Free only. The Gemini free tier allows about **20 requests per day per model** (measured by the price-estimate run on `feature/price-estimates`, which hit the cap). The catalog has about 7,900 places. So every Gemini step batches many places per request, the job is resumable, and it processes places in priority order (§6.4).
- Batch work runs in `pipeline/`, never in the browser. Secrets stay in `pipeline/.env`.
- Crawling follows brief §11: obey `robots.txt`, rate-limit, send the existing `USER_AGENT` (config.ts). Wikimedia APIs require that descriptive User-Agent as well.
- Licensed photos must keep the license and credit the license requires. Allowlist only: CC0, Public Domain, CC BY, CC BY-SA (any version). Anything else, including NC and ND licenses, is skipped.
- OSM data stays ODbL-attributed (unchanged).
- Shared contract and ownership rules (§8).

## 4. Card photos

### 4.1 Sources, in display order

| Rank | Source | How it's found | Stored | Credit shown |
|---|---|---|---|---|
| 1 | Student upload | Uploaded with a review in the app | File in Supabase Storage | "Photo: student" (+ "demo photo" when `is_seed`) |
| 2 | Linked licensed photo | OSM `wikimedia_commons` / `image` tag pointing at Commons, or Wikidata P18 via the OSM `wikidata` tag | Commons URL + license metadata | Author, license, link to the Commons file page |
| 3 | Website photo | The place's own website: `og:image`, JSON-LD `image`, then large `<img>` elements on the home or about page | URL only (hotlinked) | "Photo: <domain>", linking to the place's website |
| 4 | Nearby Commons photo | Commons geosearch within 50 m, accepted only if the file title or a category contains the place's name (normalized, fuzzy match ≥ 0.8) | Commons URL + license metadata | Author, license, link |
| 5 | Mapillary street photo | Nearest image within 30 m whose camera heading points at the place (±45°) | Mapillary image ID only | "Street view near here · Mapillary, CC BY-SA", linking to the image |

Ranking is my call: explicitly linked photos are near-certain to be correct; website photos are usually the best pictures of the inside; geosearch and street photos are the most likely to show the wrong thing, so they come last. A card shows up to 5 photos in rank order; the first one is the hero image.

### 4.2 Details

- **Website photos:** skip logos, icons, sprites and images under 400 px on the short side (from HTML attributes or a HEAD/size probe). Store the absolute image URL and the page it came from. If the image fails to load on the card, hide it (the `<img>` `onerror` handler), don't show a broken frame.
- **Website photos switch:** a build-time web flag `VITE_SHOW_WEBSITE_PHOTOS` (default `true`). If the team rejects P-013's website-photo part, it is set to `false` and the rows stay unused for display. They can still be sent to the vibe step.
- **Removal on request:** `place_photos.hidden = true` removes a photo from cards without deleting the row, so the batch job doesn't re-add it.
- **Mapillary:** its thumbnail URLs expire, so only the image ID is stored. The browser resolves the thumbnail through the Mapillary Graph API with a public client token (`VITE_MAPILLARY_TOKEN`; Mapillary client tokens are meant for browser use). Without a token, Mapillary photos are skipped. Mapillary is the first thing to cut if time runs short.

## 5. Student uploads

- Signed-in users (existing Supabase Auth, P-014) can add a review to a place: rating 1–5, text, optional vibe tags from the DATA_MODEL §3 vocabulary, and up to 3 photos.
- Photos go to a public-read Supabase Storage bucket `place-photos`, under `<user_id>/<uuid>.<ext>`. JPEG, PNG or WebP only, at most 5 MB each. Strip EXIF location in the browser before upload (privacy, AGENTS.md §5).
- The upload form states that the user grants Vibenta permission to show the photo and that it must be their own photo.
- Users can delete their own reviews and photos. The team can hide anything through the dashboard (`hidden`).
- Moderation for the hackathon is after the fact: uploads show immediately, the team removes problems. **Open question for the team (§10).**
- Seeded demo content (team-taken photos, team-written reviews) is inserted with `is_seed = true` and labeled "demo" on the card.

## 6. Vibe inputs and the vibe step

### 6.1 Inputs collected per place (all stored as text)

| Input | Source | `vibe_sources` key |
|---|---|---|
| Website text | Home and about page visible text, JSON-LD `description`, meta description | `website` |
| Photos | Up to 3 photos per place (website, licensed and student, in rank order) are sent as images straight into the vibe call (§6.2). No separate description step. Priority places only (§6.4). | `photos` |
| Wikipedia / Wikivoyage | Wikipedia extract via the Wikidata sitelink; Wikivoyage listing text when a listing matches by name and is within 100 m | `wiki` |
| OSM tags | `outdoor_seating`, `internet_access`, `opening_hours`, `live_music`, `smoking`, etc. Ingest's `pickOsmTags` (normalize.ts) currently drops `live_music`, `smoking`, `wikidata`, `wikimedia_commons` and `image`; extend its key list and re-run ingest. | `osm_tags` |
| Boston license data | data.boston.gov Annual Entertainment Licenses (live music, DJ, dancing) and Section 12 alcohol licenses (closing hour), matched by normalized address plus name similarity | `city_licenses` |
| Student reviews | `student_reviews.body` and `vibe_tags` | `student_reviews` |

The alcohol-license dataset was last modified in 2020. Treat it as a weak signal and skip it if matching proves unreliable.

### 6.2 Vibe step

Gemini scores places **in batches**, following the price step's pattern (validate each entry by `id`, retry a bad batch once, stop cleanly on quota):
- **Text-only batches** of about 50 places, for places without photos.
- **Batches with photos** of about 5 places with up to 3 images each, for priority places.

Each entry returns `vibe_scores` (DATA_MODEL §3 keys, [0,1]), a one-to-two-sentence `ambience_description`, and the evidence used. Confidence: `high` with website text or photos, `medium` with wiki text, city license data, student reviews or rich OSM tags, `low` with sparse OSM tags only.

Each Gemini model has its own daily quota, so a run may use a second model (for example `flash-lite`) once the first is used up. The model is recorded per place.

The neighbourhood input from DATA_MODEL §5 (`context_features`) is **out of scope**: nothing computes it yet, and it would need parks, water and campus geometry. Then embed `ambience_description` as DATA_MODEL §5 step 7 says (text model and CLIP text encoder), once those models are pinned.

### 6.3 Re-running

Inputs are stored separately from the scores, so the vibe step can be re-run (new prompt, new vocabulary version) without re-crawling.

### 6.4 Order and limits

Both steps process places in this order:
1. The demo list: a hand-kept file of place IDs in `pipeline/`.
2. Places within 800 m of a rapid-transit stop (from `apps/web/src/features/transit/data/stops.json`) and within 1.5 km of a target campus.
3. Everything else.

Photo batches cover tiers 1 and 2; tier 3 gets text-only scoring. Each run skips places already done unless `--refresh` is passed, and stops cleanly at the quota, so runs can resume the next day.

Rough budget: 20 text-only requests of 50 places score about 1,000 places a day per model.

## 7. Data model (new migration)

~~~sql
create table place_photos (
  id              bigint generated by default as identity primary key,
  restaurant_id   bigint not null references restaurants(id) on delete cascade,
  kind            text not null check (kind in ('student', 'licensed', 'website')),
  source          text not null check (source in ('upload', 'osm', 'wikidata', 'commons', 'mapillary', 'website')),
  match_method    text not null check (match_method in ('upload', 'osm_tag', 'wikidata', 'name_match', 'nearest_facing', 'website')),
  url             text,                -- display URL; null for mapillary and uploads
  storage_path    text,                -- uploads only
  mapillary_id    text,                -- mapillary only
  page_url        text,                -- link-back: Commons file page, website page, Mapillary image page
  license         text,                -- e.g. 'CC BY-SA 4.0'; null for website photos and uploads
  credit          text,                -- author or domain, as displayed
  author_id       uuid references auth.users(id) on delete cascade,  -- uploads only
  review_id       bigint,              -- uploads attached to a review
  rank            smallint not null,   -- 1..5 from §4.1
  is_seed         boolean not null default false,
  hidden          boolean not null default false,
  created_at      timestamptz not null default now(),
  checked_at      timestamptz
);

create table place_vibe_inputs (
  restaurant_id   bigint not null references restaurants(id) on delete cascade,
  source          text not null,       -- a vibe_sources key from §6.1
  content         text not null,
  source_url      text,
  fetched_at      timestamptz not null default now(),
  primary key (restaurant_id, source)
);
~~~

- `student_reviews` is created as DATA_MODEL.md §4 already specifies, plus a `hidden` column.
- RLS: `place_photos` and `student_reviews` are readable by everyone where `hidden = false`. Signed-in users insert and delete only their own rows (`author_id = auth.uid()`, `kind = 'student'`). Everything else is written by the pipeline with the secret key. `place_vibe_inputs` is not readable by `anon` (it holds crawled website text, which brief §11 says not to display at length).
- Storage bucket `place-photos` with matching policies.

## 8. Ownership and contract changes

| Part | Owner (WORKSTREAMS.md) |
|---|---|
| `pipeline/` steps, migrations, `place_photos`, `place_vibe_inputs` | Integration (catalog) |
| Vibe step and its prompt | Vibe (C), using Integration's inputs |
| Card photo display, upload UI | Map (A), with accounts |

**Contract change (needs Map + Integration approval, CONTRACTS.md §7):** add to `Place`

~~~ts
export interface PlaceImage {
  url: string;                 // resolved display URL
  kind: 'student' | 'licensed' | 'website';
  credit: string;
  license?: string;            // required when kind === 'licensed'
  pageUrl?: string;            // link-back
  isSeed?: boolean;
}
// Place:
images?: PlaceImage[];         // rank order, at most 5
~~~

The existing `image` field stays and holds `images[0]` until consumers move over.

The web app does not use the CONTRACTS.md `Place` yet. It has its own `Place` in `apps/web/src/osm.ts`, filled by `apps/web/src/catalog.ts`. The card therefore needs a photo fetch: `place_photos` rows for the open place, read when the card opens. That fetch reads our own database, so it doesn't break the "no live photo lookup" non-goal.

**Branch and dependencies:**
- The pipeline build (§0) branches from `feature/accounts-vibe-theme`, which holds the restaurants migration and Supabase Auth. It doesn't need `feature/price-estimates`, because `enrich:media` makes no Gemini calls.
- For the later vibe step: `gemini.ts` on `feature/price-estimates` is written for prices. Generalize it into a shared client (request, JSON schema, retry, quota stop).
- New npm scripts follow the `enrich:price` pattern: `enrich:media` (photos and vibe inputs) and `enrich:vibe` (scoring).

## 9. Approaches considered

- **A. Everything in the batch job (chosen).** Photos and vibe inputs are resolved offline and stored. Fast cards, reproducible rankings, matches P-009/P-010.
- **B. Batch for vibe, live photo lookup when a card opens.** Fresher, but adds latency and a live dependency during the demo, plus a new server function. Rejected.
- **C. Hand-curated photo list for demo places.** Best quality but manual. Kept as a fallback: if a demo place's photo is wrong, fix it with a seeded upload or `hidden`.

Sources ruled out: Google Places (P-007; storage and non-Google-map bans), Yelp (paid, 24 h cache limit, no AI use; P-008), Tripadvisor Content API (credit card required; no storing or indexing beyond location IDs), Reddit (AI use barred without rights holders' permission), Gemini Search/Maps grounding (not on the free tier for current models), Foursquare tips and photos (paid Premium endpoints; terms not verified), Flickr (non-commercial keys reportedly now need a Pro account; unverified).

## 10. Decided vs. left open

**Decided by the user:**
- Photos show on cards.
- Sources are student uploads, licensed photos and website photos.
- Everything free.
- This build covers the pipeline only (§0).

**Calls made after scoping to the pipeline:**
- **Demo list.** An optional file `pipeline/demo-places.txt`. If it's missing, tier 1 is skipped.
- **Target campuses.** Default to the universities in `apps/web/src/discovery/data/bostonLocations.generated.ts` (`kind: "university"`).
- **Moderation.** The schema supports show-immediately with `hidden` for removal. Holding uploads for approval would add one column later and is the upload UI owner's choice.

**My calls (correct me):** display ranking in §4.1; hotlinking website photos instead of copying them; the website-photo switch and `hidden` flag; Mapillary as optional; EXIF stripping; up to 5 photos per card; batched scoring with photos sent straight into the vibe call (up to 3 per place, priority places only); a second Gemini model when the first hits its quota; neighbourhood input dropped; extending ingest's OSM tag list; priority order and branch order in §6.4 and §8.

**Open for the team:**
1. Ratify P-013, including showing website photos despite AGENTS.md §5. The pipeline can collect website photos before ratification, since display is switched by `VITE_SHOW_WEBSITE_PHOTOS`.
2. Map (A) and Vibe (C) pick up their parts from this doc.

**Left to the builder:** HTML parsing library, exact size and match thresholds, the carousel UI, Commons API query details, address normalization for city license matching.

## 11. Testing and success

- Unit tests with recorded fixtures: license allowlist, name matching, website image filtering, `robots.txt` handling, ranking, Mapillary heading check, city license matching.
- `enrich:media --dry-run` prints a coverage summary: places processed, places with at least one photo, photos per source, places with each vibe input, skipped for quota.
- Manual check: every place on the demo list shows a correct photo and a plausible ambience description. Wrong photos get `hidden`.
- Card states: no photos, image fails to load, seeded content labeled, licensed credit visible.
- Success: every demo place has a correct photo and `vibe_confidence` of `medium` or better; credits are visible on every photo.

### Run record (2026-11-21, local Supabase)

Run against a local Supabase (Docker) loaded by `npm run ingest` from the cached OSM/Foursquare data (7,864 places). The hosted project wasn't touched: the migration isn't applied there yet.

- **Tiers:** 3,613 places fall in tiers 1–2 (no demo list yet, so all of them are tier 2). 4,251 are tier 3.
- **OSM tags after re-ingest:**
  - `wikidata` on 34 places;
  - `image` on 5;
  - `live_music` on 1;
  - `wikimedia_commons` on none.
- **Real run, 100 tier-2 places, 73 s, no Mapillary token:**
  - 45 places got at least one photo: 117 website photos, 2 Commons photos.
  - Vibe inputs: website 55, wiki 4, osm_tags 85, city_licenses 19.
  - Website failures: robots 10, http 7. No per-place errors.
  - At this rate, tiers 1–2 take about 45 minutes.
- **Spot check of 12 photos:**
  - About half show the place: storefront, interior, kitchen, the restaurant's own food.
  - The rest are logos, ads or tiny blurred CDN thumbnails.
  - Thumbnails, avatars and app icons are now filtered by the size the URL declares.
  - Logos, ads and chains' corporate images still get through, so the card or vibe step should judge photo content. Hiding website photos for chains is an option.
- **Linked licensed photos are rare** in this catalog. OSM `wikidata` links are scarce, so licensed photos are mostly Commons geosearch matches.
