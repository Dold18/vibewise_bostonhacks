# Scene Composer: compiler (phase 1)

**Status:** pure library, tested, **not wired to the map**. Nothing here touches MapLibre, the DOM or the network. Design: [docs/SCENE_COMPOSER_DESIGN.md](../../../../../docs/SCENE_COMPOSER_DESIGN.md) (PR #32). Assets: `public/scene-assets` (PR #33).

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
| `compile.ts`, `state.ts` | `compileScene`, `SceneState`, hashing, `diffScene` |

## Extending

- **New look for a value:** add a swatch in `swatches.ts`. Tests require it to be a real catalog value and never a default.
- **New preset:** add catalog values to `presets.ts` (and, pending ratification, to `PRESET_IDS`). Tests validate every entry.
- **New renderer feature:** add its keys to a capability profile only once the renderer really draws them.

`npx vitest run src/features/scene`
