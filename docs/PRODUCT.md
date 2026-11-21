# Product Vision — Vibenta
> **Status:** Draft v0.1 · BostonHacks 2026 · Track: Bos(tons) of Eats and Streets  
> **Naming:** “Vibenta” is the current repository/working name. Branding may change without changing the product scope.

## One-line pitch
Discover Boston by the *feeling* you want, then turn that feeling into a real, affordable, public-transit-accessible outing.

## Problem
Students can search for a named restaurant or attraction, but it's much harder to answer: “Where can I go that feels like this photograph, scene, song, or mood?” Group decisions add conflicting tastes, budgets, and starting points; standard maps lack student-specific social context; campus events are scattered across sources. Even a good suggestion is not useful unless it can be reached during the time available using the MBTA.

## Who it's for
- **Primary:** Boston-area college students planning meals, dates, outings, and experiences alone or with friends.
- **Secondary:** New students, visitors, photographers, and people exploring unfamiliar neighborhoods.
- **Not a claim:** We do not currently know precise visitor ages or live student attendance at venues.

## Core experience: The Living Boston Map
1. User chooses intent: restaurants, cafés, entertainment, nightlife, events, culture, or exploring; categories can overlap.
2. User supplies starting location, budget, time window, and individual/group mode.
3. User can enter text, upload a photograph, or name a movie or song to express an aesthetic.
4. An adaptive Akinator-like visual quiz asks progressively more informative comparisons.
5. **The map stays on screen throughout.** As preferences evolve, destination markers reorder, fade, shrink, or grow; cards update; and the map smoothly changes aesthetic (warm/cozy, electric/energetic, etc.). Theme changes must correspond to the inferred profile and remain readable.
6. The user selects a place or suggested multi-stop outing. Actual MBTA transit/walking options render on the **same map**, with time, transfer and feasibility details.
7. Optional group mode merges individuals' preferences without hiding hard constraints or severely disadvantaging one participant.
8. Optional Recreate mode compares an inspiration image with appropriately licensed real Boston location images.

### Signature demonstration
A judge supplies an arbitrary image or description. Our map visibly converges toward matching real Boston destinations as they answer a few questions. A second judge joins with different preferences; the options re-rank for both. They select a destination and watch a real MBTA route appear. A source-vs-location photograph comparison reinforces the tangible result.

## Feature catalog — full product goal
**Discovery and visual identity**
- Living map, animated pins/cards, coherent scene-specific visual themes, accessibility/readability controls.
- Category selection, budget, origin, time-window and transit feasibility constraints.
- Image, natural language, song, artist, movie and scene inputs.
- Structured Vibe DNA profile, responsive sliders, adaptive informative questions, preference uncertainty/convergence visualization.
- Vibe Portal/Teleport transitions, authentic location previews, optional visual storyboards.

**Recommendations and execution**
- Structured place catalog (not just free-form LLM suggestions), explainable match reasons, prices/hours, valid location coordinates.
- Student-friendly sorting, verified discounts, reliable low-cost recommendations.
- MBTA routes and walking legs shown on-map; eventually multi-stop itinerary optimization and live alert-aware replanning.
- Recreate mode: aesthetic/visual matching from inspiration to licensed/authorized photos of real places; optional on-location framing overlays.

**Social and campus discovery**
- VibeFusion group invite, independent preference profiles, budgets, synchronized view, fairness-aware shared suggestions.
- Student Pulse: student-authored ratings, voluntarily verified affiliation, opt-in aggregate check-ins and social-atmosphere descriptors. Never invent demographics or real-time crowds.
- Public or organizer-authorized campus events (including Greek-life events **only** when public/authorized); visibility and attendance restrictions respected.
- Future saved lists, community reviews, campus affinity, Vibe Passport, Split & Reunite.

## Track alignment
| Requirement | Product answer |
|---|---|
| Web application | Browser-based Living Map |
| College students | Student pricing, campus feedback/events, group planning |
| Food & activities | Verified restaurant, venue, experience, and event catalog |
| Boston aesthetic | Primary vibe interpretation and map transformation |
| Cravings/preferences | Multimodal inputs and adaptive quiz |
| Budget & location | Hard filters/constraints and ranking |
| Public transit | MBTA-aware recommendations and actual route display |

Transit must influence **feasibility and/or rank**; it must not be only a decorative line or external directions link.

## Hackathon: must work vs. later
### First usable vertical slice
- Interactive Boston map with independently verified real places, marker selection and cards.
- Category, origin and affordability controls.
- **Real** route request from selected place and origin; walking/transit segments drawn on the map, including loading, no-route and error states.
- Minimal README and smoke tests.

### Signature hackathon slice
- Basic vibe quiz and deterministic/semantic destination scoring.
- Pins/cards visually re-rank and map theme changes with answers.
- At least one working free-text and ideally one image input.
- End-to-end journey from vibe → recommended place → MBTA itinerary.

### High-priority extensions, after the signature slice is reliable
- True adaptive next-question logic and Vibe DNA; two-user group session.
- Verified student discounts/events; movie/song text input; Recreate comparisons.
- Multi-stop optimization.

### Longer-term, retained in vision
- Student Pulse with sufficient real participation, complete Recreate camera alignment, large destination catalog, community rankings, complex real-time replanning, richer media analysis and visual effects.

## Product integrity rules
- Don't manufacture venues, prices, student discounts, popularity percentages, real-time crowds or transit arrivals.
- Show source and freshness where important. Missing data is “unknown,” not zero or a made-up estimate.
- Don't scrape Beli or bulk-copy Google Maps content. Use lawful first-party/permissioned data and APIs within their terms. Images must be licensed/authorized or retrieved/displayed lawfully under API terms.
- Only surface public or authorized events; never expose private invite-only locations.
- Route times and estimates must be identified as scheduled, predicted, or illustrative.
- Don't overclaim accessibility, event eligibility or actual crowd composition.

## Success criteria
1. A judge understands the premise in 10 seconds.
2. Arbitrary, supported inputs visibly change genuine place rankings and map appearance.
3. Clicking a real place draws an actual, correctly labeled transit route.
4. User can explain why a place was recommended and decide whether it fits budget, time and group.
5. The main demonstration works repeatedly, including network/error fallback states.

## References
- Architecture and responsibilities: [ARCHITECTURE.md](ARCHITECTURE.md)
- Integration contracts: [CONTRACTS.md](CONTRACTS.md)
- Sequence and acceptance tests: [ROADMAP.md](ROADMAP.md)
- Decisions still pending: [DECISIONS.md](DECISIONS.md)
