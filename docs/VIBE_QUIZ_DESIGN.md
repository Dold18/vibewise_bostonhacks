# Vibe Quiz — Generative Design (Accepted)

> **Status: accepted design, 2026-11-21.** Supersedes the active-discrimination / feature-tag approach in [VIBE_CONVERGENCE_QUIZ.md](VIBE_CONVERGENCE_QUIZ.md) (now marked superseded). That document's question-family table and example content are **reused** here as the template library.
> **Related:** [EMBEDDING_PIPELINE.md](EMBEDDING_PIPELINE.md) (the single embedding space the quiz output is matched in) · [PRODUCT](PRODUCT.md) · [CONTRACTS](CONTRACTS.md) · [ROADMAP](ROADMAP.md)

## 1. Core mechanism: incremental vibe-text accumulation

The quiz does **not** score features or rank against a separate hand-tagged venue catalog. It produces a short passage of text (a couple of sentences) describing the user's desired vibe. That text is embedded and compared against the restaurant catalog's embeddings, using the same embedding pipeline as everywhere else in the app (see [EMBEDDING_PIPELINE.md](EMBEDDING_PIPELINE.md)).

After **each answer**, one Gemini call does two things at once and returns them as structured output:

1. **Next question** — a prompt plus 2–4 options, drawn from the question-family templates (§4). Gemini fills in the specific content (which movie, which song, which image pairing) based on the conversation so far.
2. **`vibe_so_far`** — an updated couple-of-sentences summary of the accumulated vibe, incorporating the new answer.

```text
answer_n + history + vibe_so_far(n-1)
        ↓  one Gemini call, structured output
{ next_question: { family, prompt, options[2..4] }, vibe_so_far(n) }
```

Consequences:
- The vibe text is live and current after every turn, not computed once at the end.
- The `vibe_so_far` returned alongside the final answer **is** the finished vibe text. No separate summarization step runs after the quiz ends. At the end it is embedded like any other text query.
- *Secondary benefit, not this workstream's responsibility:* because `vibe_so_far` updates every turn, a live "scene setter" / map-theming feature could consume it progressively to shift the map's atmosphere during the quiz. That consumer is out of scope here.

## 2. Fixed length, no early stopping

The quiz runs a **fixed 10 questions**. There is no convergence detection or early-stop logic.

This is a deliberate simplification. Early stopping needs either numeric confidence scoring (unreliable from LLMs; see §3) or extra live computation against embeddings (unnecessary complexity for the time available). A fixed count is simpler to build, test and demo reliably.

## 3. Later answers refine, not overhaul — via prompting, not weighting

- Explicit numeric decay-weighting of answers (e.g. "answer 3 counts more than answer 9") was **considered and rejected**: it needs a hand-tuned curve with no data to calibrate against.
- Instead, the prompt that produces `vibe_so_far` must explicitly instruct the model: *early answers establish the core direction; later answers should refine or add nuance to the existing `vibe_so_far` rather than overturning it, unless the new answer clearly contradicts what is already established.* This yields the "diminishing influence of later answers" effect through the model's own summarization judgment, not a formula.
- **No numeric confidence score is tracked or returned.** A qualitative instruction in the prompt is more reliable than an LLM's numeric self-assessment, and with no early stopping there is no decision that needs a score.

## 4. Question-family templates: structure fixed, content generated

To avoid generic, Buzzfeed-style questions ("are you more X or Y"), Gemini is **not** told to freely "be adaptive". It is given a fixed library of question **families** (structural templates). Each turn it picks a family and fills in specific content adaptively from the conversation so far.

- **Template library:** the family table and example content from [VIBE_CONVERGENCE_QUIZ.md](VIBE_CONVERGENCE_QUIZ.md) ("Question families") carry forward, repurposed as generation templates rather than a fixed question bank. Families include, non-exhaustively: cinematic world ("which movie's world fits"), song choice, object/texture pairing, sensory metaphor, dealbreaker, opening-credit-sequence framing, emotion/atmosphere. Pull the full table from the original doc.
- **Style guidance in the system prompt:** include **2–3 concrete example questions per family** so Gemini imitates the established creative register instead of inventing a blander one.
- **Rotation:** rotate across families turn to turn; never use the same family on consecutive turns.
- **Media references are text only.** Movies and songs appear as text descriptions within question content. The options must remain answerable by someone who doesn't know the work (carry a one-line descriptive alternative, as in the original doc's guidance), and "skip" / "I don't know these" must never imply a negative preference.

## 5. Reliability and fallback

Each turn's Gemini call can fail (network, rate limit, malformed output). On failure:

- Fall back to a **pre-written static question** for that turn. Keep **at least one per family** in reserve.
- **Preserve the previous turn's `vibe_so_far` unchanged.** Never discard or blank it.

A single failed turn must degrade gracefully and never corrupt the session or crash the quiz. (For the failed turn the answer cannot be folded into `vibe_so_far`; folding it into the next successful call via the conversation history is an implementation choice for the quiz owner.)

**Loading state:** show a visible indicator between questions (e.g. "thinking of your next question…"). Each generation call is expected to take roughly 1–3 seconds, sometimes longer on poor networks; that much silence would feel broken.

## 6. Replayability

- Question content is generated live, not drawn from a fixed bank, so two sessions diverge as soon as any answer differs. This is mostly automatic.
- For extra variety along similar answer paths, the family library should contain **multiple roughly-equivalent framings per underlying signal** (for example a "cinematic world" question and a "song choice" question probing similar territory), so repeat sessions don't feel identical even when answers trend alike.

## 7. Explicitly out of scope for this version

- Active per-question discrimination against live candidate-venue rankings (the original proposal's approach). Rejected: it needs a separate hand-tagged feature catalog plus non-trivial live computation, disproportionate to the accuracy gain over well-designed fixed or generated questions.
- Numeric confidence scoring or convergence-based early stopping.
- **Licensed song/audio preview playback** (Spotify / Apple Music embeds). Media references are text descriptions only; no audio playback is part of this design. (This drops the "Song snippets" section of the original proposal.)
- A separate venue feature-tag catalog. There is one catalog, the embedding-based one in [EMBEDDING_PIPELINE.md](EMBEDDING_PIPELINE.md).
- The live map-theming consumer of `vibe_so_far` (§1).
