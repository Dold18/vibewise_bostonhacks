/**
 * Which city section realizes each catalog setting. One owner per key: two
 * systems never draw the same setting twice, and a renderer may only claim
 * capabilities for keys routed to its own section.
 *
 * Keys the base theme already renders (vibeTheme `setScene`: palette, grade,
 * light angle/intensity, sky blends, fog color, transition) are not routed;
 * sections read their result through `CityPlan.palette` and section colors.
 */
import { MAP_RENDERER_V1 } from '../scene/capabilities';
import type { SceneKey } from '../scene/catalog';
import type { DecorationAnchor, SectionId } from './contracts';

const GROUP_SECTION: Readonly<Record<string, SectionId | null>> = {
  building_surfaces: 'buildings',
  roads_and_ground: 'streets',
  natural_land: 'streets',
  water_and_coast: 'streets',
  neighborhood_and_places: 'decorations',
  air_and_atmosphere: 'atmosphere',
  cinematic_and_artistic: 'atmosphere',
  sky_and_horizon: 'atmosphere',
  lighting_and_shadows: 'atmosphere',
  // Not city rendering: owned by the map/pins, UI, camera or the coordinator.
  global_grade: null,
  text_and_labels: null,
  marker_recommendations: null,
  interface_and_cards: null,
  camera_and_perspective: null,
  animation_and_morph: null,
  navigation_safe: null,
};

/** Exceptions to the group rule: objects placed in space are decorations, wherever their group sits. */
const KEY_SECTION: Readonly<Record<SceneKey, SectionId | null>> = {
  // Integration: the street renderer draws lamp pools and park flowers into the
  // ground materials, so these two belong to streets (decorations still read them as cues).
  'roads_and_ground.street_lights': 'streets',
  'natural_land.floral_accents': 'streets',
  // Particle pacing is realized by the atmosphere renderer's particle systems.
  'animation_and_morph.ambient_pace': 'atmosphere',
  'animation_and_morph.particle_motion': 'atmosphere',
  'natural_land.tree_symbol_style': 'decorations',
  'natural_land.leaf_particles': 'atmosphere',
  'water_and_coast.harbor_mist': 'atmosphere',
  'cinematic_and_artistic.illustration_props': 'decorations',
  'cinematic_and_artistic.parallax_decoration': 'decorations',
  'lighting_and_shadows.local_spotlights': 'decorations',
  'neighborhood_and_places.matched_building_outline': 'buildings',
  'neighborhood_and_places.venue_material_highlight': 'buildings',
  'neighborhood_and_places.relevant_neighborhood_tint': 'streets',
  'neighborhood_and_places.local_fog_clearing': 'atmosphere',
  // Labels and ranking lines belong to the map/pins owner.
  'neighborhood_and_places.district_story_labels': null,
  'neighborhood_and_places.match_connections': null,
};

/** Default anchor per decoration setting ID; composition may refine it. */
export const DECORATION_ANCHORS: Readonly<Record<string, DecorationAnchor>> = {
  tree_symbol_style: 'park',
  illustration_props: 'plaza',
  parallax_decoration: 'skyline',
  local_spotlights: 'venue',
  local_hotspots: 'venue',
  local_light_pools: 'venue',
  place_scene_particles: 'venue',
};

const BASE_THEME_KEYS: ReadonlySet<SceneKey> = new Set(MAP_RENDERER_V1.values.keys());

/** The section that owns a catalog key, or null if no city renderer may draw it. */
export function sectionOf(key: SceneKey): SectionId | null {
  if (BASE_THEME_KEYS.has(key)) return null;
  if (key in KEY_SECTION) return KEY_SECTION[key] ?? null;
  return GROUP_SECTION[key.slice(0, key.indexOf('.'))] ?? null;
}

/** `building_surfaces.window_glow` → `window_glow` */
export const settingId = (key: SceneKey): string => key.slice(key.indexOf('.') + 1);
