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

### P-002 · Proposed · Frontend and map stack
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
