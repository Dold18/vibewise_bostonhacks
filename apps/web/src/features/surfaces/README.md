# World surfaces: procedural streets, pavement and terrain

**Status:** renderer complete and browser-verified on the live Boston map; **not yet wired into `main.ts`** (integration-owned). See [Integration](#integration).

The Scene Composer decides *what the city should feel like*. This module makes the **ground itself** change: what every street, sidewalk, plaza, open lot, park and wood is made of, how worn or wet it is, and how it is lit. It reads the shared city appearance parameters (`SceneState`) and never alters geometry.

```
SceneState ──deriveSurfaceRecipe──▶ SurfaceRecipe ──textureSpecs──▶ paintTexture ──updateImage──▶ fixed pattern slots
   (shared)        pure, deterministic        │                                                          ▲
                                              └──paintPlan──▶ setPaintProperty (opacity/color only) ─────┘ on layers added once
```

## What it renders

| Surface | OpenMapTiles geometry | Materials |
|---|---|---|
| Minor + service streets | `transportation` minor/service/track lines | asphalt, aged asphalt (cracks, utility patches, tire tracks), wet asphalt (streaks, puddles mirroring sky or neon), granite setts, illustrated cobbles, mossy flagstone, brick pavers, glazed tile mosaic, limestone slabs, paper-atlas hatching |
| Major streets | secondary/tertiary/primary/trunk | a calmer variant of the same family (cobbles → setts, etc.) |
| Motorways | motorway | always the asphalt family (wet/aged/paper when the world is) |
| Sidewalks / footpaths | `path`/`pedestrian` lines (real OSM footways) | scored concrete, brick bond, granite flags, mosaic, boardwalk, sketch dots, glow dots, fine dashes |
| Plazas | `pedestrian`/`path` polygons | same family as sidewalks, larger units |
| Open ground | `background` (under landuse) | concrete grain, dark grain with glints, paper grain, sand, stucco, topographic contours |
| Parks, grass, pitches | `park`, `landcover` grass/wetland, `landuse` pitch/track | grainy, lush blades, watercolor, soft dapple; accents: flowers, wildflowers, blossoms, fallen leaves, frost, fireflies; edges: hedge, glow, ink |
| Woods | `landcover` wood/forest | illustrated canopy, dense canopy, sparse canopy |
| Road edges | `line-gap-width` around each road class | stone curb, ink, gold trim, neon |
| Lane markings | major roads | fine dashes, strong graphic, retro double line |
| Street lamps | all streets | sparse amber, dense amber, cold white, alternating neon pools |

Water, buildings and labels are never patterned here (tests enforce it).

## Why the streets follow the real map

- **Line patterns are cross-sections.** MapLibre maps a `line-pattern`'s full height onto the line width (`y = 0.5·normal + 0.5` in its shader) and scales the length by the same factor. So a road texture's top and bottom rows *are* the curbs at every zoom: gutters and curb lips sit on the real road edges, tire tracks at ±22 % of the width, setts are laid in courses across the carriageway, wet streaks run with traffic, and lamp pools keep a constant spacing relative to the street.
- **Same filters, same widths.** Each street layer copies the base road layer's filter and width curve exactly and sits directly above it, so intersections keep the base stacking (tests compare them to `mapStyle.ts`).
- **Fills are world-anchored** by MapLibre, so ground and park materials stay put while the camera moves.
- **Deterministic variation.** Every texture is seeded; three street variants (fresh / normal / worn) are picked per street from its name, so the same street always looks the same and nothing shimmers during pan/zoom.

## Changing worlds without reloading tiles

Layers are added **once** and reference **fixed image names** (`ws-tex-*`). A new world repaints the slot's pixels and calls `map.updateImage` with the same size, which in MapLibre only patches the GPU atlas (no worker re-layout, no tile reload). Intensity is animated `*-opacity` paint. Pattern names, filters, dash arrays and layout never change after install (tests check the paint plan). When a *material* changes, the affected layers fade out, the pixels swap, and they fade back in. Texture painting is spread across frames (10 ms budget).

## How materials are chosen (procedural, no scene names)

1. **Explicit values win**: `roads_and_ground.street_material / wet_sheen / lane_detail / pedestrian_paths / street_lights / road_reflections`, `natural_land.grass_texture / floral_accents / park_glow / foliage_density_illusion / seasonal_visual`.
2. **Otherwise inferred from appearance values**: each material has affinities to catalog values (wall/roof palette, road color and casing, palette family, finish, sky…) weighted by their strengths. `recipe.ts` contains no preset/scene names (tested), so any new combination from Gemini overrides or blended presets produces a new composition.
3. **Presence** = the strongest non-default value: an early, faint answer gives a faint city; a neutral scene is exactly the plain map.
4. **Lighting relationships**: night (dark land) switches ground to dark grain with glints and enables lamps; light color tints wet reflections, dapples and curbs; neon casings drive neon reflections, edges and lane color.
5. **Navigation policy** (route or focused destination on screen): street/sidewalk/ground textures at 50 %, parks 60 %, neon edges 35 %, glows → hedges, lamps off. Route overlays always draw above every surface layer.

## Assets used

Real repository assets supply micro-grain (`grains.ts`, rasterized once to 256², reduced to signed luminance detail, multiplied in at 7–9 %):

- `public/scene-assets/v1/`: `asphalt-grit.svg`, `concrete-pores.svg`, `paper-grain.svg`
- `public/scene-assets/v2/` atlas cells: `pavement.coarse_asphalt.cool`, `stone_concrete.{pitted_concrete.cool, pitted_concrete.warm, limestone_slabs.warm, stucco_plaster.warm, stucco_plaster.pastel}`, `nature_ground.{short_grass.warm, dense_foliage.warm, dense_foliage.cool, moss.warm, moss.cool, sandy_ground.warm}`

Structured geometry (setts, cobbles, bricks, tiles, slabs, planks, canopy) is generated procedurally because the atlas cells are not seamlessly tileable for structured patterns (cut stones at cell borders would repeat along every street). If grains fail to load, textures stay fully procedural.

## Integration

Not done here: `main.ts` is a shared runtime entry point. Proposed patch for the integration owner (four lines):

```ts
import { connectSurfaces, mountSurfaces, withSurfaceCapabilities, loadGrains } from './features/surfaces';
import { MAP_RENDERER_V1 } from './features/scene';

const scene = mountScene({ ..., capabilities: withSurfaceCapabilities(MAP_RENDERER_V1) }); // was the MAP_RENDERER_V1 default
const surfaces = mountSurfaces(map, { onError: (e) => console.error('[surfaces]', e) });
connectSurfaces(surfaces, scene.session);
void loadGrains().then((g) => surfaces.setGrains(g));
// in syncTrip, next to scene.setNavigation(s.navigationOpen):
surfaces.setNavigation(s.navigationOpen);
// in the HMR dispose: surfaces.destroy();
```

Without the capability extension the compiler clips the explicit surface keys (they appear in `SceneState.disabled`) and only inference runs.

## QA

```js
// Vite dev build, browser console (live session + surfaces, before integration):
const qa = (await import('/src/features/surfaces/dev.ts')).attachSurfaceQa(window.vibentaScene);
qa.preset('noir_nocturne'); qa.material('cobbles'); qa.wear(0.9); qa.stats();
```

`node scripts/surfaces-browser.mjs [worlds|closeup|pitched|perf|route|all]` drives headless Chrome over the live app (identical-camera captures, tile-load counting, frame timing, real transit route). `QA_DPR=2` for retina captures, `QA_GPU=swiftshader` for software GL.

Unit tests: `npx vitest run src/features/surfaces`.

## Known limitations

- **Not wired into the app entry yet** (see Integration). Until then the live quiz drives palette/light but not surfaces.
- **Narrow base roads.** The base style draws streets narrower than reality (~11 px at z18), so street materials read best from z16.5 up; below ~z15 they fade out by design.
- **Crosswalks are not drawn**: the OpenMapTiles schema used here has no crossing geometry, and we do not fabricate them. `crosswalk_treatment` is not claimed.
- **Lighting is stylized**, not physically based: bevel highlights are fixed in pattern space (they turn with each street), there is no real reflection or specular, and `wet` is an illustrated look. Lamp pools are decorative spacing, not real streetlight positions.
- **Street-name labels**: the base style has none (place names are DOM pins); nothing here hides labels, but street-name legibility could not be measured.
- **Pattern images are 2× bitmaps**; on 1× screens fine detail is downsampled.
- **Highway yellow**: textures take motorway color mostly from the major-road palette, but the base highway fill stays yellow under them in dark scenes (scene swatch limitation noted in `scene/README.md`).
