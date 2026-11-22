## Expanded v2 library

In addition to this initial pack, the branch now includes **192 further generated SVG variations across 12 vector atlases** at `/scene-assets/v2/` (see `v2/gallery.html` and `v2/manifest.json`). The separate, more nuanced **WebP atlas ZIP** was generated and is downloadable from the conversation, but is **not** checked into this branch. A reproducible offline Poly Haven CC0 material importer is available in `scripts/import-polyhaven-textures.mjs`; its PBR files have not been imported yet.

# Scene Asset Starter Pack v1

This directory provides **33 original generated 256×256 SVG assets** for potential use by the Vibenta Scene Composer.

**These are static resources, not complete renderers.** Nothing in this PR modifies the map or enables any effect. A runtime adapter still needs to load, cache, composite and animate assets with MapLibre/CSS/WebGL. Some assets can be applied as CSS overlays now; 3D façade/texture projection requires geometry-aware rendering.

Preview: launch Vite and open `/scene-assets/v1/gallery.html`. All assets are referenced from `manifest.json` with catalog setting IDs.

## What is precomputed?

- Grain, stone, brick, glass, paving, illustrated windows, water patterns, stars, clouds, sky haze, sprite-field particles, lighting sprites, film overlays, technical patterns.
- Each image is reusable across many scene presets with adjustable opacity, tint, size and animation.
- **Not** actual building materials, observed weather, live window lighting or finished full-city renders.
- No third-party asset has been imported. All assets are originally generated SVGs; no copyright attribution is needed for these files.

## Recommended additional CC0 material sourcing

- [ambientCG](https://ambientcg.com/) and [CC0 license](https://docs.ambientcg.com/license/): real PBR brick, asphalt, stone, concrete, metal, wood, paving.
- [Poly Haven](https://polyhaven.com/) and [CC0 license](https://polyhaven.com/license): PBR textures, HDRIs and models.
- [Kenney](https://kenney.nl/assets) and [CC0 FAQ](https://kenney.nl/support): decorative particles and 3D props.

These are verified candidate libraries, **not downloaded assets**. Source material needs per-asset provenance and size/format checks. Avoid downloading unrelated 8K assets for a mobile-first browser map.

## Safety, UX and performance

- Keep pointers passing through decorative overlays, labels legible, map attribution visible, and transit/walking routes above visual effects as needed.
- Disable or reduce animation under `prefers-reduced-motion`.
- Preload essential lightweight textures; lazy-load advanced effects; cache browser resources.
- Do not use fictional rain/snow/lighting effects as real conditions.
- Test SVG filter rendering and shader usage on Safari, Chrome and mobile; convert to compressed raster assets only when profiling justifies it.
