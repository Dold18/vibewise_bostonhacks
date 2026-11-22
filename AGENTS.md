# AI Coding Agent Instructions — VibeWise
This file applies to Codex, Claude Code and any other automated coding assistant working in this repository. Read these instructions **before** making edits.

## 1. Start every task with context
Read, in order:
1. [Product vision](docs/PRODUCT.md) — why the product exists and the complete scope.
2. [Architecture](docs/ARCHITECTURE.md) — modules and responsibilities.
3. [Shared contracts](docs/CONTRACTS.md) — canonical place/route types and coordinate conventions.
4. [Workstreams](docs/WORKSTREAMS.md) — file ownership, Git workflow.
5. [Roadmap](docs/ROADMAP.md) — current milestone and acceptance criteria.
6. [Decision log](docs/DECISIONS.md) — accepted vs merely proposed decisions.

**Status warning:** The repository may be only documentation at first. Do not pretend a component, endpoint, stack, API key or build command exists before checking the actual files.

## 2. Identify workstream and scope
Before changing code, restate in your development output:
- Assigned workstream (map, transit, vibe, integration).
- Paths you plan to edit.
- Contract/interface you consume or produce.
- The smallest acceptance test proving your feature works.

Don't expand scope to rebuild unrelated modules.

## 3. Mandatory boundaries
- Map/cards owns UI, marker selection, rendering normalized route overlays.
- Transit owns route calculation, provider integration, normalization and transit-specific testing.
- The coordinator owns `selectedPlaceId`, origin and request lifecycle.
- Do not invent an alternate `Place`, `TransitRequest`, `TransitResponse`, or coordinate order.
- Internal positions: `{lat, lng}`; geometry coordinates: `[lng, lat]`.
- Map emits the selected **place ID**, not a provider-specific routing payload.
- Provider-specific responses stay in the transit adapter, never leak into map components.
- Don't make edits in another workstream's directories without explicit coordination.

## 4. Working with an unsettled architecture
- Treat proposals in `docs/DECISIONS.md` as undecided. Ask the team to ratify choices rather than assuming.
- Avoid dependencies until team agrees on package manager, app framework, map renderer, and routing provider.
- If implementation requires changing a shared contract, **propose the change first**; after approval, update docs, executable types and tests together.
- Prefer small vertical slices that build and work independently.

## 5. Honest data and privacy
- Use real, permissioned/verified Boston place and event information or clearly labeled development fixtures.
- Never fabricate active MBTA arrivals, valid routes, venue prices, student discounts, student demographic statistics or live check-ins.
- An event's university registration does **not** make a private party public. Respect organizer permission and access controls.
- Avoid scraping/reproducing protected Beli/Google Maps content or misusing provider imagery. Follow source terms.
- Don't expose personal location, university verification records or user movement history without proper consent, minimization and safeguards.
- No secrets/API tokens in code, PRs, docs, logs, or chat transcripts.

## 6. Tests and reliability
For every change:
- Prefer compile/lint/test commands already present in repo; do not invent successful test results.
- Document commands actually run, and report if tests are blocked because scaffold or credentials do not yet exist.
- Cover idle, loading, success, no-route and error states.
- Ignore stale route responses when a different place is selected.
- Rehearse the critical path: map → select real place → real transit option → route overlay.
- Prioritize working behavior and accessible contrast over extra animation.

## 7. Git workflow
- Never commit directly to `main`.
- Follow `docs/WORKSTREAMS.md` for `develop` and feature branch process.
- Keep PRs focused and reviewable.
- Don't rewrite teammates' work to resolve a conflict without discussing ownership.
- Do not change documentation or types solely to hide errors; reconcile the intended contract.

## 8. Required final report from an agent task
1. Summary of implemented behavior.
2. List of changed files.
3. Contract changes, if any, and whether approved.
4. Tests run and their results (or why not run).
5. Known limitations, mock data, provider dependencies.
6. Exact next integration step.

**Primary goal:** build an honest, memorable, transit-connected Boston discovery tool. The map's visual intelligence must correspond to actual recommendation state.
