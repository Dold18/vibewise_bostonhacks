# Workstreams and Collaboration Rules — Vibenta
> **Status:** Proposed v0.1. Owners are roles until teammates claim them. Designed for people using separate Codex / Claude Code agents.

## Ownership right now
| Workstream | Owner | Owns | Doesn't own |
|---|---|---|---|
| A — Living Map & Cards | **Map teammate (assign name)** | Basemap, markers, place cards, selection UX, route overlay renderer, theme slots | Calling MBTA/provider APIs, inventing route logic |
| B — Transit | **MBTA teammate (assign name)** | Transit provider/adapter, request validation, route legs, times/transfers, routing tests | Second map, place catalog UI, changing cards |
| C — Product / Vibe (after M2) | **Project lead / assigned developer** | Preference scoring, quiz, Vibe DNA, theme state and rank output | Owning the map renderer or transit provider |
| D — Integration / QA | **Project lead / integration owner** | Shared contracts, selection coordinator, catalog fixture, integration smoke tests, PR coordination | Silent breaking changes in teammates' branches |

Names are deliberately unassigned; do not infer assignments from repository access.

## Shared files vs. owned files
These paths are **proposed** until app scaffold is agreed:
- A: `src/features/map/**`
- B: `src/features/transit/**`
- C: `src/features/vibe/**`
- Integration: `src/app/**`, `src/features/places/**`, `src/shared/**`, `tests/**`
- Shared documentation: `docs/**`, `README.md`, `AGENTS.md`, `CLAUDE.md` — coordinate edits.

Never edit another workstream's owned files to make a local agent's code compile without talking to its owner. Open a small integration PR or ask for a coordinated change.

## Branch strategy
- `main`: stable, substantial integrated progress only; **no direct development**.
- `develop`: team integration branch, created from `main`. Feature PRs target `develop`.
- Feature branches: `feature/map-foundation`, `feature/transit-routing`, `feature/vibe-quiz`, etc.
- Documentation proposals may use `docs/shared-context-v1` and target `develop`.
- Agree on shared contracts, merge documentation, then branch each feature off the same `develop` commit.
- If under time pressure, short-lived feature branches and one reviewer are fine; avoid bypassing tested integration.

## Required coordination
1. Before coding: everyone reads `PRODUCT.md`, `ARCHITECTURE.md`, `CONTRACTS.md`, `ROADMAP.md`, and agent rules.
2. Each workstream records a short task claim in the team's coordination channel or GitHub issue: branch, files owned, intended API surface, expected output, dependency.
3. For new shared interfaces: discuss shape, update `CONTRACTS.md` and types, then implement.
4. For implementation PRs: include summary, files changed, screenshots/demo if visual, tests run, remaining limitations, and any docs updates.
5. Integration owner merges into `develop` after checking smoke tests and conflicts.
6. Merge `develop` to `main` only when a coherent tested milestone is ready.

## Initial handoff between A and B
**A must produce:**
- Real map with markers using the canonical `Place` fixture.
- Clicks call `onPlaceSelect(placeId)`.
- Selection card displays place metadata.
- Route overlay component accepts normalized `TransitResponse`/selected `TransitOption`.
- Explicit idle, loading, ready, no-route and error states.

**B must produce:**
- Function/service `getTransitRoutes(request: TransitRequest): Promise<TransitResponse>`.
- Validated provider data normalized to walking/transit legs and geometry.
- Test cases covering at least one feasible journey, no route, provider failure and malformed data.
- Evidence that line labels, stops and durations are real provider fields (not guessed).

**Integration owner must produce:**
- One canonical place fixture/catalog, selectedPlaceId, origin and request lifecycle.
- Connect A selection to B request; ignore stale responses.
- One verified end-to-end test and visible origin selection.

## Working with coding agents
- Tell each agent the workstream, owned paths and acceptance test. Agents do **not** receive blanket permission to redesign the system.
- Every agent must read `AGENTS.md` plus the relevant docs at task start.
- Ask agents to **propose** a contract change before implementing it.
- Agents may use mocks/fixtures locally; mocks must be clearly identified and must not be presented as live routes or genuine student demographics.
- Never paste secrets/API keys into a prompt or commit them; use environment variables and a documented `.env.example`.
- Agents should report changed files, reasoning, tests and untested paths.

## Suggested PR template
~~~md
### Scope
What feature/milestone does this implement?

### Files / ownership
List touched paths and owner approval for cross-boundary changes.

### Contracts
Any change to Place, TransitRequest, TransitResponse, VibeProfile, events?

### Verification
Commands run; manual steps; screenshot/video for UI.

### Limitations / follow-ups
What doesn't yet work or uses fixtures?
~~~

## Disagreement resolution
If documentation conflicts, the team stops and records the decision in `DECISIONS.md`. Accepted shared executable types and tested APIs must match `CONTRACTS.md`; drift is a bug, not a reason for another agent to fork the model.
