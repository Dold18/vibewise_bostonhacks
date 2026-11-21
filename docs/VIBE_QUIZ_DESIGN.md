# Vibe Convergence Quiz — Interactive Discovery Design (Proposal v1)

> **Status: proposed, not approved for implementation.** Product direction from project lead, November 21, 2026.  
> **Related:** [VIBE_ENGINE_ARCHITECTURE.md](VIBE_ENGINE_ARCHITECTURE.md) — per-answer embeddings, place ranking, candidate-discriminative question selection, and early stopping · [PRODUCT](PRODUCT.md) · [CONTRACTS](CONTRACTS.md) · [ROADMAP](ROADMAP.md) · GitHub PR #23 (initial headless seven-axis prototype), PR #20 (updated form).  
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
7. **Stop:** aim to reach useful matches in **3–4 questions** for a well-specified vibe, while allowing **up to 10 questions total (absolute hard cap)** for ambiguous or nuanced requests. Stop sooner when further questions are unlikely to change the ranking, or whenever the user selects **Show my matches**. Never force all 10.

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

## Song snippets: effortless, optional listening

**Product requirement:** When a question presents song choices, each song must have a small, independent **Listen / Pause preview** affordance, so a user who doesn't know the track can still choose based on sound. **Selection and playback are separate actions**: tapping Listen must never submit the quiz answer.

### Compact interface
A song-choice card/row shows:
- Track title and artist in one concise line group.
- A short *curated atmosphere descriptor*, e.g. “dreamy · hazy · nostalgic,” as a useful fallback rather than pretending a song is universally interpreted the same way.
- A compact round Play/Pause button at right, with an accessible label “Listen to a preview of [track] by [artist].”
- An optional slim playback-progress indicator or provider-native indicator that appears **only after** the user starts listening. Do not fabricate progress or a promised 30-second duration.
- Clearly selectable main card area for “This matches my vibe,” visually distinct from the playback button.

On small screens, cards stay stacked and readable; the player may open a compact inline embedded controller below the active song. Never render three full-height music embeds concurrently or open a separate tab just to hear a preview when in-page playback is supported.

### Playback interaction rules
1. **Never autoplay** music when the question appears.
2. Only one preview can play at a time. Starting another should pause/destroy the previous controller where supported.
3. Pause playback on question selection, Skip, Next, Back, closing the quiz, or replacing the current set of songs.
4. The user can answer immediately without playing anything.
5. Show loading/unavailable status gracefully; if this browser/account/territory cannot play a sample, provide an official “Listen on Spotify / Apple Music” link and keep a concise description.
6. “I don't know these” and Skip are valid choices and must never imply a dislike for the songs.
7. Never equate hitting Play with selecting a track or an affinity signal unless consent and a distinct action are given. Don't track listening time for recommendation inference by default.
8. Respect reduced-motion settings and keyboard accessibility. Album art only where permissioned/authorized (provider embeds can supply art within their terms).

### Preview sourcing and limitations
- **Initial preferred implementation:** Use an authorized provider-native track embed with controls, lazily mounted for the song the user requests. Spotify's official iFrame API can create, play and pause embeds: https://developer.spotify.com/documentation/embeds/references/iframe-api . Its compact official track player is approximately 152px tall at a minimum 280px wide when revealed: https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed . Playback may be a partial preview, a full song for eligible signed-in users, or unavailable; do **not** promise a clip length or universal availability.
- **Provider alternative:** Apple Music's officially generated embeddable track player documents 30-second playback for listeners who aren't signed in: https://artists.apple.com/support/1117-apple-music-marketing-tools . Validate rights, availability, embedding and integration UX before committing to it.
- **Avoid for this use case:** Spotify Web API `preview_url` fields for newly created apps (restricted since Nov 2024); Apple iTunes Search API `previewUrl` files as free entertainment clips (Apple explicitly limits promotional samples to store promotion, with store-badge requirements). See https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api and https://performance-partners.apple.com/search-api .
- Never download, rehost, cut, concatenate or redistribute copyrighted music samples. Don't claim to create/use an independent audio snippet without a licensed source.

### Provider-independent data contract (proposed)
```ts
type SongQuestionOption = QuestionOption & {
  track: {
    title: string;
    artist: string;
    spotifyTrackId?: string;        // official embed identity
    appleMusicEmbedUrl?: string;    // verified generated embed
    openInProviderUrl?: string;     // authorized link for fallback
  };
  playback: 'embed_available' | 'external_only' | 'unknown';
};
```
The UI should not depend on leaked provider MP3 URLs. Playback availability must be decided from actual provider capability, not an LLM assertion.

### Build sequence
1. **A:** Song-choice rows with title, artist, text descriptors, and distinct **select** vs. **listen** controls. Use a *labeled mock/unavailable state*, not fake audio.
2. **B:** Integrate one provider's official embed for a curated handful of verified tracks; test desktop/mobile browsers and unavailable states. Keep the embed lazily mounted.
3. **C:** Optional richer dynamic metadata, art and provider choices; ensure no music service credentials are exposed in client code and no song choices require accounts merely to participate.

**Acceptance:** unfamiliar listeners can hear an authorized sample when available and still answer without listening; no autoplay, no simultaneous tracks, playback pauses on navigation, provider-unavailable fallback works, and the card never confuses play with select.

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
- Song options display track/artist and a separate, accessible **Listen preview** control; audio is optional and initially may use provider availability fallback. Never simulate actual playback.
- Implement selection against actual candidate venues using diversity and discrimination heuristics.
- Test that opposing answers re-rank candidate places and visibly update map pins; preserve normal transit selection.

**Stage B — Rich quiz**
- Expand to 40–80 culturally broad and esoteric questions, more distinctive original imagery, image moodboards and meaningful skip/familiarity handling. Sessions usually take 3–4 questions, but may continue to **10 maximum** when answers keep resolving meaningful uncertainty.
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
- Song previews are user-initiated, one at a time, stop on navigation, and use authorized provider playback or a clearly stated unavailable/external fallback.
- Changing an answer can revise the resulting profile and map ranking.
- The user can see matches early; the system doesn't force all possible questions.

## Research note
Adaptive preference elicitation and maximizing information from questions are established recommender approaches. Useful sources:
- https://ssanner.github.io/papers/umap21_bayprefkey.pdf
- https://pubsonline.informs.org/doi/10.1287/mksc.1110.0660

**Quiz-cap implementation note:** PR #23 currently provides seven unique questions and a four-question default, and caps the count to the size of its bank. It does **not yet support ten distinct questions**. Before connecting the final quiz UI, expand the candidate question pool, change the hard cap to 10, and add no-repeat and early-stop tests at 10 questions. Do not accomplish this by repeating earlier questions.

**Integration hold:** don't merge/extend PR #23 as though its seven-axis fixed bank were the finished experience. Review this product direction and the map team's place-tag coverage first.
