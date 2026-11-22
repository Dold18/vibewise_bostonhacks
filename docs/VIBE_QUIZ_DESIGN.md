# Adaptive outing quiz — accepted implementation

Status: user-approved refinement of PR #35, 2026-11-21. Supersedes its fixed-ten length, completion-only embedding, and scene-consumer exclusions. Question generation remains independent of venues. No alternate feature-tag catalog or CLIP space is introduced.

## Session and generation

The existing two-step outing form owns practical constraints and browser-local photos. An explicit **Refine this vibe** action starts or resumes a separate outing session. Photos remain local and are not analyzed. The legacy seven-axis engine remains for compatibility tests; it does not drive this UI.

The canonical executable contract is `apps/web/src/features/vibe/profile.ts`: `OutingVibeProfile`, schema 1.0.0. It contains session ID, monotonically increasing revision, original input, current `vibe_so_far`, explicit evidence with provenance/polarity, unresolved qualifiers, immutable history, question families/topics, completion state, and embedding identity/status/revision. Gemini interpretation is recorded as a generated summary checkpoint, not promoted into explicit evidence. Practical preferences and persistent account taste remain separate.

One server-side Gemini operation returns a validated summary, optional next question, qualifiers, and qualitative continuation advice. Every option has an ID, descriptive label and explanation; there are 2–4 options. The initial operation uses original text with zero venues. Credentials never enter browser code. Requests have bounded input/output, deadlines, concurrency/rate limits, runtime validation and one quality-repair attempt. No raw prompts are logged.

## Creativity and non-repetition

`families.ts` contains sixteen extensible families with two creative examples each: cinematic worlds, soundtracks, doorways, objects, sensory metaphors, opening scenes, unexpected discoveries, emotions, dealbreakers, weather, photographs, characters, games, literature, social stories and original formats. Each turn offers Gemini five varied families plus unresolved semantic topics, using history and explicit evidence. This is not a fixed family sequence.

Validation rejects repeated IDs/prompts/topics, consecutive families, generic bipolar questions, near-identical options, and known crowd-exclusion contradictions. Cultural references include descriptive alternatives. Following unfamiliarity, the next question must be culturally neutral. Topic and word-overlap guards are conservative heuristics, not proof of semantic novelty; live quality review is still required.

## Variable length and replay

Target 3–4 informative answers for straightforward outings; absolute maximum ten. **Show My Matches** is available from the initial loading state. **Continue Refining** remains available while topics and capacity remain. Early completion requires at least three informative responses, a specific summary, no unresolved qualifiers, and Gemini's qualitative recommendation or stability across three real embeddings. Stability alone cannot finish a vague session. Completion records user request, sufficient detail, stability with specificity, exhausted topics, or maximum. No confidence percentages.

Chosen answers add explicit evidence. Unchosen answers, Skip, Neither and unfamiliarity never become dislikes. Explicit exclusions are retained outside the summary and included in embedding input. Corrections replace active evidence on the same recognized topic, or explicitly retract selected evidence IDs. Recognition is intentionally conservative and cannot understand every natural-language contradiction.

Editing answer N truncates later history, reconstructs evidence and the last accepted summary checkpoint, and generates from that valid prefix. Abort plus session/revision guards invalidate obsolete generation and embedding work. Original prose/history remain immutable for review. Session state is in memory, not persisted to accounts or storage.

## Failures and live consumers

On generation failure, use a culturally neutral creative local fallback; preserve the previous valid summary unchanged, retain pending answers, and include all retained history on retry. On embedding failure, publish unavailable rather than a fabricated vector. Text-based refinement continues.

After each successful summary, request the pinned MiniLM embedding asynchronously. A single publisher emits frozen complete snapshots to summary/DNA UI, recommendations and the scene adapter. See [EMBEDDING_PIPELINE.md](EMBEDDING_PIPELINE.md).

The PR #32 SceneIntent adapter carries the same profile/revision and existing palette descriptors; presets and overrides remain empty because the proposed Composer renderer/assets are not implemented in main. Existing theme preview observes navigation > active outing > saved account taste > default. Provisional answers never call account `recordVibe`.

Semantic convergence consumes only currently eligible, compatible real catalog vectors; full candidate IDs and geographic coordinates remain intact. Weaker pins can shrink/hide reversibly, with Show all places. Search/navigation and the selected destination are protected. Missing compatible venue vectors leave map pins unchanged. Fixture tests are not live venue recommendations.

## Verification and remaining dependencies

Run `npm test` and `npm run build` in `apps/web`. `live.test.ts` covers replay, evidence, completion, stale responses, publisher/scene contracts and labeled fixture ranking; `server.test.ts` covers bounded HTTP endpoints, Gemini schema/repair/timeouts and embedding cache behavior without paid calls. Live Gemini quality requires a server-side GEMINI_API_KEY. The real local MiniLM runtime requires model download/cache and approved native dependencies. Catalog provenance and Composer integration remain owned by their workstreams.
