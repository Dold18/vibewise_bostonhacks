/**
 * Surface recipe: what every ground surface of the city is made of, derived
 * from the shared city appearance parameters (the Scene Composer's
 * `SceneState`: resolved catalog values, their strengths, palette, light).
 *
 * - **Explicit wins.** A non-default `roads_and_ground.*` / `natural_land.*`
 *   value (from a preset or a Gemini override) is realized as requested.
 * - **Otherwise inferred, never named.** Materials are scored from affinities
 *   to *appearance values* (wall palette, road color, palette family, …).
 *   There is no scene/preset name anywhere in this module, so any new
 *   combination of values produces a coherent, new surface composition.
 * - **Neutral is the plain map.** With no scene presence every intensity is 0.
 * - **Per-surface roles.** Minor streets take the strongest treatment, major
 *   roads a calmer variant, motorways stay in the asphalt family, sidewalks,
 *   plazas, open ground, parks and woods each get their own material.
 */
import type { Palette } from '../../mapStyle';
import { lightness, mixOk } from '../scene/color';
import { hashString, stableStringify } from '../scene/state';

/** Structural subset of the Scene Composer's SceneState that surfaces read. */
export interface SurfaceAppearance {
  readonly resolved: Readonly<Record<string, string>>;
  /** Strength (0..1) of every non-default resolved value. */
  readonly strengths: Readonly<Record<string, number>>;
  readonly palette: Palette;
  readonly lighting: { readonly color: string; readonly intensity: number };
}

export const ROAD_MATERIALS = [
  'asphalt', 'aged_asphalt', 'wet_asphalt', 'granite_setts', 'cobbles', 'flagstone',
  'brick_pavers', 'glazed_tiles', 'limestone', 'paper_sketch',
] as const;
export type RoadMaterial = (typeof ROAD_MATERIALS)[number];

export const WALK_MATERIALS = [
  'concrete_slabs', 'brick_bond', 'granite_flags', 'mosaic_tiles', 'boardwalk', 'sketch_dots', 'glow_dots', 'fine_dashes',
] as const;
export type WalkMaterial = (typeof WALK_MATERIALS)[number];

export const GROUND_MATERIALS = ['none', 'concrete_grain', 'paper_grain', 'sand_grain', 'stucco', 'dark_grain', 'topo_lines'] as const;
export type GroundMaterial = (typeof GROUND_MATERIALS)[number];

export const GREEN_MATERIALS = ['none', 'grainy', 'lush_blades', 'watercolor', 'soft_dapple'] as const;
export type GreenMaterial = (typeof GREEN_MATERIALS)[number];
export type GreenAccent = 'none' | 'flowers' | 'wildflowers' | 'blossoms' | 'leaves' | 'frost' | 'fireflies';
export type GreenEdge = 'none' | 'hedge' | 'glow' | 'ink';
export type WoodMaterial = 'none' | 'canopy' | 'dense_canopy' | 'sparse_canopy';
export type EdgeStyle = 'none' | 'curb' | 'ink' | 'gold' | 'neon';
export type LaneStyle = 'none' | 'fine_lines' | 'strong_graphic' | 'retro_diagram';
export type LampStyle = 'none' | 'sparse_amber' | 'dense_amber' | 'cold_white' | 'neon';
export type Reflection = 'none' | 'sky' | 'warm' | 'neon';

export type Origin = 'explicit' | 'inferred' | 'off';

export interface SurfaceColors {
  readonly road: string;
  readonly roadMajor: string;
  readonly motorway: string;
  readonly casing: string;
  readonly land: string;
  readonly park: string;
  readonly wood: string;
  readonly ink: string;
  readonly light: string;
  readonly sky: string;
  readonly accentA: string;
  readonly accentB: string;
  /** Mosaic colors drawn from the scene palette. */
  readonly mosaic: readonly string[];
}

export interface SurfaceRecipe {
  /** 0..1 overall scene presence; 0 ⇒ plain map. */
  readonly presence: number;
  readonly night: boolean;
  readonly roads: { readonly minor: RoadMaterial; readonly major: RoadMaterial; readonly motorway: RoadMaterial; readonly intensity: number };
  /** 0..1 wetness applied on top of any road material. */
  readonly wet: number;
  readonly reflection: Reflection;
  /** 0..1 cracks, patches, dirt, chipped stones. */
  readonly wear: number;
  /** Texture feature scale (1 = default). */
  readonly scale: number;
  readonly walk: { readonly material: WalkMaterial; readonly intensity: number };
  readonly ground: { readonly material: GroundMaterial; readonly intensity: number };
  readonly green: { readonly material: GreenMaterial; readonly accent: GreenAccent; readonly edge: GreenEdge; readonly edgeColor: string; readonly intensity: number };
  readonly wood: { readonly material: WoodMaterial; readonly intensity: number };
  readonly edges: { readonly style: EdgeStyle; readonly color: string; readonly intensity: number };
  readonly lanes: { readonly style: LaneStyle; readonly color: string; readonly intensity: number };
  readonly lamps: { readonly style: LampStyle; readonly intensity: number };
  readonly colors: SurfaceColors;
  /** Where each decision came from (debug panels and honest reporting). */
  readonly origins: Readonly<Record<string, Origin>>;
  readonly hash: string;
}

/** Developer/QA overrides (never set by the compiler). */
export interface SurfaceOverrides {
  readonly roadMaterial?: RoadMaterial;
  readonly walkMaterial?: WalkMaterial;
  readonly groundMaterial?: GroundMaterial;
  readonly greenMaterial?: GreenMaterial;
  readonly wear?: number;
  readonly wet?: number;
  readonly scale?: number;
  /** Multiplies every intensity. */
  readonly intensity?: number;
}

// ---------------------------------------------------------------------------
// Affinities: appearance value → material votes. Tokens are `group.key=value`;
// `group.key=*` matches any non-default value of that key.

const ROAD_AFFINITY: Readonly<Record<RoadMaterial, Readonly<Record<string, number>>>> = {
  asphalt: {
    'global_grade.palette_family=cool_blue': 0.5, 'sky_and_horizon.horizon_blend=sharp_silhouette': 0.3,
    'building_surfaces.wall_palette=glass_cyan': 0.5, 'building_surfaces.wall_palette=concrete_gray': 0.2,
    'building_surfaces.building_material_finish=polished': 0.4, 'building_surfaces.facade_look=glass_grid': 0.5,
  },
  aged_asphalt: {
    'roads_and_ground.road_color=coal': 0.5, 'building_surfaces.wall_palette=concrete_gray': 0.5,
    'global_grade.palette_family=monochrome': 0.6, 'sky_and_horizon.sky_mode=storm_gray': 0.3,
    'building_surfaces.building_material_finish=weathered': 0.5, 'cinematic_and_artistic.analog_aging=*': 0.5,
    'building_surfaces.wall_palette=ink_black': 0.3,
  },
  wet_asphalt: {
    'roads_and_ground.wet_sheen=*': 1, 'roads_and_ground.road_color=neon_dark': 0.7, 'global_grade.palette_family=neon_night': 0.6,
    'roads_and_ground.road_reflections=*': 0.7, 'air_and_atmosphere.rain=*': 0.8, 'building_surfaces.building_material_finish=wet_sheen': 0.6,
  },
  granite_setts: {
    'building_surfaces.wall_palette=slate': 0.4, 'building_surfaces.wall_palette=weathered_stone': 0.7,
    'building_surfaces.wall_palette=sandstone': 0.3, 'roads_and_ground.road_color=sandstone': 0.5,
    'global_grade.palette_family=luxury_dark': 0.5, 'roads_and_ground.road_casing=dark_ink': 0.3,
    'roads_and_ground.road_color=coal': 0.2, 'building_surfaces.facade_look=stone_blocks': 0.7, 'roads_and_ground.road_color=cool_slate': 0.4,
  },
  cobbles: {
    'roads_and_ground.road_color=warm_pavement': 0.7, 'building_surfaces.wall_palette=brick_amber': 0.6,
    'building_surfaces.roof_palette=terracotta': 0.3, 'global_grade.palette_family=warm_amber': 0.4,
    'roads_and_ground.road_casing=warm_gold': 0.2, 'building_surfaces.facade_look=brick_illustration': 0.6,
    'building_surfaces.corner_appearance=rounded_illustration': 0.5,
  },
  flagstone: {
    'global_grade.palette_family=earthy': 0.7, 'building_surfaces.roof_palette=copper': 0.3, 'natural_land.wood_palette=deep_forest': 0.2,
    'natural_land.park_palette=storybook': 0.2, 'building_surfaces.facade_look=wood_slats': 0.5,
  },
  brick_pavers: {
    'building_surfaces.wall_palette=brick_amber': 0.4, 'building_surfaces.roof_palette=terracotta': 0.45,
    'global_grade.temperature=candle_warm': 0.2, 'natural_land.park_palette=autumn': 0.2,
  },
  glazed_tiles: {
    'global_grade.palette_family=pastel': 0.7, 'building_surfaces.wall_palette=pastel': 0.6,
    'building_surfaces.roof_palette=pastel': 0.3, 'sky_and_horizon.sky_mode=dream_pastel': 0.3,
  },
  limestone: {
    'global_grade.palette_family=sunwashed': 0.6, 'building_surfaces.wall_palette=soft_plaster': 0.6,
    'building_surfaces.roof_palette=cream': 0.4, 'roads_and_ground.road_color=ivory': 0.15,
  },
  paper_sketch: {
    'global_grade.palette_family=paper_atlas': 0.9, 'global_grade.contrast_curve=flat_print': 0.4,
    'cinematic_and_artistic.paper_texture=*': 0.9, 'cinematic_and_artistic.halftone=*': 0.4,
  },
};
/** Every scene leans slightly toward clean asphalt (the real city). */
const ROAD_BASELINE: Partial<Record<RoadMaterial, number>> = { asphalt: 0.3 };

/** Explicit catalog `street_material` → material. */
const STREET_MATERIAL: Readonly<Record<string, RoadMaterial>> = {
  clean: 'asphalt', aged_asphalt: 'aged_asphalt', wet_asphalt: 'wet_asphalt', stone: 'granite_setts',
  cobblestone_illustration: 'cobbles', paper_texture: 'paper_sketch',
};

/** Major roads keep the family but read calmer; motorways stay asphalt. */
const MAJOR_OF: Readonly<Record<RoadMaterial, RoadMaterial>> = {
  asphalt: 'asphalt', aged_asphalt: 'aged_asphalt', wet_asphalt: 'wet_asphalt', granite_setts: 'granite_setts',
  cobbles: 'granite_setts', flagstone: 'granite_setts', brick_pavers: 'granite_setts', glazed_tiles: 'glazed_tiles',
  limestone: 'limestone', paper_sketch: 'paper_sketch',
};
const MOTORWAY_OF = (m: RoadMaterial, wet: number): RoadMaterial =>
  wet > 0.15 || m === 'wet_asphalt' ? 'wet_asphalt' : m === 'aged_asphalt' ? 'aged_asphalt' : m === 'paper_sketch' ? 'paper_sketch' : 'asphalt';

const WALK_OF: Readonly<Record<RoadMaterial, WalkMaterial>> = {
  asphalt: 'concrete_slabs', aged_asphalt: 'concrete_slabs', wet_asphalt: 'glow_dots', granite_setts: 'granite_flags',
  cobbles: 'brick_bond', flagstone: 'boardwalk', brick_pavers: 'brick_bond', glazed_tiles: 'mosaic_tiles',
  limestone: 'concrete_slabs', paper_sketch: 'sketch_dots',
};
const PEDESTRIAN_PATHS: Readonly<Record<string, WalkMaterial>> = {
  fine_dashes: 'fine_dashes', rounded_dots: 'mosaic_tiles', soft_glow: 'glow_dots', sketch: 'sketch_dots',
};

const GROUND_OF: Readonly<Record<RoadMaterial, GroundMaterial>> = {
  asphalt: 'concrete_grain', aged_asphalt: 'concrete_grain', wet_asphalt: 'dark_grain', granite_setts: 'concrete_grain',
  cobbles: 'stucco', flagstone: 'sand_grain', brick_pavers: 'stucco', glazed_tiles: 'stucco', limestone: 'sand_grain',
  paper_sketch: 'topo_lines',
};

const GRASS_TEXTURE: Readonly<Record<string, GreenMaterial>> = { grainy: 'grainy', watercolor: 'watercolor', soft_dapple: 'soft_dapple' };
const PARK_GREEN: Readonly<Record<string, [GreenMaterial, GreenAccent]>> = {
  natural: ['grainy', 'none'], spring: ['soft_dapple', 'blossoms'], summer_lush: ['lush_blades', 'none'], autumn: ['grainy', 'leaves'],
  winter_muted: ['grainy', 'frost'], sage: ['grainy', 'none'], storybook: ['watercolor', 'flowers'], moonlit: ['soft_dapple', 'fireflies'],
};
const SEASONAL_ACCENT: Readonly<Record<string, GreenAccent>> = {
  spring_blush: 'blossoms', summer_sun: 'none', autumn_gold: 'leaves', winter_frost: 'frost',
};
const PARK_GLOW: Readonly<Record<string, string>> = { soft_green: '#a8ff9e', golden_sun: '#ffd36b', storybook: '#ffb3e6' };
const WET_SHEEN: Readonly<Record<string, number>> = { subtle: 0.35, moderate: 0.6, rainy_night: 0.9 };
/** Wetness implied by weather (rain, or heavy-rain volumetric weather) when no wet sheen is set. */
const RAIN_WET: Readonly<Record<string, number>> = { drizzle: 0.45, light: 0.5, cinematic: 0.7, storm_visual: 0.85, heavy_rain: 0.8 };
const BASE_WEAR: Readonly<Record<RoadMaterial, number>> = {
  asphalt: 0.12, aged_asphalt: 0.85, wet_asphalt: 0.3, granite_setts: 0.4, cobbles: 0.45, flagstone: 0.5,
  brick_pavers: 0.35, glazed_tiles: 0.08, limestone: 0.2, paper_sketch: 0,
};

const isDefault = (a: SurfaceAppearance, key: string) => !(a.strengths[key] > 0);
const explicit = (a: SurfaceAppearance, key: string): [string, number] | null =>
  isDefault(a, key) ? null : [a.resolved[key], a.strengths[key]];

/** Score each candidate by its affinities to the resolved, non-default values. */
export function scoreAffinities<T extends string>(
  a: SurfaceAppearance,
  table: Readonly<Record<T, Readonly<Record<string, number>>>>,
  baseline: Partial<Record<T, number>> = {},
): Array<[T, number]> {
  const scores = (Object.keys(table) as T[]).map((m): [T, number] => {
    let s = baseline[m] ?? 0;
    for (const [token, w] of Object.entries(table[m])) {
      const [key, value] = token.split('=');
      const strength = a.strengths[key];
      if (!(strength > 0)) continue;
      if (value === '*' || a.resolved[key] === value) s += w * strength;
    }
    return [m, Math.round(s * 1000) / 1000];
  });
  // Stable: higher score first, then table order.
  return scores.sort((x, y) => y[1] - x[1]);
}

/**
 * How present the scene is: the strongest non-default value. Strengths already
 * carry preset weights and model confidence, so an early, faint answer gives a
 * faint city and a scene with no non-default values is exactly the plain map.
 */
export function presenceOf(a: SurfaceAppearance): number {
  const strongest = Object.values(a.strengths).reduce((m, v) => Math.max(m, v), 0);
  return Math.round(Math.min(1, strongest) * 1000) / 1000;
}

const NEON_CASING: Readonly<Record<string, string>> = { neon_cyan: '#33e6ff', neon_pink: '#ff4fd8' };

/** Derive the full surface recipe. Pure and deterministic. */
export function deriveSurfaceRecipe(a: SurfaceAppearance | null, overrides: SurfaceOverrides = {}): SurfaceRecipe {
  const origins: Record<string, Origin> = {};
  const p = a?.palette;
  const presence = a ? presenceOf(a) : 0;
  const colorsFallback = p ?? null;
  if (!a || !colorsFallback || presence <= 0) return neutralRecipe(colorsFallback);

  const palette = a.palette;
  const night = lightness(palette.land) < 0.42;
  const k = Math.max(0, overrides.intensity ?? 1);

  // --- wetness and road material ---
  const wetExplicit = explicit(a, 'roads_and_ground.wet_sheen');
  let wet = wetExplicit ? (WET_SHEEN[wetExplicit[0]] ?? 0) * wetExplicit[1] : 0;
  origins.wet = wetExplicit ? 'explicit' : 'off';
  // Falling rain wets the ground it falls on, so streets and weather agree.
  const rain = explicit(a, 'air_and_atmosphere.rain') ?? explicit(a, 'air_and_atmosphere.volumetric_weather');
  const rainWet = rain ? (RAIN_WET[rain[0]] ?? 0) * Math.min(1, rain[1] * 1.25) : 0;
  if (rainWet > wet) {
    wet = rainWet;
    origins.wet = 'inferred';
  }

  const sm = explicit(a, 'roads_and_ground.street_material');
  let minor: RoadMaterial;
  if (sm && STREET_MATERIAL[sm[0]]) {
    minor = STREET_MATERIAL[sm[0]];
    origins.roads = 'explicit';
  } else {
    minor = scoreAffinities(a, ROAD_AFFINITY, ROAD_BASELINE)[0][0];
    origins.roads = 'inferred';
  }
  if (overrides.roadMaterial) minor = overrides.roadMaterial;
  if (minor === 'wet_asphalt' && wet < 0.45) {
    wet = Math.max(wet, 0.55);
    origins.wet = origins.wet === 'explicit' ? 'explicit' : 'inferred';
  }
  if (overrides.wet !== undefined) wet = clamp(overrides.wet, 0, 1);

  const refl = explicit(a, 'roads_and_ground.road_reflections');
  const neonish = a.resolved['global_grade.palette_family'] === 'neon_night' || !!NEON_CASING[a.resolved['roads_and_ground.road_casing']];
  const reflection: Reflection = refl
    ? refl[0] === 'neon_streaks' ? 'neon' : refl[0] === 'warm_streaks' ? 'warm' : 'sky'
    : wet > 0 ? (neonish ? 'neon' : warmLight(a.lighting.color) ? 'warm' : 'sky') : 'none';

  // --- wear and scale ---
  let wear = BASE_WEAR[minor];
  const finish = a.resolved['building_surfaces.building_material_finish'];
  if (!isDefault(a, 'building_surfaces.building_material_finish')) wear += finish === 'weathered' ? 0.3 : finish === 'polished' ? -0.25 : 0;
  if (!isDefault(a, 'cinematic_and_artistic.analog_aging')) wear += 0.2;
  wear = clamp(overrides.wear ?? wear, 0, 1);
  let scale = 1;
  if (a.resolved['building_surfaces.corner_appearance'] === 'rounded_illustration') scale = 1.25;
  if (a.resolved['global_grade.palette_family'] === 'cool_blue') scale = 0.9;
  scale = clamp(overrides.scale ?? scale, 0.5, 2);

  // --- sidewalks and plazas ---
  const pp = explicit(a, 'roads_and_ground.pedestrian_paths');
  let walkMaterial = pp && PEDESTRIAN_PATHS[pp[0]] ? PEDESTRIAN_PATHS[pp[0]] : WALK_OF[minor];
  origins.walk = pp ? 'explicit' : 'inferred';
  if (overrides.walkMaterial) walkMaterial = overrides.walkMaterial;

  // --- open ground ---
  let groundMaterial: GroundMaterial = GROUND_OF[minor];
  if (night && groundMaterial === 'concrete_grain') groundMaterial = 'dark_grain';
  origins.ground = 'inferred';
  if (overrides.groundMaterial) groundMaterial = overrides.groundMaterial;

  // --- parks and woods ---
  const gt = explicit(a, 'natural_land.grass_texture');
  const parkPalette = a.resolved['natural_land.park_palette'];
  const [parkGreen, parkAccent] = PARK_GREEN[parkPalette] ?? ['grainy', 'none'];
  let greenMaterial: GreenMaterial = gt && GRASS_TEXTURE[gt[0]] ? GRASS_TEXTURE[gt[0]] : parkGreen;
  origins.green = gt ? 'explicit' : 'inferred';
  if (overrides.greenMaterial) greenMaterial = overrides.greenMaterial;
  const seasonal = explicit(a, 'natural_land.seasonal_visual');
  const floral = explicit(a, 'natural_land.floral_accents');
  let accent: GreenAccent = isDefault(a, 'natural_land.park_palette') ? 'none' : parkAccent;
  if (seasonal) accent = SEASONAL_ACCENT[seasonal[0]] ?? accent;
  if (floral) accent = floral[0] === 'bright_spring' ? 'blossoms' : floral[0] === 'wildflowers' ? 'wildflowers' : 'flowers';
  origins.greenAccent = seasonal || floral ? 'explicit' : accent === 'none' ? 'off' : 'inferred';
  const glow = explicit(a, 'natural_land.park_glow');
  const greenEdge: GreenEdge = glow ? 'glow' : minor === 'paper_sketch' || parkPalette === 'storybook' ? 'ink' : 'hedge';
  const greenEdgeColor =
    greenEdge === 'glow' ? mixOk(palette.park, PARK_GLOW[glow![0]] ?? a.lighting.color, 0.7) : greenEdge === 'ink' ? palette.textPrimary : mixOk(palette.park, '#1f3a1f', 0.45);
  const foliage = explicit(a, 'natural_land.foliage_density_illusion');
  const fv = foliage?.[0];
  const woodMaterial: WoodMaterial = fv === 'sparse' || fv === 'minimal' ? 'sparse_canopy' : fv === 'dense_illustration' ? 'dense_canopy' : 'canopy';
  const woodBoost = fv === 'lush' || fv === 'dense_illustration' ? 1.15 : fv === 'minimal' ? 0.5 : 1;

  // --- road edges, lanes, lamps ---
  const casing = a.resolved['roads_and_ground.road_casing'];
  const casingSet = !isDefault(a, 'roads_and_ground.road_casing');
  const edgeStyle: EdgeStyle = !casingSet
    ? minor === 'granite_setts' || minor === 'cobbles' || minor === 'flagstone' ? 'curb' : 'none'
    : casing === 'dark_ink' ? 'ink' : casing === 'warm_gold' ? 'gold' : NEON_CASING[casing] ? 'neon' : 'curb';
  const edgeColor =
    edgeStyle === 'neon' ? NEON_CASING[casing] : edgeStyle === 'gold' ? '#d9a441' : edgeStyle === 'ink' ? palette.textPrimary : mixOk(palette.roadCasing, night ? '#9aa0a8' : '#c9c4ba', 0.5);
  origins.edges = casingSet ? 'explicit' : edgeStyle === 'none' ? 'off' : 'inferred';

  const ld = explicit(a, 'roads_and_ground.lane_detail');
  const laneStyle: LaneStyle = ld
    ? (ld[0] as LaneStyle)
    : minor === 'paper_sketch' ? 'retro_diagram' : neonish ? 'strong_graphic' : minor.endsWith('asphalt') ? 'fine_lines' : 'none';
  const laneColor = laneStyle === 'retro_diagram' ? palette.textPrimary : neonish ? '#5ef2ff' : night ? '#e8d9a8' : '#ffffff';
  origins.lanes = ld ? 'explicit' : laneStyle === 'none' ? 'off' : 'inferred';

  const sl = explicit(a, 'roads_and_ground.street_lights');
  const dusk = !night && a.lighting.intensity < 0.3 && warmLight(a.lighting.color) && a.resolved['global_grade.temperature'] === 'candle_warm';
  const lampStyle: LampStyle = sl
    ? (sl[0] as LampStyle)
    : night ? (neonish ? 'neon' : warmLight(a.lighting.color) ? 'dense_amber' : 'cold_white') : dusk ? 'sparse_amber' : 'none';
  origins.lamps = sl ? 'explicit' : lampStyle === 'none' ? 'off' : 'inferred';

  const colors: SurfaceColors = {
    road: palette.roadMinor,
    roadMajor: palette.roadMajor,
    // Mostly the major-road color: the palette's bright highway yellow would read as sand under a texture.
    motorway: mixOk(palette.highway, palette.roadMajor, 0.85),
    casing: palette.roadCasing,
    land: palette.land,
    park: palette.park,
    wood: palette.wood,
    ink: palette.textPrimary,
    light: a.lighting.color,
    sky: palette.sky,
    accentA: neonish ? NEON_CASING[casing] ?? '#ff4fd8' : mixOk(a.lighting.color, '#ffb347', 0.5),
    accentB: neonish ? '#33e6ff' : mixOk(palette.sky, '#ffffff', 0.3),
    mosaic: [palette.roadMinor, palette.park, palette.water, palette.building3dHigh, palette.sky],
  };

  const s = (x: number) => round3(clamp(x * presence * k, 0, 1));
  const recipe: Omit<SurfaceRecipe, 'hash'> = {
    presence,
    night,
    roads: { minor, major: MAJOR_OF[minor], motorway: MOTORWAY_OF(minor, wet), intensity: s(0.92) },
    wet: round3(wet),
    reflection,
    wear: round3(wear),
    scale: round3(scale),
    walk: { material: walkMaterial, intensity: s(0.9) },
    ground: { material: groundMaterial, intensity: s(groundMaterial === 'none' ? 0 : 0.75) },
    green: { material: greenMaterial, accent, edge: greenEdge, edgeColor: greenEdgeColor, intensity: s(greenMaterial === 'none' ? 0 : 0.85) },
    wood: { material: woodMaterial, intensity: s(0.8 * woodBoost) },
    edges: { style: edgeStyle, color: edgeColor, intensity: s(edgeStyle === 'none' ? 0 : edgeStyle === 'curb' ? 0.55 : 0.85) },
    lanes: { style: laneStyle, color: laneColor, intensity: s(laneStyle === 'none' ? 0 : 0.8) },
    lamps: { style: lampStyle, intensity: s(lampStyle === 'none' ? 0 : night ? 0.9 : 0.55) },
    colors,
    origins,
  };
  return { ...recipe, hash: hashString(stableStringify(recipe)) };
}

/** No scene: every surface off. The plain map is untouched. */
export function neutralRecipe(palette: Palette | null): SurfaceRecipe {
  const c = palette;
  const colors: SurfaceColors = {
    road: c?.roadMinor ?? '#ffffff', roadMajor: c?.roadMajor ?? '#ffffff', motorway: c?.highway ?? '#fcd56a', casing: c?.roadCasing ?? '#dadce0',
    land: c?.land ?? '#f3f3f0', park: c?.park ?? '#c3e8bd', wood: c?.wood ?? '#b3dfab', ink: c?.textPrimary ?? '#3c4043',
    light: c?.light ?? '#ffffff', sky: c?.sky ?? '#bcd9f7', accentA: '#ffb347', accentB: '#ffffff', mosaic: [],
  };
  const recipe: Omit<SurfaceRecipe, 'hash'> = {
    presence: 0, night: false,
    roads: { minor: 'asphalt', major: 'asphalt', motorway: 'asphalt', intensity: 0 },
    wet: 0, reflection: 'none', wear: 0, scale: 1,
    walk: { material: 'concrete_slabs', intensity: 0 },
    ground: { material: 'none', intensity: 0 },
    green: { material: 'none', accent: 'none', edge: 'none', edgeColor: colors.park, intensity: 0 },
    wood: { material: 'none', intensity: 0 },
    edges: { style: 'none', color: colors.casing, intensity: 0 },
    lanes: { style: 'none', color: '#ffffff', intensity: 0 },
    lamps: { style: 'none', intensity: 0 },
    colors,
    origins: { roads: 'off', walk: 'off', ground: 'off', green: 'off', edges: 'off', lanes: 'off', lamps: 'off', wet: 'off' },
  };
  return { ...recipe, hash: hashString(stableStringify(recipe)) };
}

function warmLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const b = n & 255;
  return r - b > 30;
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;
