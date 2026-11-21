# Vibe Engine — Embeddings, Candidate Ranking & Adaptive Questions

> **Status: design proposal, not yet implemented.** Companion to [VIBE_QUIZ_DESIGN.md](VIBE_QUIZ_DESIGN.md).  
> **Product requirement:** After **every quiz answer**, update the user's semantic preference representation, re-rank real place candidates, update the Living Map, and choose a question that would most usefully separate the remaining candidate venues. Typical 3–4 questions; absolute maximum **10**, with early exit and optional continued refinement.
>
> **Implementation boundary:** This is a planned replacement/extension of the seven-axis scaffold in PR #23, not a claim that embeddings or active learning are currently implemented.

## 0. Executive architecture

```text
PLAN FORM (hard constraints: category, starting point, time, budget)
        +
USER PROMPT (text / optional images / media references)
        ↓
EXTRACTOR (grounded textual/visual scene signals and exclusions)
        ↓
SESSION MODEL (positive+negative semantic embedding channels;
               structured signed facets; immutable answer history)
        ↓
HARD CONSTRAINTS + PLACE RETRIEVAL (verified Boston catalog,
                                    precomputed place embeddings/facets)
        ↓
RERANK (semantic similarities + facet coverage + qualified feasibility)
        ↓
MAP (show leading candidates, never silently lose viable venues)
        ↓
QUESTION POLICY (choose high-discrimination option set from current
                 contenders; penalize redundancy/unfamiliarity/effort)
        ↓
USER ANSWERS → append event → rebuild/update preference vectors and facets
             → rerank every place → update map → choose next question
             ↳ stop early or continue, never beyond 10
```

**Crucial distinction:** The questions should distinguish among *currently plausible real destinations*, not merely estimate a user's position on seven general lifestyle axes.

## 1. Collecting useful place data

We can't rank *aesthetic experiences* accurately from generic OSM categories alone. The map team already consumes real places, but the vibe engine needs a separate, verifiable description for each place.

Proposed per-place enrichment:

```ts
interface PlaceVibeIndexRecord {
  placeId: string;                         // same canonical Place ID as the map
  description: string;                    // sourced or editorially described, not invented facts
  scenePhrases: string[];                 // "dim brick interior", "waterfront view", ...
  facets: Partial<Record<VibeFacetId, number>>; // 0..1 degree of applicability
  facetProvenance: Record<string, { source: string; verifiedAt?: string }>;
  embedding: number[];                    // precomputed, normalized same-model vector
  aspectEmbeddings?: Record<string, number[]>; // future: architecture/music/social/etc.
  embeddingModelId: string;               // invalidate/recompute on model change
}
```

- Keep Place facts (ID/location/category/address) in the **canonical catalog**. This index adds *vibe* evidence, it is not another map Place definition.
- Initially annotate **20–30 varied verified places**; a small truthful corpus beats hundreds of generic entries.
- Descriptions should emphasize the *experience*: light, architecture, music, social character, activities, sensory atmosphere, surroundings. Separate objectively verifiable facts from subjective editorial interpretation; unknown remains unknown.
- Generate embeddings **once offline/build-time** for place descriptions and reusable question-option descriptions. Cache by model/version/content hash. Update only when source text changes.
- For authorized place images: either extract a scene description then embed text, or use a valid **joint image/text embedding model**. Do not cosine-compare unrelated models' vector spaces.
- Keep a few differently curated places with overlapping generic tags (two cafés could feel dramatically different), or the active quiz will have nothing meaningful to distinguish.

For 20–200 places, a simple in-memory typed-array/vector search is sufficient and easier to debug than a vector database. Move to a database/vector index only when scale or latency requires it.

## 2. What we store about the user

**Don't compress a multi-faceted request into one undifferentiated vector.** A user could desire a lively neon street, quiet conversation, and dislike fancy dress codes simultaneously.

Proposed **session-scoped** state:

```ts
type VibeFacetId = string;                 // frozen curated vocabulary, versioned
type EvidenceOrigin = "initial_text" | "photo" | "media_reference" | "quiz_answer";

interface VibeEvidence {
  id: string;
  origin: EvidenceOrigin;
  sourceId?: string;                      // questionId/optionId or source reference
  description: string;                   // natural-language meaning, not just a title
  polarity: "want" | "avoid";
  weight: number;                        // heuristic strength, never probability
  facetDeltas: Partial<Record<VibeFacetId, number>>;
  embeddingId?: string;                  // resolve via precomputed/vector cache
}

interface VibeSessionState {
  originalText: string;
  evidence: VibeEvidence[];               // immutable append-only, or rebuilt from answers
  answeredQuestionIds: string[];
  // Derived, not independently mutated:
  positiveEmbedding: number[];
  negativeEmbedding?: number[];
  facets: Partial<Record<VibeFacetId, number>>; // signed [-1, 1]
  rankedPlaceIds: string[];
  questionCount: number;
}
```

Place data, location, budget and time remain outside this session in the canonical practical preferences. Do not overwrite or duplicate those constraints in the vibe module.

Suggested initial treatment:
- Extract **positive descriptions**, **explicit exclusions**, and **specific named references** separately; preserve original user wording.
- A liked song does **not** imply disliked unchosen songs. An explicit dealbreaker *does* add a negative signal.
- Recognized film/song names can use curated reference descriptions or a validated interpreter; simply embedding a title is often insufficient to capture the user's intended scene. Ask *which part* of the film they mean.
- Audio snippets are an optional aid to choosing; hitting Play is **not** a preference event and should not alter rankings.
- If a user goes Back and changes an earlier answer, reconstruct the derived profile from the original input plus the retained/current answers, avoiding cumulative vector drift or double counting.

## 3. Embedding update after every answer (fast path)

**Requirement:** a preference-vector update occurs on each chosen answer, but a **fresh external embedding API request on every click is unnecessary**.

### Initial prompt
1. Receive prompt and optional authorized image analyses.
2. Extract explicit wants/avoids and grounded natural-language descriptions.
3. Embed the meaningful **descriptive phrases** using one versioned text embedding model.
4. Build two semantic channels: `uPositive` and `uNegative`, plus signed structured facet scores.

### Every quiz choice
1. Each reusable question option has **precomputed** semantic-description embedding and curated facet deltas.
2. User chooses option `x`.
3. Append `VibeEvidence` with answer provenance. Do **not** treat unselected options as negatives.
4. Recalculate profile from initial evidence + all current answers:
   - `uPositive = normalize(sum(w_i * e_i) for positive evidence)`
   - `uNegative = normalize(sum(w_j * e_j) for avoid evidence)`
   - `facets = combine_signed_deltas_with_explicit_answer_priority(...)`
5. Re-rank the viable catalog immediately using cached place embeddings.
6. Update pin prominence/cards and select the next question **from the new ranking**.

A **new/free-text** answer or genuinely new AI-generated option may need an embedding API call; temporarily update facet scores and then re-rank again when that embedding resolves. Prevent old async responses from overwriting newer session versions.

Use preference evidence weighting (initial prose and answers can be weighted differently), but **do not simply average everything with equal weight**: explicit refinements should have more authority than weak speculative interpretations. Calibrate heuristic weights on curated scenario tests.

### Where to use an LLM or on-demand embedding
- **Initially:** one optional server-side extractor+embedding pass for arbitrary initial text and opt-in images. Missing interpreter falls back to existing keyword/curated-tag logic.
- **Per answer:** pure local deterministic vector + facet update from cached question-option embeddings; no LLM required.
- **Occasionally:** if text contains novel unrecognized cultural context, a bounded semantic interpreter can resolve it asynchronously. LLM output must conform to valid feature/attribute IDs and not assert unsupported place facts.
- **Never:** block every question on a freshly generated AI paragraph or upload user photos without explicit consent/notice.

## 4. Candidate scoring and narrowing

Two distinct operations:

### A. Genuine hard constraints
Apply the already selected category, requested time and budget **only when reliable data supports the filter**. Unknown pricing/hours/transit feasibility must remain **unknown**, not silently fail an inferred constraint. Location and transit cost/travel time must use the map/transit providers' actual supported outputs.

### B. Soft vibe ranking
For each viable place, compare:
- **Positive semantic similarity:** cosine of `uPositive` and its place embedding.
- **Negative semantic penalty:** separate `uNegative` similarity; exclusions can have high influence.
- **Structured facet agreement:** curated scene attributes versus signed wishes/avoids, weighted by evidence and coverage.
- **Feasibility adjustment:** only when genuinely known; unknown is shown, not fabricated.

Illustrative starting formula (**unvalidated weights; tunable in tests**):

```ts
vibeScore(place) =
    0.55 * positiveSimilarity(userPositive, place)
  - 0.20 * negativeSimilarity(userAvoid, place)
  + 0.25 * knownFacetAgreement(userFacets, placeFacets);

// Feasibility applied afterward (known true/false/unknown),
// not hallucinated into the semantic embedding.
```

Normalize individual score components to compatible ranges, and **renormalize or omit missing components** instead of treating them as zero-valued dislikes. Strong explicit exclusions can be handled as exclusions only when objectively checkable; otherwise penalize the known matching venue trait.

**Don't permanently discard low-ranked places as the quiz continues.** Keep the full *eligible* catalog in memory. Show a prominent Top 5 and compute question utility over approximately Top 15–25; answers may bring previously weak candidates back into view. A user's changed answer must be reversible.

## 5. How to choose the *next* question

Question selection must depend on the remaining *places*, not just the profile's weakest generic dimension.

Given weighted current top candidates `C` and unasked library question `q` with options `a1..ak`:

1. Simulate each possible answer **without changing the live session**.
2. Apply the option's precomputed semantic/facet evidence.
3. Re-rank `C` (and ideally full eligible catalog) under each simulated answer.
4. Estimate **how much the plausible top results differ** across answers. Favor questions capable of changing top places or ranking order, not questions that barely affect anything.
5. Require relevance: an art-gallery question isn't meaningful if none of the leading candidates is an art-gallery-like experience and its answer would not discriminate.
6. Add small preference for cultural variety and unanswered uncertainties; penalize highly similar recent questions, obscure unfamiliar references, inaccessible media, and interaction cost.
7. Choose highest-utility question; if all available questions have negligible utility, recommend early.

```ts
questionUtility(q) =
    expectedCandidateSeparation(q, currentCandidates)
  + clarificationValue(q, userEvidence)
  + contextualRelevance(q, originalPrompt)
  + formatVarietyBonus(q, recentQuestions)
  - repetitionPenalty(q, questionHistory)
  - familiarityOrEffortCost(q);
```

For MVP, use a **deterministic proxy** for expected separation, such as variance in top-place scores and how top-five membership changes under competing options. We **do not** have a learned model of which response a user will choose, so this is **not genuine Bayesian information gain**, and the quiz shouldn't imply statistical certainty.

Later, if we collect consented answer/candidate feedback, learn response likelihoods `P(answer | user state, question)` and calculate true expected entropy or ranking-value reduction.

### A worked example
Current text: **“late-night neon, cinematic, but quiet enough for two people to talk.”**

Top hypothetical venue classes (not factual Boston recommendations):
- neon arcade: excellent electric/cinematic, poor conversation fit;
- intimate dim café: excellent conversation, weaker neon;
- atmospheric cocktail lounge: plausible both.

Unanswered contrast: **visually striking public atmosphere vs. private conversation**.

High-value question:
> “You find two hidden doors in the city. Which one would you open?”
> - “A buzzing, neon-lit arcade with music and strangers” (energy↑, crowd↑, neon↑)
> - “A dim, intimate room with music just below conversation level” (intimate↑, quiet↑, low-light↑)

Either answer changes how the **same** three contenders rank. This is far more useful than asking “Vintage or modern?” just because that axis is unfilled. Next question depends on the actual new shortlist.

## 6. Keeping the quiz short

- **Typical target:** ~3–4 questions (hypothesis to validate), with 30–45 seconds of active interaction as a design goal, **not a guaranteed completion time**.
- **Hard maximum:** 10 questions. A question bank of seven unique questions cannot satisfy this, so PR #23 must be expanded/superseded.
- **Show my matches:** always available and immediate.
- **Stop early** if (i) the user exits, (ii) no question materially distinguishes the current plausible top places, or (iii) top recommendations are stable after successive responses. Use heuristics initially, not fake probabilistic confidence.
- **Continue refining:** available even after provisional recommendations, until 10 total questions, if there are still meaningful distinctions to explore.
- **Do not force a song question** when clicking an authorized preview would slow down an otherwise resolved outing. A song option should be understandable without listening.

## 7. Minimal implementation interfaces (proposed)

```ts
interface VibeEngineInput {
  practicalPreferences: unknown;            // read existing typed InitialPreferences in adapter
  initialText: string;
  imageDescriptorIds?: string[];             // resolved only after authorized analysis
}

interface RankingUpdate {
  sessionVersion: number;
  ranked: Array<{
    placeId: string;
    score: number;
    matchedSignals: string[];
    missingEvidence?: string[];
  }>;
  nextQuestion: CandidateQuestion | null;    // from VIBE_QUIZ_DESIGN.md proposal
  shouldRecommend: boolean;
  reason: "still_discriminative" | "stable" | "low_information" | "max_questions" | "user_exit";
}

interface VibeAnswerEvent {
  questionId: string;
  optionId?: string;
  response: "selected" | "either" | "skip" | "unfamiliar";
  sequence: number;
}

// Pure functions: test with fixed fixtures, no provider/network dependency.
function deriveVibeProfile(base: VibeEngineInput, history: VibeAnswerEvent[]): VibeProfile;
function rankEligiblePlaces(profile: VibeProfile, places: PlaceVibeIndexRecord[]): RankingUpdate["ranked"];
function chooseNextQuestion(profile: VibeProfile, ranked: RankingUpdate["ranked"], asked: Set<string>): CandidateQuestion | null;

// Coordinator owns async requests and maps sessionVersion to avoid stale results.
```

These are **conceptual interfaces**; they deliberately do not redefine the canonical `Place`, `TransitRequest`, or `TransitResponse` contracts.

## 8. MVP execution order

1. **Index quality before clever algorithms:** verify/source 20–30 varied Boston venue descriptions and curate around 25–35 scene features. Agree same feature IDs on both sides.
2. Precompute one embedding per venue and per question option, versioned. Include a keyword/facet fallback if embeddings are unavailable.
3. Build a **pure local update pipeline**: choose predefined option → append event → update preference vectors/facets → rerank all eligible venues. Unit-test that opposite answers produce different relevant venue rankings and aren't irreversible.
4. Add a **small question bank (12–16)** across song, film, original/permissioned visual, object/metaphor and dealbreaker forms. Each option has curated signals, accessible text and precomputed semantic description.
5. Implement candidate-discrimination selection and no-repeat/history limits.
6. Connect to the existing vibe step and map renderer via an **approved adapter only**; map shouldn't own embedding computation.
7. After the loop works: opt-in image-to-scene interpretation, broader reference catalog, dynamic question phrasing and richer provider-native music previews.

## 9. Tests and telemetry

### Tests before visual polish
- Two opposite descriptions rank a deliberately varied fixture catalog differently.
- Selecting the left/right response causes different *candidate-place rankings*, not just different labels in a profile.
- Reversing an earlier answer reproduces the same scores as a clean rebuilt session.
- Explicit “not crowded” doesn't become “crowded” when averaged with an unrelated positive preference.
- Skip/unfamiliar is neutral; **unselected songs are not negative**.
- All candidates are ranked from verified IDs; map never receives a newly invented venue ID.
- Empty/ambiguous input still gives a reasonable first question.
- Repeated questions or semantic duplicates excluded; never exceed **10**.
- A contextual question can win over a generic one because it separates actual candidate venues.
- Delayed embedding/media API response from an earlier answer can't overwrite a newer result.

### Optional privacy-conscious learning from real users
With appropriate disclosure and consent, record *minimal anonymous session events*: question ID/family, selected option, rank movement, skip/unfamiliar rate, eventual place selection and whether the suggestion was useful. Avoid retaining raw images, private locations or complete free-text prompts as default behavioral telemetry. Aggregate only when sample size justifies it.

Use data to measure:
- recommendation usefulness after 1, 2, 3, 4... questions;
- fraction of questions skipped and mean time per question family;
- change in top-5 rank ordering after each answer;
- user willingness to continue vs. stop;
- whether question choice improves result quality over a random or fixed-question baseline.

**Product metric:** incremental recommendation quality **per question / per second**, not number of questions asked.

## Notes on evidence
Conversational recommendation literature recognizes active preference elicitation, user interaction cost, and item-aware question selection as central concerns; these motivate the architecture but **do not validate our chosen weights or stopping thresholds**:
- https://www.sciencedirect.com/science/article/pii/S2666651021000164
- https://ieeexplore.ieee.org/abstract/document/10650365
- https://pmc.ncbi.nlm.nih.gov/articles/PMC9038518/
