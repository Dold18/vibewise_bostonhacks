# Roadmap — Vibenta
> **Status:** Proposed v0.1, ordered from smallest functional app to full product.  
> **Strategy:** Every milestone must leave the repository demonstrably working. Full vision remains in [PRODUCT.md](PRODUCT.md).

## Milestone gates
| Gate | Milestones | Meaning |
|---|---|---|
| Foundation | M0–M2 | Real Boston map, cards and working MBTA route from selection |
| Hackathon signature | M3–M5 | Vibe choices re-rank real places and transform the map |
| Competitive extensions | M6–M9 | Multimodal input, generative quiz, group mode, student/events, Recreate |
| Long-term product | M10+ | Large reliable dataset, student community, live replanning |

## Ordered tasks and acceptance criteria

### M0 — Shared contracts and scaffold
**Owner:** Integration lead, with both teammates.
- [ ] Review and accept [CONTRACTS.md](CONTRACTS.md), including coordinate order, place ID, route status and geometry.
- [ ] Choose minimal frontend/framework and map SDK; record decisions.
- [ ] Create agreed directories, shared executable TypeScript types and minimal app startup.
- [ ] Seed 10–20 independently verified Boston places using lawful data, with stable IDs.
- [ ] Configure `.env.example` for optional keys without committing secrets.

**Done when:** every teammate starts the app locally and both feature stubs compile against one shared contract.

### M1 — Map + place cards
**Owner:** Map teammate.
- [ ] Boston basemap loads, pans and zooms.
- [ ] Real destination markers populate from shared `Place[]`.
- [ ] Click a marker/card selects a place by stable ID and displays metadata.
- [ ] Category and affordability filters work; missing prices labeled unknown.
- [ ] A visible origin/start selector exists (can begin as text/coordinate preset with verified label).
- [ ] Stub route renderer can render documented sample/fixture legs without claiming live data.

**Done when:** manual smoke test selects three distinct real places and map/cards stay in sync.

### M2 — Actual transit integration
**Owner:** Transit teammate + integration lead.
- [ ] Implement and validate `TransitRequest` → `TransitResponse`.
- [ ] **Tier 0 (required):** nearest stop(s), walk estimate and next departures for every place; feeds ranking. See [PROJECT_BRIEF.md §9](../PROJECT_BRIEF.md) and D-007.
- [ ] **Tier 1 (required for M2):** same-route-pattern journey drawn from provider `/shapes`, direction from stop sequence, per-branch matching (never per line color), with the service-running check and last-train label.
- [ ] Anything Tier 1 cannot verify degrades to Tier 0 (labeled estimate), never a drawn guess.
- [ ] *Tier 2 (greedy single transfer, pattern-validated on both legs) is a deferred bonus: build it only after M3 works end to end.*
- [ ] Transit service computes a feasible walking and MBTA-connected journey for the Tier 0/1 cases; all geometry normalized.
- [ ] Origin required; selecting place triggers asynchronous route request.
- [ ] Map displays route geometry, walking/transit legs, estimated duration, transfers and origin.
- [ ] Correct loading, no-route, error and retry handling.
- [ ] Rapidly selecting A then B never leaves A's route visible.
- [ ] Show any provider freshness or schedule-vs-prediction qualification.

**Done when:** Tier 0 works for every place; two verified same-pattern origin/destination pairs yield drawn, direction-correct routes; a failure path and a "no single-pattern connection → Tier 0" fallback are handled gracefully.

**Parallel build:** transit (Tier 0/1) and the vibe/embedding pipeline start together. M2 drawing work must not block the start of M3.

### M3 — Simple vibe quiz and scoring
**Owner:** Vibe owner.
- [ ] Run the variable-length creative Gemini quiz (target 3–4, maximum 10) with neutral creative fallback questions and Show My Matches at every stage.
- [ ] Embed every successful summary with the pinned MiniLM runtime; publish one revisioned outing profile. Rank eligible places only when verified compatible catalog embeddings exist.
- [ ] Choosing an answer visibly changes card order and marker importance.
- [ ] Expose simple match explanation.
- [ ] Transit still works after re-ranking.

**Done when:** two contrasting preference profiles yield measurably different recommendation rankings using the same place catalog.

### M4 — Living map atmosphere
**Owner:** Map owner with Vibe owner.
- [ ] Implement warm/cozy, electric/energetic and neutral theme states.
- [ ] Smooth transitions in map style, card accents and marker prominence.
- [ ] Tie theme transitions to preference state (not hard-coded screen steps).
- [ ] Keep streets, text and MBTA route overlays readable across all themes.
- [ ] Maintain reasonable performance on a normal laptop.

**Done when:** quiz changes ranking **and** visual atmosphere without destroying map state.

### M5 — Text and image inputs
**Owner:** Vibe owner / integration.
- [ ] Parse natural-language vibe descriptions into `VibeProfile`.
- [ ] Support uploaded image analysis (with fallback if provider not available).
- [ ] Normalize outputs to same ranked place model; no detached generic list.
- [ ] Demonstrate arbitrary supported user input and explain ranking differences.

**Done when:** text/image input affects the live map and a selection still yields real transit directions.

### M6 — Quiz polish and Vibe DNA
- [ ] Add richer question content and imagery within the question-family templates.
- [ ] Visualize the evolving `vibe_so_far` text (live map theming) as the quiz proceeds.
- [ ] Let users revise earlier answers and regenerate the vibe text.

### M7 — Group mode
- [ ] Two phones join one session.
- [ ] Independent preference profiles and budgets.
- [ ] Fair shared ranking, explain why suggestions suit the group.
- [ ] Updates synchronize; unverified placeholder data never presented as live.

### M8 — Student discovery and campus events
- [ ] Verified inexpensive places/discount descriptions with timestamps.
- [ ] Public/authorized event records with date, price, location and visibility.
- [ ] Student feedback contribution and opt-in verification foundation.
- [ ] Do not display false visitor age or fabricated campus attendance.
- [ ] Deal markers on map pins (student discounts and specials, proposed P-015): `docs/superpowers/specs/2026-11-21-deal-markers-design.md`.

### M9 — Recreate and multi-stop outings
- [ ] Compare image reference to authorized real destination photographs.
- [ ] Show why visual matches are plausible.
- [ ] Build basic 2–3-stop transit-feasible itinerary within budget/time constraints.
- [ ] Use real or clearly labeled illustrative routing data.

### M10+ — Full platform
Saved lists/ratings; Student Pulse with real sufficient samples; campus affinity; expanded authorized catalog; film/song enrichment; Vibe Teleport; live alert-aware rerouting; Split & Reunite; on-site camera alignment; robust community safety/permissions.

## Stop-the-line rules
- Never spend cosmetic polish time while selection → real route is broken.
- Do not proceed to M3 if M0/M1/M2 interfaces are incompatible.
- A mock-only route is not M2-complete.
- If external providers fail, keep a **clearly labeled offline replay/fixture demo** as a fallback, not fake live results.
- Protect the demo path from last-minute dependency/contract rewrites.

## Suggested test sequence for every integration
1. App boots without uncaught errors.
2. Map loads Boston and verified place markers.
3. Click a place; card displays exact selected record.
4. Choose origin; actual route appears or a truthful error/no-route is shown.
5. Change selection rapidly; old route cannot overwrite new.
6. Answer vibe question; pins/cards change, selection/transit still function.
7. Repeat after cold reload and on a second device.

## Competition deadline
BostonHacks 2026 hackathon submission is scheduled for **Sunday, November 22, 2026 at 9:00 AM local Boston time**. Confirm any updated organizer instruction or extension. Prioritize a fully reproducible end-to-end demo over breadth.


## Adaptive engine integration gate (2026-11-21)

Implementation and automated checks live on `feature/vibe-engine-live`; this does not mark live venue matching or Scene Composer rendering complete. Acceptance includes zero-venue operation, durable exclusions, neutral skips, replay/edit, stale request rejection, real MiniLM inference, creative family variety, graceful provider failure, desktop/mobile UI and temporary account-safe theme preview. Live Gemini quality additionally requires credentials. Real convergence requires verified catalog embedding provenance; PR #32 renderer integration and the separate map UI branch must be coordinated before a combined release.
