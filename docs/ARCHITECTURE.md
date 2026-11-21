# Architecture — Vibenta
> **Status:** Proposed architecture v0.1. Concrete framework choices and directory layout are pending team confirmation.

## First principle
Create one continuous user journey: **place catalog → map selection → real transit option**. The quiz, aesthetic themes and collaboration extend this foundation. Modules must exchange stable, typed data, not call into one another's internals.

## Logical modules
1. **Catalog (Places):** Owns verified place records, IDs, coordinates, category, tags, photos and source provenance.
2. **Map UI:** Owns basemap, visible pins, destination cards, selected place presentation, theme, route-overlay rendering.
3. **Transit service:** Owns routing integration, request validation, provider adapters, normalized walking/transit legs, route status and source/freshness.
4. **Vibe service (later):** Owns normalized user preferences, question selection and ranking of place IDs; doesn't manipulate map internals.
5. **Collaboration service (later):** Owns group membership, per-user profiles and synchronization; doesn't mutate place definitions.
6. **App coordinator:** Owns shared state: origin, selectedPlaceId, filters, current route result/request, vibe profile and group session ID. Connects components.

## Module boundaries for the first two teammates
| Responsibility | Map / cards owner | MBTA / routing owner |
|---|---|---|
| Basemap, camera/view, marker interaction | **Owns** | No |
| Place cards and selection UI | **Owns** | No |
| Route line and transit-stop drawing on same map | **Owns**, consumes normalized legs | Supplies normalized geometry only |
| MBTA/route provider calls | No | **Owns** |
| Transfers, walking legs, route option normalization | Displays only | **Owns** |
| Loading, no-route and error UI | **Owns** | Supplies status/error |
| Changing shared types/contracts | Agreement required | Agreement required |
| Place catalog | Shared/canonical | Read-only by contract |

**Critical handoff:** UI emits selected **place ID**; coordinator resolves selected `Place`, builds `TransitRequest` with an explicit origin, and calls transit service. Transit service returns `TransitResponse`; map renders route geometry and leg details. Neither owner invents a second version of the `Place` or `TransitResponse` model.

## Proposed repository layout
Directory names are a proposal, **not evidence of existing code**. Agree before coding.
~~~text
/
  README.md
  AGENTS.md
  CLAUDE.md
  docs/
    PRODUCT.md
    ARCHITECTURE.md
    CONTRACTS.md
    WORKSTREAMS.md
    ROADMAP.md
    DECISIONS.md
  src/
    app/                 # composition, shared state and route coordination
    features/
      map/               # basemap, markers, cards, themes, route visualization
      places/            # place data adapters/catalog
      transit/           # route provider adapter, normalization, tests
      vibe/              # quiz, preference model, ranking (later)
      groups/            # synchronization and fairness (later)
    shared/
      contracts/         # executable types matching docs/CONTRACTS.md
      fixtures/          # small demo-compatible ground-truth samples
  tests/
~~~
If the team chooses a framework with its own routing/app directory, keep the **module ownership**, not necessarily these exact paths.

## Data flow (first milestone)
~~~text
verified places ──→ catalog ──→ map markers & cards
                                  │
user selects place ───────────────┘
         ↓
app coordinator + selected origin
         ↓
TransitRequest ──→ routing adapter/provider
         ↓
TransitResponse (status, options, legs, geometry)
         ↓
map route overlay + itinerary details
~~~

## Data flow (future vibe feature)
~~~text
photo/text/media + quiz answer → VibeProfile → rank Place IDs
                                                  ↓
                                     map pin visibility, sizes and cards
                                     map atmosphere/theme from profile
                                                  ↓
                                     selection → same transit handoff
~~~

## Technology decisions
- **Not yet ratified:** React/Next.js vs. alternatives; MapLibre vs. Mapbox; data storage/backend provider; routing vendor/approach.
- **Required capabilities:** dynamic map styling and GeoJSON/polyline overlays; typed shared models; reasonable local dev setup; a live path for transit directions; API keys kept server-side when required.
- **Routing distinction:** MBTA's routes, stops, predictions and alerts **do not alone produce end-to-end door-to-door directions**. An itinerary/routing provider or routing engine must compute walking + boarding + transfers + duration. Do not label a manually connected MBTA polyline as a verified journey.
- **Coherent data licensing:** confirm basemap/Places photo and source usage compatibility before mixing providers or caching protected content.
- **No vendor lock in interfaces:** provider-specific response objects may live in adapters, never in shared UI contracts.

## Performance and resilience
- State changes should feel immediate; route requests are asynchronous with loading, cache only where permitted, and a clear error/no-route result.
- A newly selected destination invalidates or cancels prior in-flight route results; old responses must never overwrite the latest selection.
- Mark route origin explicitly; never assume device location permission.
- A seeded local fixture catalog keeps basic demo UI functional during third-party API outages; don't simulate a live MBTA result without labeling it.
- Theme changes must preserve contrast, geographic readability and transit-line legibility.

## Local and integration testing
- Map smoke test: renders 10+ places, selection opens correct card, pins filter without remounting map.
- Transit smoke test: known origin/destination produces route legs with sensible geometry **or** explicit no-route with documented source.
- Contract test: all routes use coordinates in `{ lat, lng }`; GeoJSON coordinates use `[lng, lat]`.
- Race-condition test: select A then B quickly; B's route remains displayed.
- End-to-end test: select place → route request → walking and transit legs render with readable itinerary.
- Future vibe test: changing an answer changes scores/pin prominence reproducibly.

## Integration rule
Shared contracts are proposed in [CONTRACTS.md](CONTRACTS.md). Once two workstreams start implementing, edits to them require both owners' review in the same pull request. During the hackathon, stabilize the handoff before polishing features.
