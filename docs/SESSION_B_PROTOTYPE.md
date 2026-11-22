# Session B prototype — implementation and handoff

Implementation location: `/private/tmp/vibenta-quiz-v2-session-b`, branch `feature/quiz-v2-session-b`, based on adaptive-engine commit `6c980e9`. No commits, pushes or merges made. The named live directory was on `design/visual-foundation-previews` with local changes; the main workspace had an in-progress merge. Both were left untouched. This isolated checkout is the runnable implementation, not a deployment into either team checkout.

## Behavior and scope

Enter **Coffee. Brain's fried.** in the existing vibe step and select **Start vibe quiz**. Punctuation/case/apostrophe variants work; other inputs keep the ordinary adaptive quiz. This is an authored bounded slice, not a general AI scene planner.

B1 presents original bakery and window-nook storyboards. Inspect/close previews and all B2 moment controls are disposable UI state: they never call `session.answer`, alter evidence, trigger embedding or re-rank pins. **Put me here** commits an actual existing choice response. The selected environment is derived from immutable history and displayed through generation, continuation and results.

B2 uses the chosen environment. Stay shows arrival → settling in → staying; leave shows arrival → outside. Only the bakery branch offers the optional Kiki text comparison. Its identity source is linked; no franchise media/set is used, and familiarity is not necessary. A B2 selection explicitly says **See matches**, commits its ordinary choice and calls the existing user-requested results action. Automatic stopping thresholds and ten-question cap are unchanged. Continue Refining remains the ordinary engine path.

Back/resume, history edit, correction, Skip, Neither, immediate matches and retry remain in the shared shell. Editing B1 discards obsolete B2 answers/summary checkpoints and derives a fresh branch. Free-text correction does not guess a scene from keywords; it returns to the ordinary contextual interviewer. New sessions clear preview state. Failed images show persistent scene descriptions and the same usable controls. All scene controls are native buttons with visible focus, 44px minimum targets and no motion requirement.

## Compatibility and interpretation

No changes to `profile.ts`, `Question`, `Response`, `OutingVibeProfile` 1.0.0, evidence semantics, MiniLM fingerprint, publisher, map/transit contracts or Composer files. No dependencies added.

A local `ScenePresentation` interface (`session-b-scene/1`) maps the three canonical versioned question IDs to scene-stage type, original storyboard asset IDs and branch-specific frames. Existing question IDs and option IDs retain scene/variation identity in history. Exact semantic question validation prevents the model from attaching registered imagery to altered prose or the wrong branch; JSON property order is irrelevant. Other questions retain existing validation rules. Existing clients can render these questions as ordinary described text choices without understanding the presentation registry.

Gemini receives the canonical authored next question alongside the existing context in its normal combined summary/question operation. It still produces the contextual `vibe_so_far`; there is no compulsory second request. The existing exceptional validation repair remains. Explicit option descriptions tell users what request they are committing; we do not infer personality or silently turn artwork details into fixed tags. Contextual model readings remain in the existing correctable summary, not a new class of explicit evidence. A new tentative-evidence/brief wire interface remains a proposal, not implemented.

When Gemini is unavailable, the authored B1/B2 questions still run and selected evidence reaches MiniLM; the last valid summary remains unchanged, with the existing fallback notice and an explicit “You chose” read-back. We do not label locally assembled text as a Gemini summary.

## Assets and sensory acceptance

See `apps/web/public/quiz-scenes/session-b-v1/manifest.json` for every original SVG's identity, SHA-256, creator/source inputs, date, status and remaining production work. Eight original code-native SVG storyboards are included: bakery/nook × arrive/settle/stay/leave. They are fictional functional placeholders, labeled in the UI; they are not approved final atmospheric art or Boston venue photos.

Read-only asset inspection found map texture/3D packs in the visual-preview worktree, and no public scene artwork in the adaptive-engine branch. Unrelated packs were not reused. No externally sourced image, franchise screenshot, generated bitmap or music asset is included.

Before sensory acceptance: produce coherent finished atmospheric artwork for both environments, retain the original camera/composition across beats, review alt text against the final files, update hashes/provenance, and repeat blocked-image/mobile review. The current storyboards establish functionality, not the promised finished visual experience.

## Verification

Commands run from `apps/web` unless stated otherwise:

- `npm ci --ignore-scripts`: installed existing locked dependencies, no manifest/lock changes. The existing native runtime was available for real inference.
- `npm test -- --reporter=dot`: **312 passed, 25 files**. Includes both branches × stay/leave with online fixture and offline generation, replay/edit, free correction, neutral B1/B2 actions, immediate exit, single Gemini operation, canonical identity/asset hashes and stale generation/inference. HTTP tests require localhost binding; the initial sandbox-only attempt failed with EPERM, then the suite passed with permitted local binding.
- `npm run build`: TypeScript + production Vite build passed; existing >500 kB bundle warning remains.
- `node scripts/session-b-browser.mjs`: **77/77 checks passed**, focused desktop/390px browser matrix, with explicitly mocked generation/vectors and no fabricated venue rankings. Detailed counts/artifacts are in `/private/tmp/vibenta-session-b-qa/session-b-results.json`; screenshots are beside it. Browser harness failures during development were corrected before the final run; failed runs are not acceptance evidence.
- `VIBENTA_QA_URL=http://localhost:5176/ VIBENTA_QA_OUTPUT=/private/tmp/vibenta-session-b-legacy-qa node scripts/vibe-browser.mjs`: **23/23 existing browser checks passed**, fixture providers/vectors. This validates ordinary quiz regressions, not real Gemini quality or venue matches.
- `node scripts/session-b-real-minilm.mjs`: **all four real session paths passed** against pinned `Xenova/all-MiniLM-L6-v2` revision `751bff37182d3f1213fa05d7196b954e230abad9`, fp32, mean pooling, L2. Every final vector has 384 dimensions, unit norm and the current session revision. Bakery/stay versus nook/leave cosine was **0.7019363529421329**. Report: `/private/tmp/session-b-real-minilm.json`. Real inference initially failed under restricted network/cache validation; it passed with network access. No venue vectors or Gemini are used in this check.
- `git diff --check`: passed.

### Unverified integration gates

No root `.env` exists in either referenced checkout or this isolated checkout. The actual API status reports `geminiConfigured: false`. Live Gemini creativity, compatible real catalog matching, human-reviewed top-five relevance and real supported transit route rehearsal were **not verified**. The existing catalog adapter remains disabled without owner-confirmed exact-model provenance/configuration. Browser checks assert unavailable/empty ranking in this condition; synthetic vectors are never presented as real catalog verification. Real MiniLM differences alone do not prove useful Boston recommendations.

The unchanged existing publisher and scene/theme/map adapters receive the actual profile. Preview-only behavior is verified separately from committed state; venue prominence still requires genuine compatible catalog data. No illustrative route, moved coordinate, fake crowd, venue availability or claimed seating policy was added. Existing transit/coordinate tests run as part of the suite, but no new live-provider itinerary was claimed.

## Session A follow-up — plan only

1. After an actual song selection, ask for or retain the user's selected reason. The recording's identity is not the reason. Preserve correction and own-word paths.
2. Retrieve candidate original visuals from that reason plus the emerging vibe. The same song can lead to shared-food connection, anonymous city space, or physical energy; fries are only one possible shared-connection branch. The isolated specification now makes this explicit.
3. Prototype one comparison with original art and two documented original audio cues; distinguish this from recognizable-song playback. No provider integration is implemented here.
4. Verify exact recording availability and permission for the intended standalone quiz use before introducing any recognizable player. Verify separate audiovisual pairing rights before combining that recording with scene images. A successful embed is not pairing clearance.
5. Evaluate opposite reasons for the same recording and unfamiliar/unavailable paths before creative acceptance. Preserve a useful silent continuation, labeled as such. Only a cleared recognizable pairing can meet that part of the flagship target.

## Exact next integration step

Review the isolated prototype using the short input above and approve/replace the temporary art. The catalog owner then confirms/rebuilds real vectors with the exact pinned fingerprint and configures the existing catalog connection in this checkout; the API owner supplies server-side Gemini configuration privately. Run section 8's two contrasting real-catalog top-five checks and the supported real transit handoff before claiming full integrated acceptance. Coordinate carrying these uncommitted files into the team's eventual integration branch; do not overwrite either active team checkout.

## Changed-file manifest

- `apps/web/public/quiz-scenes/session-b-v1/bakery-arrive.svg`
- `apps/web/public/quiz-scenes/session-b-v1/bakery-leave.svg`
- `apps/web/public/quiz-scenes/session-b-v1/bakery-settle.svg`
- `apps/web/public/quiz-scenes/session-b-v1/bakery-stay.svg`
- `apps/web/public/quiz-scenes/session-b-v1/manifest.json`
- `apps/web/public/quiz-scenes/session-b-v1/nook-arrive.svg`
- `apps/web/public/quiz-scenes/session-b-v1/nook-leave.svg`
- `apps/web/public/quiz-scenes/session-b-v1/nook-settle.svg`
- `apps/web/public/quiz-scenes/session-b-v1/nook-stay.svg`
- `apps/web/scripts/session-b-browser.mjs`
- `apps/web/scripts/session-b-real-minilm.mjs`
- `apps/web/server/vibeGemini.ts`
- `apps/web/src/features/vibe/README.md`
- `apps/web/src/features/vibe/__tests__/sessionB.test.ts`
- `apps/web/src/features/vibe/liveEngine.ts`
- `apps/web/src/features/vibe/sessionB.ts`
- `apps/web/src/features/vibe/ui/liveQuiz.ts`
- `apps/web/src/features/vibe/ui/quiz.css`
- `apps/web/src/features/vibe/ui/sceneStage.ts`
- `apps/web/src/features/vibe/validation.ts`
- `docs/SESSION_B_PROTOTYPE.md`
- `docs/VIBE_QUIZ_V2_SPEC.md`
