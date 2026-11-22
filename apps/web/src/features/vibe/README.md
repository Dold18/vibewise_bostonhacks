# Adaptive outing engine

The active quiz is `liveEngine.ts` + `ui/liveQuiz.ts`, mounted in the existing discovery vibe step. See [accepted design](../../../../../docs/VIBE_QUIZ_DESIGN.md) for behavior and boundaries. The older `engine.ts`/`model.ts`/`questions.ts` seven-axis prototype remains only for compatibility; it is not used by the live UI.

- `profile.ts`: canonical immutable session/provider contracts and pinned MiniLM identity.
- `evidence.ts`: replayable explicit ledger and conservative corrections.
- `families.ts`, `validation.ts`: sixteen creative families, guidance, bounds and fallback/quality guards.
- `publisher.ts`, `adapters.ts`, `convergence.ts`: shared snapshots, scene/recommendation boundaries, reversible safe pin appearance.
- `providers.ts`: browser API adapters, embedding cache/deduplication.
- `../../../server/vibeGemini.ts`, `vibeApi.ts`, `miniLM.ts`: server-only Gemini, guarded HTTP and real local inference.

From `apps/web`, run `npm test`, `npm run build`, or `npm run dev:all`. Put `GEMINI_API_KEY` in root `.env`; optionally choose another file with `VIBENTA_ENV_FILE`. Never use a VITE_ prefix for secrets. Initial model download requires network access; `VIBENTA_MODEL_CACHE` selects its cache directory. `TRANSIT_API_PORT` and `VITE_PORT` allow a separate preview.

Missing Gemini produces a labeled local question while preserving summary/history. Missing MiniLM publishes unavailable. Missing catalog fingerprint retains ordinary map pins; exact catalog setup is in EMBEDDING_PIPELINE.md. Photos are preserved locally but not analyzed. Automated fixtures never call paid providers or represent real Boston rankings. Session state is not durable across reloads.

The integrated map connects `outingProfiles` once through
`scene.connectProfiles(outingProfiles)`. The existing Scene Session compiles
wanted evidence into a guarded scene and sends it to the existing theme's
`setScene`; navigation continues to control scene safety. No `setOuting`
controller or additional palette is initialized. `createConvergence` reads only
eligible, compatible catalog vectors and updates the existing markers via
`semanticMarkerState`, including visibility, keyboard focus and matching shadows.
