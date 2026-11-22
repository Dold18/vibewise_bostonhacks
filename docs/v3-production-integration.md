# Vibewise V3 — production integration report

Status: **integrated locally, not pushed or merged.** Branch `feature/vibewise-v3-full-integration`
in the worktree `~/Desktop/vibewise-v3-integration`.

| Item | Value |
| --- | --- |
| Original baseline | `916a88b` (main after PR #67) |
| Main incorporated | `d8014aa` (PR #68: Rank My Matches, recommendation focus, Vibewise rebrand), merged in `14a40d3` |
| Design source | `design/identity-exploration/v3/` at `e4588f4` (`design/identity-exploration-20261122`), read only |
| Not included | Open PRs #63 and #65 (not merged to main) |
| Backup ref | `backup/v3-before-main-d8014aa` (the branch before the main merge) |

## Architecture

- `apps/web/src/design/vibewise/` holds the shared identity: tokens, self-hosted fonts, the 80 V3 icons,
  wordmarks, aperture art, the exact V1 3C cradle geometry (`sheets.ts`) and the icon renderer
  (`icons.ts`). See `apps/web/src/design/README.md`.
- Each component keeps its stylesheet next to its module; each was rewritten in place on the V3 tokens
  (no override layer). Legacy token names are redefined in V3 terms in `tokens.css`.
- Behavior is untouched: handlers, state machines, ARIA, focus restoration, data and API contracts.
  Markup additions are limited to decorative, `aria-hidden` elements (cradle art, answer spine, letter
  badges, summary slips, artwork, pin glyph) and V3 icons that add no text to buttons.
- **Carbon** is the displayed neutral city (`mapStyle.neutralPalette`): initial style, the theme
  controller's plain state and the scene session `base`. `basePalette` remains the light reference the
  scene/atmosphere engines are tuned against, so their day/night semantics are unchanged (making Carbon
  the reference failed 9 engine tests that encode those semantics). No style reload.

## Deviations from V3 (and why)

| Deviation | Reason |
| --- | --- |
| Third quiz-prompt tier: >160 characters at 22px (19px on phones), Syne 700 | Generated prompts quote the user's words and reach 200+ characters; at the V3 long size (26/21px) they filled a phone sheet and pushed the answers off-screen. Still never truncated. |
| Question heading has no focus ring | It receives programmatic focus (tabindex −1) only so screen readers announce it; it is not an operable control. |
| Phone map controls form one row under the account key | V3 specifies the top-right placement for the expanded phone sheet; a column there collided with the dock at 320×640, so the row is used at all phone states. |
| Compass keeps a coral north dot | The V3 compass glyph is symmetric; the dot preserves the production north cue while rotating. |
| Rank badges and the Match strength legend | Not in V3 (added by PR #68); drawn from V3 primitives: ink disc, lime numeral, paper keyline, coral registration. Main's minimum-size formula is unchanged. |
| Phone legend below the control row | Main placed it top-left at 12px, which overlaps the V3 phone control row at 320px. Visibility logic unchanged. |
| Search / Saved rows lead with a CSS-masked V3 glyph | Keeps the existing row markup and handlers. |

## Coverage of the 48 audited V3 component families

Verification legend: **B** = checked in a real browser (headless Chrome, live dev server), **Q** = covered
by a repository browser QA script that passed, **F** = rendered with a labeled QA fixture because the live
service needs credentials, **U** = unit tests. Mobile = 390×844 and/or 320×640.

| # | Component | Production source | V3 reference | Status | Desktop | Mobile | Functional | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Quick Tools | discovery/ui/panelViews.ts | global | Done | B | B (390, 320) | Q | Smoke bar, V3 icons, lime Saved badge |
| 2 | Preferences shell / cradle | discovery/ui/panel.ts, design/vibewise/sheets.ts | preferences, collapsed | Done | B | B | Q, U (geometry) | Exact V1 3C outline, keys in the scoop |
| 3 | Activity | discovery/ui/selectField.ts | activity | Done | B | B | Q | |
| 4 | Cuisine / activity type | discovery/ui/multiSelectField.ts | multiselect | Done | B | single-column at 320 | B | |
| 5 | Origin autocomplete | discovery/ui/locationField.ts | location | Done | B | — | B | |
| 6 | Geolocation | discovery/locations.ts | location-error | Done (styles) | — | — | — | Error notice styled; no permission prompt triggered in QA |
| 7 | Budget | discovery/ui/selectField.ts | budget | Done | B | — | B | |
| 8 | Time / date | discovery/ui/timingField.ts | timing | Done (styles) | — | — | Q | Native date/time internals stay native |
| 9 | Qualifications / clear | discovery/ui/panel.ts | preferences-warning | Done | B | — | Q | Warnings are notices with a mark, not color alone |
| 10 | Vibe text / examples | discovery/ui/vibeStep.ts | vibe | Done | B | B | Q | |
| 11 | Reference images | discovery/ui/vibeStep.ts | upload | Done | B | — | Q | Local files only, limits unchanged |
| 12 | Search trip fields | navigation/ui/searchView.ts | search | Done | B | — | Q (navigation) | |
| 13 | Search result list | discovery/ui/panelViews.ts | search-results | Done | — | — | — | Legacy generic view, styled with the same rows |
| 14 | Saved list | discovery/ui/panelViews.ts | saved | Done | B | B | B | Empty, count, persistent/blocked note |
| 15 | Account trigger | account/ui.ts | account | Done | B | B | B | |
| 16 | Authentication form | account/ui.ts | signin | Done | B | — | B (validation) | No credentials submitted |
| 17 | Account panel | account/ui.ts | account | Done | F | — | — | Signed-in needs Supabase credentials |
| 18 | Clear-history confirmation | account/ui.ts | account-confirm | Done | F | — | — | |
| 19 | Map control stack | index.html, style.css | global | Done | B | B | B | |
| 20 | Map attribution | style.css | global | Done | B | B | — | |
| 21 | Map / catalog status toast | index.html, main.ts | map-error | Done | F | — | — | Message is set by the real `showToast`; specimen text only for the screenshot |
| 22 | Stylized city notice | city/disclosure.ts, style.css | global | Done | — | — | U | Inline colors moved to CSS |
| 23 | Quiz introduction / generation | vibe/ui/liveQuiz.ts | quiz-intro | Done | B | — | Q | Aperture art at the first question |
| 24 | Quiz shell | vibe/ui/liveQuiz.ts | quiz-standard | Done | B | B | Q | |
| 25 | Text choice | vibe/ui/liveQuiz.ts | quiz-standard | Done | Q | Q | Q | |
| 26 | Image choice | vibe/ui/mediaStage.ts | quiz-image | Done | B | B | B | |
| 27 | Progressive reveal | vibe/ui/mediaStage.ts | quiz-reveal | Done | B | — | B | |
| 28 | Image blend | vibe/ui/mediaStage.ts | quiz-blend | Done | B | — | B | |
| 29 | Listening | vibe/ui/mediaStage.ts | quiz-music | Done | B | — | B | No autoplay; player loads on request |
| 30 | Free text | vibe/ui/mediaStage.ts | quiz-freeform | Done | B | — | B | |
| 31 | Scene stage B1 | vibe/ui/sceneStage.ts | quiz-scene | Done | see results | — | — | Dormant on main; rendered via `setAuthoredSessionB(true)` |
| 32 | Scene stage B2 | vibe/ui/sceneStage.ts | quiz-moments | Done (styles) | — | — | — | |
| 33 | Media explanation / references | vibe/ui/mediaStage.ts | quiz-image | Done | B | — | — | |
| 34 | Evolving summary / evidence | vibe/ui/liveQuiz.ts | quiz-summary | Done | B | — | Q | |
| 35 | Answer history / correction | vibe/ui/liveQuiz.ts | quiz-history | Done | B | — | Q | |
| 36 | Completion / refinement | vibe/ui/liveQuiz.ts | quiz-complete | Done | B | — | Q | Includes PR #68 results action states |
| 37 | Final recommendations | main.ts, matchesView.ts | results | Done | see results | — | see results | Ranked and unranked |
| 38 | Venue popup | map/placePopup.ts | place | Done | B | — | B | |
| 39 | Venue popup actions | map/placePopup.ts | place | Done | B | — | B | Save, Saved, Navigate |
| 40 | Deal rows / badge | map/placePopup.ts, style.css | deals | Done (styles) | — | — | U | No place with deal records in the QA area |
| 41 | Venue / category pins | main.ts, style.css | markers | Done | B | B | Q | Glyphs, selection ring, rank badges |
| 42 | Pin labels / route markers | map/pinLabels.ts, map/routeHubs.ts | markers | Done | B | — | U | |
| 43 | Directions shell | navigation/ui/routePlannerView.ts | directions | Done | B | — | Q | |
| 44 | Route fields | navigation/ui/tripFields.ts | directions | Done | B | — | B | |
| 45 | Route lifecycle | navigation/ui/routePlannerView.ts | route-loading | Done | B | — | B | Live MBTA route returned |
| 46 | Itinerary | navigation/itinerary.ts | route | Done | B | — | B | Real MBTA line colors kept |
| 47 | Walking caveat | navigation/ui/routePlannerView.ts | route | Done | B | — | B | Shown as a warning notice |
| 48 | Secondary primitives | discovery/ui/dom.ts and the modules above | states | Done | B | B | — | Buttons, fields, chips, switch, notices, focus |

PR #68 additions (not in the V3 inventory):

| Component | Source | Status | Verification |
|---|---|---|---|
| Results action (Show My Matches → Finding your matches… → Rank My Matches ⇄ Show Unranked Matches, retry, empty) | vibe/ui/liveQuiz.ts, vibe/matchesView.ts | V3 styled; logic verbatim | see results |
| Rank badges on the top three pins | main.ts, style.css | V3 styled; scale formula verbatim | see results |
| Match strength legend | main.ts, style.css | V3 styled; visibility logic verbatim | see results |
| Recommendation camera (`recommendationFocus.ts`) | map/recommendationFocus.ts | Unchanged | U |

## Verification

(See the final section for exact commands, counts and screenshot paths.)

### Results at the final commit (2026-11-22)

- `npx tsc --noEmit`: pass. `npx vitest run`: 95 files / 1118 tests pass. `vite build`: pass.
- `scripts/vibe-browser.mjs` (after the main merge): 29/29 pass.
- `scripts/rank-matches-browser.mjs`: 28 checks pass, then the run stops at "click pins 1, 2, 3"
  (the pin lookup returns null). **Untouched main `d8014aa` stops at the same step with the same
  28 identical passes in this environment**, so this is environmental, not a V3 regression. Separately
  verified in the browser: Show My Matches → Finding your matches… → Rank My Matches ⇄ Show Unranked
  Matches, top-three badges and accessible rank labels, scales of 1.6 and below, legend shown only
  while ranked, no camera move on rank/unrank, and 0 badges after unranking.
- `scripts/quiz-media-browser.mjs`: 15 pass, 1 fail ("no single preset dominates final city scenes").
  Without a Gemini key every run gets the same local questions; not a styling issue.
- `scripts/check-navigation-browser.mjs`: 47 pass, 9 fail. All failures assert the pre-V3 look
  (blue Preferences header, flush card edges now offset by the coral registration, white pin
  edges) and need updating to the V3 design; they are not functional failures.
- `scripts/session-b-browser.mjs`: marked RETIRED in its own header; the scene stage was rendered via
  `setAuthoredSessionB(true)` instead.
- Not verifiable here: Gemini questions (no `GEMINI_API_KEY`; the local fallback director was used),
  signed-in account (real Supabase login not attempted; rendered with a labeled fixture store).
