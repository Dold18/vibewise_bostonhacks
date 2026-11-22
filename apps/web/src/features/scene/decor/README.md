# World decoration engine

Procedural, world-anchored placement of imported 3D models across the visible Boston map. It extends the existing two-slot set piece (`../models.ts`, unchanged). That set piece stays as it is, but it no longer caps the whole city's decoration at two locations.

## Pipeline

```
SceneState ─ deriveTheme ─▶ motifs · gates · strength · hero layouts      (themes.ts)
           └ selectCast ──▶ coherent cast: ≤7 secondary + ≤5 micro models  (compose.ts)
z14 vector tiles ─ decodeMvt / buildTileGeometry ─▶ local metric geometry (mvt.ts, geometry.ts, tiles.ts)
           └ surfaceCandidates ─▶ safe spots per z17 cell (~225 m)        (surfaces.ts)
           └ composeCell / composeHero ─▶ placements (cached)              (compose.ts)
placements ─ hero-footprint · venue · route · LOD · budget filters ─▶ instances (engine.ts)
instances ─ InstancedMesh per (tier, model, primitive) ─▶ MapLibre custom layer (layer.ts)
```

Placement depends only on `(seed, theme, config, map data)`. The camera decides which cells get composed and which instances are shown. It never decides where an instance stands.

## Inputs

| Driver | Source |
|---|---|
| Stable session seed | `config.seed` (dev attach keeps one per browser session) |
| Eligible asset families | `catalog.ts` rules over manifest IDs plus measured geometry (`data/asset-metrics.v1.json`, produced by `scripts/measure-decor-assets.mjs`) |
| Context and semantic relevance | Preset weights → motifs (`PRESET_MOTIFS`); the verified set piece's layout mood; explicit context tokens |
| Density | `config.density` × vibe strength (preset weight × discovery progress) |
| Scale distribution | Family size ranges, log-uniform, `scale` and `scaleVariance` |
| Clustering and dispersion | `config.clustering`: promenades, vignettes, groves vs Poisson-disk accents |
| Minimum spacing | Per tier, plus solid-body radii from measured footprints |
| Camera distance and zoom | `lod.minZoom` and `lod.range` per tier, with distance thinning by stable rank |
| Surface suitability | `surfaces.ts` (below) |
| Count and complexity budget | `budget.maxInstances`, `maxTriangles`, `maxAssets`, `maxDrawCalls`. The performance context tightens them; low performance turns micro details off. |
| Collision and occlusion | Occupancy test per cell; cell-edge margins; hero footprints clear cell decorations; buildings occlude through the shared depth buffer; open spots and roofs are favored (canyon props are mostly hidden) |
| Navigation and performance | Hidden in `route`/`focus` navigation, in 2D (pitch < 12°) and when 3D is toggled off; render work happens only on `moveend` |

## Levels of detail

- **Micro** (1.3–5 m): flowers, shrubs, rocks, benches, lanterns, market goods, graves. Shown from z16.4, within about 350 m.
- **Secondary** (6–18 m, stylized so they read at z16): street trees, lamp posts, festoons, stalls, sculptures, characters, masts, landmarks, boats. Shown from z14.6.
- **Hero installations**: the authored two-slot layouts (`hero_installation` plus `ambient_accent`), re-sited on the largest verified open ground in each z15 region. They appear once discovery progress reaches `heroProgress` (0.7). The scale adapts to the space at 3.2–5.5 m per unit, at most `maxHeroes` are shown, and they keep `minSpacing.hero` apart. They avoid the existing set-piece stage while it is active.

## Surface suitability (safe restricted placement)

Candidates come only from vector geometry, and each one must pass conservative clearance tests. Road half-widths are class-based and err wide.

- **sidewalk**: the curb-side furniture zone of primary to minor roads. A walkway of at least 1.6 m must remain to the building line. Rejected at intersections, on bridges, near rails or water, and inside buildings.
- **path_edge**: beside footways, never on them. Outside parks and plazas it needs 4 m of building clearance.
- **plaza**: pedestrian areas and squares, and the sides of pedestrian streets (a central corridor stays clear).
- **park**: park, grass and wood areas, clear of paths, roads and water.
- **waterfront**: a few meters inland of water edges.
- **rooftop**: flat spots on extruded roofs of 8 m or more, inset at least 3 m and clear of steps in height, at the exact rendered roof height (`render_height`, as in the basemap style). In a pitched downtown view, roofs are the open, visible surfaces; street canyons are hidden. Rooftop props show from z15, once extrusions reach full height.

Areas with no reliable surface, such as dense blocks with no sidewalk room, get nothing. They are never filled with random scatter.

## Honesty constraints

- Decorations stay at least `venueClearance` (28 m) from destination pins, so a prop never reads as a venue's feature. They take no pointer events, and the dev label says "Fictional decorations".
- Cuisine, music and culture-specific props (`gate: 'context'`) need explicit context or a compiler-verified set piece. Aesthetic presets never unlock them.
- Winter-holiday props need `seasonal`. Observance items (menorah, kinara) need an opt-in **and** explicit context. A set piece alone never unlocks them.
- Buildings, vehicles, traffic signals, hydrants, dumpsters and interior fixtures are never scattered.

## API

```ts
import { mountRuntimeDecor } from './decor';
const decor = mountRuntimeDecor(map, runtimeAssets, { exclusions: () => pins });
decor.render(sceneState);          // follow the Scene Session
decor.configure({ density: 1, seed: 'abc', clustering: 0.7 });
decor.stats();                     // counts, cast, culling, collisions, draw calls, timings
await decor.settled();             // latest refresh done and every needed model loaded (QA, tests)
decor.destroy();
```

Dev, on the live map (no shared files touched):

```js
const { attachWorldDecor } = await import('/src/features/scene/decor/dev.ts');
await attachWorldDecor({ density: 1, seed: 'demo' });
vibentaDecor.density('low'); vibentaDecor.configure({ seed: 'other' }); vibentaDecor.stats();
```

## Proposed integration (owned by the runtime integrator)

In `features/scene/runtime.ts`, inside `mountAssetRuntime`, next to `models`:

```ts
const decor = preview3d ? (await import('./decor')).mountRuntimeDecor(map, runtimeAssets, { exclusions }) : null;
// render(state): decor?.render(state);  stats(): decor?.stats();  destroy(): decor?.destroy();
```

`exclusions` should return the selectable places' `{lng, lat}`. The dev attach derives them from the DOM pins.
