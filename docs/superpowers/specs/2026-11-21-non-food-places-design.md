# Non-food places in the catalog — design

> **Status:** Draft for approval, 2026-11-21. Builds on the ingest (`2026-11-21-osm-foursquare-ingest-design.md`), place media (`2026-11-21-place-photos-vibe-sources-design.md`) and deals (`2026-11-21-deal-markers-design.md`) designs. Needs a DECISIONS.md entry (proposed P-016) and DATA_MODEL.md updates.

## 1. Intent

Museums, parks, landmarks and entertainment venues should carry about as much information as food places, so that:
- their cards show the same kinds of detail (address, website, phone, hours, photos, deals), and
- the vibe search, once it exists, can recommend them alongside restaurants.

Today only food places are in the Supabase catalog. Parks and museums are fetched live by the browser from map tiles and Overpass, so they get no photos, no Foursquare data and no vibe inputs, and the vibe search could never rank them. "Entertainment" and "sightseeing" have no map layer at all, even though the discovery panel offers them as activity types.

The vibe search belongs to the Vibe workstream (C). Nothing fills `description` / `embedding` yet. An unmerged branch, `origin/feature/vibe-engine-live`, adds `catalogSemanticCandidates` to `apps/web/src/catalog.ts`; it reads `restaurants.embedding` by `place_id`. This work gets non-food places into the catalog with the same inputs, so the vibe step and that ranking code can pick them up (see §8 for how the two branches meet).

## 2. Goals, non-goals, anti-goals

**Goals**
- One table per location type. Food stays in `restaurants`; new tables `museums`, `parks`, `landmarks`, `entertainment`.
- A shared `places` registry that every type table and the shared tables (photos, reviews, vibe inputs, deals) link to.
- Every pipeline script takes the location type as a parameter: `--type <name>`.
- Ingest fills the new tables from OSM and Foursquare OS Places; `enrich:media` and `enrich:photos` collect photos and vibe inputs for them exactly as for restaurants.
- The map reads museums, parks, landmarks and entertainment from the catalog, with details on the card, and falls back to Overpass when the catalog can't answer (as food does today).
- A single view across all types for the future vibe search.

**Non-goals**
- Building the vibe step or the vibe search.
- Admission prices. `enrich:price` stays restaurants-only (its rubric is entrée prices). Non-food cards show no price row, never "Price unknown".
- Renaming `restaurants`.
- Events (time-bound listings); shopping and student-event activity types.

**Anti-goals** (failure even if the code works)
- The same real place appearing twice, as a museum and as a landmark, or under two pins.
- Hundreds of playgrounds, traffic islands and unnamed plaques crowding the map and the vibe results.
- Breaking existing restaurant data: photos, stored photo copies, vibe inputs and deals already collected must stay attached to their places with no re-run needed.
- A non-food deal or price that isn't backed by a source.

## 3. Constraints

- Free only; no new paid sources. No Gemini calls in any step this design touches.
- OSM ODbL and Foursquare Apache 2.0 attribution, as today (`attribution` column).
- Crawling rules unchanged: robots.txt, polite fetcher, existing `USER_AGENT`.
- The hosted Supabase project already has the earlier migrations and about 7,900 restaurant rows with photos, copies and vibe inputs. Changes are forward migrations only.
- `place_deals` (merged to `main` in PR #37) has a `restaurant_id` FK; the registry migration repoints it. Branch from current `origin/main`.
- **Release order (builder-check call):** the migration, the pipeline changes and a schema-compatible `catalog.ts` update ship in **one PR**, and the migration goes onto the hosted project only when that PR merges. Otherwise the renamed `restaurant_id` breaks the pipeline on `main` and silently drops deals from food cards (the deals embed fails over to "unavailable"). New map layers (§8) are a second PR for the Map owners.
- Ownership: `pipeline/` and `supabase/` are the Integration workstream (D). `apps/web/src/catalog.ts` is Integration. `apps/web/src/osm.ts` categories, `apps/web/src/main.ts` and `apps/web/src/discovery/mapLayers.ts` belong to the Map/discovery owners (A); the web part (§8) needs their sign-off.

## 4. Approaches considered

1. **Widen `restaurants`** with new categories. Smallest change, one table to rank. Rejected by the project lead in favor of separate tables per type.
2. **Rename to `places`, then widen.** Cleaner name, but touches every module and collides with open branches. Not chosen.
3. **Separate table per type** — **chosen** by the project lead. Then: how do the four shared tables (`student_reviews`, `place_photos`, `place_vibe_inputs`, `place_deals`), which all reference `restaurants.id`, link to places in several tables?
   - **(a) Shared `places` registry** — **chosen.** One row per place across all types; type tables and shared tables reference it. Keeps FK integrity and cascades, keeps existing ids, gives one id space.
   - (b) One nullable link column per type in each shared table, exactly one set. No data move, but every new type adds columns to four tables and every query must pick the column.
   - (c) Per-type copies of the four shared tables. Policies and code repeated per type. Ruled out.

## 5. Data model (new migration `supabase/migrations/2026112210xxxx_place_registry.sql`)

### 5.1 Registry

~~~sql
create table public.places (
  id          bigint generated by default as identity primary key,
  place_id    text not null unique,          -- wire id, same value as the type row's place_id
  place_type  text not null check (place_type in ('restaurants','museums','parks','landmarks','entertainment')),
  created_at  timestamptz not null default now()
);
~~~

`place_type` values are the type table names; the pipeline's type config (§6.1) uses the same names.

### 5.2 Moving restaurants onto the registry (same ids)

1. `insert into places (id, place_id, place_type) select id, place_id, 'restaurants' from restaurants;` then advance the `places.id` identity past `max(id)`.
2. `restaurants.id`: drop its identity; add `foreign key (id) references places(id) on delete cascade`. A type row's `id` **is** its registry id (shared primary key).
3. For each of `student_reviews`, `place_photos`, `place_vibe_inputs`, `place_deals`: drop the FK to `restaurants`, rename `restaurant_id` → `place_ref`, add `foreign key (place_ref) references places(id) on delete cascade`, rename the indexes to match.

Because ids don't change, every existing photo, stored copy (`pipeline/<id>/…` storage paths), vibe input and deal stays attached. Column grants and RLS policies follow a column rename in Postgres; the builder verifies this on a local reset (§10).

### 5.3 Keeping registry and type rows in step

- **Delete:** the pipeline deletes through `places` (cascades to the type row and all shared rows). An `after delete` trigger on every type table also deletes the registry row, so a direct type-row delete can't leave an orphan.
- **place_id changes** (ingest's rekey "promote"): an `after update of place_id` trigger on every type table copies the new value to `places.place_id`.
- **Insert:** the pipeline creates the registry row first (§6.3). Not a `before insert` trigger: ingest upserts, and a `before insert` trigger fires even when the upsert turns into an update, which would leave orphan registry rows.

### 5.4 New type tables

`museums`, `parks`, `landmarks`, `entertainment` share the same columns, which are the type-neutral columns of `restaurants`:

`id` (PK, FK → `places.id` on delete cascade), `place_id` (unique), `source` (`osm`/`foursquare`), `source_id`, `fsq_place_id` (unique), `name`, `location` geography(Point,4326), `address`, `website`, `phone`, `kind` (text, e.g. `museum`, `gallery`, `cinema`, `park`, `monument`; §6.2), `hours` jsonb, `hours_raw`, `description`, `embedding` vector(384), `osm_tags` jsonb, `context_features` jsonb, `fts` (generated, as on `restaurants`), `last_seen_at`, `attribution`, `media_checked_at`, `deals_checked_at`, `unique (source, source_id)`.

Same indexes as `restaurants` (location gist, fts gin), same RLS: readable by `anon` and `authenticated`, no client writes. No food columns (cuisines, price).

### 5.5 Views

- **`place_points`** (replaces `restaurant_points`, service role only): `union all` of every type table with `place_type`, `id`, `place_id`, `name`, `lat`, `lng`, `website`, `address`, `osm_tags`, `media_checked_at`, `deals_checked_at`, `last_seen_at`. Pipeline steps filter it by `place_type`. `restaurant_points` is dropped once no code reads it.
- **`catalog_places`** (public read, for the vibe search and the map index): `union all` of every type table with `id`, `place_id`, `place_type`, `source`, `source_id`, `name`, `location`, `kind` (for `restaurants`: its `category`), `description`, `embedding`. `security_invoker = true` so the type tables' RLS applies.

Adding a type later means: one `create table`, one `check` value on `places.place_type`, and one more branch in each view.

## 6. Pipeline

### 6.1 Type config (`pipeline/src/placeTypes.ts`, new)

One entry per type; every script reads it. Each entry holds:
- `table` (= `place_type`), `idPrefix` behavior unchanged (`osm:` / `fsq:`),
- `osm`: Overpass selectors and a `kindOf(tags)` function,
- `fsq`: the Foursquare category paths to keep and a `kindOf(label)` function,
- `keep(place)`: extra filter (park size, §6.2),
- `osmTagKeys`: tags kept in `osm_tags` for this type (extends the food list in `normalize.ts`),
- `genericNameWords`: words added to the Commons name-match stop list (`media/wikimedia.ts` `GENERIC`), e.g. `park`, `museum`, `gallery`, `theatre`, `garden`, `memorial`,
- `steps`: which enrich steps apply.

`restaurants` becomes an entry that reproduces today's behavior exactly (same Overpass query, same Foursquare filter, same category mapping, same tag list).

### 6.2 What each type collects (starting lists; builder verifies with dry runs)

| Type | OSM (named features only) | Foursquare OS Places | Extra filter |
|---|---|---|---|
| `museums` | `tourism=museum\|gallery`; `amenity=arts_centre` with `tourism=museum` | Arts and Entertainment > Museum (all sub-kinds), Art Gallery | — |
| `parks` | `leisure=park\|garden\|nature_reserve`; `natural=beach` | Landmarks and Outdoors > Park, Garden, Beach, Nature Preserve | Kept only if it has a `wikidata`/`wikipedia` tag **or** its Overpass bounding box is ≥ 0.5 ha. `leisure=playground` never. |
| `landmarks` | `tourism=attraction\|viewpoint`; `historic=*` with a `wikidata` tag | Landmarks and Outdoors > Monument, Historic and Protected Site, Scenic Lookout, Bridge, Plaza | `historic=*` without Wikidata is skipped (thousands of plaques). |
| `entertainment` | `amenity=theatre\|cinema\|arts_centre\|music_venue\|events_venue`; `leisure=bowling_alley\|amusement_arcade\|escape_game\|miniature_golf\|trampoline_park\|ice_rink\|stadium`; `tourism=zoo\|aquarium\|theme_park` | Arts and Entertainment (excluding Museum, Art Gallery), Sports and Recreation > Bowling Alley, Skating Rink, Stadium, Mini Golf, Escape Room | Gyms, fitness centres and sports clubs excluded. |

**One type per place.** Types are tried in a fixed order — `restaurants`, `museums`, `entertainment`, `parks`, `landmarks` — and an OSM element or Foursquare place belongs to the first type whose rules match. Each type's ingest drops anything an earlier type claims, using the same config, so e.g. a historic building with `tourism=museum` goes to `museums` only. The registry's unique `place_id` is the backstop: a conflict is skipped and reported, never overwritten.

**Across sources and types (builder-check call).** First-type-wins only settles an element whose own tags match two types. OSM and Foursquare can disagree about the same real place (Foursquare "Bar", OSM `amenity=music_venue`; Foursquare "Museum", OSM `historic=*`). So after the per-type merge and before writing, every new row is checked against the places already in **other** type tables (`catalog_places`), with the same name and distance rules as `merge.ts`. A match is skipped and listed in the run summary as a cross-type duplicate; the existing row wins. Running types in the fixed order above on a fresh database therefore gives one row per real place.

**Type changes (builder-check call).** Ingest never moves an existing place to another type. If a place already in the catalog now matches a different type (OSM re-tag, list change), it stays where it is and is listed as a type conflict in the summary. Moving it would mean deleting and re-inserting rows that photos, uploads and deals hang off; that is a deliberate later tool if conflicts turn out common, not an automatic step.

**Foursquare labels:** the exact second- and third-segment strings must be verified against the Boston extract of the pinned release before they go in the config (the food config was verified the same way, see `config.ts`). Matching is exact on segments, never substring, and only the primary (first) label counts, as for food.

**Matching OSM ↔ Foursquare** reuses `merge.ts` unchanged (same name and distance thresholds), run per type. Parks and landmarks are areas whose OSM point is a bounding-box centre, so the builder checks the match rate in the dry-run report; widening the distance threshold for area types is the builder's call if matches are clearly missed.

### 6.3 Scripts and the `--type` parameter

Every script takes `--type <name>`, **required**; a missing or unknown value prints the valid names and exits non-zero.

| Script | With `--type` |
|---|---|
| `npm run ingest -- --type museums` | Overpass and Foursquare queries from the type config; cache files per type (`osm-<type>-<date>.json`, `fsq-<type>-<release>.json`, `rows-<type>.json`, …). For rows not yet in the type table: insert `places` rows first (`place_id`, `place_type`), then upsert the type rows with those ids. Rekey and "not seen" work on that type's table only; rekey "collapse" deletes through `places`. |
| `npm run enrich:media -- --type parks` | Reads `place_points` filtered by type; writes `place_photos` / `place_vibe_inputs` by `place_ref`; sets `media_checked_at` on the type table. Priority tiers unchanged. |
| `npm run enrich:photos -- --type parks` | Stores copies only for photos whose place has that type (join through `places`). |
| `npm run enrich:deals -- --type museums` | Curated list, OSM `happy_hours` and website scan, as today, for any type. Curated entries are already keyed by `place_id`. |
| `npm run enrich:price -- --type restaurants` | Any other type exits with "price estimates only apply to restaurants". |

Existing runbooks change from `npm run ingest` to `npm run ingest -- --type restaurants`; README and DATA_MODEL are updated with it.

**Deals for non-food places:** before the first non-dry write for a new type, the builder runs `enrich:deals --type <t> --dry-run` and reviews the matches. If the website scan's rules (tuned on restaurant pages) give false positives on museum or venue pages, the scan is turned off for that type in its `steps` config and only curated deals are used.

### 6.4 Code that changes

- `types.ts`: `RestaurantRow` becomes a base row plus a food extension; non-food rows carry `kind` instead of `category` + `source_cuisines`.
- `sources.ts`, `normalize.ts`, `osm.ts`, `foursquare.ts`: take the type config instead of food constants.
- `db.ts`, `media/db.ts`, `deals/db.ts`, `deals/curated.ts`, `media/photoStore.ts`: table from the config; `restaurant_id` → `place_ref`; `restaurant_points` → `place_points`. Storage path stays `pipeline/<id>/…` (same ids).
- `enrichMedia.ts`: `OSM_TAGS_LEFT_OUT` and the wiki name-match stop words come from the type config.

## 7. Food behavior must not change

Running the new `--type restaurants` must produce the same rows as today's ingest. The builder proves it: dry-run both on the same cached Overpass and Foursquare files and diff the `rows` output (ignoring only the cache file names).

## 8. Web (Integration + Map owners)

- `catalog.ts`: the pin index reads `catalog_places` (all types, one paged query) instead of `restaurants`. A map layer maps to `(place_type, kind?)`: `restaurants`/`coffee`/`bars` → `restaurants` with category `restaurant`/`cafe`/`nightlife`; `museums` → `museums`; `parks` → `parks`; new `landmarks` → `landmarks`; new `entertainment` → `entertainment`. Details are fetched from the pin's type table by `place_id`. The deals embed goes through the registry (`places(place_deals(…))`); the builder confirms the PostgREST embed path on a local stack and keeps the existing "embed unavailable" fallback.
- `pinToPlace`: non-food places show `kind` as their type label and get no price row.
- `osm.ts` `CATEGORIES` gains `landmarks` (🗿) and `entertainment` (🎭) with Overpass selectors equal to the pipeline's, for the fallback path. `mapLayers.ts`: `sightseeing` → `landmarks`; `games_entertainment`, `sports_recreation`, `live_music` → `entertainment`.
- Catalog-backed layers fall back to Overpass exactly as food does today when the catalog is unreachable or empty for that type.

PR 1 (with the migration, §3) carries only what keeps today's food behavior working: `catalog.ts` reading through the registry (index from `catalog_places`, deals embed via `places`). PR 2 carries the new layers and the `osm.ts` / `mapLayers.ts` / `main.ts` changes for the Map/discovery owners' review.

**Vibe ranking code:** `catalogSemanticCandidates` on `origin/feature/vibe-engine-live` reads `restaurants.embedding`. This work does **not** touch it; the Vibe workstream (Jacob) points it at `catalog_places` when ready *(project lead, 2026-11-21)*. This work's job is to make that a one-line change: `catalog_places` exposes `place_id` and `embedding` for every type. Whichever branch merges second resolves the `catalog.ts` conflict, and the PR description flags the overlap to Jacob.

## 9. Contracts and docs

- `CONTRACTS.md` `PlaceCategory` already has `entertainment`, `culture` and `attraction`. The mapping of types to `PlaceCategory` (`museums` → `culture`, `parks` and `landmarks` → `attraction`, `entertainment` → `entertainment`) is proposed in P-016 for the integration owner; the running app uses `osm.ts`'s `Place`, which needs no change.
- `DATA_MODEL.md`: new §3d for the registry, type tables and views; `restaurant_id` → `place_ref` in §3b and §3c.
- `DECISIONS.md`: P-016 records the per-type tables, the registry, and the `--type` parameter.

## 10. Testing and success

**Tests (`node --test`, existing style):**
- Type config: each type's `kindOf` and `keep` on fixture tags/labels, including park size and the `historic` + Wikidata rule; first-type-wins precedence on an element that matches two types.
- CLI: `--type` missing or unknown fails with the list; `enrich:price` rejects non-restaurant types.
- Ingest planning: new rows get registry inserts before upserts; existing rows don't; collapse deletes through `places`.
- Food regression: the diff in §7 is empty.

**Migration check on a local Supabase reset:** existing restaurant ids, photo rows, stored copy paths, vibe inputs and deals are unchanged; deleting a type row removes its registry row and shared rows; an upload-policy insert using `place_ref` still works as an authenticated user.

**Success:** after ingest and `enrich:media` for all four types, a coverage report per type shows rows, rows with address/website/hours, rows with at least one photo, and rows with vibe inputs. The share with photos and with vibe inputs should be in the same range as restaurants'. Address, website and hours are recorded but not a gate: parks and landmarks rarely have them in OSM or Foursquare, and filling them would need new sources (for example Wikidata P856), which is out of scope *(builder-check call)*. On the map, a museum card shows address, website, hours and deals from the catalog.

## 11. Left to the builder

- Exact SQL shape (explicit `create table` per type or a shared template), trigger and index names, the migration timestamp.
- The final OSM and Foursquare lists after dry runs, the park size threshold (start at 0.5 ha), and whether area types need a wider match distance.
- How `types.ts` splits food and base rows.
- The coverage report's format.
- Whether to keep `restaurant_points` as a compatibility view for one release or drop it in the same migration.
- `supabase/seed.sql` and any grants `places` needs for the PostgREST embed.

## 12. Decided with the project lead

- Separate table per location type; shared `places` registry for the shared tables; `--type` on every script.
- The vibe ranking code is left to the Vibe workstream (§8).
