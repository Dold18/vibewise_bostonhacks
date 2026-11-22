# Building appearance engine

This engine changes the architecture of Boston's 3D buildings on the real map, driven by composable parameters. It owns how buildings render. It does not own the vibe-to-parameters mapping; that belongs to the scene composer and the shared city contract.

## Architecture

| | |
|---|---|
| Geometry | Real OpenMapTiles `building` footprints, `render_height` and `render_min_height` from the same `openmaptiles` source the map already loads. Read via `map.querySourceFeatures`, then re-extruded on the CPU. |
| Renderer | One MapLibre `CustomLayerInterface` with `renderingMode: '3d'`, WebGL2 and a single draw call, placed where the native `building-3d*` bands sit. Those bands are hidden while it is mounted and restored by `destroy()`. |
| Surface coordinates | Every wall vertex carries metres: `u` along its wall edge, `v` above ground, the edge length and the edge's ring offset. Roof vertices carry footprint-aligned metres relative to the building's own first vertex. |
| Material shader | Asset textures come from a mipmapped, anisotropic `TEXTURE_2D_ARRAY`. On top of them the shader adds procedural structure per surface kind, storey and bay windows, trim, weathering, roof treatments, a sun anchored to the map, Blinn-Phong specular and an analytic sky reflection. |
| Rules | `rules.ts` is deterministic and pure. Each building's facade and roof come from a session seed, its OSM id and part centroid, its height, its footprint area and an optional district cell. |
| Camera parity | Opacity follows the native layer's pitch fade, which `main.ts` drives. Heights ramp from z14 to z15 as natively, and nothing is drawn below z14. |

Why not `fill-extrusion-pattern`: it applies one image per layer to both walls and roofs, scaled in tile pixels. It has no concept of storeys, bays, wall edges, trim, glow, roughness or per-building rules. The scene branch's overlay at 0.2 opacity showed that it can only tint.

## Contract (`contract.ts`)

`BuildingAppearance` holds weighted `facades[]`, weighted `roofs[]`, `lighting`, `variation` and `strength`.

- **`facades[]`:** each has a wall material, windows and trim, plus optional `heightRange` and `footprintRange`.
- **`roofs[]`:** each has a kind and a surface.
- **Values:** every field is a material or architectural parameter, such as surface kind, asset reference, texture scale and rotation, roughness, reflectivity, weathering, window shape, storey height, bay width, lit fraction, cornice, base course, string courses, quoins or pilasters, and parapet.
- **Validation:** `normalizeAppearance` clamps values to the supported envelope and reports each change.
- **No theme code:** nothing in the renderer branches on a cuisine, mood or preset. `__tests__/engine.test.ts` guards this.
- **Status: proposed.** No shared city-engine contract existed when this was written. The shared contract should re-export these types or map onto them with a pure adapter.

## Usage

```ts
import { mountBuildingAppearance } from './features/buildingAppearance';
const engine = mountBuildingAppearance(map, appearance); // map: the app's MapLibre map
await engine.update(nextAppearance);                     // any new combination; no new code
engine.stats();                                          // buildings, triangles, timings, GPU draw ms, textures, issues
engine.destroy();                                        // native extrusions come back
```

`fixtures.ts` holds five example configurations for QA:

- `NEUTRAL_MASSING`
- `MASONRY`
- `WEATHERED_STONE_PLASTER`
- `GLASS_MODERN`
- `HEIGHT_ZONED_DUSK`

These are data only.

## Assets used (existing library, `public/scene-assets/v2`)

All are original SVG atlas cells, rasterised to 512² texture-array layers at runtime:

- **Brick:** `brick_masonry.running_bond.warm`, `brick_masonry.stacked_bond.warm`, `brick_masonry.slim_bricks.warm`
- **Stone and concrete:** `stone_concrete.limestone_slabs.warm`, `stone_concrete.granite_blocks.cool`, `stone_concrete.stucco_plaster.{warm,pastel}`, `stone_concrete.pitted_concrete.cool`
- **Roofing:** `roofing.clay_roof_tiles.warm`, `roofing.slate_shingles.cool`, `roofing.standing_seam.cool`
- **Glass and metal:** `glass_metal.window_grid.cool`, `glass_metal.brushed_metal.cool`
- **Timber:** `timber.horizontal_planks.warm`
- **Ground cover:** `nature_ground.moss.warm`, `pavement.rounded_cobbles.cool`

v1 single SVGs, such as `stone-blocks`, also resolve.

## Known limitations

- **Roof geometry:** roofs are flat caps at the real height, minus the parapet. OpenMapTiles carries no `roof:shape`, so no pitched, hipped or dome geometry is generated. Tile, slate and seam roofs are surface treatments on flat caps.
- **Facade data:** wall edges, storeys and bays are procedural. They are not real Boston facade data or window positions.
- **Shading:** stylised Lambert, Blinn-Phong and analytic sky reflection. It is not PBR, has no environment or scene reflections, casts no shadows, and gets no MapLibre fog on these buildings.
- **Texture detail at city zoom:** at about z16–17, brick and stone grain is sub-pixel and mipmaps to a tone. At that zoom, materials are told apart by architecture (windows, trim, coursing, weathering, roofs) and tone. Grain is visible from about z18.
- **Main-thread rebuilds:** mesh builds run on the main thread, 25–290 ms depending on view size. They are deferred while the camera moves, so a newly loaded tile joins once the camera rests.
- **Fragment cost:** about 6–8 ms of GPU time for 19k buildings at 1440×900 on an Apple M1. That is fine at 60 fps there, but unmeasured on low-end GPUs.
- **Projection:** mercator only. Globe projection and terrain are not handled.
- **Tile seams:** walls on z14 tile-clip seams are detected and skipped. A building cut by a tile seam arrives as two pieces with different part centroids, so the pieces can receive different treatments. This is rare, because z14 tiles are about 1.8 km wide over Boston.

## QA

- **Evidence:** `docs/qa/building-appearance/`, plus `apps/web/scripts/building-appearance-{browser,checks}.mjs` to reproduce it.
- **Unit tests:** `__tests__/engine.test.ts`.
