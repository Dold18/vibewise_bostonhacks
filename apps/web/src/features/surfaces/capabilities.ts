/**
 * The catalog settings the surface renderer really draws. A renderer may only
 * claim values it realizes (scene/capabilities.ts); a test checks that every
 * value listed here maps to a distinct surface treatment in recipe.ts.
 *
 * Not claimed (no honest data or no renderer yet): crosswalk_treatment (OSM
 * crossings are not in the OpenMapTiles schema we use), ground_shadows,
 * major/minor_road_emphasis, rail_treatment, tree_symbol_style, hillshade_style.
 */
import { SCENE_CATALOG, type SceneCatalog, type SceneKey } from '../scene/catalog';
import type { CapabilityProfile } from '../scene/capabilities';

export const SURFACE_KEYS = [
  'roads_and_ground.street_material',
  'roads_and_ground.wet_sheen',
  'roads_and_ground.lane_detail',
  'roads_and_ground.pedestrian_paths',
  'roads_and_ground.street_lights',
  'roads_and_ground.road_reflections',
  'natural_land.grass_texture',
  'natural_land.floral_accents',
  'natural_land.park_glow',
  'natural_land.foliage_density_illusion',
  'natural_land.seasonal_visual',
] as const satisfies readonly SceneKey[];

/** Every catalog value of the surface keys (the default is always supported). */
export function surfaceValues(catalog: SceneCatalog = SCENE_CATALOG): Map<SceneKey, Set<string>> {
  const out = new Map<SceneKey, Set<string>>();
  for (const key of SURFACE_KEYS) {
    const setting = catalog.byKey.get(key);
    if (setting) out.set(key, new Set(setting.values.filter((v) => v !== setting.default)));
  }
  return out;
}

/** `base` plus everything the surface renderer draws, e.g. `withSurfaceCapabilities(MAP_RENDERER_V1)`. */
export function withSurfaceCapabilities(base: CapabilityProfile, catalog: SceneCatalog = SCENE_CATALOG): CapabilityProfile {
  const values = new Map<SceneKey, ReadonlySet<string>>(base.values);
  for (const [key, set] of surfaceValues(catalog)) values.set(key, new Set([...(base.values.get(key) ?? []), ...set]));
  return Object.freeze({ id: `${base.id}+surfaces-v1`, values, features: new Set([...base.features, 'svg_textures' as const]) });
}
