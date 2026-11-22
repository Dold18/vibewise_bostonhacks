# Universal procedural scene composer

Turns evolving user preferences into a **unique, coherent city world per session**, built from reusable parts instead of a list of named scenes. Pure TypeScript: no MapLibre, DOM, Gemini or network access.

```
signals ──interpretSignals──▶ style point + hints + confidence
        ──composeWorld(seed)─▶ Composition: one reusable part per slot, harmony, emphasis, focal points, params
        ──encodeComposition──▶ SceneIntent (≤3 preset anchors + ≤12 overrides), verified with the real compiler
        ──SceneSession.submit▶ SceneState  (the source of truth, unchanged)
        ──deriveCityPlan─────▶ CityRenderPlan: every catalog value read back from SceneState
```

```ts
import { createComposerDriver, buildAssetTagIndex } from './features/scene/composer';

const driver = createComposerDriver({ session, sessionId, capabilities: MAP_RENDERER_V1, assets, assetIndex });
driver.update({ mood: ['cozy'], music: ['jazz'], timeOfDay: 'night', progression: { answers: 3 } });
driver.getPlan();                          // CityRenderPlan
driver.undo();                             // restores the previous scene exactly
driver.setContext({ navigation: 'route' }); // route navigation through the driver (see limitations)
```

## How arbitrary combinations work without predefined scenes

1. **Continuous style space** (`axes.ts`): 11 axes (warmth, luminance, energy, chroma, ornament, era, nature, softness, grit, moisture, intimacy). Every input is a pull in this space (`signals.ts`), so "cozy + synthwave + noodle soup + dusk" is just a point, authored by nobody.
2. **Reusable component families** (`components.ts`): 17 slots (keystone light, grade, walls, roofs, edges, windows, street light, streets, greenery, water, air, particles, lens, medium, props, markers, motion), 155 parts plus a plain fallback per slot (≈5×10¹⁶ raw combinations). Each part is written only in catalog values with an ideal position in the style space.
3. **Per-slot selection** (`compose.ts`), keystone first: each part is scored by style fit, hint bonus minus anything to avoid, fit to the real swatch hues of the color harmony, and fixed per-session seed noise. Parts that conflict with what is already chosen are excluded. The plain fallback competes harder when this session de-emphasizes the subsystem.
4. **Coherence on catalog values** (`tags.ts`, `coherence.ts`): pairwise exclusion rules (time of day and light direction, weather, seasons, medium, noir vs whimsy, light vs dark ground...), one particle system at most, a visual-density cap, and explicit-only values. Rules are pairwise over non-default values, so clipping by capability, navigation or performance can only remove conflicts.
5. **Encoding through the existing contract** (`encode.ts`): presets are *anchors* placed in the style space, never the output. The encoder searches anchor subsets, spends overrides on the most important unrealized values (renderable values count 3×, and blends must reach adequate strength), compiles the candidates, repairs conflicts the anchors bring, and keeps the best. Without anchors the intent is a subset of a coherent composition, so the fallback ladder always ends coherent.
6. **Plan** (`plan.ts`, `decor.ts`): catalog values come from `SceneState.resolved`, and values a renderer cannot draw are listed as `pending`. Decoration uses only verified asset IDs whose tags carry no cuisine, culture, observance, seasonal or venue-feature meaning. Context-specific layouts need verified venue facts (seasonal: a verified seasonal fact; observance: the user's explicit opt-in). Decoration is hidden while navigating.

**Variation** comes from the seed: a small personality offset in the style space, the hue family within each harmony anchor, the harmony scheme, proportional emphasis across subsystems, part choice among near-ties, architectural parameters, and decoration distribution. **Progressive updates**: because noise is fixed per session, a small change only flips near-tied slots, and a sticky margin keeps the previous pick. **Undo**: compositions and their effective intents are cached by signal content, and the session caches compiled looks, so returning to earlier signals restores the identical `SceneState`.

## Safety

- National cuisines and religious or cultural observances are *recognized* (so they are never misread as style) but produce no style and no decoration. Dish words map to a dining mode ("noodle soup": warm, steamy, intimate), never to a culture.
- Spooky props only appear when the user's own words ask for them. Particle systems, artistic media and seasonal foliage need an explicit cue.
- Navigation-safe groups stay locked, geometry is never touched, and decorations are fictional and avoid routes, stops, pins and labels.

## Verification

- `npx vitest run src/features/scene/composer`: property sweeps over random never-authored combinations, seeds, minor vs major updates, undo, confidence, performance, explicit/avoid, cultural safety, unsupported-asset fallbacks, and a comparison against random catalog assemblies.
- Dev preview: `npm run dev`, then open `/composer-preview.html` (dev only; not a build input).
- Live map: `node scripts/composer-browser.mjs` (with `VIBENTA_QA_URL` pointing at the dev server) drives the preview and the real Boston map through `window.vibentaScene.session` with the composer driver, and asserts coherence, variation, navigation and exact undo.

## Known limitations

- **Live renderer coverage.** `MAP_RENDERER_V1` draws the palette, grade, light, sky, fog color and transitions. Facades, windows, street materials, atmosphere overlays and decorations are fully planned (`pending` in the plan) but only drawn once the world-surface, atmosphere and asset renderers declare them.
- **Override budget.** 12 overrides plus 3 anchors bound fidelity to the full composition (≈0.53 of all values; ≈0.97 of what the live map can draw).
- **Navigation context.** `SceneSession` does not expose its context, so navigation must go through `driver.setContext`, or `SceneState` must carry `context` (as proposed on `feature/scene-asset-rendering`; the plan already reads it when present).
- **Preset finding.** The ratified `woodland_story` preset breaks two composer rules on its own (fireflies under a dawn sky, two particle systems). The encoder repairs this whenever it is used as an anchor; the preset itself is unchanged.
