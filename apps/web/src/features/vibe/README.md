# Vibe Quiz Engine (headless v0)

**Status:** Independent engine for the first Akinator-style discovery milestone. Not wired into the discovery panel or map yet. The photo uploader in `discovery/ui/vibeStep.ts` stores browser-local `File[]` and does **not** analyze images.

## What this already does

1. Read the user's `vibeText` and identify **tentative keyword clues** along seven bipolar outing dimensions:
   - energy (calm → electric)
   - social (intimate → bustling)
   - setting (indoor → outdoor)
   - lighting (dim → bright)
   - aesthetic (vintage → modern)
   - formality (casual → upscale)
   - outing (stay and relax → explore and try things)
2. Simple negation support (e.g., "not too fancy", "avoid crowds"). It is deliberately **not** a full natural-language understanding system; arbitrary movie titles, artists, songs and images receive no fabricated inferred meaning.
3. Pick the next question based on unresolved or contradictory dimensions, not a permanently fixed sequence. Limit the first session to **four questions**, with `left`, `right`, `either` and `skip` responses.
4. Return normalized [0,1] axis tags and a separate **heuristic** evidence-strength score; an explicit answer overrides text-based inference for that dimension. This is not a measured probability of accuracy.

## Minimal integration API

```ts
import {
  startVibeQuiz,
  nextVibeQuestion,
  submitVibeAnswer,
  vibeQuizSnapshot,
} from './features/vibe/engine';

let session = startVibeQuiz(prefs.vibeText, 4);
let question = nextVibeQuestion(session);
// Display question.title, .left and .right using cards.
// Provide "Either / no preference" and "Skip" actions.
if (question) {
  session = submitVibeAnswer(session, question.id, 'left');
  question = nextVibeQuestion(session);
}
const { tags, evidenceStrength, complete } = vibeQuizSnapshot(session);
```

The UI should keep `session` independent from `InitialPreferences` until the team agrees on a shared `DiscoveryState` and ranking adapter. Avoid a second source of truth for origin/budget/time. This module **does not** write the map, route, place catalog, or shared data contracts.

## Architectural decisions for a later PR

- **Question visuals:** The current bank returns text labels only. Use properly sourced photos or original illustrations later, with independent image-license checks. A question can become a left/right image comparison without changing its `axis` or `id`.
- **Source interpretation:** Introduce an AI interpreter only after v0 has a working demo. It should return axis estimates with provenance, uncertainty and validity checks, rather than arbitrary unstructured venue choices. Images stay private unless the user authorizes upload to a specific service.
- **Better Akinator questions:** Replace the current uncertainty heuristic with expected information gain over the actual viable place catalog, once destinations have reliable vibe dimensions. Don't claim v0 computes formal information gain.
- **Venue rankings:** Map normalized axes to an explicitly approved place-attribute schema, incorporate evidence strengths, then preserve hard budget/time/transit constraints. A weak text guess must not outweigh a user's explicit choice.
- **Reviewability:** Include Back/Edit/Skip and stop early when user wants recommendations. Never force all seven questions.

## Tests

```sh
cd apps/web
npm test
npm run build
```

Tests live in `src/features/vibe/__tests__/engine.test.ts`; run them locally or in CI before merging. Unit tests cover opposite moods, simple negation, conflicts, blank/media-only text, question priority, four-question cap, no repeats, skip/either, answer overrides and immutable session updates.
