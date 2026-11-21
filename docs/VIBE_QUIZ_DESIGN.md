# Vibe Convergence Quiz — Interactive Discovery Design (Proposal v1)

> **Status: proposed, not approved for implementation.** Product direction from project lead, November 21, 2026.  
> **Related:** [PRODUCT](PRODUCT.md) · [CONTRACTS](CONTRACTS.md) · [ROADMAP](ROADMAP.md) · GitHub PR #23 (initial headless seven-axis prototype), PR #20 (updated form).  
> **Goal:** Akinator-style progressive inference of a user's desired *real Boston experience* using artful questions spanning film, television, music, photography, objects, metaphor, social situations, and sensory details.

## The change in direction
The existing headless prototype has seven bipolar traits and a mostly fixed seven-question bank. **This is only scaffolding.** The final experience must not feel like a conventional personality quiz or repeatedly ask obvious questions such as “Calm or energetic?”

Ask the **most discriminative question at each step**, preferably expressed through a memorable cultural or sensory reference, and continuously update the *same* Living Map. Aim to refine the scene the user wants to inhabit, not to label the person.

For example, after “I want something like the city nights in Blade Runner 2049, but somewhere to talk with a friend,” ask *which element* matters: rain/neon streets, skyline/architecture, synthy music, or an intimate hidden booth—not whether the user generally prefers indoor places.

## Experience contract
1. **Inputs:** prior practical choices (category, origin, budget, time); free text; optional uploaded images; potential user-supplied movie/song names.
2. **First inference:** derive tentative aesthetic/sensory/experiential signals, showing uncertainty. Known media references may be resolved from a curated catalog, not assumed to have been played/analyzed.
3. **Question:** show one clear, lively and relevant question using 2–4 answer choices (text, licensed/original images, named media references, moodboards, etc.). Always include `Neither / something else`, `I don't know these` when relevant, `Skip`, and an optional `Show matches` exit.
4. **Update:** infer both positive and negative preference shifts from the answer, retain provenance, and re-rank viable Boston places.
5. **Feedback:** visually de-emphasize weaker map pins and promote stronger options; show useful explanations such as “More atmospheric and low-key, less formal.” Do not invent a venue's aesthetic if its data lacks evidence.
6. **Next:** re-evaluate candidate places and choose the next question *based on remaining ambiguity and expected discrimination*, not a static sequence. Avoid duplicate question meaning and repeated formats.
7. **Stop:** recommend when user chooses, after diminishing information gain, or after a soft limit (target 3–7 questions; hard cap TBD). Don't force every dimension.

## Question families: broad and esoteric but interpretable
The question form is the *presentation*; answer options are grounded in semantic signals. The question library should contain multiple distinct forms:

| Family | Example prompt | Options and what is learned |
|---|---|---|
| Film / TV worlds | “Which cinematic world would you step into tonight?” | *Chungking Express* street-level neon / *Amélie* quirky Paris / *Grand Budapest Hotel* polished maximalism — each maps to curated aesthetic tags. Text alternatives required. |
| Soundtrack / songs | “Which song would you put over this scene?” | *Space Song* (Beach House) / *Midnight City* (M83) / *Electric Feel* (MGMT) — internally curated mood signatures; don't require unlicensed playback. |
| Original/permissioned image pairs | “Which scene feels closer?” | Quiet candlelit corner vs rain-lit arcade; captions and descriptive alt text. |
| Surreal/fictional locations | “Which door are you opening?” | An ivy-covered bookshop / underground arcade / observatory with a city view / empty garden courtyard. |
| Objects and textures | “What belongs in the frame?” | Vinyl records + old books / chrome + blue LEDs / sun-faded Polaroids + flowers / mismatched arcade tokens. |
| Sensory metaphor | “What should the night smell/sound like?” | Rain on asphalt / fresh bread / ocean air / wood and old paper; option features carry mood and setting signals, not literal venue-smell claims. |
| Opening-credit sequence | “What would the first shot look like?” | Wide city skyline / crowded street food stall / close-up of candles in a booth / someone walking into a wooded park. |
| Anticipation / story | “What kind of unexpected thing would feel right?” | Finding a hidden room / hearing live music / stumbling into an exhibit / wandering without a destination. |
| Emotion / atmosphere | “What should linger when you leave?” | Excitement / wonder / comfort / beautiful melancholy. |
| Dealbreakers | “What would break the spell?” | A packed crowd / silence / overly polished decor / nowhere to sit. Explicit negative signals can be high-value. |
| Counterfactual | “Suppose the weather shifts. Which scene is *still* appealing?” | Warm interior refuge / dramatic rain walk / vibrant indoor gathering / bright covered market. |
| Playful oddities | “Which photograph would you keep from the night?” | Grainy disposable-camera crowd / minimal architectural shot / dreamy skyline reflection / close-up of a record shop. |

**Examples are hypotheses for catalog design, not guarantees that users recognize particular media.** Use pop culture as a meaningful vocabulary for aesthetic comparison, not a random reference inserted for novelty.

### How to avoid repetitive questions
- Rotate presentation families when usefulness is similar; not three consecutive “which movie” questions.
- If a person explicitly references an artist/film, preferentially ask about **aspects** of that reference.
- If a person doesn't recognize a film/song, present a one-line descriptive alternative and let them skip. Do not equate lack of recognition with rejecting its vibe.
- Contrast answers that are *different on the unresolved factor* while holding understood preferences roughly constant.
- Prefer nuanced comparisons once broad ambience is known, e.g. “rainy neon street vs intimate synth-lit hideaway” rather than “old vs modern.”

## Data model: beyond seven bipolar traits
Represent the user's temporary **desired scene**, not personality.

Start with an **interpretable, multi-label feature space**; traits are not always mutually exclusive (a venue may be both historic *and* lively). Proposed groups:
- **Sensory:** lighting (amber, neon, natural, candlelit), sound (quiet, live, bass-heavy, acoustic), visual density (minimalist/maximalist), texture (industrial, soft, weathered).
- **Emotion:** nostalgic, mysterious, playful, contemplative, romantic, exhilarating, surreal, comforting, rebellious.
- **Setting:** urban, waterfront, wooded, hidden, open-air, enclosed, panoramic, underground, historic, futuristic.
- **Social:** intimate, communal, crowded, solitary, conversation-friendly, performance-oriented.
- **Behavior:** wander, sit, eat, make, watch, dance, explore, discover, photograph.
- **Style:** polished, gritty, elegant, DIY, whimsical, retro, contemporary, cinematic.

Aim for an **initially curated set of ~25–35 feature IDs**, with an explicit strength, polarity (desired/avoid), provenance and provisionality. Retain the seven coarse axes from PR #23 only as a **compatible baseline**, not as the whole model. The actual feature vocabulary and mappings require validation against the available Boston places.

Illustrative internal shape (do not change existing shared contracts without review):

```ts
type VibeSignal = {
  featureId: string;           // e.g. "neon", "intimate", "conversation_friendly"
  preference: number;          // -1 dislike/avoid ... +1 want
  weight: number;              // heuristic evidence weight, NOT calibrated probability
  source: "text" | "image" | "media_reference" | "quiz";
};

type QuestionKind =
  | "cinematic_world" | "song_choice" | "image_pair" | "moodboard"
  | "metaphor" | "object_choice" | "scenario" | "emotion" | "dealbreaker";

type QuestionOption = {
  id: string;
  label: string;
  description?: string;        // accessible even without knowing reference
  signalDeltas: Record<string, number>; // curated, bounded feature shifts
  mediaAssetId?: string;       // must resolve to licensed/authorized asset
};

type CandidateQuestion = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: QuestionOption[];
  mediaReferenceIds?: string[];
  tags?: string[];             // topic/context, not freeform ranking commands
};
```

For movies/songs, annotate their **evoked aesthetic** as a subjective creative interpretation, not facts about the user's personality or the work itself. Avoid assuming every user interprets a song identically.

## Ranking and Akinator-style question selection
This is *candidate-conditioned active preference elicitation*, not simply “ask the weakest of seven dimensions.”

### Ranking loop
1. Apply **hard constraints** from the practical form with honest unknown-data handling. Keep a viable real-place set.
2. Score each candidate venue by the weighted similarity between the current inferred scene and that venue's **sourced/curated** descriptive attributes. Unknown vibe attributes should remain unknown rather than zero.
3. Normalize the scores to relative candidate weights for question selection; do not label these as calibrated probabilities of being the user's ideal.
4. For each eligible candidate question, estimate how its options would **split the currently top-ranked venues**. Prefer questions whose answers could meaningfully change the ordering.
5. Add small bonuses for contextual relevance, novelty of format and media familiarity; penalize already-asked/similar questions and questions depending on absent place metadata.
6. On answer, update scene signals and re-rank; preserve reversible question history. Use a slight consistency prior but let explicit answers override text guesses.
7. Stop when rankings stabilize or the user wants recommendations.

Conceptually:

`questionUtility = placeDiscrimination + uncertaintyResolution + contextRelevance + formatVariety - repetition - unfamiliarity`

A later version can model **expected information gain / entropy reduction** rigorously if response models are available. The hackathon MVP may use a deterministic proxy: *candidate disagreement over option signals among the top venues*. Never describe a simple heuristic as Bayesian certainty.

### Place data is the dependency
A creative quiz cannot generate honest recommendations from generic OSM POI type tags alone. For the signature demo, hand-curate and source-check a small varied catalog of Boston venues with the same feature IDs (and where possible properly licensed photographs). Candidate-aware question selection is meaningful only when venue annotations can distinguish the answers.

## Media, accessibility and rights
- Movie/TV/song titles and artist names can be shown as **text references**. Don't promise automatic soundtrack analysis simply from a name.
- For illustrative scene images, prefer original illustration or permissioned images. Movie stills/posters and album art are not automatically free to republish.
- Spotify restricted audio-features and 30-second preview capabilities for new applications beginning November 2024; its February 2026 development-mode rules also impose limits. **Do not architect the hackathon around live track previews or Spotify audio-feature extraction.** See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api and https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- TMDB has non-commercial attribution conditions; don't treat API access as unrestricted commercial image licensing. See: https://developer.themoviedb.org/docs/faq
- Every visual answer needs text/alt text. Supply `I don't know these` without penalizing the user. Avoid strobing transitions and keep map labels legible.

## Phased build — retain a usable prototype
**Stage A — Basic demonstrable intelligence**
- Retain PR #23's testable session/reducer approach, but explicitly mark it as a scaffold.
- Curate 20–30 independent scene feature IDs and annotate at least 20 varied real places.
- Create **12–16 high-quality, manually authored questions across at least five distinct families** (film, music, image, metaphor, dealbreaker).
- Implement selection against actual candidate venues using diversity and discrimination heuristics.
- Test that opposing answers re-rank candidate places and visibly update map pins; preserve normal transit selection.

**Stage B — Rich quiz**
- Expand to 40–80 culturally broad and esoteric questions, more distinctive original imagery, image moodboards, meaningful skip/familiarity handling, stable 3–7 question sessions.
- Add animations showing convergence without collapsing all options prematurely.

**Stage C — AI and media**
- Interpret open-ended prose, opt-in user images, and named media references into validated scene features with evidence/conflict tracking.
- Use AI to rephrase or generate contextual *presentation*, but constrain scoring to the schema and source-grounded place catalog.
- Replace heuristics with learned response models or expected information gain once data and validation justify them.

## Acceptance tests
- A user who describes an intimate neon place receives different follow-ups from a user who describes a playful outdoor afternoon.
- Questions include culture, sensory metaphor, original visuals and practical dealbreakers; they don't cycle through seven generic traits.
- Every answer can cause a meaningful change in scored **actual** candidate locations or is not selected.
- After a film or song reference, users can answer without already knowing the work.
- `Skip` and `I don't know these` do not imply negative preference.
- No fabricated venue traits, fake track playback, or unlicensed visual assets.
- Changing an answer can revise the resulting profile and map ranking.
- The user can see matches early; the system doesn't force all possible questions.

## Research note
Adaptive preference elicitation and maximizing information from questions are established recommender approaches. Useful sources:
- https://ssanner.github.io/papers/umap21_bayprefkey.pdf
- https://pubsonline.informs.org/doi/10.1287/mksc.1110.0660

**Integration hold:** don't merge/extend PR #23 as though its seven-axis fixed bank were the finished experience. Review this product direction and the map team's place-tag coverage first.
