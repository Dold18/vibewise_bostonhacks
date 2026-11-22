/**
 * Reusable component families, one family per slot of the city.
 *
 * A component is a small, single-purpose treatment (a wall material, a window
 * style, a lighting rig) written only in catalog values, with an ideal position
 * in the style space. It is NOT a scene: a world is one choice per slot, made
 * independently under compatibility rules, so the families multiply
 * (≈ 10^15 raw combinations across 17 slots) instead of enumerating looks.
 *
 * Every slot also has an implicit `plain` component (no change), which is the
 * fallback when nothing fits, nothing is compatible, or the slot is
 * de-emphasized in this session's world.
 */
import type { SceneKey } from '../catalog';
import type { Pull } from './axes';

export type Subsystem = 'core' | 'light' | 'architecture' | 'ground' | 'environment' | 'atmosphere' | 'artistry';
export const EMPHASIS_SUBSYSTEMS = ['light', 'architecture', 'ground', 'environment', 'atmosphere', 'artistry'] as const;
export type EmphasisSubsystem = (typeof EMPHASIS_SUBSYSTEMS)[number];

/** A catalog value with its strength inside the component (default 1). */
export type Assign = string | readonly [value: string, strength: number];

export interface Component {
  readonly id: string;
  /** Ideal style position; unnamed axes are "don't care". */
  readonly ideal: Pull;
  readonly assign: Readonly<Record<SceneKey, Assign>>;
  /** Eligible only when one of these hint tags is at least HINT_GATE strong (for strong stylistic media). */
  readonly gate?: readonly string[];
}

export interface Slot {
  readonly id: string;
  readonly subsystem: Subsystem;
  /** Shown in previews and reports. */
  readonly label: string;
  readonly components: readonly Component[];
}

export const HINT_GATE = 0.3;
const c = (id: string, ideal: Pull, assign: Record<SceneKey, Assign>, gate?: string[]): Component => ({ id, ideal, assign, gate });

/** Slots in composition order: the keystone light first, so everything after respects its time of day. */
export const SLOTS: readonly Slot[] = [
  {
    id: 'sky_light', subsystem: 'core', label: 'Sky and key light',
    components: [
      c('clear_noon', { luminance: 0.9, moisture: -0.4, warmth: 0 }, {
        'sky_and_horizon.sky_mode': 'clear_blue', 'lighting_and_shadows.light_preset': 'soft_day', 'lighting_and_shadows.light_angle': 'noon_high',
        'lighting_and_shadows.light_intensity': 'bright', 'lighting_and_shadows.light_color': 'white', 'lighting_and_shadows.shadow_character': 'crisp',
        'sky_and_horizon.celestial_symbol': ['sun_disc', 0.6], 'sky_and_horizon.horizon_blend': ['sharp_silhouette', 0.5],
      }),
      c('fresh_morning', { luminance: 0.6, warmth: 0.1, softness: 0.2 }, {
        'sky_and_horizon.sky_mode': 'warm_dawn', 'lighting_and_shadows.light_preset': 'soft_day', 'lighting_and_shadows.light_angle': 'morning_low',
        'lighting_and_shadows.light_intensity': 'bright', 'lighting_and_shadows.light_color': 'white', 'lighting_and_shadows.shadow_character': 'soft',
        'sky_and_horizon.fog_horizon_color': ['silver', 0.5],
      }),
      c('dawn_blush', { luminance: 0.2, warmth: 0.4, softness: 0.6, energy: -0.4 }, {
        'sky_and_horizon.sky_mode': 'warm_dawn', 'lighting_and_shadows.light_angle': 'morning_low', 'lighting_and_shadows.light_color': 'pink',
        'lighting_and_shadows.light_intensity': 'subtle', 'sky_and_horizon.horizon_glow': 'rose_band', 'sky_and_horizon.fog_horizon_color': 'rose',
        'lighting_and_shadows.ambient_fill': 'warm',
      }),
      c('golden_hour', { luminance: 0.2, warmth: 0.9, energy: 0.3 }, {
        'sky_and_horizon.sky_mode': 'golden_hour', 'lighting_and_shadows.light_preset': 'golden_hour', 'lighting_and_shadows.light_angle': 'evening_low',
        'lighting_and_shadows.light_color': 'amber', 'lighting_and_shadows.light_intensity': 'subtle', 'sky_and_horizon.horizon_glow': 'warm_band',
        'sky_and_horizon.fog_horizon_color': 'golden', 'lighting_and_shadows.ambient_fill': 'warm', 'sky_and_horizon.celestial_symbol': ['sun_disc', 0.5],
      }),
      c('rose_dusk', { luminance: -0.2, warmth: 0.5, softness: 0.5, energy: -0.3 }, {
        'sky_and_horizon.sky_mode': 'rose_dusk', 'lighting_and_shadows.light_preset': 'blue_hour', 'lighting_and_shadows.light_color': 'pink',
        'lighting_and_shadows.light_angle': 'evening_low', 'lighting_and_shadows.light_intensity': 'subtle', 'sky_and_horizon.horizon_glow': 'rose_band',
        'sky_and_horizon.fog_horizon_color': 'rose',
      }),
      c('violet_twilight', { luminance: -0.45, chroma: 0.5, era: -0.3, energy: 0.5 }, {
        'sky_and_horizon.sky_mode': 'purple_twilight', 'lighting_and_shadows.light_preset': 'blue_hour', 'lighting_and_shadows.light_color': 'violet',
        'lighting_and_shadows.light_angle': 'side_lit', 'lighting_and_shadows.light_intensity': 'subtle', 'sky_and_horizon.horizon_glow': 'cool_band',
        'sky_and_horizon.fog_horizon_color': 'purple',
      }),
      c('indigo_night', { luminance: -0.85, warmth: -0.2 }, {
        'sky_and_horizon.sky_mode': 'night_indigo', 'lighting_and_shadows.light_preset': 'moonlit', 'lighting_and_shadows.light_color': 'icy_blue',
        'lighting_and_shadows.light_angle': 'side_lit', 'lighting_and_shadows.light_intensity': 'dim', 'lighting_and_shadows.ambient_fill': 'cool',
        'sky_and_horizon.celestial_symbol': ['crescent_moon', 0.6], 'sky_and_horizon.starfield': ['subtle', 0.5], 'sky_and_horizon.fog_horizon_color': 'blue_gray',
      }),
      c('lamplit_night', { luminance: -0.7, warmth: 0.7, intimacy: 0.4 }, {
        'sky_and_horizon.sky_mode': 'night_indigo', 'lighting_and_shadows.light_color': 'amber', 'lighting_and_shadows.light_angle': 'side_lit',
        'lighting_and_shadows.light_intensity': 'dim', 'lighting_and_shadows.ambient_fill': 'warm', 'sky_and_horizon.horizon_glow': ['warm_band', 0.5],
        'sky_and_horizon.fog_horizon_color': ['golden', 0.4],
      }),
      c('neon_night', { luminance: -0.8, chroma: 0.8, era: -0.6 }, {
        'sky_and_horizon.sky_mode': 'night_indigo', 'lighting_and_shadows.light_preset': 'neon_reflection', 'lighting_and_shadows.light_color': 'violet',
        'lighting_and_shadows.light_angle': 'back_lit', 'lighting_and_shadows.light_intensity': 'dim', 'sky_and_horizon.horizon_glow': 'neon_band',
        'sky_and_horizon.fog_horizon_color': 'purple', 'lighting_and_shadows.ambient_fill': 'cool',
      }),
      c('noir_night', { luminance: -0.8, chroma: -0.7, grit: 0.1 }, {
        'sky_and_horizon.sky_mode': 'night_indigo', 'lighting_and_shadows.light_preset': 'noir', 'lighting_and_shadows.light_color': ['gold', 0.6],
        'lighting_and_shadows.light_angle': 'side_lit', 'lighting_and_shadows.light_intensity': 'dim', 'lighting_and_shadows.ambient_fill': 'deep_shadow',
        'lighting_and_shadows.shadow_character': 'dramatic', 'sky_and_horizon.fog_horizon_color': 'blue_gray',
      }),
      c('overcast_day', { luminance: 0.3, chroma: -0.5, moisture: 0.6 }, {
        'sky_and_horizon.sky_mode': 'storm_gray', 'lighting_and_shadows.light_preset': 'overcast', 'lighting_and_shadows.light_intensity': 'subtle',
        'lighting_and_shadows.shadow_character': 'soft', 'sky_and_horizon.fog_horizon_color': 'silver', 'sky_and_horizon.horizon_blend': 'soft_diffuse',
        'sky_and_horizon.cloud_form': ['overcast', 0.6],
      }),
      c('dream_haze', { softness: 0.9, luminance: 0.3, chroma: 0.1 }, {
        'sky_and_horizon.sky_mode': 'dream_pastel', 'lighting_and_shadows.light_color': 'pink', 'lighting_and_shadows.light_intensity': 'bright',
        'sky_and_horizon.horizon_glow': 'pale_mist', 'sky_and_horizon.horizon_blend': 'soft_diffuse', 'sky_and_horizon.fog_horizon_color': 'rose',
        'sky_and_horizon.cloud_form': ['cotton', 0.5],
      }),
    ],
  },
  {
    id: 'grade', subsystem: 'core', label: 'Grade and ground tone',
    components: [
      c('warm_amber', { warmth: 0.8, luminance: 0 }, {
        'global_grade.palette_family': 'warm_amber', 'global_grade.temperature': ['candle_warm', 0.6], 'global_grade.contrast_curve': ['low_soft', 0.4],
      }),
      c('sunwashed', { luminance: 0.8, warmth: 0.3, chroma: -0.1 }, {
        'global_grade.palette_family': 'sunwashed', 'global_grade.temperature': ['sun_warm', 0.5], 'global_grade.contrast_curve': ['low_soft', 0.5],
        'global_grade.grade_finish': ['matte', 0.4],
      }),
      c('cool_blue', { warmth: -0.7, luminance: 0.3 }, { 'global_grade.palette_family': 'cool_blue', 'global_grade.temperature': ['twilight_cool', 0.5] }),
      c('earthy', { nature: 0.6, grit: 0.3, warmth: 0.3, luminance: 0.3 }, {
        'global_grade.palette_family': 'earthy', 'global_grade.saturation': ['muted', 0.5], 'global_grade.grade_finish': ['matte', 0.5],
      }),
      c('pastel_soft', { softness: 0.9, luminance: 0.4, energy: -0.3 }, {
        'global_grade.palette_family': 'pastel', 'global_grade.contrast_curve': ['low_soft', 0.6], 'global_grade.grade_finish': ['matte', 0.4],
      }, ['pastel', 'whimsy', 'spring']),
      c('neon_night', { luminance: -0.8, chroma: 0.8, era: -0.5 }, {
        'global_grade.palette_family': 'neon_night', 'global_grade.saturation': ['vibrant', 0.7], 'global_grade.contrast_curve': ['dramatic', 0.5],
      }),
      c('luxury_dark', { luminance: -0.7, grit: -0.7, chroma: -0.3 }, {
        'global_grade.palette_family': 'luxury_dark', 'global_grade.contrast_curve': ['high_filmic', 0.6], 'global_grade.grade_finish': ['cinematic', 0.6],
        'global_grade.saturation': ['desaturated', 0.4],
      }),
      c('noir_grade', { chroma: -0.9, luminance: -0.6 }, {
        'global_grade.palette_family': 'luxury_dark', 'global_grade.saturation': ['grayscale', 0.5], 'global_grade.contrast_curve': ['dramatic', 0.6],
        'global_grade.grade_finish': 'cinematic',
      }),
      c('monochrome_day', { chroma: -0.9, luminance: 0.5, ornament: -0.6 }, {
        'global_grade.palette_family': 'monochrome', 'global_grade.saturation': ['muted', 0.6], 'global_grade.contrast_curve': ['flat_print', 0.4],
      }),
      c('vintage_film', { era: 0.8, chroma: -0.3, luminance: 0.2 }, {
        'global_grade.palette_family': 'vintage_film', 'global_grade.grade_finish': ['faded_print', 0.5], 'global_grade.contrast_curve': ['low_soft', 0.4],
        'global_grade.saturation': ['muted', 0.4],
      }),
      c('paper_atlas', { era: 0.6, softness: 0.3, ornament: 0.3, luminance: 0.4 }, { 'global_grade.palette_family': 'paper_atlas', 'global_grade.grade_finish': ['matte', 0.5] }, ['paper', 'retro']),
      c('watercolor', { softness: 0.7, nature: 0.3, luminance: 0.5 }, { 'global_grade.palette_family': 'watercolor', 'global_grade.contrast_curve': ['low_soft', 0.5] }, ['painterly', 'paper']),
      c('vivid_pop', { chroma: 0.9, energy: 0.7, luminance: 0.5 }, {
        'global_grade.saturation': ['vibrant', 0.8], 'global_grade.contrast_curve': ['dramatic', 0.4], 'global_grade.grade_finish': ['high_gloss', 0.4],
      }),
      c('hyper_digital', { chroma: 1, era: -0.8, energy: 0.8 }, { 'global_grade.saturation': ['hypercolor', 0.6], 'global_grade.contrast_curve': ['dramatic', 0.6] }),
    ],
  },
  {
    id: 'walls', subsystem: 'architecture', label: 'Wall material and facade',
    components: [
      c('warm_brick', { warmth: 0.6, era: 0.5, grit: 0.2 }, {
        'building_surfaces.wall_palette': 'brick_amber', 'building_surfaces.facade_look': ['brick_illustration', 0.6], 'building_surfaces.wall_vertical_gradient': ['warm_top', 0.5],
      }),
      c('sandstone', { warmth: 0.5, luminance: 0.5, era: 0.3 }, {
        'building_surfaces.wall_palette': 'sandstone', 'building_surfaces.facade_look': ['stone_blocks', 0.5], 'building_surfaces.wall_vertical_gradient': ['warm_top', 0.4],
      }),
      c('soft_plaster', { softness: 0.6, luminance: 0.5 }, {
        'building_surfaces.wall_palette': 'soft_plaster', 'building_surfaces.facade_look': ['smooth_cement', 0.5], 'building_surfaces.wall_vertical_gradient': ['subtle', 0.6],
      }),
      c('weathered_stone', { era: 0.8, grit: 0.4, chroma: -0.4 }, {
        'building_surfaces.wall_palette': 'weathered_stone', 'building_surfaces.facade_look': 'stone_blocks', 'building_surfaces.building_material_finish': ['weathered', 0.6],
      }),
      c('raw_concrete', { grit: 0.6, ornament: -0.6, chroma: -0.5 }, {
        'building_surfaces.wall_palette': 'concrete_gray', 'building_surfaces.facade_look': 'smooth_cement', 'building_surfaces.building_material_finish': ['weathered', 0.4],
        'building_surfaces.wall_vertical_gradient': ['flat', 0.6],
      }),
      c('slate_night', { luminance: -0.6, chroma: -0.4, grit: -0.2 }, {
        'building_surfaces.wall_palette': 'slate', 'building_surfaces.facade_look': ['smooth_cement', 0.4], 'building_surfaces.wall_vertical_gradient': ['strong_height_shift', 0.5],
      }),
      c('cyan_glass', { era: -0.8, grit: -0.6, warmth: -0.4 }, {
        'building_surfaces.wall_palette': 'glass_cyan', 'building_surfaces.facade_look': 'glass_grid', 'building_surfaces.building_material_finish': ['glassy_illusion', 0.6],
        'building_surfaces.wall_vertical_gradient': ['cool_top', 0.6],
      }),
      c('violet_glass', { era: -0.8, chroma: 0.7, luminance: -0.5, grit: -0.5 }, {
        'building_surfaces.wall_palette': 'glass_violet', 'building_surfaces.facade_look': 'glass_grid', 'building_surfaces.building_material_finish': 'glassy_illusion',
        'building_surfaces.wall_vertical_gradient': 'cool_top',
      }),
      c('gilded', { ornament: 0.7, grit: -0.6, warmth: 0.5 }, {
        'building_surfaces.wall_palette': ['gold_tone', 0.7], 'building_surfaces.facade_look': ['stone_blocks', 0.5], 'building_surfaces.building_material_finish': ['polished', 0.5],
        'building_surfaces.wall_vertical_gradient': ['warm_top', 0.5],
      }),
      c('pastel_facades', { softness: 0.8, chroma: 0.2, luminance: 0.5, grit: -0.3 }, {
        'building_surfaces.wall_palette': 'pastel', 'building_surfaces.wall_vertical_gradient': ['subtle', 0.5],
      }),
      c('ink_black', { luminance: -0.8, chroma: -0.8, ornament: -0.3 }, {
        'building_surfaces.wall_palette': 'ink_black', 'building_surfaces.facade_look': ['smooth_cement', 0.4], 'building_surfaces.wall_vertical_gradient': ['flat', 0.5],
      }),
      c('timber', { nature: 0.6, era: 0.5, warmth: 0.4 }, {
        'building_surfaces.wall_palette': ['sandstone', 0.4], 'building_surfaces.facade_look': 'wood_slats', 'building_surfaces.wall_vertical_gradient': ['warm_top', 0.3],
      }),
      c('paper_cut', { softness: 0.5, ornament: 0.5, era: 0.3 }, {
        'building_surfaces.wall_palette': ['soft_plaster', 0.6], 'building_surfaces.facade_look': 'paper_cutout',
      }, ['paper', 'whimsy']),
    ],
  },
  {
    id: 'roofs', subsystem: 'architecture', label: 'Roofs and skyline',
    components: [
      c('terracotta', { warmth: 0.7, era: 0.4 }, { 'building_surfaces.roof_palette': 'terracotta', 'building_surfaces.height_color_treatment': ['warm_towers', 0.6] }),
      c('slate_roofs', { chroma: -0.4, era: 0.4, warmth: -0.2 }, { 'building_surfaces.roof_palette': 'slate', 'building_surfaces.height_color_treatment': ['muted_lowrise', 0.4] }),
      c('copper_patina', { era: 0.6, ornament: 0.5 }, { 'building_surfaces.roof_palette': 'copper', 'building_surfaces.roof_details': ['illustrated_equipment', 0.4] }),
      c('gold_crowns', { ornament: 0.8, grit: -0.5, warmth: 0.4 }, { 'building_surfaces.roof_palette': 'gold', 'building_surfaces.height_color_treatment': ['gold_towers', 0.6] }),
      c('cream_roofs', { luminance: 0.6, softness: 0.5 }, { 'building_surfaces.roof_palette': 'cream', 'building_surfaces.height_color_treatment': ['warm_towers', 0.3] }),
      c('midnight_roofs', { luminance: -0.8 }, { 'building_surfaces.roof_palette': 'midnight', 'building_surfaces.height_color_treatment': ['dark_towers', 0.6] }),
      c('pastel_roofs', { softness: 0.9, luminance: 0.4, grit: -0.3 }, { 'building_surfaces.roof_palette': 'pastel', 'building_surfaces.roof_details': ['soft_halo', 0.4] }),
      c('cool_skyline', { era: -0.7, warmth: -0.5 }, { 'building_surfaces.roof_palette': ['slate', 0.5], 'building_surfaces.height_color_treatment': ['cool_towers', 0.7] }),
      c('hatched', { softness: -0.6, chroma: 0.4 }, { 'building_surfaces.roof_details': 'abstract_hatch' }),
    ],
  },
  {
    id: 'edges', subsystem: 'architecture', label: 'Building edges and silhouette',
    components: [
      c('ink_lines', { softness: -0.5, ornament: 0.2 }, { 'building_surfaces.building_outline': 'ink', 'building_surfaces.silhouette_style': ['crisp_ink', 0.5] }),
      c('cream_lines', { softness: 0.4, luminance: 0.5 }, { 'building_surfaces.building_outline': 'cream', 'building_surfaces.silhouette_style': 'light_outline' }),
      c('gold_lines', { ornament: 0.6, grit: -0.5 }, { 'building_surfaces.building_outline': ['gold', 0.6] }),
      c('cyan_glow', { era: -0.8, luminance: -0.6, chroma: 0.6 }, { 'building_surfaces.building_outline': 'cyan_glow', 'building_surfaces.silhouette_style': ['luminous_edge', 0.6] }),
      c('magenta_glow', { chroma: 0.9, luminance: -0.6, energy: 0.5 }, { 'building_surfaces.building_outline': 'magenta_glow', 'building_surfaces.silhouette_style': 'luminous_edge' }),
      c('soft_round', { softness: 0.9 }, { 'building_surfaces.corner_appearance': 'rounded_illustration', 'building_surfaces.building_outline': 'none' }),
      c('softened', { softness: 0.4, nature: 0.2 }, { 'building_surfaces.corner_appearance': ['softened', 0.6] }),
      c('no_outline', { ornament: -0.8, grit: -0.4 }, { 'building_surfaces.building_outline': 'none' }),
    ],
  },
  {
    id: 'windows', subsystem: 'architecture', label: 'Windows and trim',
    components: [
      c('warm_scatter', { luminance: -0.5, warmth: 0.6, intimacy: 0.4, energy: -0.4 }, { 'building_surfaces.window_pattern': 'sparse_warm', 'building_surfaces.window_glow': 'warm_low' }),
      c('warm_full', { luminance: -0.6, warmth: 0.5, energy: 0.5 }, { 'building_surfaces.window_pattern': 'randomized_warm', 'building_surfaces.window_glow': 'warm_high' }),
      c('office_grid', { era: -0.5, warmth: -0.4, ornament: -0.4, luminance: -0.3 }, { 'building_surfaces.window_pattern': 'office_cool', 'building_surfaces.window_glow': 'cold_white' }),
      c('blue_grid', { era: -0.6, luminance: -0.6, warmth: -0.6 }, { 'building_surfaces.window_pattern': 'full_grid', 'building_surfaces.window_glow': 'blue' }),
      c('neon_windows', { chroma: 0.8, luminance: -0.7, era: -0.5 }, {
        'building_surfaces.window_pattern': 'neon_accent', 'building_surfaces.window_glow': 'mixed', 'building_surfaces.emissive_trim': ['fine_magenta', 0.5],
      }),
      c('gold_trim', { ornament: 0.7, grit: -0.6, luminance: -0.2 }, {
        'building_surfaces.window_pattern': ['sparse_warm', 0.5], 'building_surfaces.window_glow': ['warm_low', 0.5], 'building_surfaces.emissive_trim': 'fine_gold',
      }),
      c('white_trim', { ornament: -0.5, era: -0.6, grit: -0.5 }, { 'building_surfaces.emissive_trim': 'white_architectural' }),
    ],
  },
  {
    id: 'street_light', subsystem: 'light', label: 'Street lighting',
    components: [
      c('amber_sparse', { luminance: -0.4, warmth: 0.5, intimacy: 0.4, energy: -0.4 }, { 'roads_and_ground.street_lights': 'sparse_amber', 'lighting_and_shadows.local_spotlights': ['few_warm', 0.5] }),
      c('amber_dense', { luminance: -0.6, warmth: 0.5, energy: 0.5 }, {
        'roads_and_ground.street_lights': 'dense_amber', 'lighting_and_shadows.bloom': ['subtle', 0.5], 'lighting_and_shadows.bounce_light': ['amber', 0.4],
      }),
      c('cold_white', { luminance: -0.4, warmth: -0.6, era: -0.4 }, { 'roads_and_ground.street_lights': 'cold_white', 'lighting_and_shadows.local_spotlights': ['few_cool', 0.5] }),
      c('neon_pools', { chroma: 0.9, luminance: -0.7, energy: 0.5 }, {
        'roads_and_ground.street_lights': 'neon', 'lighting_and_shadows.local_spotlights': 'neon_pools', 'lighting_and_shadows.bloom': ['neon', 0.6],
        'lighting_and_shadows.bounce_light': ['mixed_neon', 0.5],
      }),
      c('cinematic_bloom', { luminance: -0.5, chroma: -0.3 }, { 'lighting_and_shadows.local_spotlights': ['few_warm', 0.5], 'lighting_and_shadows.bloom': ['cinematic', 0.5] }),
      c('dreamy_bloom', { softness: 0.9 }, { 'lighting_and_shadows.bloom': ['dreamy', 0.5], 'lighting_and_shadows.bounce_light': ['violet', 0.3] }),
    ],
  },
  {
    id: 'streets', subsystem: 'ground', label: 'Streets and ground',
    components: [
      c('warm_pavement', { warmth: 0.6 }, { 'roads_and_ground.road_color': 'warm_pavement', 'roads_and_ground.road_casing': ['warm_gold', 0.6] }),
      c('ivory_roads', { luminance: 0.7, softness: 0.3 }, { 'roads_and_ground.road_color': 'ivory', 'roads_and_ground.road_casing': 'muted' }),
      c('sandstone_roads', { warmth: 0.5, era: 0.4, luminance: 0.4 }, { 'roads_and_ground.road_color': 'sandstone', 'roads_and_ground.street_material': ['stone', 0.5] }),
      c('cobbles', { era: 0.9, ornament: 0.4 }, { 'roads_and_ground.road_color': ['sandstone', 0.5], 'roads_and_ground.street_material': 'cobblestone_illustration' }),
      c('cool_slate', { warmth: -0.5, grit: -0.2 }, { 'roads_and_ground.road_color': 'cool_slate', 'roads_and_ground.road_casing': 'muted' }),
      c('coal_streets', { luminance: -0.7, chroma: -0.3 }, { 'roads_and_ground.road_color': 'coal', 'roads_and_ground.road_casing': 'dark_ink' }),
      c('rain_slick', { moisture: 0.9, luminance: -0.5 }, {
        'roads_and_ground.road_color': ['coal', 0.6], 'roads_and_ground.street_material': 'wet_asphalt', 'roads_and_ground.wet_sheen': 'rainy_night',
        'roads_and_ground.road_reflections': ['warm_streaks', 0.5],
      }),
      c('damp_streets', { moisture: 0.6 }, { 'roads_and_ground.wet_sheen': ['subtle', 0.6], 'roads_and_ground.road_reflections': ['warm_streaks', 0.4] }),
      c('neon_cyan_streets', { chroma: 0.9, luminance: -0.8, era: -0.6 }, {
        'roads_and_ground.road_color': 'neon_dark', 'roads_and_ground.road_casing': 'neon_cyan', 'roads_and_ground.road_reflections': 'neon_streaks',
        'roads_and_ground.wet_sheen': ['subtle', 0.5],
      }),
      c('neon_pink_streets', { chroma: 0.9, luminance: -0.8, energy: 0.6 }, {
        'roads_and_ground.road_color': 'neon_dark', 'roads_and_ground.road_casing': 'neon_pink', 'roads_and_ground.road_reflections': 'neon_streaks',
      }),
      c('gritty_asphalt', { grit: 0.8 }, { 'roads_and_ground.street_material': 'aged_asphalt', 'roads_and_ground.road_casing': 'muted', 'roads_and_ground.ground_shadows': ['dark_edge', 0.5] }),
      c('diagram_roads', { softness: -0.7, ornament: -0.4 }, {
        'roads_and_ground.major_road_emphasis': 'diagrammatic', 'roads_and_ground.pedestrian_paths': 'fine_dashes', 'roads_and_ground.minor_road_emphasis': ['dimmed', 0.6],
      }),
      c('sketch_paths', { softness: 0.5, era: 0.3 }, { 'roads_and_ground.pedestrian_paths': 'sketch', 'roads_and_ground.street_material': ['paper_texture', 0.5] }, ['paper']),
      c('glow_paths', { softness: 0.7, luminance: -0.3 }, { 'roads_and_ground.pedestrian_paths': 'soft_glow', 'roads_and_ground.road_reflections': ['warm_streaks', 0.4] }),
    ],
  },
  {
    id: 'greenery', subsystem: 'environment', label: 'Parks and trees',
    components: [
      c('lush_summer', { nature: 0.8, luminance: 0.6, warmth: 0.3 }, {
        'natural_land.park_palette': 'summer_lush', 'natural_land.foliage_density_illusion': 'lush', 'natural_land.park_glow': ['golden_sun', 0.4],
      }, ['summer', 'verdant', 'sun', 'coastal']),
      c('spring_bloom', { nature: 0.5, softness: 0.6, chroma: 0.3 }, {
        'natural_land.park_palette': 'spring', 'natural_land.floral_accents': ['delicate', 0.6], 'natural_land.foliage_density_illusion': ['lush', 0.4],
      }, ['spring', 'petals', 'pastel', 'whimsy']),
      c('autumn_gold', { warmth: 0.7, nature: 0.5, era: 0.3 }, {
        'natural_land.park_palette': 'autumn', 'natural_land.wood_palette': 'golden_autumn', 'natural_land.sand_palette': ['golden', 0.6],
      }, ['autumn', 'warm-glow', 'retro']),
      c('winter_muted', { warmth: -0.7, chroma: -0.4 }, {
        'natural_land.park_palette': 'winter_muted', 'natural_land.wood_palette': 'muted', 'natural_land.sand_palette': 'cold_gray',
      }, ['winter', 'snow']),
      c('sage_calm', { chroma: -0.4, softness: 0.4, nature: 0.4 }, {
        'natural_land.park_palette': 'sage', 'natural_land.wood_palette': 'olive', 'natural_land.grass_texture': ['grainy', 0.4],
      }),
      c('storybook_canopy', { softness: 0.7, ornament: 0.6, era: 0.4 }, {
        'natural_land.park_palette': 'storybook', 'natural_land.wood_palette': 'teal_illustrative', 'natural_land.tree_symbol_style': 'illustrated_canopy',
        'natural_land.floral_accents': ['wildflowers', 0.5],
      }, ['whimsy', 'paper', 'rustic']),
      c('moonlit_park', { luminance: -0.8, nature: 0.3 }, { 'natural_land.park_palette': 'moonlit', 'natural_land.wood_palette': 'deep_forest' }),
      c('minimal_trees', { ornament: -0.8, era: -0.5 }, {
        'natural_land.tree_symbol_style': 'minimal_circle', 'natural_land.foliage_density_illusion': ['sparse', 0.5], 'natural_land.park_palette': ['sage', 0.4],
      }),
      c('watercolor_green', { softness: 0.8, nature: 0.5 }, { 'natural_land.grass_texture': 'watercolor', 'natural_land.foliage_density_illusion': ['lush', 0.4] }, ['painterly']),
      c('low_poly_trees', { era: -0.6, chroma: 0.4, softness: -0.4 }, { 'natural_land.tree_symbol_style': 'low_poly' }, ['digital']),
      c('deep_forest', { nature: 0.9, luminance: -0.1, moisture: 0.3 }, {
        'natural_land.wood_palette': 'deep_forest', 'natural_land.foliage_density_illusion': 'dense_illustration', 'natural_land.park_palette': ['summer_lush', 0.4],
      }),
    ],
  },
  {
    id: 'water', subsystem: 'environment', label: 'Water and coastline',
    components: [
      c('turquoise_glint', { luminance: 0.8, warmth: 0.3, chroma: 0.4 }, {
        'water_and_coast.water_palette': 'turquoise', 'water_and_coast.water_reflectivity': 'sun_glint', 'water_and_coast.coastline_line': ['soft', 0.6],
      }),
      c('aqua_calm', { luminance: 0.5, softness: 0.4 }, { 'water_and_coast.water_palette': 'aqua', 'water_and_coast.water_texture': ['gentle_ripples', 0.6] }),
      c('deep_teal', { nature: 0.4, chroma: -0.1, luminance: -0.1 }, { 'water_and_coast.water_palette': 'deep_teal', 'water_and_coast.water_depth_look': ['subtle_gradient', 0.6] }),
      c('silver_mist', { moisture: 0.7, chroma: -0.5 }, {
        'water_and_coast.water_palette': 'silver', 'water_and_coast.harbor_mist': ['low', 0.6], 'water_and_coast.water_reflectivity': ['soft_sheen', 0.5],
      }),
      c('midnight_moon', { luminance: -0.8, softness: 0.2 }, {
        'water_and_coast.water_palette': 'midnight_navy', 'water_and_coast.water_reflectivity': 'moon_streak', 'water_and_coast.coastline_line': ['soft', 0.5],
      }),
      c('neon_harbor', { chroma: 0.9, luminance: -0.8, era: -0.5 }, {
        'water_and_coast.water_palette': ['midnight_navy', 0.6], 'water_and_coast.water_reflectivity': 'neon_reflect',
        'water_and_coast.coastline_line': ['luminous_cyan', 0.5], 'water_and_coast.reflected_colors': 'mixed_neon',
      }),
      c('ink_water', { chroma: -0.8, luminance: -0.6 }, { 'water_and_coast.water_palette': 'black_ink', 'water_and_coast.coastline_line': 'ink' }),
      c('gold_reflect', { warmth: 0.8, luminance: -0.2 }, {
        'water_and_coast.water_palette': ['deep_teal', 0.5], 'water_and_coast.reflected_colors': 'gold', 'water_and_coast.water_reflectivity': ['soft_sheen', 0.5],
      }),
      c('twilight_water', { luminance: -0.4, chroma: 0.4, softness: 0.3 }, { 'water_and_coast.water_palette': 'purple_twilight', 'water_and_coast.reflected_colors': ['rose', 0.5] }),
      c('watercolor_water', { softness: 0.8, nature: 0.3 }, { 'water_and_coast.water_texture': 'watercolor', 'water_and_coast.water_palette': ['aqua', 0.5] }, ['painterly']),
      c('fine_line_water', { softness: -0.5, ornament: -0.3 }, { 'water_and_coast.water_texture': 'fine_lines', 'water_and_coast.coastline_line': ['ink', 0.5] }),
    ],
  },
  {
    id: 'air', subsystem: 'atmosphere', label: 'Air, haze and light shafts',
    components: [
      c('whisper_fog', { moisture: 0.5, softness: 0.3 }, { 'air_and_atmosphere.fog_volume': 'whisper', 'air_and_atmosphere.fog_hue': 'silver', 'air_and_atmosphere.haze_profile': ['horizon', 0.6] }),
      c('harbor_haze', { moisture: 0.6, nature: 0.3 }, { 'air_and_atmosphere.haze_profile': 'waterfront', 'air_and_atmosphere.fog_volume': ['light', 0.5], 'air_and_atmosphere.fog_hue': 'pearl' }),
      c('heavy_fog', { moisture: 1, luminance: -0.4 }, { 'air_and_atmosphere.fog_volume': 'medium', 'air_and_atmosphere.fog_hue': 'blue', 'air_and_atmosphere.haze_profile': 'ground' }),
      c('warm_haze', { warmth: 0.8, luminance: 0.1 }, {
        'air_and_atmosphere.fog_volume': ['whisper', 0.5], 'air_and_atmosphere.fog_hue': 'warm_gold', 'air_and_atmosphere.haze_profile': ['horizon', 0.5],
      }),
      c('rose_haze', { softness: 0.7, warmth: 0.4 }, { 'air_and_atmosphere.fog_volume': ['whisper', 0.5], 'air_and_atmosphere.fog_hue': 'rose', 'air_and_atmosphere.haze_profile': 'edge' }),
      c('sunbeams', { luminance: 0.6, warmth: 0.4, moisture: 0.2 }, { 'air_and_atmosphere.light_shafts': 'sunbeams' }),
      c('night_beams', { luminance: -0.7, energy: 0.4 }, { 'air_and_atmosphere.light_shafts': ['night_beams', 0.6], 'air_and_atmosphere.haze_profile': ['edge', 0.4] }),
      c('violet_fog', { chroma: 0.5, luminance: -0.6, era: -0.4 }, {
        'air_and_atmosphere.fog_volume': ['whisper', 0.6], 'air_and_atmosphere.fog_hue': 'violet', 'air_and_atmosphere.haze_profile': ['horizon', 0.5],
      }),
    ],
  },
  {
    id: 'particles', subsystem: 'atmosphere', label: 'Particle system (at most one)',
    components: [
      c('drizzle', { moisture: 0.9, luminance: -0.2 }, { 'air_and_atmosphere.rain': 'drizzle' }, ['rain']),
      c('cinematic_rain', { moisture: 1, luminance: -0.7, chroma: -0.2 }, { 'air_and_atmosphere.rain': 'cinematic' }, ['rain']),
      c('gentle_snow', { warmth: -0.8 }, { 'air_and_atmosphere.snow': 'gentle' }, ['winter', 'snow']),
      c('slow_petals', { softness: 0.8, nature: 0.4, warmth: 0.2 }, { 'air_and_atmosphere.petals': 'slow_fall' }, ['spring', 'petals', 'whimsy']),
      c('fireflies', { nature: 0.7, luminance: -0.6, softness: 0.4 }, { 'air_and_atmosphere.fireflies': 'gentle' }, ['verdant', 'whimsy', 'rustic', 'stars']),
      c('magic_sparkle', { softness: 0.7, ornament: 0.6, chroma: 0.3 }, { 'air_and_atmosphere.sparkle': 'magical' }, ['whimsy', 'sparkle']),
      c('neon_sparkle', { chroma: 0.9, luminance: -0.7, energy: 0.7 }, { 'air_and_atmosphere.sparkle': 'neon' }),
      c('dust_drift', { warmth: 0.6, era: 0.5, energy: -0.5 }, { 'air_and_atmosphere.dust_motes': 'subtle' }, ['warm-glow', 'retro', 'cinematic', 'sun']),
      c('falling_leaves', { warmth: 0.6, nature: 0.6, era: 0.3 }, { 'natural_land.leaf_particles': 'falling_leaves' }, ['autumn']),
    ],
  },
  {
    id: 'lens', subsystem: 'atmosphere', label: 'Lens and film',
    components: [
      c('soft_vignette', { intimacy: 0.6, energy: -0.3 }, { 'air_and_atmosphere.vignette': 'soft' }),
      c('warm_vignette', { warmth: 0.7, intimacy: 0.5 }, { 'air_and_atmosphere.vignette': 'warm' }),
      c('cinematic_vignette', { chroma: -0.4, luminance: -0.4 }, { 'air_and_atmosphere.vignette': 'cinematic', 'air_and_atmosphere.grain': ['fine_film', 0.5] }),
      c('film_grain', { era: 0.7, grit: 0.3 }, { 'air_and_atmosphere.grain': 'fine_film' }),
      c('coarse_grain', { grit: 0.9 }, { 'air_and_atmosphere.grain': ['coarse_film', 0.6], 'air_and_atmosphere.vignette': ['strong', 0.4] }),
      c('starburst', { grit: -0.6, chroma: 0.3, luminance: -0.4, energy: 0.5 }, { 'air_and_atmosphere.lens_glare': ['starburst', 0.5] }),
      c('retro_monitor', { era: -0.4, chroma: 0.7, energy: 0.5 }, { 'air_and_atmosphere.scanlines': ['subtle', 0.5], 'air_and_atmosphere.chromatic_aberration': ['very_subtle', 0.4] }, ['digital']),
      c('cool_vignette', { warmth: -0.6 }, { 'air_and_atmosphere.vignette': 'cool' }),
    ],
  },
  {
    id: 'medium', subsystem: 'artistry', label: 'Artistic medium',
    components: [
      c('editorial_atlas', { era: 0.4, ornament: 0.3, softness: 0.2 }, { 'cinematic_and_artistic.render_aesthetic': ['editorial_atlas', 0.5], 'cinematic_and_artistic.paper_texture': ['cream_fiber', 0.4] }, ['paper', 'retro']),
      c('watercolor', { softness: 0.8, nature: 0.4 }, { 'cinematic_and_artistic.render_aesthetic': 'watercolor', 'cinematic_and_artistic.paper_texture': ['cream_fiber', 0.5] }, ['painterly']),
      c('storybook', { softness: 0.7, ornament: 0.6, era: 0.4 }, { 'cinematic_and_artistic.render_aesthetic': 'storybook', 'cinematic_and_artistic.ink_edges': ['hand_drawn', 0.5] }, ['whimsy', 'paper', 'rustic']),
      c('noir_film', { chroma: -0.8, luminance: -0.7 }, { 'cinematic_and_artistic.render_aesthetic': ['noir', 0.6], 'cinematic_and_artistic.decorative_frame': ['cinema_letterbox', 0.4] }, ['noir', 'cinematic']),
      c('cyberpunk', { era: -0.9, chroma: 0.9, luminance: -0.7 }, { 'cinematic_and_artistic.render_aesthetic': ['cyberpunk', 0.6], 'cinematic_and_artistic.grid_overlay': ['sci_fi', 0.3] }, ['neon', 'futurist', 'digital']),
      c('vintage_film', { era: 0.8, chroma: -0.3 }, { 'cinematic_and_artistic.render_aesthetic': ['vintage_film', 0.6], 'cinematic_and_artistic.analog_aging': ['faded_film', 0.5] }, ['retro', 'cinematic']),
      c('retro_game', { energy: 0.7, chroma: 0.8, era: -0.3 }, { 'cinematic_and_artistic.render_aesthetic': ['retro_game', 0.6] }, ['digital']),
      c('blueprint', { ornament: -0.7, softness: -0.6 }, { 'cinematic_and_artistic.render_aesthetic': ['blueprint', 0.5], 'cinematic_and_artistic.grid_overlay': ['faint_blueprint', 0.4] }, ['graphic', 'minimal']),
      c('paper_diorama', { softness: 0.5, ornament: 0.5 }, { 'cinematic_and_artistic.render_aesthetic': ['paper_diorama', 0.6], 'cinematic_and_artistic.parallax_decoration': ['paper_layers', 0.4] }, ['paper', 'whimsy']),
      c('comic_ink', { chroma: 0.7, softness: -0.6, energy: 0.5 }, { 'cinematic_and_artistic.render_aesthetic': ['comic_ink', 0.6], 'cinematic_and_artistic.halftone': ['comic_print', 0.4] }, ['graphic']),
    ],
  },
  {
    id: 'props', subsystem: 'artistry', label: 'Illustrated props',
    components: [
      c('lanterns', { warmth: 0.6, intimacy: 0.4 }, { 'cinematic_and_artistic.illustration_props': 'lanterns' }, ['lantern']),
      c('floating_geometry', { softness: 0.5, ornament: 0.5 }, { 'cinematic_and_artistic.illustration_props': 'floating_geometric' }, ['whimsy']),
      c('hologram_glyphs', { era: -0.9, chroma: 0.7 }, { 'cinematic_and_artistic.illustration_props': 'hologram_glyphs' }, ['futurist', 'digital']),
    ],
  },
  {
    id: 'markers', subsystem: 'core', label: 'Pins and interface',
    components: [
      c('warm_halo', { warmth: 0.5, luminance: -0.3 }, { 'marker_recommendations.pin_glow': 'warm_halo', 'interface_and_cards.panel_surface': 'warm_frost' }),
      c('neon_halo', { chroma: 0.8, luminance: -0.6 }, {
        'marker_recommendations.pin_glow': 'neon_halo', 'interface_and_cards.panel_surface': 'dark_glass', 'interface_and_cards.panel_border': ['neon_edge', 0.5],
      }),
      c('soft_halo', { softness: 0.6 }, { 'marker_recommendations.pin_glow': 'soft_halo', 'interface_and_cards.panel_translucency': ['subtle_glass', 0.6] }),
      c('dark_glass', { luminance: -0.6, grit: -0.4 }, { 'marker_recommendations.pin_glow': ['subtle', 0.6], 'interface_and_cards.panel_surface': 'dark_glass' }),
      c('paper_cards', { era: 0.5, softness: 0.3, luminance: 0.4 }, { 'interface_and_cards.panel_surface': 'paper', 'interface_and_cards.card_surface': 'paper' }),
      c('gold_luxe', { ornament: 0.6, grit: -0.6 }, { 'marker_recommendations.pin_material': ['metallic_illusion', 0.5], 'interface_and_cards.panel_border': ['gold', 0.5] }),
      c('minimal_dot', { ornament: -0.8 }, { 'marker_recommendations.pin_material': ['outlined', 0.5], 'interface_and_cards.panel_border': 'hairline' }),
    ],
  },
  {
    id: 'motion', subsystem: 'core', label: 'Ambient motion',
    components: [
      c('still_calm', { energy: -0.7 }, { 'animation_and_morph.particle_motion': ['drift', 0.5], 'animation_and_morph.pin_update_motion': ['fade_scale', 0.5] }),
      c('gentle', { energy: -0.2, softness: 0.4 }, { 'animation_and_morph.ambient_pace': 'slow', 'animation_and_morph.particle_motion': ['float', 0.5], 'animation_and_morph.pin_update_motion': ['gentle_spring', 0.4] }),
      c('balanced', { energy: 0.3 }, { 'animation_and_morph.ambient_pace': 'balanced', 'animation_and_morph.particle_motion': ['twinkle', 0.4], 'animation_and_morph.effect_stagger': ['subtle', 0.5] }),
      c('lively', { energy: 0.8 }, {
        'animation_and_morph.ambient_pace': 'lively', 'animation_and_morph.particle_motion': ['swirl', 0.5], 'animation_and_morph.pin_update_motion': 'gentle_spring',
        'animation_and_morph.color_wave': ['radial', 0.4],
      }),
      c('cinematic', { chroma: -0.4, luminance: -0.4, energy: -0.2 }, { 'animation_and_morph.effect_stagger': 'building_then_sky', 'animation_and_morph.light_shift_motion': ['sweep', 0.5] }),
    ],
  },
];

export const SLOT_BY_ID: ReadonlyMap<string, Slot> = new Map(SLOTS.map((s) => [s.id, s]));

export const assignOf = (a: Assign): { value: string; strength: number } => (typeof a === 'string' ? { value: a, strength: 1 } : { value: a[0], strength: a[1] });

/** Raw combination count (including each slot's plain fallback): the size of the design space, not a list of scenes. */
export const combinationCount = () => SLOTS.reduce((n, s) => n * (s.components.length + 1), 1);
