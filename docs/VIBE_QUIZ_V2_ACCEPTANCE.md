# Vibe Quiz V2 — final acceptance matrix (multimodal media, 2026-11-22)

Workstream C (Product / Vibe). Branch `fix/v2-quiz-immediate-launch-20261121`, uncommitted. Nothing committed, pushed or merged.

## Verdict (updated 2026-11-22 after live Gemini testing)

| Goal | Status | One-line reason |
|---|---|---|
| 1 · Genuine multimodal experiences | **PARTIAL** | Gemini chooses real licensed photos, public-domain stills, storyboard art and official recordings, and real playback is verified. Gemini sometimes pairs a prompt with an image whose subject doesn't fit; there is no finished original artwork. |
| 2 · Cultural intelligence | **PARTIAL** | Gemini introduces fitting references unprompted (Crimson Peak, Rebecca and "Wicked Game" for "haunted but romantic"; This Is Fine and Gilmore Girls for coffee). 37 distinct references across 13 sessions, but Before Sunrise appears in all 13 and a cozy-café cluster recurs. |
| 3 · Emotional discovery | **PARTIAL → near PASS** | Corrections and contradictions change the reasoning ("You want a quiet nook to talk, but you also want to dance for an hour. How does the night make that pivot?"). Opposite answer paths diverge in content, format and city. |
| 4 · Creativity and entertainment | **PARTIAL** | The voice fits each input (coffee: "Choose your bunker"; "What is the one rule everyone else in the room must follow so you don't lose your mind?"), but there is some sameness across sessions. |
| 5 · Quiz and living map evolve together | **PARTIAL** | Quiz palette and city presets follow committed answers through the publisher → Scene Session. Amber leads 7 of 13 final cities. Venue ranking is **BLOCKED** on catalog credentials. |

### Live Gemini evidence (real authenticated requests, `gemini-3.5-flash-lite`)

- **Configuration.** The key is in the existing `/Users/jdold/Desktop/vibenta-vibe-engine-live/pipeline/.env`, loaded via `VIBENTA_ENV_FILE`.
  - Earlier "unconfigured" results came from an **incorrect environment path**: the server had been started without `VIBENTA_ENV_FILE`. The file was never missing.
  - The key is read server-side only, never appears in served browser code, and appears in no repository or artifact file.
- **Browser matrix** (`report-gemini-run2.json`): 13 sessions, 84 generate calls, all HTTP 200.
  - Latency: p50 2.6s, p90 5.1s, max 6.0s.
  - Question sources: 70 of 70 from Gemini, 0 from the local fallback.
  - Formats: image_choice 17, image_reveal 16, listening 13, image_blend 12, free_text 9, text_choice 3.
  - Openers vary by input.
- **Behavior checks:** all pass.
  - The player isn't loaded until requested and stays paused until the user presses play.
  - Credits are visible on every image and beside the player.
  - A 456-character draft and its focus survive a background update.
  - Correction and undo by editing history work.
  - Focus, accessible names, reduced motion and 44px targets all pass.
- **Real playback:** Daft Punk, ABBA, Vangelis, LCD Soundsystem and The Killers, each about 6s, unmuted, after a real click.
- **Ranking:** unavailable in every session, honestly, because there are no catalog credentials. `scripts/ranking-real-minilm.mjs` passes 5/5 on fixture venues, covering positive preferences, explicit dislikes, changes of mind, new evidence and negated free text.

The sections below record the earlier offline-only run (local director, before Gemini was configured).

## What was built

- **Media contract `vibenta-media/1`.** This is an additive, optional `Question.presentation` plus an additive `Response {kind:'text'}`. Both are *pending ratification* by the vibe owner. Old consumers and the Scene Composer ignore them.
  - Formats: `image_choice`, `image_reveal` (progressive widen), `image_blend` (slider between two filters on one adaptation-permitted photo), `listening` (YouTube's visible player), `free_text`, `text_choice`.
  - Each presentation carries a `voice`, a `mood` and a `design` object. `design` holds `{known, uncertainty, whyThisMedium, branches[per option]}`.
- **Verified registry** (`src/features/vibe/media/`). Gemini sees IDs and plain descriptions only, never URLs.
  - **51 Wikimedia Commons images.** Licenses were machine-verified through the Commons API (33 CC BY-SA, 9 CC BY, 4 CC0, 5 PD after exclusions), and every URL was re-checked for HTTP 200 on 2026-11-22.
    - CC BY-SA files are shown unmodified only: `adaptation:false` keeps them out of blends.
    - Every image shows its author, license and source link.
    - Excluded for rights caution: the Steamboat Willie still (live Mickey trademark) and a teamLab installation photo (the artwork's own copyright).
  - **47 official YouTube uploads.** Each passed oEmbed 200, `playableInEmbed:true`, playability status OK, not age-restricted, and an official channel (VEVO, artist, label or Topic). This was checked from one US network, so region availability may differ.
  - **86 cultural references** across film, TV, games, songs, memes, books and artworks. Every Wikipedia source URL returns 200. References carry identity facts and non-prescriptive "evokes" notes, never traits.
  - **Spotify is excluded:** the spec's policy review flags its quiz and sync restrictions.
  - **No audiovisual pairing:** listening questions use text options and the recording's own video. Vibenta never sets a recording against its own imagery.
  - **No YouTube contact until click:** the player loads only when the user clicks.
- **Gemini director** (`server/vibeGemini.ts`). One structured call per turn with the schema above, plus retrieval of the whole compact library.
  - The server rejects and retries (with validation feedback) when a question:
    - has no presentation;
    - uses unknown media;
    - reuses media or repeats a format back to back;
    - asks more than two free-text questions;
    - opens without real media;
    - follows "I don't know these" with a recording.
  - The prompt covers per-input voice, proactive cultural references with a note for people who don't know them, no trait assignment, preserved contradictions, and corrections steering the next question.
- **Offline director** (`media/localDirector.ts`). Used only when Gemini fails, and always labeled "Local question: the AI is unavailable…".
  - Retrieval is negation-aware and recency-weighted.
  - Each voice has its own opening order, and calm or loud answers reorder the next formats.
- **UI** (`ui/mediaStage.ts`, `ui/liveQuiz.ts`).
  - Renderers for all formats, with credits, an image-failure description fallback, a sound-off description, and "Why this question?".
  - A correctable "What I've picked up" read-back, plus a mood palette on the quiz.
  - The quiz no longer rebuilds on embedding-only updates. Before this fix, it restarted a playing video and dropped focus from a half-typed answer.
- **Map bridge** (`media/sceneBridge.ts`). After at least one committed answer, the accepted mood plus the Composer's own lexicon intent becomes the profile's optional `sceneIntent`, which the Scene Composer validates as untrusted input. It is atmosphere only and never touches ranking, pins or geography. Previews never change it.

## Browser evidence (real app, headless Google Chrome via CDP, nothing mocked)

`node scripts/quiz-media-browser.mjs` was run against `npm run dev:all` on ports 5181/8791.

- Inputs: 10 runs, the 5 required vibes plus 3 with no cultural reference, and opposite answer paths on 2 inputs. Six answers per run.
- Desktop at 1440px; mobile at 390px for 3 inputs.
- Report: `/private/tmp/vibenta-media-qa/report.json`. Screenshots sit beside it; the mobile run is in `/private/tmp/vibenta-media-qa-390/`.
- All questions came from the **local director**, because Gemini is unconfigured. Ranking was `unavailable` in every run ("Venue embeddings are not connected").

**Real playback:** "One More Time" (Daft Punk, official upload `FGBhQbmPwH8`) played inside YouTube's own player frame after a trusted click. At desktop it reached `currentTime` 5.9s, unmuted, not paused, `readyState` 4. At 390px it reached 5.5s. Only this one track's playback was exercised; the other 46 are verified embeddable but not played.

| Input | Path | Formats shown | Real media | References | Quiz palette path | Final map presets (Scene Composer) | Ranking |
|---|---|---|---|---|---|---|---|
| Need a fun night. | first | listening → image_choice → image_reveal → free_text → image_blend → listening | 4 photos; One More Time, Dancing On My Own | All My Friends | electric_party → warm_amber → neon_noir | neon_city .42, underground_indie .17, retro_atlas .06 | unavailable |
| Need a fun night. | last | listening → image_choice → image_reveal → free_text → image_blend → image_choice | 6 photos; One More Time | Hey Ya! | electric_party → candlelit_gothic | amber_refuge .33, noir_nocturne .27, woodland_story .06 | unavailable |
| Haunted but somehow romantic. | first | image_reveal → image_blend → image_choice → free_text → image_reveal → image_blend | 7 photos incl. Nosferatu (1922) still | Crimson Peak, Corpse Bride | candlelit_gothic | amber_refuge .34, noir_nocturne .27, dream_pastel .04 | unavailable |
| Haunted but somehow romantic. | last | same formats as first path | 7 photos | Crimson Peak, Corpse Bride | candlelit_gothic | amber_refuge .30, noir_nocturne .29, dream_pastel .07 | unavailable |
| Coffee. Brain's fried. | first | Session B B1 → B2 → (Continue Refining) free_text → image_reveal → image_choice | 2 storyboards + 4 photos | Friends | warm_amber | amber_refuge .50, woodland_story .11 | unavailable |
| I want something like a 2000s house party. | first | listening → image_choice → listening → image_reveal → image_blend → listening | 4 photos; Hollaback Girl, SexyBack, Hey Ya! | Guitar Hero | electric_party → neon_noir | neon_city .45, noir_nocturne .13, amber_refuge .08 | unavailable |
| I want to feel like I'm in Blade Runner. | first | image_reveal → listening → image_blend → listening → free_text → image_reveal | 3 photos (Hong Kong neon in rain…); The Midnight "Sunset", Chromatics "Shadow" | Blade Runner, Lost in Translation | neon_noir → electric_party | neon_city .52, noir_nocturne .13 | unavailable |
| Something low-key with one good surprise. | first | image_choice → free_text → image_blend → image_reveal → image_choice → free_text | 8 photos | Stranger Things | warm_amber → neon_noir | neon_city .45, noir_nocturne .13, retro_atlas .07 | unavailable |
| Make me forget this week. | first | same sequence as above | 8 photos | Stranger Things | sunlit → warm_amber → neon_noir | same as above | unavailable |
| Somewhere I can think. | first | same sequence as above | 8 photos | All My Friends | sunlit → warm_amber → neon_noir | neon_city .47, noir_nocturne .14, amber_refuge .05 | unavailable |

What this evidence does and does not show:

- **Branching:**
  - **Need a fun night:** opposite answers diverge. Choosing "the feeling, but not the volume" and then writing "a candle on the table and nobody in a hurry" moved the palette to candlelit_gothic and showed misty river and chapel images. The map went amber/noir. The other path went neon/indie and played Robyn next.
  - **Haunted but somehow romantic:** both paths kept the same format order; only the images and options differed. That branching is weak.
- **Weak spots:**
  - The three neutral inputs share one opener sequence and drift toward neon. That is partly caused by the harness's single scripted free-text answer, but it is a real fallback weakness.
  - The coffee input still starts with the authored Session B storyboards (committed behavior, kept intact).
  - The coffee row's repeated `free_text` is the results snapshot and the resumed question, not two questions.
- **Map:** the scene preset hash changed after each committed answer in every run, and the first question (no answer yet) left the map unchanged. This is **atmosphere only**. It does not prove recommendation integration.

## Tests actually run

- `npx vitest run`: **658 passed** (55 files). New `media.test.ts` covers:
  - registry rights fields and the no-URL Gemini library;
  - shape, session and variety rules, and the unfamiliar follow-up rule;
  - free-text evidence and its arrival in the next Gemini request;
  - the Gemini retry-with-feedback and `source:'gemini'` stamping;
  - per-input openers, opposite-answer divergence and negation;
  - the scene bridge (no intent before an answer; valid Composer presets after).
- `npm run build`: passes; the existing >500 kB chunk warning remains.
- `git diff --check`: clean.
- **Legacy `vibe-browser.mjs`: 30/30 pass.** It was run from a scratchpad copy on a free debug port, because the repo script's hard-coded port 9385 was held by a stale Chrome from my own earlier run.
- **`session-b-browser.mjs`: 74/77 on this branch.**
  - Port 9387 is occupied by another session's Chrome, so it was run from a scratchpad copy on port 9471.
  - The same 3 checks ("Gemini failure authored B1/B2" and "no uncaught browser exceptions: Invalid InterceptionId") also fail on a pristine `git archive HEAD` copy, which reaches 72/77 with two extra flaky map checks. They are pre-existing in this environment, not regressions.

## Blockers and remaining work

1. **Gemini credentials (Goals 2, 3, 4).** Add `GEMINI_API_KEY` to the root `.env`; the server re-reads it on each request. Then rerun `node scripts/quiz-media-browser.mjs` and judge full sessions against the addendum's criteria.
   - The structured schema (nested `presentation`, `propertyOrdering`) has only been exercised with mocked transport. Live schema acceptance by the Gemini API, and latency within the 2×12s attempts and 30s client timeout, are unverified.
2. **Catalog (Goal 5 ranking).** The catalog owner supplies `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and a verified `VITE_CATALOG_EMBEDDING_MODEL_KEY` with vectors rebuilt for the pinned MiniLM fingerprint. Then run two contrasting real top-five checks. Until then, ranking is honestly unavailable and pins are not reweighted.
3. **Artwork (Goal 1).** There is no finished original atmospheric art; the Session B SVGs are placeholders. Modern film and TV works (Blade Runner, etc.) are text-only references paired with real, labeled photographs, never presented as stills.
4. **Rights review.** Machine license checks are not legal review. Items needing review:
   - incidental brand signs (Mickey's Diner, the Retrovolt arcade);
   - a watermark on the San Francisco rain photo;
   - actors visible in public-domain stills.
5. **Decisions for the owner:**
   - Ratify `Question.presentation`, `Response {kind:'text'}` and `OutingVibeProfile.sceneIntent`.
   - Decide whether "Coffee. Brain's fried." should keep the authored Session B opener or hand over to Gemini like every other input.
