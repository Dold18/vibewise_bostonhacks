# Shared Contracts v1 — Design Checklist (DRAFT)

Do **not** treat this file as code or an approved API. These are interface boundaries to settle together before independently assigning agents.

## Response to a preference interaction
A single request/response should carry a complete, internally consistent `DiscoveryState`:
- sessionId, monotonically increasing revision
- `VibeProfile` dimensions and uncertainty estimates
- selected categories, hard constraints (budget, location, time, accessibility if collected)
- sorted `Recommendation` entries referencing canonical place IDs
- next quiz question (if needed), optional theme hints for the Living Map
- clear status / error representation

The frontend must not require access to private model prompts or ranking internals. It can animate changes between state revisions.

## Core domain objects

| Object | Owner | Required design decisions |
|---|---|---|
| `Place` | Data lane | ID, category, lat/lon, source, price and photo provenance, verified/unverified facts |
| `VibeProfile` | Intelligence lane | axes, normalized [0,1] score scale, confidence, explicit hard constraints |
| `QuizQuestion` | Intelligence lane | question ID, visual options, answer values, accessibility fallbacks |
| `Recommendation` | Intelligence lane | place ID, affinity score, ranking reason, filtering explanation |
| `DiscoveryState` | API/integration owner | session ID, revision, profile, ranked list, next question, theme hints |
| `TransitPlan` | Data/routing lane | ordered legs, stops, walking, transfer info, duration provenance and timestamp |
| `GroupSession` (optional) | Group domain owner | participant IDs, independent constraints, state revision, fairness output |

## Candidate public API surfaces (names not frozen)
- Start a discovery session / set constraints
- Submit text/image/media input
- Submit a quiz answer and receive refreshed `DiscoveryState`
- Get place details by canonical ID
- Request a transit plan for selected places/start/time
- Optional: create/join/update a group session

Each surface needs example JSON, status/error responses, schema validation, and consumer-owned contract tests.

## Consistency rules
- Same ID for a place in map markers, recommendation cards, data layer, and route requests
- Same budget unit in backend, API, data, and frontend; explicitly choose USD cents or a structured money type
- Scores use [0,1] on the wire unless changed through accepted contract revision
- UTC timestamps or offset-bearing ISO 8601 for instants; local operating hours include timezone (America/New_York)
- A travel estimate must disclose provider/data age or be labeled a non-live approximation
- Third-party data permissions and attribution must be recorded
- Unknown attributes must remain unknown, not false or fabricated
- Avoid logging uploaded photos or user identity beyond what is necessary

## Example consumer-driven contract test
Given fixture `place-001`, quiz answer "cozy", and a known starting point:
- API returns a valid state with revision incremented
- Every recommended `placeId` exists in the canonical dataset
- Recommendation score remains in allowed range
- A returned next question has valid IDs/options
- Frontend updates marker emphasis without crashing on optional missing details
- A transit route (when requested) references an existing destination and explicit travel legs

## Contract freeze checkpoint
Schema owners and integration owner approve actual generated validators/types and minimal example JSON **before** parallel frontend, AI, and data implementation begins.
