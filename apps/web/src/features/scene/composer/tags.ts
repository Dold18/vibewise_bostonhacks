/**
 * Coherence vocabulary: stylistic tags attached to *catalog values*.
 *
 * Tags live on values rather than on components so the same rules judge both
 * the composer's own choices and whatever the compiler finally resolves
 * (including values contributed by preset anchors). A value without tags is
 * stylistically neutral. A default value is never tagged.
 *
 * EXCLUSIVE pairs are hard conflicts: no resolved scene may contain a value
 * tagged with one side and a value tagged with the other. Because every rule
 * is pairwise over non-default values, any subset of a coherent scene is still
 * coherent, so capability clipping, navigation and performance budgets can only
 * remove conflicts, never create them.
 */
import type { SceneKey } from '../catalog';

type TagTable = Readonly<Record<SceneKey, Readonly<Record<string, readonly string[]>>>>;

export const VALUE_TAGS: TagTable = {
  // ── time of day and light direction ────────────────────────────────────
  'sky_and_horizon.sky_mode': {
    clear_blue: ['day', 'clear', 'noon'],
    warm_dawn: ['day', 'morning'],
    golden_hour: ['day', 'evening'],
    rose_dusk: ['dusk', 'evening'],
    purple_twilight: ['dusk'],
    night_indigo: ['night'],
    storm_gray: ['overcast'],
    dream_pastel: ['pastel', 'whimsy'],
  },
  'lighting_and_shadows.light_preset': {
    soft_day: ['day'],
    golden_hour: ['evening'],
    overcast: ['overcast'],
    blue_hour: ['dusk'],
    moonlit: ['night', 'nocturnal'],
    noir: ['noir'],
    neon_reflection: ['night', 'neon'],
  },
  'lighting_and_shadows.light_angle': {
    morning_low: ['morning'],
    noon_high: ['noon', 'crisp'],
    evening_low: ['evening'],
  },
  'lighting_and_shadows.light_intensity': { high_key: ['day'] },
  'lighting_and_shadows.ambient_fill': { deep_shadow: ['noir'] },
  'lighting_and_shadows.shadow_character': { crisp: ['crisp'], graphic: ['graphic', 'crisp'], soft: ['soft'] },
  'lighting_and_shadows.rim_light': { neon_pink: ['neon'], neon_cyan: ['neon'] },
  'lighting_and_shadows.bounce_light': { mixed_neon: ['neon'] },
  'lighting_and_shadows.local_spotlights': { few_warm: ['lamps'], few_cool: ['lamps'], neon_pools: ['neon', 'lamps'] },
  'lighting_and_shadows.bloom': { neon: ['neon'], dreamy: ['whimsy', 'soft'] },
  'sky_and_horizon.celestial_symbol': { sun_disc: ['sun'], crescent_moon: ['nocturnal'], full_moon: ['nocturnal'] },
  'sky_and_horizon.starfield': {
    few: ['nocturnal'], subtle: ['nocturnal'], dense: ['nocturnal'], illustrated_constellations: ['nocturnal', 'paper'],
  },
  'sky_and_horizon.horizon_glow': { neon_band: ['neon'] },
  'sky_and_horizon.horizon_blend': { sharp_silhouette: ['crisp'], soft_diffuse: ['soft'] },
  'sky_and_horizon.cloud_form': { storm_mass: ['rain', 'overcast'], overcast: ['overcast'] },
  'sky_and_horizon.sky_illustration': {
    watercolor: ['painterly', 'paper'], paper_grain: ['paper'], retro_gradient: ['retro'], space_dust: ['futurist', 'nocturnal'],
  },

  // ── grade ───────────────────────────────────────────────────────────────
  'global_grade.palette_family': {
    neon_night: ['neon', 'darkground'],
    luxury_dark: ['luxe', 'darkground'],
    warm_amber: ['lightground'],
    cool_blue: ['lightground'],
    earthy: ['lightground'],
    pastel: ['pastel', 'whimsy', 'lightground'],
    vintage_film: ['retro', 'lightground'],
    watercolor: ['painterly', 'paper', 'lightground'],
    paper_atlas: ['paper', 'antique', 'lightground'],
    sunwashed: ['day', 'lightground'],
    monochrome: ['minimal', 'lightground'],
  },
  'global_grade.saturation': { hypercolor: ['digital'], grayscale: ['noir'] },
  'global_grade.temperature': { ice_cold: ['winter'], sun_warm: ['day'] },
  'global_grade.grade_finish': { high_gloss: ['glossy'], faded_print: ['paper', 'retro'], cross_processed: ['retro'], cinematic: ['cinematic'] },

  // ── architecture ────────────────────────────────────────────────────────
  'building_surfaces.wall_palette': {
    glass_cyan: ['glossy', 'futurist'],
    glass_violet: ['glossy', 'futurist', 'neon'],
    gold_tone: ['luxe'],
    pastel: ['pastel', 'whimsy'],
    ink_black: ['noir', 'darkground'],
    weathered_stone: ['antique'],
  },
  'building_surfaces.roof_palette': { pastel: ['pastel', 'whimsy'], midnight: ['darkground'], gold: ['luxe'] },
  'building_surfaces.facade_look': {
    glass_grid: ['glossy', 'futurist', 'minimal'],
    wood_slats: ['rustic'],
    paper_cutout: ['paper', 'whimsy'],
    stone_blocks: ['antique'],
    brick_illustration: ['retro'],
    smooth_cement: ['minimal'],
  },
  'building_surfaces.building_material_finish': {
    polished: ['glossy'], glassy_illusion: ['glossy', 'futurist'], wet_sheen: ['glossy', 'wet'], weathered: ['grunge'],
  },
  'building_surfaces.building_outline': { cyan_glow: ['neon'], magenta_glow: ['neon'], ink: ['graphic-line'], gold: ['luxe'] },
  'building_surfaces.silhouette_style': { luminous_edge: ['neon'], crisp_ink: ['graphic', 'crisp'] },
  'building_surfaces.corner_appearance': { rounded_illustration: ['whimsy', 'paper'] },
  'building_surfaces.window_pattern': { neon_accent: ['neon'], office_cool: ['minimal'] },
  'building_surfaces.window_glow': { warm_low: ['lamps'], warm_high: ['lamps'], cold_white: ['lamps'], blue: ['lamps'], mixed: ['lamps'] },
  'building_surfaces.emissive_trim': { fine_cyan: ['neon'], fine_magenta: ['neon'], fine_gold: ['luxe'], white_architectural: ['minimal'] },
  'building_surfaces.roof_details': { abstract_hatch: ['graphic'], soft_halo: ['soft'] },

  // ── streets ─────────────────────────────────────────────────────────────
  'roads_and_ground.road_color': { neon_dark: ['neon', 'darkground'], coal: ['darkground'] },
  'roads_and_ground.road_casing': { neon_cyan: ['neon'], neon_pink: ['neon'], warm_gold: ['luxe'] },
  'roads_and_ground.street_material': {
    wet_asphalt: ['wet', 'rain'], cobblestone_illustration: ['antique', 'paper'], paper_texture: ['paper'], aged_asphalt: ['grunge'], stone: ['antique'],
  },
  'roads_and_ground.wet_sheen': { subtle: ['wet'], moderate: ['wet'], rainy_night: ['wet', 'rain', 'night'] },
  'roads_and_ground.road_reflections': { neon_streaks: ['neon', 'wet'], warm_streaks: ['wet'] },
  'roads_and_ground.street_lights': { sparse_amber: ['lamps'], dense_amber: ['lamps'], cold_white: ['lamps'], neon: ['neon', 'lamps'] },
  'roads_and_ground.lane_detail': { strong_graphic: ['graphic'], retro_diagram: ['graphic', 'retro'] },
  'roads_and_ground.pedestrian_paths': { soft_glow: ['soft'], sketch: ['paper'] },
  'roads_and_ground.major_road_emphasis': { diagrammatic: ['graphic'] },
  'roads_and_ground.ground_shadows': { illustrated: ['paper'] },

  // ── nature and water ────────────────────────────────────────────────────
  // Pale park/wood swatches are absolute daylight colors: under a night sky they read as sand, not lawn.
  'natural_land.park_palette': {
    spring: ['spring', 'lightground'], summer_lush: ['summer', 'lightground'], autumn: ['autumn', 'lightground'], winter_muted: ['winter', 'lightground'],
    sage: ['lightground'], moonlit: ['night'], storybook: ['whimsy', 'lightground'],
  },
  'natural_land.wood_palette': { golden_autumn: ['autumn', 'lightground'], olive: ['lightground'], muted: ['lightground'] },
  'natural_land.sand_palette': { sunset_pink: ['evening'] },
  'natural_land.leaf_particles': { falling_leaves: ['autumn'], petals: ['spring', 'particles'], blossoms: ['spring', 'particles'] },
  'natural_land.seasonal_visual': { spring_blush: ['spring'], summer_sun: ['summer', 'sun'], autumn_gold: ['autumn'], winter_frost: ['winter'] },
  'natural_land.tree_symbol_style': { illustrated_canopy: ['paper'], low_poly: ['digital'], fine_line: ['graphic-line'] },
  'natural_land.grass_texture': { watercolor: ['painterly', 'paper'], soft_dapple: ['painterly'] },
  'natural_land.floral_accents': { bright_spring: ['spring'], wildflowers: ['rustic'] },
  'natural_land.park_glow': { golden_sun: ['sun'], storybook: ['whimsy'] },
  'water_and_coast.water_palette': { midnight_navy: ['night'], black_ink: ['noir', 'darkground'], purple_twilight: ['dusk'] },
  'water_and_coast.water_texture': { watercolor: ['painterly', 'paper'], ink_wash: ['painterly'], fine_lines: ['graphic-line'] },
  'water_and_coast.water_reflectivity': { moon_streak: ['nocturnal'], sun_glint: ['sun', 'clear'], neon_reflect: ['neon'] },
  'water_and_coast.coastline_line': { luminous_cyan: ['neon'], gold: ['luxe'] },
  'water_and_coast.harbor_mist': { medium: ['murk'], dense: ['murk'] },
  'water_and_coast.reflected_colors': { mixed_neon: ['neon'] },

  // ── atmosphere ──────────────────────────────────────────────────────────
  'air_and_atmosphere.fog_volume': { medium: ['murk'], heavy: ['murk'] },
  'air_and_atmosphere.rain': { drizzle: ['rain', 'particles'], light: ['rain', 'particles'], cinematic: ['rain', 'particles'], storm_visual: ['rain', 'particles'] },
  'air_and_atmosphere.snow': { few_flakes: ['winter', 'particles'], gentle: ['winter', 'particles'], dense: ['winter', 'particles'] },
  'air_and_atmosphere.sparkle': { tiny: ['particles'], playful: ['whimsy', 'particles'], magical: ['whimsy', 'particles'], neon: ['neon', 'particles'] },
  'air_and_atmosphere.fireflies': { few: ['nocturnal', 'particles'], gentle: ['nocturnal', 'particles'], many: ['nocturnal', 'particles'] },
  'air_and_atmosphere.petals': { few: ['spring', 'particles'], slow_fall: ['spring', 'particles'], whimsical: ['spring', 'whimsy', 'particles'] },
  'air_and_atmosphere.dust_motes': { sunlit: ['sun', 'particles'], visible: ['particles'], subtle: ['particles'] },
  'air_and_atmosphere.light_shafts': { sunbeams: ['sun'], night_beams: ['night'] },
  'air_and_atmosphere.grain': { coarse_film: ['grunge', 'retro'], analog_noise: ['retro'], paper_grain: ['paper'] },
  'air_and_atmosphere.scanlines': { subtle: ['digital'], retro_monitor: ['digital', 'retro'], holographic: ['digital', 'futurist'] },
  'air_and_atmosphere.chromatic_aberration': { retro_glitch: ['digital'] },
  'air_and_atmosphere.distortion': { dream_shimmer: ['whimsy'], heat_haze: ['summer'], holographic_warp: ['digital', 'futurist'] },
  'air_and_atmosphere.volumetric_weather': { heavy_rain: ['rain'], dramatic_fog: ['murk'] },
  'air_and_atmosphere.lens_glare': { starburst: ['glossy'] },
  'air_and_atmosphere.vignette': { cinematic: ['cinematic'] },

  // ── artistic medium ─────────────────────────────────────────────────────
  'cinematic_and_artistic.render_aesthetic': {
    editorial_atlas: ['paper'], watercolor: ['painterly', 'paper'], storybook: ['whimsy', 'paper', 'rustic'], noir: ['noir', 'cinematic'],
    cyberpunk: ['neon', 'futurist', 'digital'], vintage_film: ['retro', 'cinematic'], retro_game: ['digital', 'graphic'],
    blueprint: ['graphic', 'minimal'], paper_diorama: ['paper', 'whimsy'], comic_ink: ['graphic'],
  },
  'cinematic_and_artistic.paper_texture': {
    cream_fiber: ['paper'], aged_parchment: ['paper', 'antique'], blueprint_paper: ['paper', 'graphic'], grainy_print: ['paper', 'retro'],
  },
  'cinematic_and_artistic.ink_edges': { heavy_outline: ['graphic'], hand_drawn: ['paper'] },
  'cinematic_and_artistic.halftone': { comic_print: ['graphic'], retro_newsprint: ['graphic', 'retro'] },
  'cinematic_and_artistic.color_banding': { posterized: ['graphic'], duotone: ['graphic'], tritone: ['graphic'] },
  'cinematic_and_artistic.analog_aging': { faded_film: ['retro'], light_leak: ['retro'], film_burn: ['retro'] },
  'cinematic_and_artistic.decorative_frame': { thin_gold: ['luxe'], cinema_letterbox: ['cinematic'], vintage_border: ['antique', 'retro'], technical_hud: ['digital', 'futurist'] },
  'cinematic_and_artistic.grid_overlay': { faint_blueprint: ['graphic'], sci_fi: ['digital', 'futurist'], subtle_graph: ['graphic'] },
  'cinematic_and_artistic.parallax_decoration': { paper_layers: ['paper'], mist_layers: ['murk'] },
  'cinematic_and_artistic.illustration_props': { lanterns: ['warm-glow'], floating_geometric: ['whimsy'], seasonal_icons: ['seasonal'], hologram_glyphs: ['digital', 'futurist'] },

  // ── markers and interface ───────────────────────────────────────────────
  'marker_recommendations.pin_glow': { neon_halo: ['neon'] },
  'interface_and_cards.panel_border': { neon_edge: ['neon'], gold: ['luxe'] },
  'interface_and_cards.panel_surface': { paper: ['paper'] },
  'interface_and_cards.card_surface': { paper: ['paper'] },
};

/** Hard conflicts between tags. */
export const EXCLUSIVE: ReadonlyArray<readonly [string, string, string]> = [
  ['day', 'night', 'a daytime sky or light with a night one'],
  ['day', 'nocturnal', 'stars, moons or fireflies in daylight'],
  ['sun', 'night', 'sunlight effects at night'],
  ['sun', 'overcast', 'sunlight effects under an overcast sky'],
  ['morning', 'evening', 'morning and evening light directions together'],
  ['noon', 'evening', 'a high noon sun with evening light'],
  ['noon', 'morning', 'a high noon sun with low morning light'],
  ['noon', 'night', 'a high noon sun at night'],
  ['night', 'evening', 'low evening sunlight at night'],
  ['night', 'morning', 'low morning sunlight at night'],
  ['lamps', 'noon', 'street lamps and lit windows under a noon sun'],
  ['darkground', 'day', 'a night-dark city under a daytime sky'],
  ['lightground', 'night', 'lit windows and a night sky over a daytime-pale ground'],
  ['rain', 'clear', 'rain under a clear sky'],
  ['rain', 'sun', 'rain with sunbeams or sun glints'],
  ['rain', 'winter', 'rain and snow together'],
  ['spring', 'summer', 'spring and summer seasonal cues together'],
  ['spring', 'autumn', 'spring and autumn seasonal cues together'],
  ['spring', 'winter', 'spring and winter seasonal cues together'],
  ['summer', 'autumn', 'summer and autumn seasonal cues together'],
  ['summer', 'winter', 'summer and winter seasonal cues together'],
  ['autumn', 'winter', 'autumn and winter seasonal cues together'],
  ['neon', 'paper', 'neon light on a paper or print medium'],
  ['neon', 'rustic', 'neon with rustic storybook materials'],
  ['neon', 'antique', 'neon with antique stone and parchment'],
  ['digital', 'paper', 'screen artifacts on a paper medium'],
  ['digital', 'antique', 'screen artifacts with antique materials'],
  ['futurist', 'antique', 'futurist glass and holograms with antique materials'],
  ['futurist', 'rustic', 'futurist glass with rustic wood'],
  ['glossy', 'paper', 'glossy glass or polish on a paper medium'],
  ['painterly', 'graphic', 'painterly washes with hard graphic print'],
  ['noir', 'whimsy', 'noir shadow with whimsical sparkle or pastel'],
  ['noir', 'pastel', 'noir with pastel colors'],
  ['murk', 'crisp', 'heavy mist with crisp hard-edged light'],
  ['minimal', 'ornate', 'minimal and ornate treatments together'],
  ['grunge', 'luxe', 'gilded luxury with grunge wear'],
];

/** Values that may only come from an explicit request, never from inferred style. */
export const EXPLICIT_ONLY_TAGS = new Set(['seasonal']);

/** At most this many simultaneous particle systems (rain, snow, petals, sparkle, fireflies, dust). */
export const MAX_PARTICLE_SYSTEMS = 1;

export function tagsOf(key: SceneKey, value: string): readonly string[] {
  return VALUE_TAGS[key]?.[value] ?? [];
}

export interface TagConflict {
  readonly a: { readonly key: SceneKey; readonly value: string; readonly tag: string };
  readonly b: { readonly key: SceneKey; readonly value: string; readonly tag: string };
  readonly reason: string;
}

/** Every exclusive-pair conflict in a set of (key, value) assignments. Defaults must be filtered by the caller. */
export function tagConflicts(assignments: ReadonlyArray<readonly [SceneKey, string]>): TagConflict[] {
  const out: TagConflict[] = [];
  const tagged = assignments.map(([key, value]) => ({ key, value, tags: tagsOf(key, value) })).filter((x) => x.tags.length);
  for (const [x, y, reason] of EXCLUSIVE) {
    for (const p of tagged) {
      if (!p.tags.includes(x)) continue;
      for (const q of tagged) {
        if (q === p || !q.tags.includes(y)) continue;
        out.push({ a: { key: p.key, value: p.value, tag: x }, b: { key: q.key, value: q.value, tag: y }, reason });
      }
    }
  }
  return out;
}
