# Atmosphere renderer

Fog, weather, particles, print/film treatments, vignette, bloom and light shafts for the live Boston map, driven entirely by the Scene Composer's `SceneState`.

```
SceneState ──paramsFromScene──▶ AtmosphereParams ──composeAtmosphere──▶ AtmospherePlan ──tween──▶ 2 MapLibre custom layers
 (resolved values + strengths,   (≈30 independent        (navigation, reduced motion,       (smooth,     vb-atmosphere-world (3d)
  palette, light, sky fog)        continuous controls)    coherence, load cap, quality)      eased)       vb-atmosphere-grade (2d)
```

The theme controller (`vibeTheme/controller.ts`) hands every scene to the renderer; `scene/mount.ts` also passes the navigation context. `MAP_RENDERER_V2` (scene/capabilities.ts) declares exactly the catalog values this module realizes, so everything else stays in `SceneState.disabled`.

## What each effect really is

| Pass (draw order) | Space | Technique |
|---|---|---|
| Height fog | **World, depth-tested** against building extrusions | 4–7 horizontal fog slices. Each fragment adds optical depth σ(h)·Δh/|cos θ| along the real view ray, with exponential height falloff, a distance-weighted aerial-perspective term (1× at the screen centre up to ~6× far away), drifting world-anchored fog banks and forward scattering toward the scene light. **A sliced approximation of a volume, not ray marching.** |
| Rain, snow | **World, depth-tested** | GPU-procedural streaks (lines) and flakes (points) animated in the vertex shader in a world-anchored, camera-scaled volume. Buildings occlude them. Stylized size/speed; **never live weather.** |
| Dust, fireflies, sparkle, petals | **World, depth-tested** | GPU-procedural points at world altitudes (fireflies 1–25 m, dust in the lower air). |
| Haze, color wash, light-shaft veil | Screen space | Horizon band placed from camera pitch + FOV; edge/ground gradients; procedural breakup. Shafts radiate from the scene light's screen direction. **Screen-space approximations.** |
| Paper, watercolor, halftone, scanlines, grid, grain, vignette | Screen space, multiply | SVG-asset detail maps (below) multiplied into the city, with a centre-clear zone and a darkening floor. |
| Bloom, shafts, light leaks, scratches | Screen space, screen blend | **Real bloom on the rendered city**: the frame so far is blitted to ¼ resolution, bright/saturated pixels kept, separably blurred and screened back. Shafts/leaks are approximations. |

Both layers are inserted after the 3D buildings and **before the focus mask, every route layer and every symbol layer**, so route lines, station markers, labels and the DOM pins are never tinted, blurred or covered.

Not implemented (honestly disabled): lens glare, chromatic aberration, distortion, ink edges, color banding, decorative frames, parallax decoration, starfield, clouds, and window lights (see below).

## Assets used (verified manifest IDs)

`film-grain`, `paper-grain`, `halftone`, `scanlines`, `blueprint-grid`, `film-scratches` (v1) and `art_print.antique_paper.warm`, `art_print.watercolor_wash.cool` (v2 atlas cells). Each is fetched and rasterized only when an effect needs it, uploaded once inside `render()`, and freed when the layers are removed. `__tests__/model.test.ts` checks every ID, file and atlas rect against the manifests.

## Composition rules (`compose.ts`)

1. **Navigation** (`route`/`focus`): everything off except a soft vignette ≤ 0.35; no motion. Applied twice: by the compiler's ratified rule and by the renderer (for keys outside the overlay groups, such as `horizon_glow`).
2. **Reduced motion**: no animation, no repaint loop; particles held still and thinned.
3. **Coherence**: one precipitation; no fireflies in rain or snow, no petals in snow; precipitation blocks shafts; dust needs light, fireflies need darkness; printed media flatten bloom; scanlines and paper yield to the stronger; particle kinds share one population.
4. **Legibility**: per-effect ceilings, a total visual-load cap, and fog opacity capped along the ray through the screen centre.
5. **Quality** (`quality.ts`): device tier sets fog slices, particle counts and bloom; a frame governor steps down on sustained misses.

## GPU work

- No layers, buffers or textures exist until a scene asks for atmosphere; fading back to nothing removes the layers and frees everything.
- Static atmospheres (fog without `drift`, print, grain, vignette, bloom) cost nothing between camera moves: **zero repaints when idle**.
- Falling/flying particles repaint at 30 fps (20 on low); slow drifts at 10 fps, only when the scene sets ambient motion (`drift`).

## For the building renderer

`renderer.onAccents(fn)` reports `{ windowLight, windowColor, darkness }` from `building_surfaces.window_glow`. This module does not draw windows (the building renderer owns façades); bloom will glow any bright window color it draws.

## Dev console (dev builds)

```js
vibentaAtmosphere.set({ fogDensity: .6, grain: .4, rain: .3, shafts: .5 })  // composed like any scene
vibentaAtmosphere.clear(); vibentaAtmosphere.quality('low'); vibentaAtmosphere.stats(); vibentaAtmosphere.passes
vibentaScene.submit({ overrides: [{ key: 'air_and_atmosphere.fog_volume', value: 'medium', intensity: .6 }] })
```

QA on the real map: `node scripts/atmosphere-browser.mjs` (see the header for env vars).
