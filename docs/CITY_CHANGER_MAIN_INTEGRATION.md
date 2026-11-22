# City Changer integration into the white application

Local implementation: `503c531`; decoration provenance fix: `67aad81`. Baseline: refreshed `origin/main` at `8219bcd`.
Engine source: `feature/city-changer-integration` at `b6d47cc`.
Integration branch: `feature/city-changer-main-integration`.
Worktree: `/private/tmp/vibenta-city-changer-main-integration`.

The engine is selectively integrated into the existing application. No branch-wide merge was used. The user's original checkout remains on `fix/v2-quiz-immediate-launch-20261121` (`74f1449`), with its uncommitted quiz changes untouched. Those private changes are not part of this integration.

## Implementation and ownership

The integration request authorizes the map, scene and coordinator changes below. No transit, recommendation, catalog, account UI or quiz implementation was replaced.

- `apps/web/src/features/city/**`: planner, resource budgets, capability aggregation, renderer adapters, procedural composer bridge, deterministic seed, recovery and stylized-map disclosure.
- `apps/web/src/features/buildingAppearance/**`: procedural facades, roofs, real-footprint geometry, shaders, textures and coordinated appearance transitions.
- `apps/web/src/features/surfaces/**`: procedural road, sidewalk, plaza, park and ground materials, wet streets, navigation calming and coordinated texture swaps.
- `apps/web/src/features/atmosphere/**`: world weather, fog, lighting, particles, grade, effects, quality limits and transitions.
- `apps/web/src/features/scene/**`: composer, evidence-gated decoration engine, lazy models/materials/SVG runtime, capability-aware compiler and session support, and subsystem tests. Preview UI and tools were excluded.
- `apps/web/src/main.ts`: one profile subscription to the composer, one existing scene session, four renderers, pin/route placement exclusions, shared seed, residual asset runtime, development console probes and cleanup. A retained back/forward-cache page keeps its engine alive; real departures and HMR clean up resources.
- `apps/web/src/mapStyle.ts`: export main's existing road-width function and constants for surface alignment. Original palette, casing, road widths, building layers and geometry remain unchanged.
- `apps/web/src/features/vibeTheme/controller.ts`: source-compatible scene/atmosphere interfaces; the City Engine owns atmosphere, so a second atmosphere renderer is not mounted here. Existing account effects remain.
- Shared test helper, scene catalog and its documentation copy remain synchronized. `three` and `@types/three` use the engine source's dependency versions. Existing `public/scene-assets/**` already contains the needed manifests, models, textures and attribution; no duplicate asset pack was added.
- Browser QA scripts and a clearly documented three-record catalog replay support reproducible UI comparisons. The existing quiz browser assertion now checks separate positive/negative MiniLM requests, matching the current engine's documented ranking contract.

[Exact changed-file inventory](city-main-integration-qa/changed-files.txt).

## Excluded identity and viewer changes

No identity CSS, typography, icons, wordmark, favicon, HTML shell, scene accents, global styles, alternate navigation, account controls, discovery panels, quiz components or venue-card redesign were imported. No new viewer or composer panel is mounted, including in ordinary development sessions. Console probes are development-only. The source's narrow-road redesign, palette/material reskin and base-material identity layers were excluded; world surfaces share the original app's widths instead.

The only new interface text is a small light map caption explaining that transformed facades and props are imagined. It sits within the map, away from the quiz footer. Real geography, venue records and route geometry retain their existing sources.

## Contracts and safeguards

No changes to `Place`, `TransitRequest`, `TransitResponse`, profile publisher payloads, coordinate order or provider response boundaries. No new shared contract is proposed by this port.

The source's additive internal scene interfaces are retained: trusted caller submit options, runtime capability replacement, scene context for evidence/quality/seed, and scene timing. The local composer may submit 48 overrides; untrusted model intents remain capped at 12. Identical validation, coherence, capability, navigation and resource rules still apply. This integration request authorizes preserving that source behavior locally; scene-owner review of the larger trusted budget remains appropriate before merge, as flagged in the source history.

An additional integration fix keeps model-generated qualifiers outside prop permissions. They still shape style; only original text and explicit profile evidence grant themes. Three regression tests first reproduced the source gap and now pass, including undo and reseeding. Five browser checks also passed with adversarial haunted/Christmas qualifiers injected into an actual quiz profile: [provenance report](city-main-integration-qa/provenance.json), [rendered view](city-main-integration-qa/model-qualifiers-no-props.jpg).

Building light anchoring, rain/wet-road interpretation, composer vocabulary/energy and coordinated building/decor/surface transitions are preserved from source. Explicit themes clear with the outing. Ordinary darkness, coziness, jazz, peacefulness or surprise grants no seasonal/haunted permissions.

## Evidence: white UI preservation

Ten matched states at **1440×900** and **390×844** were captured on immutable main and the integrated app. Real map tiles loaded in both. Gemini/embedding replies are deterministic fixtures; recommendations replay three real records retrieved through the live MiniLM/catalog API. This replay proves presentation and marker coordinates, not live ranking quality.

[Comparison measurements](city-main-integration-qa/white-comparison.json): identical DOM text, geometry and computed visual styles in all ten states. Across **1,964,448 UI-interior pixels**, zero pixels changed. The mask excludes the map, widget gaps, rounded edges and map-backed shadows. Full screenshots remain available for inspection.

| State | Before | After |
|---|---|---|
| Desktop landing | [before](city-main-integration-qa/before/1440-landing.png) | [after](city-main-integration-qa/after/1440-landing.png) |
| Desktop discovery | [before](city-main-integration-qa/before/1440-discovery.png) | [after](city-main-integration-qa/after/1440-discovery.png) |
| Desktop quiz | [before](city-main-integration-qa/before/1440-quiz.png) | [after](city-main-integration-qa/after/1440-quiz.png) |
| Desktop recommendations | [before](city-main-integration-qa/before/1440-recommendations.png) | [after](city-main-integration-qa/after/1440-recommendations.png) |
| Desktop venue card | [before](city-main-integration-qa/before/1440-venue.png) | [after](city-main-integration-qa/after/1440-venue.png) |
| Mobile landing | [before](city-main-integration-qa/before/390-landing.png) | [after](city-main-integration-qa/after/390-landing.png) |
| Mobile discovery | [before](city-main-integration-qa/before/390-discovery.png) | [after](city-main-integration-qa/after/390-discovery.png) |
| Mobile quiz | [before](city-main-integration-qa/before/390-quiz.png) | [after](city-main-integration-qa/after/390-quiz.png) |
| Mobile recommendations | [before](city-main-integration-qa/before/390-recommendations.png) | [after](city-main-integration-qa/after/390-recommendations.png) |
| Mobile venue card | [before](city-main-integration-qa/before/390-venue.png) | [after](city-main-integration-qa/after/390-venue.png) |

## Integrated behavior and browser verification

- All nine requested inputs were entered through the existing quiz, with real MiniLM inference and truthful local question fallback. All 37 checks passed. Original text, accepted answers, correction and Clear traverse the same profile/composer/session path. All nine embedding states were ready; the nine inputs produced eight distinct compositions. See [quiz results](city-main-integration-qa/quiz-inputs.json).
- Twenty-seven rendered-world decoration audits across Boston Common, Back Bay and Downtown passed: every themed asset had corresponding explicit evidence or an authorized set piece. Ordinary vibes had zero themed assets. All 34 acceptance checks passed, including exact undo, rapid interruption, WebGL recovery, reduced motion, layer uniqueness and one session listener. See [acceptance](city-main-integration-qa/acceptance.json).
- Buildings, surfaces, decorations and atmosphere received the coordinated scene timing. [Transition samples at successive delays](city-main-integration-qa/transition-0.jpg), [150 ms](city-main-integration-qa/transition-150.jpg), [500 ms](city-main-integration-qa/transition-350.jpg), [1300 ms](city-main-integration-qa/transition-800.jpg) and renderer-delivery telemetry are saved. Samples are wall-clock observations, not a precision synchronization benchmark.
- Source QA rerun on the integrated app captured 26 worlds/seed/continuity/navigation states, with no warnings/errors. A prior 38-world traversal was interrupted by a deliberate HMR edit and is not counted as a completed run. [Completed rendered-world report](city-main-integration-qa/rendered-worlds.json).
- Existing navigation browser suite: all 56 checks passed. Includes idle/loading, provider failure, no route/no service, invalid response, repeated navigation, mobile, route contrast, estimated walks and no automatic location access. [Navigation report](city-main-integration-qa/navigation.json).
- A real Harvard → Kendall/MIT MBTA request succeeded through the existing API and drew its Red Line geometry over the transformed map. Walking remained explicitly approximate and ride timing schedule-derived. [Route screenshot](city-main-integration-qa/live-mbta-over-city.jpg), [provider result](city-main-integration-qa/live-mbta.json).
- WebGL loss emitted MapLibre's four expected custom-layer restoration warnings; the City Engine re-added those layers, preserved the scene and reported no renderer failures. [Recovered view](city-main-integration-qa/gpu-restored.jpg).
- Four lifecycle checks passed: retained-page behavior, no duplicate layers/listeners, bounded retained memory after 60 updates, no browser errors. [Lifecycle report](city-main-integration-qa/lifecycle.json).

## Technical validation

From `apps/web`:

```sh
npm test
npm run build
```

**1,082 tests in 91 files passed**, including existing quiz/navigation and imported compiler, composer, decoration, surfaces, transition, building and recovery tests. The source's identity-specific tests were deliberately excluded. Build includes TypeScript checking and passed; Vite retains its large-chunk advisory. [Test log](city-main-integration-qa/unit-tests.txt), [build log](city-main-integration-qa/build.txt).

The original browser regression initially failed on pristine main and after integration because it expected exclusions in the positive MiniLM query. The assertion was corrected to require separate positive and negative requests; no product code changed to satisfy it. Both the original results and final reruns are retained. The cache-aware corrected check verifies that unchanged negative evidence can reuse its previously embedded vector. Final results: **30/30 on main and 30/30 after integration**. [Before](city-main-integration-qa/quiz-regression-before-final.json), [after](city-main-integration-qa/quiz-regression-after-final.json).

`node apps/web/scripts/transit/test-engine.ts` passed seven coordinate cases plus unit assertions. All Tier 2 offline and live MBTA acceptance checks passed, including pattern-level branch validation, verified transfers, walking transfers and no-service cases. The first live attempt was blocked by sandbox networking; the network-enabled rerun passed. [Tier 2 log](city-main-integration-qa/transit-tier2.txt).

## Performance and memory

Standalone headless Chrome using Metal, 1440×900, DPR 1, same source QA method (synchronous redraw plus GPU readback):

| View | Draw median / p90 / max | Pan / orbit / zoom | JS heap snapshot |
|---|---|---|---|
| Downtown | 12.8 / 14.0 / 33.1 ms | 51.1 / 55.9 / 58.1 FPS | 245 MB |
| Beacon Hill | 11.5 / 13.8 / 16.0 ms | 57.8 / 58.1 / 58.7 FPS | 404 MB |

These heap snapshots include uncollected transient data and are not retained-memory measurements. A separate test with explicit garbage collection before/after 60 updates measured **50.04 → 50.73 MB**, a **0.69 MB** increase. This is a short regression check, not a long-session leak guarantee. Mobile/low tier deliberately keeps native buildings and omits expensive custom layers according to the source's resource policy. [Standalone performance report](city-main-integration-qa/performance.json).

The earlier concurrent-browser run had a 787.5 ms outlier; the standalone rerun above removes that contention. No claim is made about all devices or driver combinations.

## Remaining limits and review status

- No Gemini key was present in the provided environment. Real Gemini question/summary quality and the complete Gemini-powered journey require a credentialed follow-up. Local fallback, real MiniLM, real Supabase search and live MBTA were verified.
- The live search API searched 7,601 records; “cozy rainy bookstore” returned Beacon Hill Books & Cafe, Barnes & Noble Café and Bag Ladies Tea. UI comparisons replay these real records with mocked vectors; they are not ranking-quality evidence.
- Provider availability, catalog content, scheduled services, GPU capabilities and large lazy rendering chunks remain dependencies. Low-tier simplification is intentional.
- The dirty quiz work in the original checkout must be coordinated independently; it was neither discarded nor silently integrated.
- Ready for local engineering review. Do not treat this as production-release approval: credentialed Gemini QA and scene-owner review should precede a merge. No push, PR or merge has been performed. Publication requires the user's explicit approval.

## Launch and review

The isolated app was served at `http://127.0.0.1:5217/`. Dependencies were reused through local symlinks to the source engine worktree; no duplicate install was made. Keep that worktree available, or install the committed lockfile normally when disk space allows. The ignored `.env` is a local copy of the existing browser configuration; no secrets are committed.

To launch after stopping the review servers, use two terminals:

```sh
cd /private/tmp/vibenta-city-changer-main-integration/apps/web
VIBENTA_ENV_FILE="$PWD/.env" TRANSIT_API_PORT=8817 node server/index.ts
```

```sh
cd /private/tmp/vibenta-city-changer-main-integration/apps/web
VIBENTA_ENV_FILE="$PWD/.env" TRANSIT_API_PORT=8817 npm run dev -- --host 127.0.0.1 --port 5217 --strictPort
```

For a reproducible world, open `http://127.0.0.1:5217/?seed=424242`. Enter the vibe through the ordinary quiz; no viewer is required.

Useful QA commands from `apps/web`, with the app running:

```sh
VIBENTA_QA_URL=http://127.0.0.1:5217/ node scripts/vibe-browser.mjs
VIBENTA_QA_URL=http://127.0.0.1:5217/ node scripts/check-navigation-browser.mjs
VIBENTA_QA_URL=http://127.0.0.1:5217/ node scripts/city-quiz-browser.mjs
VIBENTA_QA_URL=http://127.0.0.1:5217/ node scripts/city-acceptance-browser.mjs
VIBENTA_QA_URL=http://127.0.0.1:5217/ node scripts/city-lifecycle-browser.mjs
QA_MODE=perf VIBENTA_QA_URL=http://127.0.0.1:5217/ node scripts/city-changer-browser.mjs
```

Next integration step: review the local commits and screenshot comparison, run credentialed Gemini QA in this isolated branch, then obtain approval to publish a focused PR. Reconcile any subsequent main or private quiz changes explicitly before merge.
