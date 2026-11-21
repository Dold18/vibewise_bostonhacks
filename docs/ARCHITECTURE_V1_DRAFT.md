# VibePrint / Vibenta — Architecture v1 (PROPOSAL)

**Status: Proposed, not approved.** Product naming, languages, frameworks, deployment, and team assignments are open.
**Goal:** an end-to-end Boston discovery experience that interprets a user's vibe, progressively changes the Living Map as preferences evolve, recommends authentic places, and routes an actual transit-accessible outing.

## Design principle
Use **one repo, one frontend, one logical backend, shared typed contracts, and modular domain engines**. Avoid independently deployed microservices for the first hackathon prototype. Scale organizational parallelism through module boundaries and isolated branches, not service count.

## Component boundaries

```text
Browser: Living Map + Quiz + Recommendations + Transit display
       | contract-defined HTTP / optional group events
       v
API / Session Orchestrator (one logical backend)
       |-> Preference Interpreter (text/photo/media -> VibeProfile)
       |-> Adaptive Quiz & Vibe Engine (profile + question selection)
       |-> Recommender & Itinerary Optimizer (places + constraints)
       |-> Transit Adapter (MBTA + permitted routing provider)
       |-> Place / Events Data Adapter (real venue data + provenance)
       \-> Optional Group Sessions + fairness-aware optimizer
       ^
Shared canonical data contracts, test fixtures, and validation
```

### Frontend experience
Owns map rendering, marker prominence, transitions, cards, quiz UI, and route overlays. Does **not** define independent recommendation scores or fabricate route timing. It renders a contract-defined `DiscoveryState` and real `TransitPlan` returned by the backend. UI animation can interpolate toward new state without modifying backend semantics.

### API / Session Orchestrator
Owns session lifecycle, input validation, endpoint integration, session state, and the consistent `DiscoveryState` response. Keep API entry points thin. Decide persistence after stack selection; a demo can start with simple server-side session storage if the environment supports it.

### Preference / Quiz engine
Normalizes text and (if feasible) photo references into a `VibeProfile`. Adaptive quiz selects a question based on uncertainty, answers update profile, and ranking responds consistently. Treat the LLM as an interpreter, not the sole recommendation algorithm. Retain deterministic test fixtures.

### Place data / Recommender
Curate roughly 40–60 **real** Boston destinations for the initial prototype. Keep place identity, coordinates, category, estimated costs, evidence/source metadata, and photo rights in one canonical dataset. Ranking respects hard constraints (budget, activity category, time availability) and soft vibe affinity. Never fabricate student popularity, discounts, or live availability.

### Transit / Route planner
Transit adapter handles external MBTA/routing integrations. It must return explicit walking/transit legs and actual route provenance; do not infer journey validity just by drawing an MBTA line. If provider data is unavailable, expose a visible fallback rather than inventing live times.

### Optional collaborative group mode
Stores individual profiles, reconciles constraints, and produces joint recommendations. For the hackathon, target a two-person demo **after** the single-user flow works. Frontend/API owners handle integration surfaces; group domain owner writes the group algorithm and sessions module.

## Candidate module structure (not yet created)

```text
apps/
  web/                   # map, quiz, animations, UI components
  api/                   # one logical backend; may be co-located after stack decision
packages/
  contracts/             # canonical request / response / data schemas
  vibe/                  # interpretation + adaptive question logic
  recommendations/       # scoring and itinerary constraints
  transit/               # route adapters and provider normalization
  groups/                # optional group optimization
data/
  fixtures/              # explicit test/mock data
  places/                # curated real destinations with provenance
tests/
  integration/           # contract and cross-module tests
  e2e/                   # complete user journey tests
docs/                     # contracts, decisions, workflow, task map
```

The exact folders can change when the stack is chosen, **but every module must have one human owner and explicit boundary**.

## Canonical data contracts (freeze before parallel implementation)
Maintain one published schema in `packages/contracts/`. Initial concepts:
- `Place`: stable ID, name, coordinates, category, cost representation, sources/provenance, and optional verified claims
- `VibeProfile`: normalized dimensions, categories, hard constraints, uncertainty
- `QuizQuestion`: ID, options, answer interpretation, accessible image metadata if applicable
- `DiscoveryState`: session ID, version, profile, ranked `Recommendation` objects, next question, visual theme hints
- `TransitPlan`: origin, destination(s), mode-separated legs, transfer/stop info, provenance, temporal validity
- `GroupSession`: participant IDs, per-user profiles/constraints, group selection state

Shared contract requirements:
1. Place IDs are consistent across venue data, recommendations, map cards, and route requests.
2. Vibe scores are normalized to [0,1] unless the team explicitly approves another scale.
3. Currency format and budget meaning (per-person vs. total) are explicit; avoid ambiguous numeric prices.
4. Geographic coordinates use latitude/longitude with stated coordinate system.
5. Date-time values carry timezone or unambiguous local-time meaning; Boston uses America/New_York.
6. Missing, unknown, or unverified venue attributes must be represented as missing/unknown, not invented values.
7. APIs return clear failure states so the frontend can handle them gracefully.

## Proposed flows
**Single user:** activity/constraints -> image or text input -> canonical profile -> ranked real places -> visual map convergence -> selected venue -> actual transit itinerary.

**Adaptive quiz:** user answer -> session orchestrator -> update `VibeProfile` -> re-rank places -> choose next question -> return one consistent `DiscoveryState` -> frontend animates.

**Group (later):** second participant joins -> profile for each user -> group optimizer considers hard constraints and preferences -> returns group result -> synced clients render consistent state.

## Dependency ordering
1. Schema + seeded realistic test fixtures
2. Thin API contract + frontend map shell
3. Deterministic ranking + profile update and visual response
4. Real location/route integration, pricing constraints, and verified data
5. Optional group sessions, Recreate Mode, events, polish

**First test:** From a clean checkout, the app loads Boston pins, accepts one preference answer, receives a different ranked list, visibly changes the map, and can open a destination card. The underlying data can initially be documented fixtures; do not claim all provider integrations work at this milestone.

## Open decisions
- Product name: VibePrint vs Vibenta or another team-approved name
- Frontend, backend, and shared-schema language/frameworks
- Where session state lives and whether live group updates need WebSockets or a hosted service
- Map provider, destination source and licenses, MBTA routing strategy
- Hosting, secrets management, budget, and provider fallback strategy
- Team size, technical strengths, human module owners
- MVP feature cutoff and demo reliability requirements
