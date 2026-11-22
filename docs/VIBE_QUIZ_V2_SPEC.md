# Vibenta V2 — creative review and revised experience specification

> Bounded B1 → B2 implementation authorized; see [prototype handoff](SESSION_B_PROTOTYPE.md). Other creative examples and executable interface proposals are not approved.
>
> Focused revision · 2026-11-21 · Workstream C, Product / Vibe. Overall architecture approved as a design direction; creative examples and executable/additive interface changes remain unapproved. Documentation only.
>
> Starting point: the existing `docs/VIBE_QUIZ_V2_SPEC.md` in the separate `vibenta-vibe-engine-live` worktree, read without modifying it. This workspace did not contain that file. This revision replaces its proposed creative collection and architecture recommendations for review; it does not supersede accepted decisions or claim the other worktree's engine exists on this branch.

## 1. Creative direction

The quiz should be a small experience worth having before there are recommendations. Someone arrives with a feeling they cannot quite locate. They hear something, enter a scene, notice what draws them in, and recognize what they want their afternoon or evening to become.

The original proposal has a useful architectural instinct: preserve the session engine and make the initial input the brief. Its creative collection does not yet deliver that promise consistently. Sixteen different mechanics scatter attention across sixteen small tasks. Several manufacture an action—circle, recolor, climb—without creating an interesting experience. Worse, their interpretation sometimes turns a subjective association into an unjustified claim about the user.

Replace the mechanic collection with four reusable presentation types and six authored concepts. Aim for three excellent interactions, a fourth only when it resolves something consequential, and ten as the absolute cap. Repetition of a medium is welcome when the emotional thread benefits. Users can see matches immediately, skip, choose neither, or correct the reading at every step.

The first vibe controls content, tone, pacing, complexity and presentation. Category makes the outing plausible. It does not choose a playlist or a question sequence by itself. A quiet coffee request about rebuilding a difficult week and a coffee request about an absurd little adventure should have almost nothing in common beyond their practical filters.

## 2. Audit of all sixteen original examples

These are judgments of the specific examples, not permanent bans on their media. “Retain” still means revise before prototyping.

| Original | Judgment | What works; what fails | Replacement or revision |
|---|---|---|---|
| N1, Build the night's setlist | Rework | Real songs give emotional specificity. Sorting three songs into clock times asks for DJ labor and falsely maps song order to actual venue timing. The payoff of a long musical build may never occur in an available preview. | A single musical moment followed by a scene that carries its feeling forward: concepts A → B. No promised excerpt or timestamp without verified access. |
| N2, 1:15 am street panorama | Retain the core | Exploring a block and entering a window is pleasurable. Six stock nightlife endings are still a menu; the rooftop and 24-hour diner risk looking like available Boston options. A pizza-counter selection does not establish light tolerance. | Concept C: three carefully staged interiors, each with a reveal. Prominent imagined-scene label. Ask what made the selected room feel right before retaining an inference. |
| N3, DJ reading the room | Rework | Recognizable songs and bodily reactions can be fun. Four tracks become a genre survey; “grab a drink” has several meanings. Leaving during one song does not justify excluding its whole genre. | Concept A: use the user's named song, one meaningful contrast at most, and retain the user's stated reason. |
| N4, What's the bittersweet part? | Remove as a required question | Treats emotional meaning seriously, but pressures disclosure and suggests a personal loss narrative. The app does not need the story behind someone's sadness to find a good night. | Carry the feeling into an imagined shared ending, concept F. Optional “Say it my way” remains available without starter chips about bereavement or departure. |
| C1, Speakers on page 40 | Rework | Concrete reading context and real music are useful. A track plus a volume knob is largely a sound-preference survey, and vocals versus instrumentals is not deterministically implied by one choice. | Concept E: experience a short sequence of room moments and decide whether it preserves immersion in the book. Music only if the original input makes it useful. |
| C2, Keep parts of Luke's | Rework | Takes the user's own reference seriously. Aspect tags turn a loved fictional place into a feature checklist. Naming a show does not establish detailed familiarity with it. | Concept C with two lived moments: comfortable recognition versus uninterrupted anonymity. Luke's is a text reference; original artwork is not a replica of its set. |
| C3, Set your table | Remove | Pretty customization, but cup, pastry and lamp are conventional preferences. Picking a teapot cannot silently change the user's category to tea houses. The keepsake is stronger than the question. | Concept E for attentive reading, or D when changing the scene reveals a real tension. No arbitrary prop slots. |
| C4, Look up from the page | Retain with a stronger beat | Looking up is a recognizable little pleasure. Four unrelated Boston views become a neighborhood survey, and a street photo cannot establish a café's view or indoor noise. | Concept E: the view is one beat in a continuous original scene. Genuine Boston photos appear later with accurate location labels, without invented window access. |
| R1, Choose the walk after | Retain as a destination for the sequence | Gives the map an emotional purpose and connects an outing to place. Glowing paths can imply verified navigation and force geography before the desired experience is clear. | Concept F: a map-based imagined ending, then verified candidates. No route line until actual routing; view preference is not an automatic geographic exclusion. |
| R2, Across table or side by side | Retain the POV reveal | Looking from a seat evokes a date more effectively than reading seating tags. Five floor-plan choices add work; seat geometry does not prove social confidence or lower pressure. | Concept C, two or three POVs, then one contextual reading the user can correct. Do not infer what the date feels. |
| R3, Circle what makes it stuffy | Remove | A checklist with a pen animation. The menu makes the user inspect problems instead of anticipate an enjoyable date. Price is already a practical constraint. | Concept D: hold a promising scene constant and remove the moment that breaks its spell. Explicit constraints can still be entered directly. |
| R4, Text your best friend | Remove as a standalone question | Imagining success can help. Predetermined message fragments and a phone frame do not make another preference choice compelling; writing a charming message is homework. | Concept F supplies a visual final beat; ordinary correction text stays optional. No pretend sending or contact access. |
| U1, Recolor Boston | Remove | A visual toy may delight briefly, but palette preference cannot justify historic hotels versus outdoor adventure versus maritime destinations. The film names do almost all the imaginative work. | Concept D changes a meaningful event or relationship in the scene; the map's palette follows the confirmed experience rather than generating it. |
| U2, Curiosity cabinet | Retain discovery, reduce scope | Concealed objects can create real surprise. Eight drawers require too much asset work and become a museum-interest inventory. A remote museum object does not establish a Boston exhibit. | Concept C: three original reveals with scale or context reversals. Clearly imaginary until tied to a verified local record. |
| U3, Send roommate a photo | Remove the caption test | An odd little photograph can invite curiosity. Captions do not establish solo versus group plans; “I'm never leaving” is not a dwell-time constraint. | Concept C or E, retaining discovery imagery and asking only about the experience actually chosen. |
| U4, Weird-o-meter | Remove | It assumes cat → museum → séance → darkness → jail is a universal ordered scale. These are independent experiences, not increasing doses of one trait. A last accepted rung cannot imply rejection of the next. | Offer equally valid, incomparable discoveries through C; preserve combinations such as eerie and tender. No weirdness score. |

The central correction is to interpretation as much as presentation. A delightful visual choice followed by a confident false reading is a bad interaction.

## 3. Revised collection: six concepts, four presentation types

This is the complete proposed collection for the first design round. Variants in section 4 instantiate these concepts; they are not additional renderers. The collection is deliberately small enough to art-direct.

### A. The moment you want to take with you

- **Emotional payoff:** one recognizable recording can recover a feeling faster than a paragraph. The question is about the moment the user wants to inhabit, not whether they like an artist.
- **Initial-input relevance:** use when the user names music, dancing, nostalgia, or a musical reference that actually helps resolve their words. Never select it merely because the category is nightlife.
- **Physical action:** press a separate Listen control on an approved player, then choose a concrete response to the moment. Offer at most one contrasting recording. Replay is optional; listening alone is not an answer.
- **Actual asset requirements:** an identified real recording, artist/version metadata, an authorized playable source verified for this use, and an accurate sensory description. Robyn's *Dancing On My Own* is the candidate used below. No lyrics, album artwork outside its permitted context, invented preview length or made-up player URL.
- **Useful discovery:** whether “bittersweet” means private emotional release, shared exuberance, or carrying energy into a gentler ending—only to the extent the user confirms that reading. Never artist → personality or track → fixed venue tag.
- **Creative continuation:** B carries the retained feeling into contrasting places; C lets the user enter one of them.
- **Unavailable/unfamiliar:** hide Listen unless verified playable; show “Audio isn't available here. Use the scene version.” Unfamiliar users can listen without a knowledge test. A scene continuation replaces the musical test when listening fails; descriptors alone must not be treated as having heard it.

### B. Same scene, different emotional gravity

- **Emotional payoff:** an unexpected soundtrack changes what an image seems to promise. The mismatch can expose a richer desire: an intimate room can feel triumphant, and a busy scene can feel lonely.
- **Initial-input relevance:** use for a tension in the user's words or previous answer, such as “chaotic but intimate” or “eerie but romantic.” Not a generic soundtrack contest.
- **Physical action:** view one original scene, try two sound beds one at a time, and retain one scene/sound pairing. A second mode holds the recording constant while switching between two scene images. Choose which dimension changes; never change both simultaneously in the comparison.
- **Actual asset requirements:** one or two original images and two original recordings with documented permission for interactive audiovisual use; or a named cultural recording with separately verified rights covering the recording, composition and this pairing. Section 4A names Robyn + a small takeaway shop as the recognizable target. Standard embeds do not establish pairing permission. For the realistic first prototype, commission two contrasting original instrumental cues, clearly labeled original music rather than covers or replacements masquerading as Robyn.
- **Useful discovery:** the user's contextual explanation of what makes the pairing attractive. “This tiny place feels like our victory lap” supports togetherness after intensity; it does not prove a desire for fluorescent lights, takeout cuisine or a specific song at the venue.
- **Creative continuation:** C enters the selected scene; D tests whether its emotional center survives a small change.
- **Unavailable/unfamiliar:** no combined playback without pairing permission. Use the same visual comparison in silence and ask about the visible moment, or move to C. Clearly distinguish this from the full audiovisual experience. Unknown songs need no recognition if playable.

### C. The door that opens into something better

- **Emotional payoff:** anticipation followed by a specific reveal. A narrow door opens onto a room larger, stranger or more welcoming than expected; looking from a seat makes closeness tangible.
- **Initial-input relevance:** the threshold comes from the user's desire: disappearing into a book, finding an overlooked wonder, or being together without performing for a room.
- **Physical action:** preview two or three doors or seats, tap Enter or View from here, inspect an original POV reveal, then choose Stay here. Opening every door is allowed and yields no preference evidence.
- **Actual asset requirements:** two or three original threshold images and corresponding POV images, with alt text; optional team-owned ambience. Cultural titles are text references only. No copyrighted set recreation, characters, screenshot tracing or invented Boston venue photography.
- **Useful discovery:** the specific experience the user selects and confirms, such as uninterrupted reading alongside other people or a shared object that makes conversation easy. Do not infer extroversion from a counter seat.
- **Creative continuation:** D alters the selected scene once; E explores its next few minutes; F brings its promise back to Boston.
- **Unavailable/unfamiliar:** descriptive reveal buttons preserve anticipation in text; no cultural recognition needed. If every image is missing, use a brief scene passage plus the same choices, honestly treated as an imagined rather than sensory comparison.

### D. Keep the feeling; change one thing

- **Emotional payoff:** experience how a tiny change can rescue or ruin a scene. The point is discovering the fragile ingredient that matters, not decorating a room.
- **Initial-input relevance:** use only for an unresolved tension already raised, such as welcoming versus intrusive, strange versus frightening, or exciting versus exhausting.
- **Physical action:** toggle between two authored versions of the scene already chosen. One variable changes: someone interrupts; the shared object vanishes; the center of attention shifts to the user. Choose Keep this version or Both work.
- **Actual asset requirements:** a matched pair of original image frames or short original clips; optional specifically cleared paired sound. No unconstrained image generation or generic cup/light/music controls during the session.
- **Useful discovery:** a contextual boundary, stated narrowly. Rejecting an interruption while reading does not establish dislike of staff or conversation in general. Both versions can be desired at different points in the outing.
- **Creative continuation:** E can carry the preferred version through a few beats; F tests whether its essence survives a real-world translation.
- **Unavailable/unfamiliar:** two original micro-scenes in text; skip if the difference cannot be perceived accessibly. Correction always overrides the offered interpretation.

### E. Let the scene breathe

- **Emotional payoff:** a short visual sequence lets someone anticipate time passing. It can hold attention, make a tiny interruption funny, or make a quiet ordinary moment desirable.
- **Initial-input relevance:** strongest for “read for two hours,” “get lost for a while,” or “I need something that feels unhurried.” A high-energy brief gets brisk cuts; a tender one gets stillness. Playback speed itself is not preference evidence.
- **Physical action:** advance through three original frames at their own pace, then choose Continue this afternoon or a concrete alternate continuation. No timed response, writing exercise or required animation.
- **Actual asset requirements:** a coherent three-frame storyboard, not stock images from unrelated places. Optional original room tone with documented use rights. Cultural references such as *Gilmore Girls*, *Animal Crossing: New Horizons*, or *Over the Garden Wall* can frame the emotional contrast in text; the artwork remains original and visibly distinct.
- **Useful discovery:** what should persist as time passes: absorption, gentle recognition, or the chance to follow a new curiosity. No claim that a real café permits two-hour occupancy until verified.
- **Creative continuation:** C can explore a newly revealed room, or F can translate the selected ending into grounded matches.
- **Unavailable/unfamiliar:** static frames instead of motion; numbered text beats if images fail. Optional silence always works. Explain references briefly without requiring prior knowledge.

### F. Bring this feeling into Boston

- **Emotional payoff:** the imagined experience resolves toward an actual city. A map becomes a promise of somewhere to go, while still admitting where the catalog cannot deliver.
- **Initial-input relevance:** reuse the user's chosen scene and exact confirmed interpretation. A nocturnal brief and a slow morning must produce different endings, even if both eventually include cafés.
- **Physical action:** choose one of two illustrated final beats over the Living Map, or press Show my matches directly. Then inspect actual catalog cards. Any place selection emits only its canonical place ID through the coordinator.
- **Actual asset requirements:** original end-scene frames; existing map; eligible catalog records with verified provenance; licensed real photos only when available. A real candidate photo is labeled with its actual place; imaginary frames say “Imagined scene · not a real venue.” No invented walking path or transit shape.
- **Useful discovery:** a final confirmed priority or a corrected reading; no automatic geographic exclusion from an inspirational image. A map color choice alone reveals nothing about the desired outing.
- **Creative continuation:** normally results, not another question. One additional question is justified only by a consequential unresolved ambiguity. Selecting a real place starts the existing origin/transit flow.
- **Unavailable/unfamiliar:** list plus interpretation if map rendering fails; preserve matches if imagery fails. Missing compatible catalog vectors means “Atmosphere preview; matching isn't available yet,” without cosmetic pin convergence.

## 4. Targeted creative revision: short inputs, earned direction

These replace the previous three scripts. They are proposed user experiences, not live Gemini results. Practical context comes from existing controls; it is not secretly added to the initial vibe. The sample answers below are hypothetical. No wording, asset, player or cultural association is claimed creatively accepted yet.

**Every screen:** Show my matches, Skip, Neither, and Say it my way remain available. Read-backs have Not quite. References have “Don't know it”; unfamiliarity is neutral. Entering a scene, previewing a variation or playing music is exploration, not preference evidence. Only an explicit answer enters the existing answer/correction flow. All artwork says **“Imagined scene · not a real venue.”** The map remains accessible; sound is opt-in, with keyboard and still/text alternatives.

### How Gemini introduces culture without guessing taste

Use the approved retrieval → one combined generation operation direction. From the user's words and current answers, retrieve a few verified cultural-reference candidates and available original scenes. Gemini must identify the uncertainty a reference helps explore, then offer it as a possible comparison—not announce a taste the user already has. Use the plain scene if no candidate earns its place. No cultural-mention quota, demographic inference or live lookup is needed.

| Trigger in this session | Candidate introduced by Vibenta | Why offer it now; what it does not establish |
|---|---|---|
| A: “fun night”; no desired energy known | Earth, Wind & Fire's *September* and Robyn's *Dancing On My Own* | Two real recordings offer different possible ways into a dance-led night. Their exuberance/ache contrast is an editorial interpretation offered for reaction, not a fact about what “fun” must mean. Include an equally visible no-dancing path. |
| B: a selected bakery scene and wanting a break from tasks | *Kiki's Delivery Service* | A possible reference for ordinary bakery life becoming inviting; do not assert that every viewer finds the film soothing. The artwork is original, not its bakery, and the next question is about how long the user wants to stay. |
| C: “something weird”; reveal selected for its absurdity | *Untitled Goose Game* | A specific vocabulary for playful mischief if that is what caught the user's attention. It is not a reason to encourage disruption at real venues, and no game footage or audio is required. |

Reference identity sources: [Robyn's official video page](https://www.robyn.com/videos/v/dancing-on-my-own-official-video), [Earth, Wind & Fire's official site](https://www.earthwindandfire.com/), [Studio Ghibli's film page](https://www.ghibli.jp/works/majo/), and [House House's game site](https://goose.game/). These verify works, not playback rights, app suitability, or the subjective associations above. Do not invent film dialogue, episodes, musical timestamps or franchise crossover scenes. A reference can be known in the index while its media remains unavailable.

### Session A — flagship: the night gets smaller, the feeling doesn't

**Initial input:** “Need a fun night.”

**Existing practical controls:** nightlife; with friends; tonight. Budget, origin and time window remain their actual entered values.

**Already known:** an enjoyable evening with friends. **Still unknown:** what they want to do, what emotional intensity appeals, and whether they want one sustained peak or a changing night. Dancing, bittersweetness, fries and a second stop are not yet known.

**A1 · Find the opening, without a genre questionnaire**

Screen: **“What gets tonight off the sofa?”** Two listening cards and one original scene sit at equal visual weight:

- **Earth, Wind & Fire — September.** “The group chat actually made it out.”
- **Robyn — Dancing On My Own.** “Dance first. Sort out the feelings later.”
- **No dance floor.** Original scene: friends lean across a tiny table, laughing so hard one has slid sideways off their seat. “We've been here an hour. Nobody's checked.”

The first two captions are Vibenta's original jokes/interpretations, not lyrics or artist quotations. Each song has separate Listen and **Take this into tonight** controls; the scene has **Start here**. A verified authorized standalone player is shown only when permitted for this quiz use; keep its video/controls visible where required and do not synchronize other visuals to it.

**Sample action:** listen to Robyn, then **Take this into tonight**. Playback stops.

**Read-back:** “Dancing, with some feeling behind it. That's my first guess.” Not quite.

**New information:** a dance-led opening and a tentative appetite for emotional release, rather than pure celebratory bounce or a conversation-led evening. The song choice alone does not establish heartbreak, a preferred music genre or tolerance for crowds. The other song is not rejected. This is a hypothesis, not a hidden constraint.

**Branch:** No dance floor bypasses A2's dance framing and proceeds to conversation-focused scenes; no music-heavy sequence is forced. If the user says “Anything, just show places,” give matches now. If music is unavailable, replace the song test with two original scenes of joyful communal dancing and a smaller emotionally absorbed dance moment, plus the conversation scene. Label **“Scene version · audio unavailable.”** Retain only the visual response, not a supposed Robyn preference.

**A2 · Follow the selected reason; fries are one possible scene**

Before A2, invite a reason for the selected recording with concrete optional responses (or the user's own words). The same Robyn choice must not hard-code a shop: “I want to sing with my friends” can lead to the small shared-food scene; “I want to feel anonymous for a while” can lead to an original city-at-night scene with space to be alone; “I just want the beat” can lead to a physical-energy comparison. These are contextual proposals, not artist-to-scene mappings. If the reason is unclear, ask a useful contrast rather than inventing an emotional arc. The AI chooses the next visual from approved assets using that reason, corrections and the accumulated vibe. Music rights and availability remain separate gates.

The following fries example applies only to the shared-connection branch:

Screen: **“This song. These fries. Explain why this is suddenly the best part of the night.”** No typed explanation is required.

An original bright takeaway-shop image: three friends in coats, a paper tray between them, the rest of the room almost empty. Buttons **Keep dancing / Get the fries** switch between that image and an original dance-floor image with the same friends. In the fully cleared target, the selected recognizable recording stays the same across both images; users explicitly start it. No edit to the recording or promised chorus cue.

The surprise is deliberate: emotionally expansive dance music against an ordinary bright little shop can make eating fries together feel like the night's emotional climax. That is a proposed artistic effect, not an automatic interpretation of every choice.

**Sample action:** try both, choose the shop, then tap **“Still buzzing. Now I can actually hear my friends.”** Other response: **“Honestly, it's the fries.”** Say it my way remains available.

**Read-back:** “Keep the buzz; make room for your friends.”

**New information:** the user wants energy to turn into connection later. Their explicit reason distinguishes that progression from merely wanting food. A1 established neither an ending nor conversational space. Do not infer cuisine, lighting tolerance, opening hours or an actual two-stop booking.

**The three honest demonstration modes:**

- **Recognizable target:** exact real recording paired with original images only after verified rights cover this interactive audiovisual use. Authorized standalone playback at A1 does not clear A2.
- **Original-audio prototype:** hold the shop image constant and compare two commissioned original cues, **big buoyant dance instrumental / sparse reflective piano**. Label both **Original demo music**. Prompt becomes **“Same fries. Two completely different nights. Which one are we having?”** This tests whether the landing should retain a celebratory buzz or become reflective. It demonstrates soundtrack transformation, not Robyn integration. It neither imitates the named recording nor overwrites an A1 correction.
- **Silent fallback:** compare dance floor and shop without music. Prompt becomes **“One more dance, or sit down with your people?”** This can establish a change of pace; it cannot validate the audiovisual effect. If A1 was also silent, do not mention “this song.”

If A2 yields sufficient direction and a useful eligible set, offer matches immediately. A3 is conditional, not a theatrical obligation.

**A3 · Optional: does this need one place or two?**

Only show when the desired progression remains useful but the session has not established whether changing venues is welcome.

Screen: **“The fries may be excellent. The logistics should not be a side quest.”** Two original three-frame strips show the same friends:

- **“Stay put.”** Dance floor → side room in the same imagined building → seated conversation.
- **“I'm up for a second stop.”** Dance floor → coats on outdoors → small food counter.

User previews either strip, then selects one. **Sample:** Stay put.

**New information:** willingness to relocate, a consequential outing-structure preference; no repeat of “want to talk.” Read-back: **“Somewhere lively with a place to sit and talk would be ideal. I'll look for evidence of both.”** This does not claim any venue supplies both, or that an illustrated transition is a routable walk.

**Final screen:** show the actual accumulated reading—e.g. “Dancing first; somewhere to hear your friends afterwards; prefer to stay in one place”—with Not quite and real eligible cards. If the catalog supports dancing but not a separate conversational space, name the gap. The map can soften its theme while maintaining a lively accent from the accepted profile. Pin changes require real matching, never the shop image or soundtrack timer. No fake late-night venue, route or illustrative line.

**A's asset minimum:** two real-recording reference records; up to two independently cleared standalone sources; one shop and one dance-floor original image; two original cues for the practical audiovisual build; optional stay/move strips only for A3. None of those recordings or art files has been produced or cleared in this task.

### Session B — engineering foundation: an afternoon with no assignment

**Initial input:** “Coffee. Brain's fried.”

**Existing practical controls:** café, solo, this afternoon. **Already known:** coffee and a desire for relief, with no diagnosis or cause inferred. **Still unknown:** whether relief means pleasant stimulation or fewer demands, and whether they want a short reset or somewhere to linger. Reading, silence and two hours are not established.

**B1 · Two ways to stop working**

Screen: **“Your brain has closed 47 tabs. Where does it go?”** Two original scene reveals:

- **“Let the room do something.”** Enter a bakery counter: a pastry has fallen over on its display card, a customer and server are laughing, hands arrange a fresh tray. There is ordinary activity to notice, not a staged show.
- **“I would like to become furniture.”** Enter a window nook: coffee within reach, a coat over the other chair, a notebook closed rather than waiting to be worked on.

Preview either, then **Put me here**. **Sample:** bakery counter.

**Read-back:** “A little life around you. No task attached.” Not quite.

**New information:** restorative ambient activity rather than reducing all stimulation. “Brain's fried” did not establish quietness or solitude within the room. The inference stays tentative; the joke is not a medical reading. No song, writing exercise or coffee-order quiz.

**B2 · Is this a pit stop or the afternoon?**

Gemini introduces the reference based on B1, not on the café category alone:

**“A little Kiki's Delivery Service bakery comfort? No delivery shift required.”** Below: **“Haven't seen it? Think a small bakery with everyday life going on around you.”** This is an offered association, not a film quotation or a promise to recreate its set.

Show two original continuations of the selected counter:

- Three self-paced frames: cup arrives → another tray comes out → you are still sitting comfortably. Button **“Let the afternoon happen here.”**
- Two frames: cup arrives → you leave with it and step into an ordinary street. Button **“Reset, then back out.”**

**Sample:** stay. **Read-back:** “Coffee, a bit of life to watch, and room to linger. That gives me something useful to look for.” Show my matches.

**New information:** dwell pattern. That can separate takeaway-led places from plausible sit-down candidates. It does not prove a two-hour policy, staff warmth, available seats or current noise. For B1's nook branch, reuse that nook and ask the same stay/go uncertainty; omit the bakery reference rather than forcing Kiki into it.

**Stop after two.** Do not add the former interruption test or ask whether they want warmth: the first answer supplied the kind of relief, and the second supplied how the place should fit the afternoon. If actual catalog information cannot distinguish further subtleties, another question has no value.

**B's asset minimum:** two original entrance/POV frames, a three-frame stay continuation and an exit frame for each branch, with shared compositions. No audio, animation, franchise images or licensed clip. Text reveals can be reviewed immediately; original art still requires production. This is the smallest scene-stage implementation that carries an answer into a coherent next beat.

### Session C — follow-up: the drawer has a smaller drawer

**Initial input:** “Something weird lol.”

**Existing practical controls:** exploring, with a roommate, this afternoon. **Already known:** novelty and a playful invitation. **Still unknown:** what kind of discovery is rewarding and whether they want to look closely or actively engage. Weird is not a scale, and eerie/kind/mechanical are not supplied in advance.

**C1 · Three small wrong turns**

Screen: **“I found three suspiciously small doors. This seems professionally responsible.”** No invented real-world claim: the visible label says **Imagined scene**.

Three original close-ups have **Open** controls:

- A drawer labeled with a hand-drawn street grid. Reveal: a miniature street inside, with a tiny upstairs light still on.
- A low brass handle. Reveal: a collection of mechanical birds repaired with mismatched parts; one seems to have a disproportionately large foot.
- An arrow pointing at an apparently blank wall. Reveal: move to the next still and the wall becomes a procession of painted little doorways seen from an angle.

Prompt after exploring: **“Which one gets an extra ten minutes?”** Explicit **Stay here** on each reveal; opening is neutral. **Sample:** miniature street.

**Read-back:** “A small thing with more to notice than expected.” Not quite.

**New information:** sustained close-looking and hidden detail appeal more than novelty alone; the reading is tentative. No claim that tiny models exist in Boston, or that unchosen birds are disliked. Static next-frame controls replace motion; text reveals remain coherent if art is missing.

**C2 · Museum manners, miniature edition**

Only the selected miniature scene continues. Prompt: **“A tiny door opens. A tinier sign says PLEASE DO NOT RING THE BELL. What kind of afternoon did we want?”** The sign is original fictional scene text, not a quote from a game.

Two original continuations:

- A miniature figure approaches the window; you discover little details as you look. **“Look closer. I respect tiny management.”**
- A visibly visitor-operated bell button sits beside the display; its label invites trying it. **“A button I'm actually allowed to press.”** A tap in the preview makes a tiny curtain lift, revealing another smaller display. No permissionless bell-ringing at a real venue is suggested.

**Sample:** permitted button. Read-back: **“Odd little discoveries you can actually interact with.”** Then Gemini may add **“A touch of Untitled Goose Game mischief, with permission this time.”** The index supplies the actual game's playful-mischief context; the model must not invent this miniature scene as a game event. If the user does not know the game, “Something to try, not just look at” carries the entire reading.

**New information:** hands-on participation rather than observation. That distinguishes interactive exhibits or workshops from passive displays where the catalog supports them. It does not establish vandalism, a need for games, or a wish to be frightened.

**Stop after two.** The old “kind versus precise birds” test and obligatory walk/café ending are removed. The selected details plus participation preference are enough to look for grounded options. If none support miniatures, show the nearest supported aspect—interactive discovery—with the gap stated. The map never gains a tiny-door pin or an invented exhibit.

**C's asset minimum:** three original close-up/reveal pairs; two continuation frames for the selected miniature route, including the smaller-display reveal. No game assets, soundtrack or physics. Prototype only that route first, with honest authored continuations for other choices rather than broken or forced paths.

### Redundancy and immediate-matches rules for these scripts

Reject these proposed follow-ups explicitly:

| Redundant question | Why reject it |
|---|---|
| “Do you want a fun night?” after A's input | Merely repeats the brief. A1 instead explores what fun could be. |
| “Would you like to talk to your friends?” after A2's explicit reason | Already answered. A3 exists only to resolve relocation, if still consequential. |
| “Do you need a break?” after B's input | Already supplied. B1 explores two different ways to get relief. |
| “Should people leave you alone?” after choosing an absorbing nook and staying | Reconfirms a reading while adding little catalog discrimination; offer matches. |
| “How weird?” after C's input | No meaningful ordinal scale; C1 offers incomparable discoveries. |
| “Would you like somewhere interactive?” after C2's permitted-button choice | Already learned. Do not ask the same uncertainty in plainer words. |

Two to four is an editorial target for these examples, not a new engine minimum. A useful answer, an explicit detailed correction or adequate starting text can justify results immediately. Keep the existing engine completion rules unchanged; use its always-available Show my matches for a two-answer or immediate exit rather than silently lowering automatic-stop thresholds. The original input “quiet coffee to read, under my entered budget, near my entered origin” may need zero quiz questions if further choices cannot change useful supported candidates. Ambiguities the catalog cannot resolve are disclosed rather than repeatedly queried.

## 5. Architecture review: fewer moving parts, more care

### 5.1 One generation operation per turn, with an application-owned brief

Reject the default two-call READ/PLAN → COMPOSE chain. Keep a revisioned Experience Brief in session state and return its update, the contextual interpretation, summary and next question together in one structured operation. This extends the one-operation summary/question pattern reported in the adaptive-engine handoff; it does not require a provider-model migration.

Proposed flow:

1. Load immutable original input, practical constraints, current validated brief, evidence and latest answer at session revision N.
2. Deterministically retrieve a small bundle of compatible authored templates, cultural references and available assets. Retrieve using the initial input plus current brief plus answer context, not category alone. Keep an authored media-free continuation in the bundle.
3. Make one structured generation request: interpret the answer in context; propose a brief update; produce `vibe_so_far`, qualifiers, continuation advice and the next question from that bundle. On the first turn, create the brief and first question together.
4. Validate IDs, provenance, anchor traces, rights/capabilities and bounded response. Schema correctness cannot establish creative quality or truthful inference. Commit only a coherent validated revision. If a next question is invalid but the interpretation is valid, an authored continuation may replace that question; incompatible state is never published.
5. Publish the accepted profile through the existing publisher, then run existing asynchronous MiniLM inference and ranking. Never wait for next-turn question assets before beginning that work. Original art remains independently preloaded where permitted.

Gemini supports structured schema output; its documentation still requires application validation of semantic correctness. This makes a combined response feasible, not proven fast or creatively good. See [Google's structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output).

The brief is an application-owned materialized view, not model memory and not independent evidence. Store anchor phrases, hypotheses with source IDs, confirmed interpretations, unresolved questions, current scene and presentation needs. Update from valid history; editing answer N truncates later history and rebuilds the brief from retained evidence/checkpoints. Preserve explicit corrections and their provenance. Do not repeatedly summarize the prior summary until it becomes its own source.

One call is the normal path; retain the existing bounded repair mechanism only as an exceptional path, with authored fallback on deadline. No compulsory live lookup, asset production, second creative-planning call or speculative generation for every answer. Retrieval that misses a new cultural reference can use original art now; background curation is not an extra blocking turn.

Google's [context caching documentation](https://ai.google.dev/gemini-api/docs/caching) describes token reuse subject to model/API conditions. Cache reusable instructions where supported; caching is neither durable session truth nor a guaranteed speedup. Retain the deployed model and API unless separately reviewed. No new latency numbers are claimed here. Measure submit → interpretation, submit → usable next screen, and submit → genuine map update, including cold/warm paths, asset failures and repair rate. Compare paired fixtures against the existing implementation before choosing a deadline or claiming improvement.

During a request, show the user's chosen moment and “Finding the next scene…”; never present an unvalidated inference as already understood. An authored explicit answer can be acknowledged immediately, but a media choice must not instantly trigger fixed semantic tags. Abort and session/revision guards prevent late generation, embedding or asset results from overwriting newer answers.

### 5.2 Four presentation types, not fifteen renderers

| Presentation type | Concepts served | Shared behavior |
|---|---|---|
| Scene stage | C, E and F | One frame or a short storyboard; two or three reveals; explicit commit; semantic button alternatives. F uses the existing map behind it rather than a new map component. |
| Scene variation | D | Two matched authored states; one meaningful difference; keyboard toggle and commit. No general scene editor. |
| Listening stage | A | One verified player, play distinct from select, pause on navigation, transparent failure. |
| Audiovisual comparison | B | One changed dimension at a time; exclusive original/cleared audio; explicit pairing capability. Reuse scene assets and controls. |

Correction, skip, neither, unfamiliarity, history and read-back belong to the shared shell. Optional text is a correction control, not a fifth creative renderer. No `compound` recursion, draggable timeline, markup engine, word tiles, dial or ladder in the prototype. Exact schema design waits for contract review.

### 5.3 Two catalogs with different authority

**Cultural-reference index:** verified titles, creators, versions, concise original descriptions, source references and fact-check status. It may contain songs, films, TV, games, characters, memes and cultural moments with no playable/displayable asset. It supports richer language and discovery without pretending there is media permission. Curated retrieval descriptors are possible associations, never fixed meanings or personality labels. A meme or cultural moment needs a verifiable identity/context; popularity and relevance must not be guessed from the user's age or school.

**Verified asset registry:** actual media identifiers and resolvable locations, rights holder/source, permitted uses, attribution, modification/pairing permission, territory/access limitations, verification date and status, alt text and sensory descriptions. Only the resolver provides URLs. An asset can link to a cultural reference, but reference existence never implies asset availability. Keep rights clearance and current technical playability separate; a successful oEmbed fetch proves neither permission nor full-track access.

Generation chooses reference IDs and asset IDs from supplied candidates; it writes no URLs, provider IDs or embed HTML. An unknown user-named title remains verbatim user text marked unresolved, with no invented scene facts. Broader cultural curation can add references without clearing new media. No external lookup on the hot path is needed for the first demo.

The original spec's Spotify-first recommendation is unsuitable as a default. Spotify's [Developer Policy](https://developer.spotify.com/policy) and [compliance guidance](https://developer.spotify.com/compliance-tips) restrict quiz integrations and audiovisual synchronization; its [Widget Terms](https://developer.spotify.com/documentation/embeds/terms) also restrict synchronization. Treat that as a design constraint: a player widget is not clearance for B, and this quiz should not ship Spotify integration on assumption. This is a conservative implementation recommendation, not a claim about an adjudicated legal classification of Vibenta.

For a verified official YouTube source, use the visible, unaltered provider player only where permitted for the actual experience. Never extract its audio, hide its video, suppress required controls/branding or repurpose it as a soundtrack. [YouTube's developer policies](https://developers.google.com/youtube/terms/developer-policies) and [player documentation](https://developers.google.com/youtube/player_parameters) are relevant primary checks. No official upload or specific recording has been verified for this draft. Apple Music is not presumed to solve these rights questions either.

### 5.4 Contextual evidence, preserved engine

Replace deterministic unit-level `signal.text` as the authority on media meaning. Determinism belongs in recording what happened and checking provenance; interpretation needs the whole session and a visible chance to correct it.

Record the exact question/version, reference/asset IDs, selected scene or pairing, any explicit explanation, source answer and session revision. Do not collect dwell time, listening history, contact information or replay counts as preference evidence. Looking, playing and opening are neutral. Unchosen options are not disliked. Unfamiliarity is neutral. A rejection applies to its stated context, not an entire genre or unchosen future step.

The combined generation operation proposes a narrow interpretation with cited sources. The user sees it immediately with Not quite; optional confirmation is appropriate where the proposed meaning is especially ambiguous, but a mandatory approval dialogue on every answer would break the experience. Mark unconfirmed readings as tentative and prevent them from becoming durable explicit dealbreakers. “Want to dance” from the user's input is explicit; “seems to want shared release” from a song reaction is provisional. The brief cannot promote that to a fact merely through repetition.

Preserve the existing accumulated profile, evidence ledger, correction/retraction/replay, `vibe_so_far`, completion controls, pinned MiniLM identity and single query/catalog embedding space. Translate retained interpretations into venue-describable language for MiniLM while preserving the reference context separately for the next question. A cultural title is not the query's whole meaning. No per-track trait vector, personality score or replacement embedding model.

MiniLM's weak negation/nuance remains a limitation. Explicit exclusions remain explicit; do not rely on embedding “not packed” to enforce occupancy or noise guarantees. Hard filters need supported facts. No evidence of current crowding means unknown. Preserve unresolved combinations (“eerie and kind”) rather than averaging them into a generic midpoint. Existing numeric similarity and map-theme signals are system outputs, never user personality measurements.

**Proposed interfaces only:** the brief, media/reference provenance, a minimal presentation discriminator and contextual interpretation drafts may require additive changes to the vibe session's profile/generation/evidence schemas. Review those with the vibe owner before implementation; do not declare version 1.1.0 approved. `Place`, `TransitRequest`, `TransitResponse`, coordinates, coordinator lifecycle and place-ID selection remain unchanged. No executable type or shared contract changes in this task.

### 5.5 Living Map and Scene Composer

The map participates in the story, but must remain geographically honest:

- Reuse the existing publisher → SceneIntent adapter → map/theme/convergence path. Proposed scene beats are presentation needs, not permission for the quiz to import map internals or mutate Composer-owned code.
- Previewing art or audio is reversible and creates no ranking evidence. After a committed answer, accepted profile interpretation may update theme; only successful compatible embeddings and real catalog records can update prominence. Never choreograph pin changes by question number.
- Imaginary interiors live in an art stage with a visible label. No generated building, hidden door, glowing destination or fictional crowd is attached to real coordinates. Genuine cards use real evidence/photos, separate from inspiration art.
- At the final beat, retain the same scene's emotional palette while exposing real candidates. Navigation, selected place, origin, attribution, routes and contrast take precedence over atmosphere. No pin movement or invented path geometry.
- Idle shows the starting map; processing preserves the prior accepted state with a loading indication; success publishes one coherent revision. No compatible vectors leaves ranking unchanged with an honest notice. Generation/embedding errors offer retry or authored continuation. Place selection still uses existing origin-required, loading, ready, no-route and error states, with stale response guards.

Scene Composer involvement beyond its current adapter is a coordinated follow-up proposal. First prototype uses original scene art in the quiz and approved existing theme capabilities. An unsupported effect is omitted; its appearance must never be used as evidence that matching worked.

## 6. Realistic asset production

Start with one art-directed pack for each of the three scripts, not a generic bank of 40 photos and 25 songs. Reuse camera position, characters without identifiable likenesses, and compositions between reveals/variants. A storyboard contact sheet must be judged before finished artwork. AI generation is a proposed production option, not authorized implementation here: use it offline for original atmospheric backgrounds, then have a human correct continuity, text, geometry and accessibility descriptions. Do not generate franchise characters, imitation screenshots or images passed off as Boston venues.

Maintain creator, tool/model/version if generated, production date, prompt/source inputs, asset hash, edits, consent where relevant, attribution and permitted uses for every image and cue. Unknown provenance cannot become “team-owned” merely by copying a file. Human or AI-made atmospheric art is always labeled as original/AI-generated inspiration, and never reused as a real candidate photo.

For real Boston imagery, use independently verified team photographs with permission, commissioned material, or individually verified openly licensed files with required credit and adaptation obligations. Public visibility alone is not permission. The earlier blanket claim that CC BY-SA forbids adaptation is inaccurate; the prototype can simply exclude those adaptations to avoid extra obligations, without rewriting what the license permits. No external image API or museum object is needed for sessions B/C.

For recognizable music, first identify the exact recording and applicable authorized delivery route. Identity, excerpt access, use permission and technical playback are four separate checks. Do not promise a chorus, drop, seek position or preview duration until the actual source supports it. For audiovisual comparison, separately clear the composition and recording for the planned use or use commissioned originals with explicit interactive pairing rights. Never substitute an invented song under a familiar title. If a cultural track cannot play, its name remains a text reference and the script uses the disclosed visual continuation.

The practical first pack is B's scene art plus one reusable scene-variation pair, followed by A's original-cue audiovisual comparison. Recognizable standalone music is a parallel dependency, not a reason to block the entire demo or claim the full target experience has been achieved. No actual artwork, recordings, rights or playable URLs are asserted by this specification.

## 7. Creative evaluation that can reject the proposal

Mechanic novelty receives no points. Beautiful decoration cannot rescue a survey. A simple image comparison can pass when the actual images create an experience worth seeing.

**Hard rejection gates:**

1. The prompt can be moved unchanged to a substantially different initial vibe and still fit equally well.
2. The experience reduces to adjective selection or a preference checklist when its decoration is removed, and its media adds no meaningful perception, surprise or emotional context.
3. The inference claims more than the response establishes, treats ambiguity as error, or assigns fixed traits from a work/genre.
4. It requires disclosure, writing, franchise familiarity, hearing, timed motion or expensive interaction to continue.
5. Its media/availability claims are unverified, its reference facts are invented, or its map depicts imagined material as real.
6. It repeats information already supplied without a fresh experience or consequential clarification.

For survivors, two reviewers assess the following independently using **fails / promising / compelling**, with a short concrete reason. No aggregate score can compensate for a failure:

| Criterion | Evidence for “compelling” |
|---|---|
| Emotional event | Reviewer can identify the specific reveal, juxtaposition, recognition or felt anticipation—not merely “nice visuals.” |
| Desire to continue | A user wants to try the next beat before being promised better recommendations. Observe voluntarily exploring/replaying; do not turn this into hidden preference tracking. |
| Personal relevance | Names the exact initial phrase or prior choice this interaction brings to life. |
| Continuity | The next beat carries an image, feeling or unresolved tension forward without repeating the answer. |
| Honest discovery | The resulting reading is narrow, correctable and useful for distinguishing plausible outings. |
| Cultural specificity | When used, the actual work contributes something more precise than “cinematic”; an unfamiliar person can still participate. No quota for cultural mentions. |
| Sensory integrity | The key effect survives accessible alternatives, and unavailable media is disclosed without pretending the user experienced it. |
| Effort and pacing | The payoff arrives before controls or instructions become work. No required creative-writing performance. |

Evaluate full sessions, not isolated clever prompts. Review the three scripts on opposite answer paths, with a mid-session correction, silence, missing assets and unfamiliar references. Ask “What did you imagine wanting to do?” and “Where did you feel the app misunderstood you?” If the answer is “I chose my favorite music/color” without a desired experience, revise.

A fully implemented sequence is not creatively accepted until real users have tried it. These examples are candidates for judgment, not self-certified successes.

## 8. Minimal prototype plan and measurable acceptance

This replaces the earlier renderer-first ordering. Architecture approval is design-direction approval only. Existing engine contracts, evidence/correction semantics, MiniLM, completion rules and publisher remain intact. Any additive brief, provenance or presentation interface remains a proposal pending owner review; an integration blocked on it must be reported, not bypassed with a second profile type.

| Priority | Deliverable | Minimum scope and gate |
|---|---|---|
| 1 · Session B, engineering foundation | One scene stage carrying a choice into its continuation, connected to the actual engine and map | Two B1 choices, stay/go continuations, existing correction/history/skip controls. Use authored scenes first; then the approved combined Gemini operation for actual contextual interpretation. Obtain owner approval separately if this requires additive interfaces. No new renderer for Kiki text, no audio or general Composer editor. Pass the integrated criteria below before adding sensory complexity. |
| 2 · Session A, flagship creative target | A1 → A2, with A3 only when relocation matters | Reuse scene stage; add one listening path and one comparison with one variable changing. Prove the original-audio comparison first. Keep recognizable playback and recognizable audiovisual clearance as separate gates. Silent completion is a fallback, never evidence that the flagship audiovisual goal passed. |
| 3 · Session C, discovery follow-up | Drawer → miniature reveal → permitted interaction → smaller reveal | Extend the same stage with hidden/revealed states and explicit commit. One fully authored miniature path first, then alternate doors. No new game framework, collectible system, procedural city or franchise media. |

### Media and asset dependency checklist

“Available now” means reviewable from existing text/verified identity, not that an application has been built. No new art or audio has been produced or cleared during this revision.

| Dependency | Can demonstrate/review now | Additional requirement before a working demonstration |
|---|---|---|
| Exact scripts, short inputs, branches, read-backs | Text/tabletop walkthrough of all three sessions | User review; these are unapproved creative examples. |
| Proactive named cultural references | Text-only names with primary identity sources linked in section 4 | Curate source-backed index records and original descriptions; identity checking does not clear media. |
| Session B | Text reveals and storyboard layout planning; no third-party media dependency | Produce/review original scene frames, alt text and branch continuity. The existing scene asset library may be inspected for reuse, but no suitable asset is assumed. |
| A's silent sequence | Honest scene-script walkthrough | Original dance-floor/shop images and explicit silent labeling. Demonstrates direction/progression only. |
| A's original-audio comparison | Composition brief and controls planning | Two original recordings, documented ownership/interactive pairing permissions, scene art, exclusive playback and sound-off path. This proves an audiovisual mechanism, not a recognizable-song integration. |
| A1 recognizable standalone listening | Real works identified from official sources | Verify the exact recording/source, permission for the actual quiz use, player terms, access/region behavior and target-browser playback. Preserve provider presentation. No arbitrary preview URL, extraction or assumed seek. |
| A2 recognizable recording plus imagery | Review the intended juxtaposition in words | Separately verified recording/composition permissions for the specific interactive audiovisual use. Ordinary embed availability is insufficient. Full flagship acceptance remains pending until cleared and tried. |
| C discovery | Text reveal with original fictional scene details | Produce original close-ups/reveals/continuations; no goose/game footage or characters needed. |
| Real catalog convergence | Existing pipeline design and adapter can be inspected | Owner-confirmed real catalog descriptions, stable IDs, exact compatible MiniLM fingerprint/vectors and functioning eligible-set integration. No synthetic vectors accepted for this gate. |
| Map/transit integration | Existing contract and adapter behavior | Run the actual selected implementation worktree with configured catalog/provider dependencies; preserve coordinates, IDs and request revision guards. No assumption that this workspace contains the live engine. |

Keep the provider constraints in section 5 unchanged. Do not use approval of this design direction as permission to ship an uncleared provider integration or to alter executable contracts.

### First integrated prototype: acceptance sheet

These are proposed measurable gates, not results. Record exact implementation revision, input/answers, catalog snapshot, model fingerprint and media mode with each run. Use existing test/build commands from the implementation worktree; no new command is asserted to exist here.

| Gate | Pass criterion |
|---|---|
| Real answers update a real profile | For both B1 branches and both B2 stay/go choices (four runs), each committed answer appears once in existing history/evidence, updates the accumulated reading through the real engine/publisher and advances its existing revision. Preview/open/listen/skip/unfamiliar actions add zero preference evidence. The branch's actual answer—not a screen number—determines its continuation. |
| Correction changes downstream meaning | Edit or correct B1 in one run: the former reading and invalid later history are removed/rebuilt by existing semantics; the next summary reflects the correction. Repeat with two out-of-order generation/embedding responses: zero stale results replace the latest state. No second evidence ledger or preference-score model. |
| Genuine compatible catalog ranking | Use the exact pinned MiniLM identity/pooling/normalization/dimension for query and real catalog vectors, verified by the catalog owner. All returned IDs resolve to actual eligible records. Capture actual cosine scores and top-five IDs from two contrasting B answer paths; at least one top-five position or membership changes because of the profile. A hand-authored ranking, random score, fixture vector or incompatible model fails this gate. If the real catalog lacks the relevant distinctions, report the coverage failure; do not tune fake descriptions to pass. |
| Relevant matches, not merely moving pins | Before the run, a human reviewer identifies at least one plausible real candidate for each contrasting path from independent catalog evidence. In each run, at least one such candidate appears in the top five and its explanation cites that evidence plus a session preference. A rank change alone cannot pass. Missing current noise, occupancy, staff behavior or dwell-policy evidence is shown as unknown. |
| Truthful map state | Across the four runs, card order and pin prominence derive from the same latest genuine ranking; canonical marker coordinates never change. Uncommitted media previews cause zero rank changes. Profile-driven theme updates preserve geography, labels, selection and route visibility; no imagined scene becomes a real place photo or marker. |
| Missing-data honesty | Block vectors, return an incompatible fingerprint, fail generation, fail embedding and block scene images in separate runs. Zero invented rankings, routes or availability claims. Preserve the last valid state or disclose unavailable matching; authored/text continuation remains usable. “Atmosphere only” cannot be reported as the genuine matching gate passing. |
| Complete selection handoff | Select two real candidates quickly. Coordinator receives canonical IDs, retains the second selection and rejects stale responses. At least one supported real origin/destination yields actual normalized transit geometry with truthful source/time labels; separately exercise no-route and provider-error states. Origin is explicit. No quiz-produced route geometry. |
| No forced extra questions | All B paths can exit via Show my matches by answer two. An immediate-results control works before answering. A detailed correction that settles the direction does not cause a restatement question. Existing automatic stopping and ten-question cap remain unchanged. |
| Basic usability | Complete both B branches at desktop and phone widths with keyboard, images blocked and reduced motion; no inaccessible action, lost answer or focus trap. Original images have reviewed alt text. |

For real Gemini runs, separately record submit → interpretation, usable next screen and actual matching/map update over at least ten warm and three cold runs. Publish measured median/p95 plus fallback rate; do not declare an invented latency result or conflate CSS theme response with completed matching.

### Flagship creative acceptance after the foundation works

Run A with at least five people who were not given its intended emotional arc. Let them type their own short nightlife inputs. Record whether they take the offered direction or reject it; do not steer everyone toward Robyn and fries.

- At least four can explain what they want to do after the sequence without merely naming an artist or image color.
- At least three independently describe how the shop/recording juxtaposition changes the meaning of the ordinary setting. Do not feed them “intimate victory” first. Record disagreement, especially if the pairing feels manipulative or corny.
- All five can reject the musical direction or correct the reading without losing access to matches. At least one no-dancing path must run end to end.
- Label every run **recognizable paired / original audio / silent**. Only actual cleared recognizable-paired runs can satisfy the full flagship acceptance target. Original-audio results establish a promising mechanism; silent runs establish resilience.
- Reject an additional question unless reviewers can name the unresolved uncertainty and show how its answer could alter a supported recommendation or outing structure. A3 is omitted when relocation is already known or immaterial.

These small samples are prototype decision aids, not statistical validation. If the comedy or media comparison feels like work, revise the script before adding renderers.

## 9. Proposed changes relative to the starting specification

| Starting section | Review proposal |
|---|---|
| A, two-call pipeline | One combined structured turn; revisioned brief retained as application state; local retrieval first; existing bounded repair/fallback; benchmark rather than promise p50/p95. |
| B/D, fifteen interaction variants and renderers | Four presentation types serving six concepts; shared shell and provenance; no detailed new executable schema until owners review. |
| C, one registry controls references and media | Broad verified cultural index plus separately cleared asset registry; references can exist without media. Explicit pairing capability and separate rights/playability checks. |
| E.7, no consecutive mechanic/medium and per-type limits | Remove distribution rules. Judge continuity, effort and useful discovery. Repeat scenes, images or music when it improves the experience. |
| E.6/F.2, deterministic media-to-signal interpretation | Deterministic response/provenance capture, contextual tentative interpretation, visible correction and explicit constraints preserved. No fixed song traits or implicit negative evidence. |
| F, map integration only between questions | Include the Living Map in the final scene beat and use the current Composer adapter; proposed bridge work requires its owner's coordination. No fabricated venue imagery or illustrative navigation lines. |
| G/H, broad asset bank and sixteen independent examples | Three complete art-directed scripts; prioritize scene continuity, then controlled audiovisual work and cleared recognizable listening. |
| I, mechanical novelty rubric | Hard rejection gates plus qualitative session review; novelty/manipulation carries no intrinsic merit. |
| J, open decisions | Review this creative direction first; then brief/provenance interface additions, original/AI art policy, media source/rights and map-owner coordination. No decision silently ratified here. |

## 10. Review state and exact next step

The overall architecture is approved as a design direction. The user authorized only B1 → B2 as the first bounded implementation. That prototype now lives in the isolated `feature/quiz-v2-session-b` checkout; see [implementation report](SESSION_B_PROTOTYPE.md) for exact files, verification and limitations. Existing engine wire contracts remain unchanged; the local presentation registry is not approval of the broader additive interface proposals above.

Session A and Session C are not implemented. A's continuation must follow the user's selected reason and emerging vibe; fries are only one possible branch. Finished atmospheric artwork, live Gemini creativity and real compatible catalog matching remain separate acceptance gates. The next integration step is documented in the handoff rather than inferred from fixture tests.
