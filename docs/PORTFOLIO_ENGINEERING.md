# VibeWise — engineering walkthrough

**Purpose:** an implementation-oriented tour of the BostonHacks 2026 codebase for reviewers. This describes the integrated project and distinguishes runtime behavior from ideas that remained in the product vision.

## Main technical problem

A location-discovery app can rank venues, or it can render a themed map. VibeWise tries to do both **continuously during preference discovery** while retaining stable venue identities, real geography, user navigation state, and readable map markers. The challenge is coordinating asynchronous AI output, semantic relevance, visual scene composition, and transit data without letting any subsystem invent facts about another.

## Runtime subsystems and implementation links

| Subsystem | Responsibility | Representative code |
| --- | --- | --- |
| **Outing session / evidence** | Maintain a revisioned vibe profile; handle answers, correction/replay, summary, stale-request protection, and publication to consumers. | [`features/vibe/`](../apps/web/src/features/vibe/), [`profile.ts`](../apps/web/src/features/vibe/profile.ts), [`publisher.ts`](../apps/web/src/features/vibe/publisher.ts) |
| **Generated questions** | Generate bounded questions on the server through Gemini, support a local fallback, and present text, image, and listening formats. | [`server/vibeGemini.ts`](../apps/web/server/vibeGemini.ts), [`server/vibeApi.ts`](../apps/web/server/vibeApi.ts), [`features/vibe/ui/`](../apps/web/src/features/vibe/ui/) |
| **Semantic retrieval** | Embed profile/search text with MiniLM, check vector compatibility and eligible venues, and present ranked versus unranked results. | [`server/miniLM.ts`](../apps/web/server/miniLM.ts), [`server/catalogIndex.ts`](../apps/web/server/catalogIndex.ts), [`features/vibe/matchesView.ts`](../apps/web/src/features/vibe/matchesView.ts), [`catalog.ts`](../apps/web/src/catalog.ts) |
| **3D visual response** | Convert profile/scene signals into bounded visual intent and coherent map materials, buildings, atmosphere, and optional decor. | [`features/city/`](../apps/web/src/features/city/), [`features/scene/`](../apps/web/src/features/scene/), [`features/atmosphere/`](../apps/web/src/features/atmosphere/), [`features/buildingAppearance/`](../apps/web/src/features/buildingAppearance/) |
| **Map and discovery UI** | Keep place selection, map movement, cards, pins, ranking, search, and scene output coordinated. | [`main.ts`](../apps/web/src/main.ts), [`discovery/`](../apps/web/src/discovery/), [`features/map/`](../apps/web/src/features/map/) |
| **Transit** | Interpret route requests with supported real MBTA/GTFS data, render legs and route overlays, and expose unsupported journeys explicitly. | [`features/navigation/`](../apps/web/src/features/navigation/), [`server/`](../apps/web/server/), [`transitRoute.ts`](../apps/web/src/transitRoute.ts) |
| **Identity** | Apply responsive V3 Layered Sheets components and design tokens without replacing interaction contracts. | [`design/vibewise/`](../apps/web/src/design/vibewise/), [`design README`](../apps/web/src/design/README.md) |
| **Catalog pipeline** | Build/normalize optional venue metadata and enrichment using explicit source and permission boundaries. | [`pipeline/`](../pipeline/), [`Supabase migrations`](../supabase/migrations/) |

### Engineering design choices

**1. Revisioned state instead of detached AI answers.** The outing profile carries session/revision information, evidence, and answer history. Old asynchronous responses should not overwrite newer choices. The same published profile drives the summary, semantic results, and scene adapter; preference data and venue facts remain separate.

**2. One semantic embedding space.** Text derived from a user prompt or a generated summary can be embedded using the same MiniLM model as enriched place text. Matching needs compatible, available catalog vectors. Without them, the UI should not pretend that its fixture-based tests are production recommendations. See [embedding design](EMBEDDING_PIPELINE.md).

**3. Constrained scene composition.** The LLM's role is to describe aesthetic intent, not to produce executable shaders, arbitrary street coordinates, or unsupported building facts. The city/scene compiler resolves that intent into supported, coherent states and passes it to appearance/atmosphere renderers. Real street geometry and location/route identities are protected from themed fiction.

**4. Separate route truth from map decoration.** MBTA/GTFS-based segments, station labels, and schedule data are different from styled graphics. Some journeys are supported; an unsupported journey should degrade to an informative status, not a convincing invented line on a map.

**5. Progressive failure handling.** The app distinguishes AI generation failure, missing catalog vectors, unconfigured accounts, unavailable map/place sources, and unsupported transit routes. The intended interaction remains usable where a bounded fallback is possible.

## Scope: what shipped versus what remains a vision

| Topic | Integrated in the hackathon codebase | Not demonstrated as complete |
| --- | --- | --- |
| Quiz | Adaptive text/media question presentation, history/correction, Gemini API and local fallback | Guaranteed creative quality or relevance for every input |
| Ranking | Matching interfaces, compatible-vector checks, reversible “Rank My Matches” state and fixture-backed tests | Guaranteed live semantic rankings without catalog configuration |
| City | Map rendering and integrated theme/scene engines | Literal reconstruction of real weather, street appearance, or venue atmosphere |
| Transit | Real provider integration and supported route rendering | Arbitrary verified door-to-door itineraries |
| Account | Auth/saved-place components and Supabase integration | Unconditional availability without configured backend |
| Future features | Product vision documents | Group mode, Recreate Mode, Student Pulse, complete discount network |

## Reproduction and validation

From `apps/web`:

```bash
npm install
npm test
npm run build
npm run dev:all
```

Use Node.js 24. `apps/web/.env.example` and the root `.env.example` name environment variables, with secrets staying server-side. A fully populated external-service experience needs service credentials, valid Supabase schema/data, and any required hosted providers. The pipeline under `pipeline/` is a separate process and is not run by the Vite dev server.

Historical validation evidence is recorded in:
- [V3 component-level integration report](v3-production-integration.md) — 48 component families, tests and browser observations, including documented failures/constraints.
- [Quiz V2 acceptance matrix](VIBE_QUIZ_V2_ACCEPTANCE.md) — Gemini, media, accessibility, fallback and real-data limitations.
- [City engine integration report](CITY_CHANGER_MAIN_INTEGRATION.md) — subsystem boundaries, renderer coordination, and QA artifacts.

These records were written during integration; some first-person statuses such as “not pushed” describe their **historical moment**, not today's `main` branch. The final November 22 integration was subsequently merged. This portfolio documentation was authored afterward and does not claim a fresh execution of the tests.

## Team context and provenance

The code and assets are a multi-contributor BostonHacks effort. The repository's [PRs](https://github.com/Dold18/vibewise_bostonhacks/pulls?q=is%3Apr+is%3Aclosed), Git history, original planning notes, and per-asset notices provide provenance; no one contributor claims sole authorship of the integrated system. Jacob Dold's role centered on the AI/vibe development and cross-workstream integration.

The repository includes third-party media and scene assets in their original attributed directories. Review their notices and licenses before reuse. No repository-wide redistribution rights are implied by public visibility.

For the exact source state that existed after the hackathon integration, see the [immutable commit reference and separate snapshot branch](HACKATHON_SNAPSHOT.md).
