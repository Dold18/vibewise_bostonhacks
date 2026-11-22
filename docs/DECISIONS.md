# Decision Log — Vibenta
> **Status:** v0.1. Use this document to distinguish genuine team decisions from assistant proposals.  
> Format: ID · status · decision · rationale · implications · date/owner.

## Accepted product decisions (from team discussion)
### D-001 · Accepted · Target challenge
- **Decision:** Enter the BostonHacks “Bos(tons) of Eats and Streets” track.
- **Why:** Product must help college students discover Boston food/activities/aesthetic using location, budget and public transit.
- **Impact:** MBTA routing, student usefulness and genuine places are mandatory, not optional decorations.

### D-002 · Accepted · Single integrated experience
- **Decision:** Combine vibe discovery, adaptive image quiz, living map, group mode, Recreate and student-oriented discovery in one platform.
- **Why:** One coherent experience and shared place/recommendation model.
- **Impact:** All features eventually write/read common preferences and place IDs.

### D-003 · Accepted · Living map central
- **Decision:** Keep map visible while vibe questions and selections happen; map style, pins and cards respond to preferences.
- **Why:** Signature distinctive interaction and clear explanation of inferred intent.
- **Impact:** Visual updates need to be driven by ranking and profile state.

### D-004 · Accepted · Incremental development
- **Decision:** Start with map, real place records and cards, integrate MBTA routing, then add vibe features and advanced social features.
- **Why:** Maintain a working product at every stage.

### D-005 · Accepted · Two parallel initial workstreams
- **Decision:** One teammate owns map/cards; another owns route calculation.
- **Why:** Separate non-overlapping implementation responsibilities.
- **Impact:** Selection and transit response contracts must be agreed before parallel build.

### D-006 · Accepted · Main branch kept stable
- **Decision:** Don't develop directly on `main`; add substantial tested changes after separate integration work.
- **Why:** Avoid shipping fragmented code from multiple AI agents.

## Proposed decisions (not yet ratified)
### P-001 · Proposed · Project name
- **Proposal:** Use “Vibenta” as repository/codename; product brand can change.
- **Reason:** Repository is named `vibenta_bostonhacks`, but naming discussion was ongoing.
- **Action:** Confirm public-facing name before demo assets and branding are finalized.

### P-002 · Proposed · Frontend and map stack *(resolved-by-P-007, pending team ratification)*
- **Options:** React/Next.js or other frontend framework; MapLibre or Mapbox; compatible legally usable tile provider.
- **Evaluation:** Speed, custom map styles, cost/API access, licensing, team familiarity.
- **Action:** Decide before M0 scaffold.

### P-003 · Proposed · Routing provider *(resolved-by-D-007, pending team ratification)*
- **Options:** Provider with end-to-end transit directions, or independent transit routing engine integrating MBTA/schedule data.
- **Risk:** MBTA API alone is not a door-to-door routing engine.
- **Action:** Choose and test a real origin/destination pair before UI integration.

### P-004 · Proposed · Place data sources
- **Proposal:** Start from a small independently verified/permissioned catalog; use external providers only within terms.
- **Risk:** Google Places images/data or Beli records cannot be unrestrictedly copied.
- **Action:** Choose lawful sources, attribution and caching rules.

### P-005 · Proposed · Interface v0.1
- **Proposal:** Adopt canonical `Place`, `TransitRequest`, `TransitResponse`, coordinate conventions in [CONTRACTS.md](CONTRACTS.md).
- **Action:** Both owners approve before writing incompatible data models.

### P-006 · Proposed · Develop integration branch
- **Proposal:** Workstream PRs merge to `develop`; `main` remains stable.
- **Action:** Team confirms; create branch before coding.

### D-007 · Proposed · Tiered MBTA routing, no routing engine for the MVP
- **Date / owner:** 2026-11-21 / transit workstream. **Flagged for team ratification.**
- **Context:** MBTA V3 alone is not a door-to-door engine (P-003), the basemap is OpenFreeMap/MapLibre so Google transit content cannot be drawn on it, and routing is supporting cast to the vibe differentiator.
- **Decision:** Use MBTA V3 + GTFS static only, in tiers. **Tier 0** feasibility (nearest stop, next departures, walk estimate; feeds ranking) always ships. **Tier 1** same-route-pattern journeys drawn from `/shapes`, time from `/schedules`. **Tier 2** greedy single transfer at a fixed hub, deferred until the vibe finder works end to end. Matching and direction are per route pattern (branch), and Tier 2 validates both legs at pattern level. Drawn routes pass the service-running check and carry the last-train label. Anything unverifiable degrades to Tier 0 and is never drawn. No general multi-transfer routing; OpenTripPlanner remains the labeled stretch.
- **Why / alternatives:** Honest provider geometry without an engine. Rejected: Google Directions (cannot be shown on a non-Google map), manually connected polylines labeled as verified journeys.
- **Implications:** Resolves P-003 for the MVP. **Refines the routing scope of D-004 without superseding it**: routing is still integrated before vibe features, but Tier 0/1 and the vibe/embedding pipeline are built in parallel, and Tier 2 follows M3. No change to the types in [CONTRACTS.md](CONTRACTS.md) (see §3.1 there). Spec: PROJECT_BRIEF §9.
- **Revisit trigger:** Tier 1 misses a large share of demo origin/destination pairs, or time allows OpenTripPlanner.

### P-007 · Proposed · Open map stack (resolves P-002; brief §8 option 2)
- **Date / owner:** 2026-11-21 · Map workstream
- **Context:** P-002 left the frontend and map stack open. PROJECT_BRIEF §8 ties the map choice to review data: Google review/place content may only be shown on a Google map.
- **Decision:** Keep the map built on `maps-draft`: **MapLibre GL JS** rendering **OpenStreetMap vector tiles from OpenFreeMap** (free, no API key), in a **Vite + TypeScript** app at `apps/web`. This is brief §8 option 2 (open basemap, no Google reviews).
- **Why / alternatives:** It already works: custom Google-Maps-like style, 2.5D buildings, pins, search. Google Maps (option 1) would give Google reviews and photos, but means a rebuild, an API key and billing, and no storing of any Google content.
- **Implications:** No Google Places content anywhere in the app or database. The framework question (vanilla TS vs React) and the `apps/web` vs `src/` layout are still open. Map attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap) must stay visible.
- **Revisit trigger:** The team decides third-party reviews must be Google's.

### P-008 · Proposed · Review data: Yelp live display only + in-app student reviews (resolves brief §8)
- **Date / owner:** 2026-11-21 · Map workstream, with Integration
- **Context:** The team wants reviews. Yelp's API terms allow caching its content for at most 24 hours; only Yelp business IDs may be stored indefinitely. The API returns excerpts only (about 3 per business, first 160 characters) and is paid after a 30-day trial. Secondary sources report a ban on using Yelp content for AI/ML without written approval. Scraping Yelp is prohibited.
- **Decision:**
  1. Store only `yelp_business_id` in Supabase.
  2. A Supabase Edge Function (API key server-side) fetches review excerpts live when a place card opens. Cache at most 24 hours, outside the database. Show Yelp's required logo, stars and link-back.
  3. Yelp content, including the star rating, is **never** stored, embedded, or used for ranking or filtering.
  4. Add **in-app student reviews** (`student_reviews` table). These are our own data, usable for display, embeddings and ranking. Seeded demo reviews are flagged `is_seed` and labeled in the UI.
- **Why / alternatives:** Embedding or storing Yelp text would keep its content past 24 hours and build our database from it; both conflict with the terms. Google reviews are ruled out by P-007.
- **Implications:** Review-driven ranking comes only from student reviews. Verify Yelp's current API Terms and Display Requirements before launch; this summary rests partly on secondary sources.
- **Revisit trigger:** Yelp grants written permission, or its terms change.

### P-009 · Proposed · Catalog sources and filter fields (refines P-004)
- **Date / owner:** 2026-11-21 · Integration (catalog), with Data & routing
- **Context:** Filters need price, distance and cuisine for every place. Live Overpass lookups from the browser proved unreliable: public servers were at capacity for most of 2026-11-21, and overpass-api.de rejects clients without a descriptive User-Agent.
- **Decision:**
  - **Sources:** OpenStreetMap (via Overpass, batch only, descriptive User-Agent, retry with backoff) and Foursquare OS Places (Apache 2.0). These are loaded offline into Supabase; the browser queries Supabase, not Overpass.
  - **Distance:** PostGIS on stored coordinates, plus precomputed nearest stations (brief §3.1).
  - **Cuisine:** OSM `cuisine`, Foursquare categories and scraped menus.
  - **Price:** `price_band` from scraped menu prices where found, else an LLM estimate, with `price_source` recorded and estimates labeled "(est.)" in the UI. Money in USD cents (CONTRACTS.md).
  - **Unknowns:** hours and price stay `null` / `'unknown'` and are never shown as known.
  - Schema in [DATA_MODEL.md](DATA_MODEL.md).
- **Why / alternatives:** Google/Yelp data can't be stored (P-007, P-008). OSM alone has no prices and patchy hours, so menu scraping and labeled estimates fill the gap.
- **Implications:** The map's current live Overpass lookups are a prototype stand-in, to be replaced by Supabase queries. `price_source`, `hours` and `cuisines` need a CONTRACTS.md change to reach `Place`.
- **Revisit trigger:** Price estimates prove too inaccurate in testing.

### P-010 / P-011 · Superseded
- A separate ambience layer with `vibe_scores`, and CLIP/SigLIP/CLAP in-browser models, were considered and superseded by the one-embedding design in [EMBEDDING_PIPELINE.md](EMBEDDING_PIPELINE.md) and [VIBE_QUIZ_DESIGN.md](VIBE_QUIZ_DESIGN.md) (2026-11-21).

### D-008 · Accepted · Branch-agnostic stretches in Tier 1 matching
- **Date / owner:** 2026-11-21 / transit workstream. Implemented and tested in commit 34f79f6. Refines the matching rule in D-007 (itself still proposed).
- **Context:** Several route patterns can cover the identical stop stretch in the same direction (e.g. `Red-1-0` Ashmont, `Red-3-0` Braintree and `Red-R-0` between Harvard and Kendall/MIT). Picking one by sort order would label an Alewife-trunk trip with a branch it does not belong to.
- **Decision:** When more than one rideable pattern covers the same stops between origin and destination (same `route_id` and `direction_id`), the engine returns the trip as `branchAgnostic: true` with every match in `equivalentPatterns`. The chosen `pattern` is only a representative, and the option id and leg `source` name the route and direction, not a branch. A stretch served by a single pattern stays pinned to that pattern.
- **Implications:** `/schedules` and service-running lookups for branch-agnostic trips must key on `route_id` + `direction_id` (then filter trips to `equivalentPatterns`), never on the representative `pattern`. Pattern-specific trips are queried by their pattern.

### P-012 · Proposed · Tier 2 walk transfer: Government Center ↔ Haymarket only (extends D-007)
- **Date / owner:** 2026-11-21 / transit workstream. **Flagged for ratification**; approved for implementation on the feature branch by the transit and UI-wiring owner, not yet ratified by the team.
- **Context:** A Tier 2 hub was one station served by both lines. Green-B/C reach Haymarket and North Station only through time-limited patterns (`Green-B-816`, `Green-C-836`), so Orange ↔ Green-B/C was effectively Tier 0 outside early mornings. Example: BU Central → Haymarket on Green-B has one trip a day, at 05:42; a Saturday 3:35 PM request correctly returned `no_service`. The canonical Green-B/C patterns end at Government Center, 376 m (straight-line) from Haymarket.
- **Decision:** Tier 2 now also includes **one short, capped, labeled-as-estimate surface walk between two schedule-verified rides**, not just in-station transfers. Exactly one pair: Orange at **Haymarket** ↔ Green at **Government Center**, in either direction.
  - A transfer is `exit` stop + `entry` stop + `walkMeters`. In-station hubs are the `exit === entry`, 0 m case and behave as before.
  - Walk distance is computed from `stops.json` (haversine), at the same ~80 m/min as other walks, and is labeled a straight-line estimate. Walk transfers over **400 m** are skipped.
  - Both rides are still validated per route pattern and gated against `/schedules`. Leg B is gated at leg A's arrival **+ walk + 2 min buffer**. The walk appears as a middle leg (`walk, ride, walk, ride, walk`) with `fromStopName`/`toStopName`, and `transfers` is still 1.
  - Order: in-station hubs first, then walk transfers. Still greedy, with no ranking. One behavior change to D-007's "first valid hub wins": `planTripLive` now moves to the next **pattern-valid** hub when the earlier one fails the service gate (`no_service`), so Haymarket-on-a-mornings-only-pattern no longer blocks the Government Center walk. If every hub fails, the first hub's failure is reported. API errors still stop immediately.
- **Why / alternatives:** The walk restores real midday Orange ↔ Green-B/C trips using two verified rides and no new data source. Rejected: leaving it as Tier 0; adding Park St ↔ Downtown Crossing and State ↔ Government Center now (out of scope until this is proven); street-routed walk times (no walking API, so estimates stay labeled).
- **Implications:**
  - Tier 2 no longer means "same station only". In-station walking is still not modeled; the surface walk is straight-line and the real street walk may be longer.
  - No change to the `TransitLeg` / `TransitOption` types in [CONTRACTS.md](CONTRACTS.md); `legs` is just 5 long for this case. `Tier2Plan` gains `entry`, `transferWalkMeters`, `transferWalkSec`.
  - `hubs.ts` adds `walks` and `candidateTransfers`; `tier2.ts` adds `tier2Candidates`; `ride.ts` loops them. The rendering in `transitRoute.ts` needed no change (verified).
  - Test expectations changed: Oak Grove → BU and BU → Chinatown at midday were `no_service` and are now `ok` via the walk. Tests in `test-tier2.ts` cover both, plus the original Saturday 3:35 PM case.
- **Revisit trigger:** The team rejects surface walks in Tier 2, or a second pair is wanted (needs its own review), or a real walking-time source is available.

### P-014 · Proposed · User accounts and a vibe-reactive map theme
- **Date / owner:** 2026-11-21 · Map workstream, with Integration (accounts) and Vibe (signal producer)
- **Context:** The site should react over time to the vibes a user chooses, so it needs accounts and a per-user history. Spec: `docs/superpowers/specs/2026-11-21-user-accounts-vibe-theme-design.md`.
- **Decision:**
  - Supabase Auth, email + password. The account control sits in the top right.
  - Tables `profiles` and `vibe_events` with owner-only RLS (DATA_MODEL.md §7a). No location is stored.
  - The Vibe Engine reports readings through `recordVibe(VibeSignal)` (CONTRACTS.md). It is the only real producer; `dev` rows come from a dev-only hook and production builds ignore them.
  - The account module derives a decayed taste and exposes it as `VibeProfile.tags`. The map palette blends toward the user's top vibes, within a contrast guard, and the top two vibes add CSS effects. Users can turn effects off, and can clear their history.
- **Why / alternatives:** Rebuilding the palette and applying only changed paint keeps one color source and keeps the route overlay. Recoloring layers from a hand-kept list drifts out of sync; CSS filters tint labels and pins. Magic links and OAuth were deferred: email delivery is rate-limited, and OAuth needs credentials.
- **Implications:** Workstream C owns "Vibe DNA"; it may replace the account module's taste calculation, and the theme reads only `VibeProfile.tags`. `mapStyle.ts` becomes `buildMapStyle(palette)`.
- **Revisit trigger:** The Vibe Engine defines its own profile, or the team wants taste to affect ranking.

## How to add a decision
~~~md
### D-007 · Accepted/Proposed/Superseded · Short title
- **Date / owner:**
- **Context:**
- **Decision:**
- **Why / alternatives:**
- **Implications:**
- **Revisit trigger (if any):**
~~~

If a decision is reversed, mark the original **Superseded** and link the new ID. Never erase architectural history.
