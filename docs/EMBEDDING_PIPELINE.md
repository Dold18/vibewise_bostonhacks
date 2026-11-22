# Embedding Pipeline — One Space for Catalog and Queries (Accepted)

> **Status: accepted design, 2026-11-21.** Companion to [VIBE_QUIZ_DESIGN.md](VIBE_QUIZ_DESIGN.md). This document records principles and requirements; the mechanics of enrichment (scraping, caching/idempotency, pipeline staging) are being designed and implemented separately and are **not** specified here.

## 1. Core principle

There is **exactly one embedded representation per restaurant** and **one embedding model** (MiniLM, e.g. `all-MiniLM-L6-v2`) used for both catalog entries and every query type. No separate systems, no CLIP, no parallel feature-tag catalog.

## 2. Why MiniLM (stated honestly)

MiniLM is a practical choice for this timeframe: free, fast, runs locally with no API cost or rate limits, and well established for general semantic similarity. It is **not provably optimal** for fine-grained aesthetic/mood discrimination; its training skews toward topical/factual similarity more than emotional nuance. But a "better" alternative brings an API dependency, per-call cost, latency and an unproven improvement, which outweighs the uncertain benefit given the time available.

The highest-leverage way to improve match quality is the **richness of the enrichment text** (§4), not swapping the model.

If retrieval quality needs validation, build a small test set (~20–30 example queries with expected good matches) and eyeball results against it. Don't swap models preemptively without evidence of a real problem.

## 3. Why not CLIP

CLIP embeds images and text into a shared space, but that space is **different from and incompatible with** MiniLM's: a CLIP vector and a MiniLM vector cannot be compared. Using CLIP would require a second parallel embedding system solely for image queries, and CLIP cannot handle song or movie inputs at all (image/text only).

A multimodal LLM (Gemini) that converts any input (image, song, movie) into text, which then passes through the single MiniLM step, is simpler and covers every input type with one system.

## 4. Catalog side: two-layer enrichment is required

Every restaurant's embedded description contains **two layers, concatenated into one passage**:

1. **Facts** — cuisine, dishes, price tier, neighborhood.
2. **Vibe** — atmosphere, mood, lighting, energy, occasion-fit. This layer does not exist in raw restaurant data and must be generated.

This is **required, not optional**. A facts-only passage cannot support mood/aesthetic queries (the product's core differentiator) because it contains no vibe language to match. A vibe-only passage would fail plain factual queries like "hotpot near me." One combined passage handles both kinds of query with no special case.

### Input tiers for enrichment

Ordered by value and cost. These are tiers of available input, **not** a prescription for how enrichment is implemented.

| Tier | Input | Notes |
|---|---|---|
| **0** (always available) | Name, cuisine, price, neighborhood | Enough to infer a plausible generic vibe. |
| **1** (cheap, include if available) | Any existing descriptive text: website blurb, menu description, hand-written note | Grounds the inference in something real. |
| **2** (highest-value upgrade, where available) | A photo | Vibe is fundamentally visual (lighting, decor, crowd). Single highest-leverage addition when a usable photo exists from a legitimate open or first-party source. |
| **3** (optional, legally sensitive, likely skip) | Review text | Real signal, but third-party platforms (Yelp, Google) carry storage/redistribution restrictions that make this costly to pursue safely. Likely not worth it at this scale. |

The specific mechanism for gathering and generating each tier is designed and implemented separately.

## 5. Query side: three input types, one embedding step

- **Text query** ("cozy ramen place for a rainy night"): embedded directly with MiniLM. No LLM call, no HyDE (§6).
- **Media query** (photo, song, or movie reference): sent to Gemini first, which produces a vibe-text description **in the same descriptive vocabulary as the catalog's vibe layer** (atmosphere/mood language, not plot summary or genre classification). That text is then embedded with MiniLM like any text query. This step is **mandatory**: MiniLM cannot process non-text input, so this is how any media input becomes usable at all.
- **Quiz input:** see [VIBE_QUIZ_DESIGN.md](VIBE_QUIZ_DESIGN.md). The quiz produces a `vibe_so_far` text passage, embedded the same way as any other text at the end.

## 6. HyDE: considered and not used for plain text queries

HyDE (hallucinating a fuller "ideal document" from a short query before embedding) pays off when query and document are written in different registers (terse keywords vs. long technical documents). That doesn't describe this system: catalog descriptions and expected user queries are both written in similar vibe-adjective language by design, so there is no register gap to close. Adding it would cost an extra LLM call and hallucination risk on every text query for marginal benefit.

The media-translation step (§5) is **not** HyDE in the retrieval-optimization sense. It is mandatory modality conversion (text is the only thing the embedder accepts), not an optional quality improvement on an already-text input.

If text-query retrieval quality is later found to be poor in testing, revisit this, as a response to an observed problem and not as a default assumption.

## 7. Retrieval: three distinct layers

1. **Hard filters** (never touch the embedding): budget ceiling, open-now, dietary restriction, transit reachability / distance. Binary inclusion/exclusion, applied before or alongside ranking.
2. **Embedding similarity** (the core ranking mechanism): cosine similarity between the query vector and each catalog entry's vector, over entries that survive the hard filters. This single mechanism handles both cuisine-literal and mood/aesthetic queries, because both kinds of information live in the same combined-text embedding.
3. **Optional tag-based boost** (small, tiebreaker only): if structured tags are also extracted separately (e.g. explicit cuisine category), a small bonus for a tag match can nudge close rankings. It must **never** be large enough to override what embedding similarity already determined, or the system silently reverts to keyword matching.
