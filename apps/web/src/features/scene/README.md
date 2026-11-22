# Scene Composer: compiler, session and live-map hookup

**Status:** the compiler and session are pure (no MapLibre, DOM, Gemini or network access). `mount.ts` is the single hookup to the live map, through vibeTheme's `setScene()`. Presets and their capabilities: [PRESETS.md](PRESETS.md). Design: [docs/SCENE_COMPOSER_DESIGN.md](../../../../../docs/SCENE_COMPOSER_DESIGN.md) (PR #32). Assets: `public/scene-assets` (PR #33).

```ts
import { compileScene, buildAssetRegistry } from './features/scene';

const scene = compileScene({
  outing: sceneIntentFromGeminiOrFallback,   // untrusted; sanitized inside
  account: themeFor(accountState),           // vibeTheme's ThemeTarget, used only without an outing scene
  context: { navigation: 'browse', reducedMotion, performance: 'medium' },
  assets: registry,                          // optional; from PR #33 manifests
});
scene.palette;   // a full mapStyle `Palette`, contrast-guarded → vibeTheme applyPalette()
scene.hash;      // equal hash ⇒ nothing to re-render
```

### Session (phase 2)

```ts
import { createSceneSession, connectProfiles } from './features/scene';

const session = createSceneSession({ capabilities, assets, account, context });
const stop = connectProfiles(session, outingProfiles);   // adaptive vibe engine publisher
session.subscribe(({ state, diff, transitionMs, reason }) => {/* renderer applies `diff` */});
session.setContext({ navigation: 'route' });            // when a route is drawn
```

- **Stale rejection:** older versions, retired sessions, and intents produced for a different version are refused.
- **Cache and restoration:** looks are cached by a stable content hash (intent without its version, account, context). Undoing an answer, or ending navigation, restores exactly the scene shown before.
- **Hysteresis:** the scene on screen is fed back as `previous`. Discrete values get an enter/exit band and a challenger margin, and the guard keeps its pin edge and labels while they still pass. A neutral scene is always exactly the plain map.
- **Updates only on change:** the render hash excludes `sessionVersion` and diagnostics. Same input sequence ⇒ same update sequence.
- **Profile adapter:** a valid model `sceneIntent` on a profile is used; otherwise (or if it is invalid or stale) a deterministic fallback built from what the user *wants*, with presence growing per answer.

### Live map (phase 3)

```ts
// main.ts
const scene = mountScene({ theme: account.theme, account: account.store, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)') });
scene.setNavigation(true | false);            // from cancelRoute()/showRouteTo()
scene.connectProfiles(outingProfiles);        // once the adaptive vibe engine is merged (issue #41)
// dev only: window.vibentaScene.preset('neon_city', 0.6), .describe('rainy neon night'), .navigation(true), .clear()
```

- `MAP_RENDERER_V1` is exactly what `setScene` renders: palette, light intensity/angle (pin shadows follow), sky blends, fog color, transition timing, and the always-on pin ring.
- Updates are coalesced to one per frame (newest scene, its own transition timing). Navigation flags are coalesced per tick, so switching destinations stays in navigation.

### Navigation policy (ratified)
While a route or focused destination is shown, the scene **keeps its palette** and a safe version of its lighting (`dim` light becomes `subtle`). All atmosphere and cinematic overlays are removed except a soft edge vignette (≤ 0.35), ambient motion and pin pulses stop, and decorations and 3D set pieces are hidden. Navigation never turns the theme off.

## Pipeline

`sanitize → source (outing > account > neutral) → weigh presets → overrides → lock protected groups → constraint rules → clip to renderer capabilities → performance budget → realize → contrast guard → assets → hash`

- **Continuous palette, discrete labels.** Every weighted choice contributes to the palette in OKLab, so preset blends are real blends and small quiz changes are small visual changes. `resolved` holds the dominant value per key for discrete renderers (overlays, markers).
- **Weights may sum to < 1.** The remainder is the plain map, so early, low-confidence answers give a faint scene.
- **Honest capabilities.** A value is implemented only if a realizer exists (`swatches.ts`). Anything else is dropped and listed in `disabled`, never reported as active. `PALETTE_ADAPTER_V0` (128 of 828 variations) is what the existing `applyPalette()` can render with no map-owner change.
- **Legibility is enforced, not hoped for.** `guard.ts` keeps labels, pins and water labels at least as readable as WCAG targets or the plain map, by the smallest correction (label set swap or push toward black/white, then pin edges, and only as a last resort the ground lightness).

## Files

| File | Role |
|---|---|
| `catalog.ts`, `data/` | Strict parser for the PR #32 catalog (runtime copy; a test keeps it identical to `docs/`) |
| `intent.ts` | `SceneIntent` type and `sanitizeIntent` (never throws) |
| `presets.ts` | 10 art directions written only in catalog values |
| `lexicon.ts` | No-model fallbacks: descriptors / account vibe keys → presets |
| `swatches.ts` | What values look like: palette swatches, relations, grade operators, light/sky numbers |
| `capabilities.ts` | Renderer capability profiles |
| `constraints.ts` | Ordered conflict and safety rules |
| `realize.ts`, `guard.ts`, `color.ts` | Realization, contrast guard, OKLab math |
| `assets.ts` | Verified asset IDs from PR #33 manifests |
| `compile.ts`, `state.ts` | `compileScene`, `SceneState`, render hash, `diffScene` |
| `session.ts` | Scene Session: staleness, cache/restore, hysteresis, updates |
| `profiles.ts` | Adapter from the vibe engine's profile stream (structural types, no import) |
| `report.ts`, `PRESETS.md` | Preset capability report and identities |

## Extending

- **New look for a value:** add a swatch in `swatches.ts`. Tests require it to be a real catalog value and never a default.
- **New preset:** add catalog values to `presets.ts` (and, pending ratification, to `PRESET_IDS`). Tests validate every entry.
- **New renderer feature:** add its keys to a capability profile only once the renderer really draws them.
- **Pin contrast ring:** the live map draws an always-on two-tone pin ring (`MAP_RENDERER_V1` declares `pin_contrast_ring`), so light-to-dark transitions are continuous (see `hysteresis.test.ts`).

`npx vitest run src/features/scene`
