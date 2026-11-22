# Vibenta visual identity redesign: status

Status as of 2026-11-22. Covers the graphite identity (Phases 1–5 of the redesign brief): base city and roads, identity, ground textures, scene coherence and QA.

## Where the work lives

- **Branch:** `design/vibenta-identity-20261122`. It started from `main` at `9f4689e`, merged PR #44 (V2 quiz launch) before it landed, and later merged `main` again (#54–#58, including the multimodal quiz), so the diff against `main` is redesign-only.
- The quiz is styled from `design/identity/quiz.css` (scoped under `.vb-discovery`), including the `.vb-media-*` and `[data-mood]` classes of the multimodal quiz, so `features/vibe/ui/quiz.css` is not edited.
- **PR #51** (Carbon Studio draft) was reviewed but **not** merged or stacked on. The new identity is a separate, default implementation.
- **Do not merge to `main` without approval.**

### Commits on the branch (oldest first)

1. `a680902`: merge of PR #44
2. `f4fb1de` **Phase 1**: road widths, neutral atlas palette, OSM material tones, contact shadows, QA harness
3. `30bd45c` **Phase 2**: identity (icons, wordmark, type, die-cut surfaces, scene accent)
4. `2f2df52` **Phase 3**: ground material textures, facade spike evidence
5. `70d4ac3` **Phase 5 fixes**: scene accent without an extra session listener, static material layers, keyboard input in the harness
6. `cb4d265`, `431d694`, `d552329`: navigation-suite identity check and animation settle, brick tone, urban texture removal, zoomOut icon, final evidence
7. Merge of `main` (#54–#58)

## Running it

```sh
cd apps/web
npm ci
npx vite --host 127.0.0.1 --port 5196 --strictPort    # the redesigned app
npm test                     # vitest
npm run build                # tsc + vite build
node scripts/visual-identity-browser.mjs [shots.json]  # screenshots (headless Chrome, GPU)
```

- Before/after comparisons were made against a detached worktree of the pre-redesign commit `a680902` served on port 5197 (`git worktree add --detach <dir> a680902`).
- Dev console hooks:
  - `vibentaScene.preset('neon_city', 1)` (also `amber_refuge`, `noir_nocturne`, `neutral`, …)
  - `vibentaScene.map`
  - `vibentaMaterials.stats()`, `.setEnabled(false)`, `.setStrength(0.5)`, `.setSurface('water', false)`

## What is done

### Phase 1: base city and roads (`src/mapStyle.ts`)

- **Road widths** at z14/z20:

  | Road | Before | After |
  |---|---|---|
  | Motorway | 6 / 32 | 3.5 / 17 |
  | Primary | 5 / 28 | 3.2 / 15 |
  | Secondary | 4 / 24 | 2.5 / 12 |
  | Minor | 2.5 / 18 | 1.8 / 9 |
  | Service | 0.8 / 8 | 0.6 / 5.5 |

  Casings dropped from +1/+2/+3 px to +0.5/+1.1/+2.2 px.
- **Neutral architectural-atlas palette**: paper ground, stone/concrete/glass building tones, muted amber highways. I tuned it until the existing vibe-blend and pin-contrast tests passed again without loosening them; every vibe still restyles the map by at least 20/255 mean.
- **Material tones**: each of the 6 height bands is split into 5 layers (30 extrusion layers in total). Tones come from OpenMapTiles' OSM-derived `colour` (`building:material`):
  - brick/clay/wood → warm
  - stone/concrete/plaster → stone
  - glass/metal → cool
  - untagged buildings → two neutral tones split by feature id

  Tones are OKLab offsets of the palette band color, so scenes recolor them with transitions and no paint is data-driven. Exports: `BUILDING_MATERIALS`, `buildingLayerId`, `materialColor`, `buildingMaterialColors`. `BUILDING_3D_LAYERS` now lists all 30 layers (`main.ts` uses it for the pitch fade).
- `SceneStyle.materialVariation?` (0–1) flattens the tones; `SceneStyle.materialStrength?` sets ground-grain strength.
- **`building-contact-shadow`** layer: the footprint offset by 2.5/2 px in the viewport, under the flat footprints.
- **`transport-area`** layer: OSM pier, wharf and pedestrian-plaza polygons, which weren't drawn before, in `palette.path`.
- **Performance**: 51–58 fps after vs 55–59 before (p50 ≈ 17 ms in both) during camera rotation, in headless GPU Chrome.

### Phase 2: identity (`src/design/`)

- **`icons.ts`**: an original 26-icon family in a screen-print style (an off-register `vx-i-pop` color region, `vx-i-ink` marker strokes, plus `vx-i-thin`/`vx-i-dot` details). Each icon's pop color is set per meaning: cobalt = wayfinding, coral = personal/saved, lime = default. It's wired through the existing `icon()`/`ICONS` in `discovery/ui/dom.ts` (same API; raw path strings still work), `placePopup.ts`, `routeHubs.ts`, `account/ui.ts`, `vibeStep.ts`, and the map controls in `index.html` (the compass keeps `id="compass-needle"`).
- **`wordmark.ts`**: a hand-lettered SVG wordmark (an ink pass plus an off-register print pass, with a starburst for the dot of the "i"), inserted in the Preferences header in `panel.ts`.
- **Fonts** (SIL OFL, from Google Fonts in `index.html`): Londrina Solid for display, Bricolage Grotesque for the interface, Space Mono for labels. Noto Sans stays for pin labels. Also added `public/favicon.svg` and a theme-color meta tag.
- **`identity/`** CSS, imported **last** in `main.ts`:
  - `tokens.css`: Carbon ramp, accent roles, silhouette tokens, and legacy aliases (`--surface`, `--accent`, `--vb-*`)
  - `base.css`: type roles, icon CSS, wordmark, motifs (marker squiggle, starburst, loop arrow, halftone as masks), buttons, fields, popovers, checkboxes, focus
  - `surfaces.css`: Quick Tools, the Preferences signature silhouette, the stamped `01`/`02` step number, Search/Saved, Directions/planner, venue popup as an editorial card, account, map controls, toast, phones
  - `quiz.css`: vibe entry, the **Start vibe quiz** focal button, quiz cards, Session B scene stage, media stage
- **Silhouettes** use CSS `corner-shape` (bevel/notch/scoop) with offset "print" box-shadows. Nothing is clipped. Browsers without support fall back to asymmetric rounded corners.
- The light-theme "Blue accents" block at the end of `discovery/discovery.css` was retired, and a few hardcoded colors were replaced with tokens.
- **`sceneAccent.ts`**: `withSceneAccent(account.theme)` wraps the scene theme target in `main.ts`. Only `--vx-scene-accent` (the wordmark print pass, Quick Tools offset, and quiz loop arrow) and `data-scene-tone` follow the rendered scene. It adds no extra session listener.

### Phase 3: textures (`src/features/map/baseMaterials.ts`)

- Ground materials are rendered as MapLibre `fill-pattern` overlays of neutral alpha detail drawn over the palette fills:
  - water: `v1/water-shimmer`
  - parks and grass: `v2 nature_ground.short_grass.warm`, an atlas cell converted by `toDetail`
  - plazas and piers: `v1/cobblestone-hatch`
- Only those 3 assets load, lazily after the map is idle.
- **No urban-ground texture** (session 2). `v1/concrete-pores` was dropped: it's a flat 13% grey wash with sub-pixel dots at 1–17% opacity, so on/off screenshots of the South End showed no visible grain at 0.4 or 0.6 opacity, only a tint. Dropping it also removes a full-coverage overlay layer.
- The overlay layers are **part of the base style** (`withMaterialOverlays` in `buildMapStyle`). Images start as transparent placeholders (via `styleimagemissing` and pre-registration) and get their real pixels through `map.updateImage`.
- **Textured 3D facades are deliberately not shipped.** The `fill-extrusion-pattern` spikes showed four problems: it replaces the scene color, puts the same image on roofs and walls, tiles at a fixed screen scale, and streaks on walls at close zoom. Evidence is in `docs/qa/visual-identity/spike-*.jpg`.

### Phase 4: scene coherence

- Verified in the browser with real presets (`docs/qa/visual-identity/scenes-neutral-amber-noir-neon.jpg`): the identity stays constant, the city transforms fully, and only the accents adapt (amber, ice blue, violet).

## Verification so far

- `npm test`: **697 / 697 pass** (57 files, plus new `features/map/__tests__/baseMaterials.test.ts` and `design/__tests__/identity.test.ts`). Tests updated: `mapStyle.test.ts` (paint-only color check, material and width tests) and `vibeTheme/__tests__/apply.test.ts` (expects 5 material layers per band).
- `npm run build`: passes. The chunk-size warning was already there.
- **Browser regression suites, branch vs baseline (`a680902`):**

  | Suite | Branch | Baseline | Notes |
  |---|---|---|---|
  | `check-navigation-browser.mjs` | 56 pass, 0 fail | 56 pass, 0 fail | Re-run 2026-11-22 (session 2), see below |
  | `vibe-browser.mjs` | 30 pass, 0 fail | 30 pass, 0 fail | Re-run 2026-11-22 (session 2) |
  | `session-b-browser.mjs` | 73 pass, 4 fail | 73 pass, 4 fail | Same 4 failures on both |

  - **Navigation:** the old blue-header check now asserts the identity (header in `--vx-text` with Londrina, coral `::after` marker, `--vx-text-faint` labels), resolved through a token probe. The baseline fails it, as it should. `mobile Directions … onScreen` was flaky, and the cause wasn't the CSS: under swiftshader the page runs at a few fps, so the sheet was measured on the first frame of `vb-sheet` + `vb-enter` (24 + 8 = 32 px below the fold). The suite now waits for finite animations to finish (`settled()`) before measuring. `Exit … releases pitch` failed once, only while two swiftshader suites ran in parallel. Run the suites one at a time.
  - **Vibe:** the `listeners===1` failure is fixed by `withSceneAccent`. Confirmed 30/30.
  - **Session B:** the same 4 failures exist on the untouched baseline (390 px "preview leaves map unchanged", the two "Gemini failure authored B1/B2" checks, and harness `Invalid InterceptionId` errors), so they're pre-existing.
  - **Software-GL frame rate (corrected).** An earlier single sample (3 vs 6 fps while mobile Directions was open, machine load ≈12) suggested a 2× regression. A controlled bench does **not** reproduce it. The bench uses SwiftShader at 1440×900, a static camera with every tile loaded, continuous repaint, 6 s windows, and alternates branch and baseline in rounds. Median p50 frame time:

    | View | Baseline `a680902` | Branch | Branch, textures off | Branch, all new map effects off |
    |---|---|---|---|---|
    | 3D downtown, z15.5, pitch 60 | ~157 ms | ~159 ms | ~151 ms | ~149 ms |
    | 2D river, z13.2 | ~149 ms | ~138 ms | ~106 ms | ~101 ms |

    - The ground textures are the largest new cost: about 20–25% of frame time when water and parks fill a 2D view, about 5% in 3D. The contact shadow costs about 10% in 3D downtown and is inconsistent in 2D.
    - Collapsing the 30 material layers to 6 gave **no** gain. The identity CSS (no backdrop-filter or blend modes) has no measurable cost.
    - Run-to-run noise on a loaded machine is ±30%, so only effects that win in every round are reported.
    - Recommendation, not implemented: on a software renderer (`WEBGL_debug_renderer_info` reports SwiftShader/llvmpipe), call `vibentaMaterials.setEnabled(false)` and hide `building-contact-shadow`. GPU users keep full quality. Measure that combined config before shipping it.
- **Screenshots** captured: 1440×900, 1366×768, 390×844, 360×640. States: default, dropdown, vibe step, quiz, quiz launch, search, saved, venue popup, mobile sheet, mobile dropdown, keyboard focus. Road zooms: z12/z13 2D, z14/z15/z16/z17.5 tilt, z16 2D. Committed evidence is in `docs/qa/visual-identity/`.
- **Keyboard:** Tab and Enter work. Focus rings are cobalt-light (`#a3b5ff`); field triggers show focus with a cobalt border and ring. Tab order still starts at the map pins (their DOM order), which is existing behavior.
- **Reduced motion:** the harness emulates `prefers-reduced-motion: reduce` by default, and the identity's transforms and transitions are disabled under it.

### After merging `main` (#54–#58)

- `npm test`: **721 / 721 pass** (60 files). `npm run build` passes.
- `check-navigation-browser.mjs`: **56 / 56**.
- `vibe-browser.mjs`: 29 pass, 1 fail: `fallback answer reaches MiniLM with explicit exclusion`. **Pristine `main` (`7148c1b`) fails the same check**, so it comes from the #57/#58 vibe changes, not the redesign.
- `quiz-media-browser.mjs` (multimodal quiz; local director, no Gemini key): **16 / 16 behavior checks** at 1440 and 390. Screenshots show the media stage, credits, view toggles, free-text answer and option cards in the identity.
- `session-b-browser.mjs` was retired on `main` and is no longer run.

## Remaining work / next steps

1. ~~Re-verify after the last refactor~~ Done (session 2): vibe 30/30, navigation 56/56, `stats().loaded` lists every surface with no errors, and grain is visible on City Hall Plaza, the Common and the harbor (`materials-*.jpg` recaptured).
2. ~~Update the outdated navigation check~~ Done (session 2).
3. **Account popover:** styled but **unverified in the browser**, because accounts are disabled without Supabase env ("Accounts unavailable"). Verify it with credentials.
4. ~~Route planner and Directions screenshots~~ Done (session 2): `directions-1440-before-after.jpg`. District labels on the dimmed navigation map render as hollow outlines on **both** baseline and branch (pre-existing, not changed here).
5. ~~Recapture the final evidence~~ Done (session 2): road/building pairs re-shot after the brick change; `ui-1366-default.jpg`, `ui-360-sheet.jpg` added.
6. **Optional polish:**
   - ~~`zoomOut` pop smear~~ Now an off-register dot like `zoomIn` (session 2). The map controls are static markup in `index.html`, so icon edits must be mirrored there.
   - ~~z17 brick roof tone too warm~~ Brick OKLab shift reduced from [-0.07, 0.013, 0.016] to [-0.065, 0.0095, 0.012] (session 2).
   - ~~`v1/concrete-pores` urban grain~~ Dropped (session 2, see Phase 3).
7. ~~Update `apps/web/src/design/README.md` with an Identity section~~ Done (session 2).
8. **Push the branch and open a draft PR** against `main`, but only with the user's approval. Note in the PR that it's stacked on #44.

## Known limitations

- `corner-shape` silhouettes need Chromium 139+. Safari and Firefox get asymmetric rounded corners.
- Fonts load from Google Fonts, as the existing app already did; the redesign doesn't work offline unless the fonts are self-hosted.
- The facade textures are not implemented (renderer limitation, documented above).
- The scene's `ui.accent` is clipped by `MAP_RENDERER_V1`, so the accent is normally derived from the scene's compiled sky color.
- Session B quiz media classes (`.vb-media-*`) are styled ahead of time from the uncommitted local work, but couldn't be viewed on this branch.
