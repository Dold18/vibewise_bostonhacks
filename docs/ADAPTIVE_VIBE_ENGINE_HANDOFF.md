# Adaptive Vibe Engine — implementation handoff

2026-11-21. Branch `feature/vibe-engine-live`, worktree `/Users/jdold/Desktop/vibenta-vibe-engine-live`, base `origin/main` at `1f048c2` (merged PR #35). No push, PR, merge or database migration. The independent map worktree remains at `f90084d`, with its existing untracked CODEX_HANDOFF.md preserved.

1. **Implemented behavior.** The two-step outing form now has an explicit Refine this vibe action, one creative question at a time, 2–4 described options, loading/retry, Skip, Neither, unfamiliarity, free-text correction, review/edit, Show My Matches, Continue Refining and evolving summary/exclusions. Practical fields, text, browser-local photos and panel state are retained. Clear all also clears the provisional outing. Photos are not uploaded/analyzed; no audio preview is claimed. Sessions live in memory and reset on reload.

2. **Stages.** Stages 1–4 are implemented and pass local automated/fixture browser verification. Stage 3 additionally passed real MiniLM inference. Stage 5 supplies tested scene/recommendation adapters and safe map integration, but real catalog convergence and the unmerged Composer renderer remain dependencies. Stage 6 passes the local test/build/browser gates; live Gemini creativity assessment is pending credentials. This is not a claim that real AI question quality or real venue ranking has been verified.

3. **Gemini.** Server-only `/api/vibe/generate` uses `gemini-2.5-flash` by default, one structured summary/question operation, bounded input, JSON schema plus runtime validation, 8.5-second call deadlines, one validation-repair attempt, rate/concurrency limits and generic failure responses. It has no dependency on venues and no provider tools. Paid services are mocked in automated tests. A production bundle check found no Gemini credential handling/header/vendor URL in browser JavaScript.

4. **Variety.** Sixteen extensible families carry two examples each. History and evidence supply unused topics and five promising families; Gemini chooses contextually within this guidance. Validators reject repeated topic/prompt/ID, consecutive family, generic bipolar questions, near-identical option text and detected crowd-exclusion contradictions. Cultural answers have descriptive alternatives; unfamiliarity requires a neutral follow-up. These guards are heuristics, not full semantic understanding. The six requested mood scenarios are covered by fallback tests, not falsely labeled as live Gemini quality sessions.

5. **Stopping.** Hard cap ten; target 3–4 informative answers when specific and unambiguous. App-side early stopping requires at least three informative responses and a sufficiently detailed summary with no qualifiers, plus qualitative finish advice or three comparatively stable real embeddings. Stability alone cannot finish a vague session. Users can request results immediately, and continue while useful topics/capacity remain. Completion reasons distinguish user request, specificity, stability, exhausted topics and maximum. No confidence percentages.

6. **Profile and replay.** `OutingVibeProfile` 1.0.0 is the additive contract explicitly approved in the task. It preserves original text, immutable questions/answers, durable explicit wants/avoids/dealbreakers with source provenance, Gemini summary/qualifier checkpoints, asked families/topics, embedding identity/revision/status and completion. Editing N drops later history and rebuilds evidence/checkpoints from the valid prefix. Corrections replace recognized topic evidence or explicit retraction IDs; recognition is conservative. Unchosen options and neutral actions do not imply dislikes. Abort plus session/revision checks reject obsolete work. Existing Place/transit coordinate contracts and practical preference types are unchanged.

7. **Real MiniLM.** Operational locally and through `/api/vibe/embed`. Transformers.js 4.3.2 runs pinned `Xenova/all-MiniLM-L6-v2` revision `751bff37182d3f1213fa05d7196b954e230abad9`, fp32 CPU, mean pooling, L2 normalization, 384 dimensions. Real HTTP calls returned unit vectors. Two contrasting synthetic outing descriptions produced cosine 0.2619661684, confirming distinct real vectors rather than test placeholders. Each successful summary triggers asynchronous inference; bounded caches/deduplication avoid repeated work. Model identity/dimension/nonzero checks and stale guards apply. First use requires network/model download and approved native dependencies. General MiniLM negation quality remains a retrieval limitation.

8. **Scene boundary.** One frozen publisher feeds summary UI, recommendations and `subscribeScene`. The adapter includes the identical profile and revision with PR #32's proposed SceneIntent shape. Presets/overrides are empty; no unmerged assets or renderer are asserted. Existing ten-key palette descriptors produce a temporary preview only, with navigation > outing > saved account taste > default precedence. Provisional sessions never call account `recordVibe`.

9. **Map convergence.** Implemented as a guarded adapter, not live-verified against the venue database. Currently eligible catalog IDs/coordinates are read without migrations; no geographic positions are moved. Compatible vectors yield cosine-based prominence and reversible weak-pin hiding, including matching shadow visibility; Show all restores access. Search/navigation/selected destinations are protected. The full eligible set is retained. Catalog matching is disabled unless its owner verifies the exact model fingerprint and sets `VITE_CATALOG_EMBEDDING_MODEL_KEY`. No provenance column exists in the current schema, and no compatible deployment was available here. Missing vectors leave pins unchanged.

10. **Fixtures and failures.** Unit/browser tests explicitly label synthetic vector spaces/provider outputs; none are production venue recommendations. Gemini outages preserve the prior valid summary and pending answers, supply a creative local question, and recover from retained history. Embedding outages publish unavailable without vectors and offer retry. Missing Gemini does not stop the quiz. Media references are text only. Photo analysis and persistent session storage remain unimplemented.

11. **Exact changed files** appear below, including this handoff.

12. **Local implementation commits.** `6e8357c` — revisioned adaptive sessions and real MiniLM runtime. `4bd8e07` — discovery UI, map/account adapters, documentation and browser smoke script. This handoff and a README link correction are committed separately; use `git log -3 --oneline` for the final report commit. No commits touch main or the independent map branch.

13. **Commands actually run and results.**
    - `cd apps/web && npm test`: **258 passing tests, 23 files**, including engine, server mock integration, replay/stale responses, convergence fixtures, account/theme and existing app regressions.
    - `cd apps/web && npm run build`: **passed** TypeScript and production Vite build. Existing large-bundle warning remains (~1.23 MB JavaScript before gzip); no ineffective dynamic-import warning remains.
    - `cd pipeline && npm test`: initial run failed on missing worktree dependencies; after `npm ci`, **94 passed**. No pipeline source/schema changes.
    - `cd apps/web && node scripts/vibe-browser.mjs`: **18 passed checks** at 1440×900 and 390×844; no uncaught browser exceptions. Provider/vector requests are fixtures. Includes early finish, editing/truncation, neutral answers, correction, form/photo preservation, failure recovery, semantic retry, Clear all and mobile width.
    - Real Node MiniLM inference and real `/api/vibe/embed` HTTP requests passed, with model identity/dimensions/norm checked.
    - `git diff --check`: passed. Original map worktree status checked and preserved.
    - Live Gemini: **not run**. The requested `/Users/jdold/Desktop/vibenta_bostonhacks/.env` was still absent at the final credential check. No key was printed, copied into source or requested in chat.

14. **Remaining integration and exact next steps.** Create the promised root `.env` containing server-only GEMINI_API_KEY, open the preview and select Try AI again; the API reloads that file on generation/status requests. Then assess live multi-turn question quality for the six requested scenarios and opposite answer paths before claiming creativity acceptance. Separately, the catalog owner must verify/rebuild vectors using the documented exact fingerprint before enabling real pin ranking. Coordinate this main-based branch with `feature/map-ui-refinement` (which contains the earlier map UI/Saved/navigation work absent from main) and the PR #32 Composer branch; do not overwrite either. Account-backed sign-in/catalog behavior needs configured Supabase and was not live-provider verified here.

15. **Run/preview.** The feature preview currently runs at http://localhost:5174, with API on 8788; the previous map preview on 5173 is separate. Reproduce with:

```sh
cd /Users/jdold/Desktop/vibenta-vibe-engine-live/apps/web
npm ci
VIBENTA_ENV_FILE=/Users/jdold/Desktop/vibenta_bostonhacks/.env TRANSIT_API_PORT=8788 VITE_PORT=5174 npm run dev:all
```

Use the vibe step's **Refine this vibe** button. Tests/build need no Gemini key. For the fixture-only Chrome smoke test while preview runs:

```sh
node scripts/vibe-browser.mjs
```

Optional `VIBENTA_QA_URL`, `CHROME_PATH`, and `VIBENTA_QA_OUTPUT` configure that script. Browser report/screenshots are under `/private/tmp/vibenta-vibe-qa/` (`browser-results.json`, desktop-question/results.png, mobile-question/results.png). They are local QA artifacts, not committed assets. See `.env.example` for server/model/catalog configuration names without secrets.

Changed-file manifest:

- `.env.example`
- `apps/web/package-lock.json`
- `apps/web/package.json`
- `apps/web/scripts/vibe-browser.mjs`
- `apps/web/server/index.ts`
- `apps/web/server/miniLM.ts`
- `apps/web/server/vibeApi.ts`
- `apps/web/server/vibeGemini.ts`
- `apps/web/src/catalog.ts`
- `apps/web/src/discovery/ui/panel.ts`
- `apps/web/src/features/account/index.ts`
- `apps/web/src/features/vibe/README.md`
- `apps/web/src/features/vibe/__tests__/live.test.ts`
- `apps/web/src/features/vibe/__tests__/server.test.ts`
- `apps/web/src/features/vibe/adapters.ts`
- `apps/web/src/features/vibe/convergence.ts`
- `apps/web/src/features/vibe/evidence.ts`
- `apps/web/src/features/vibe/families.ts`
- `apps/web/src/features/vibe/liveEngine.ts`
- `apps/web/src/features/vibe/profile.ts`
- `apps/web/src/features/vibe/providers.ts`
- `apps/web/src/features/vibe/publisher.ts`
- `apps/web/src/features/vibe/ui/liveQuiz.ts`
- `apps/web/src/features/vibe/ui/quiz.css`
- `apps/web/src/features/vibe/validation.ts`
- `apps/web/src/features/vibeTheme/controller.ts`
- `apps/web/src/main.ts`
- `apps/web/src/style.css`
- `apps/web/vite.config.ts`
- `docs/CONTRACTS.md`
- `docs/DATA_MODEL.md`
- `docs/DECISIONS.md`
- `docs/EMBEDDING_PIPELINE.md`
- `docs/ROADMAP.md`
- `docs/VIBE_ENGINE_ARCHITECTURE.md`
- `docs/VIBE_QUIZ_DESIGN.md`
- `docs/ADAPTIVE_VIBE_ENGINE_HANDOFF.md`
