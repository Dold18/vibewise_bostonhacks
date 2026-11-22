/**
 * Buildings section → BuildingAppearance (features/buildingAppearance).
 *
 * Pure and deterministic. Reads only the buildings section (claimed catalog
 * values), the shared env (seed, palette, navigation) and the policy-applied
 * scene view (wall/roof palette, height treatment, lighting, sky), then emits a
 * composable appearance: weighted facade families, a tower variant, windows,
 * glow, finish, roofs and seeded variation. No preset, mood or cuisine names.
 *
 * Every architectural style here is imagined: it restyles the real OSM
 * footprints and heights and never claims to show real Boston facades.
 */
import type { BuildingPlan, RenderEnv, SceneView } from '../contracts';
import { subSeed, unitHash } from '../seed';
import type {
  BuildingAppearance, FacadeTreatment, RoofKind, RoofTreatment, SurfaceKind, SurfaceMaterial, TrimTreatment, WindowShape, WindowTreatment,
} from '../../buildingAppearance/contract';

/** Catalog values this module really turns into geometry-bound treatments. Claimed by the building renderer. */
export const BUILDING_VALUES: Readonly<Record<string, readonly string[]>> = {
  'building_surfaces.facade_look': ['brick_illustration', 'stone_blocks', 'glass_grid', 'wood_slats', 'smooth_cement', 'paper_cutout'],
  'building_surfaces.window_pattern': ['sparse_warm', 'randomized_warm', 'office_cool', 'full_grid', 'neon_accent'],
  'building_surfaces.window_glow': ['warm_low', 'warm_high', 'cold_white', 'blue', 'mixed'],
  'building_surfaces.building_material_finish': ['weathered', 'polished', 'glassy_illusion', 'wet_sheen'],
  'building_surfaces.roof_details': ['abstract_hatch', 'illustrated_equipment'],
};

const KEYS = Object.keys(BUILDING_VALUES);

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const rgb = (hex: string): [number, number, number] => {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x9a9a9a;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c: readonly number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
/** `t` of the way from a to b. */
export const mixHex = (a: string, b: string, t: number) => {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((v, i) => v + (y[i]! - v) * t));
};
export const luminance = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const surface = (s: Partial<SurfaceMaterial> & Pick<SurfaceMaterial, 'kind' | 'color'>): SurfaceMaterial => ({
  tintStrength: 0.5, textureScale: 4, textureRotation: 0, roughness: 0.85, reflectivity: 0.05, weathering: 0.1, ...s,
});
const windows = (w: Partial<WindowTreatment> = {}): WindowTreatment => ({
  shape: 'punched', floorHeight: 3.4, bayWidth: 3.2, widthRatio: 0.5, heightRatio: 0.58, glassColor: '#2b3a48',
  frameColor: '#e9e4da', litFraction: 0.1, glowColor: '#ffcf8a', storefront: false, ...w,
});
const trim = (t: Partial<TrimTreatment> = {}): TrimTreatment => ({
  color: '#e8e2d6', corniceHeight: 0, baseHeight: 0, stringCourses: false, corners: 'none', cornerWidth: 0, parapetHeight: 0, ...t,
});

interface Variant {
  readonly label: string;
  readonly weight: number;
  readonly kind: SurfaceKind;
  readonly asset?: string;
  /** Family colour, blended toward the scene's wall colour. */
  readonly color: string;
  readonly textureScale: number;
  readonly windows: Partial<WindowTreatment>;
  readonly trim: Partial<TrimTreatment>;
  readonly roughness?: number;
  readonly reflectivity?: number;
  readonly weathering?: number;
  /** Fixed tint strength over the texture (painted surfaces keep their paint colour). */
  readonly tint?: number;
  readonly heightRange?: [number, number];
}

/** Facade families per `facade_look`: low/mid-rise variants plus a tower variant. Imagined styles, never real facade data. */
const FAMILIES: Readonly<Record<string, { readonly variants: readonly Variant[]; readonly tower: Variant; readonly roofs: readonly RoofKind[] }>> = {
  brick_illustration: {
    variants: [
      { label: 'red running bond', weight: 3, kind: 'brick', asset: 'brick_masonry.running_bond.warm', color: '#a5523a', textureScale: 3.2,
        windows: { widthRatio: 0.42, heightRatio: 0.6, frameColor: '#f1ece1', bayWidth: 2.8 },
        trim: { color: '#d9cfbd', corniceHeight: 0.9, baseHeight: 1.6, corners: 'quoin', cornerWidth: 0.9, parapetHeight: 0.9 } },
      { label: 'buff stacked bond', weight: 2, kind: 'brick', asset: 'brick_masonry.stacked_bond.warm', color: '#c9a27a', textureScale: 3.2,
        windows: { shape: 'arched', widthRatio: 0.45, heightRatio: 0.66, frameColor: '#3b2f28', bayWidth: 3.0 },
        trim: { color: '#8a5a44', corniceHeight: 0.6, baseHeight: 1.0, stringCourses: true, corners: 'pilaster', cornerWidth: 0.7, parapetHeight: 0.6 } },
    ],
    tower: { label: 'dark slim brick tower', weight: 1, kind: 'brick', asset: 'brick_masonry.slim_bricks.warm', color: '#5e3a30', textureScale: 3.6,
      windows: { shape: 'ribbon', heightRatio: 0.5, frameColor: '#cfc6b6' }, trim: { color: '#cfc6b6', corniceHeight: 1.4, baseHeight: 4, parapetHeight: 1.2 } },
    roofs: ['tile', 'tile', 'membrane'],
  },
  stone_blocks: {
    variants: [
      { label: 'limestone ashlar', weight: 3, kind: 'stone', asset: 'stone_concrete.limestone_slabs.warm', color: '#d6c7a6', textureScale: 5,
        windows: { shape: 'arched', widthRatio: 0.4, heightRatio: 0.62, frameColor: '#4a4036', bayWidth: 3.4 },
        trim: { color: '#efe6d2', corniceHeight: 1.3, baseHeight: 2.2, stringCourses: true, corners: 'pilaster', cornerWidth: 0.9, parapetHeight: 1.0 } },
      { label: 'granite blocks', weight: 2, kind: 'stone', asset: 'stone_concrete.granite_blocks.cool', color: '#8d9096', textureScale: 4.5,
        windows: { widthRatio: 0.44, heightRatio: 0.58, frameColor: '#e8e4dc', bayWidth: 3.0 },
        trim: { color: '#c9c5bd', corniceHeight: 0.8, baseHeight: 2.6, corners: 'quoin', cornerWidth: 1.0, parapetHeight: 0.8 } },
    ],
    tower: { label: 'limestone tower', weight: 1, kind: 'stone', asset: 'stone_concrete.limestone_slabs.warm', color: '#cbbd9d', textureScale: 6,
      windows: { shape: 'ribbon', heightRatio: 0.52 }, trim: { color: '#efe6d2', corniceHeight: 1.6, baseHeight: 5, parapetHeight: 1.4 } },
    roofs: ['tile', 'membrane', 'gravel'],
  },
  glass_grid: {
    variants: [
      { label: 'metal panel low-rise', weight: 2, kind: 'metal', asset: 'glass_metal.brushed_metal.cool', color: '#9aa4ad', textureScale: 6,
        windows: { shape: 'ribbon', heightRatio: 0.5, frameColor: '#2c3238' }, trim: { color: '#3a4048', baseHeight: 0.6 }, roughness: 0.45, reflectivity: 0.3 },
      { label: 'glass curtain', weight: 2, kind: 'glass', asset: 'glass_metal.window_grid.cool', color: '#5f7f97', textureScale: 6,
        windows: { shape: 'curtain', frameColor: '#2d3540', bayWidth: 1.8 }, trim: { color: '#2d3540' }, roughness: 0.18, reflectivity: 0.55, weathering: 0 },
    ],
    tower: { label: 'glass tower', weight: 2, kind: 'glass', asset: 'glass_metal.window_grid.cool', color: '#4d6f8a', textureScale: 7,
      windows: { shape: 'curtain', frameColor: '#26303a', bayWidth: 1.6 }, trim: { color: '#26303a' }, roughness: 0.15, reflectivity: 0.6, weathering: 0 },
    roofs: ['membrane', 'solar', 'gravel'],
  },
  wood_slats: {
    variants: [
      { label: 'timber planks', weight: 3, kind: 'timber', asset: 'timber.horizontal_planks.warm', color: '#9b7353', textureScale: 2.6,
        windows: { widthRatio: 0.38, heightRatio: 0.55, frameColor: '#efe8dc', bayWidth: 2.6 }, trim: { color: '#f2ece0', corners: 'pilaster', cornerWidth: 0.35, corniceHeight: 0.4 } },
      { label: 'warm plaster', weight: 1, kind: 'stucco', asset: 'stone_concrete.stucco_plaster.warm', color: '#d8c2a2', textureScale: 4,
        windows: { widthRatio: 0.4, heightRatio: 0.56, frameColor: '#6b4f3a' }, trim: { color: '#6b4f3a', baseHeight: 0.8 } },
    ],
    tower: { label: 'timber-clad tower', weight: 1, kind: 'timber', asset: 'timber.horizontal_planks.warm', color: '#8a6648', textureScale: 3,
      windows: { shape: 'ribbon', heightRatio: 0.5 }, trim: { color: '#e9e0d0', baseHeight: 3 } },
    roofs: ['green', 'tile', 'seam'],
  },
  smooth_cement: {
    variants: [
      { label: 'board-formed concrete', weight: 3, kind: 'concrete', asset: 'stone_concrete.pitted_concrete.cool', color: '#9c9c98', textureScale: 5,
        windows: { shape: 'ribbon', heightRatio: 0.46, frameColor: '#2f3236' }, trim: { color: '#7d7d7a', baseHeight: 1.2, parapetHeight: 0.6 }, roughness: 0.95 },
      { label: 'smooth render', weight: 2, kind: 'stucco', asset: 'stone_concrete.stucco_plaster.warm', color: '#cfc8bd', textureScale: 4,
        windows: { widthRatio: 0.46, heightRatio: 0.58, frameColor: '#3a3a3a' }, trim: { color: '#b9b2a6', baseHeight: 0.8 } },
    ],
    tower: { label: 'concrete slab tower', weight: 1, kind: 'concrete', asset: 'stone_concrete.pitted_concrete.cool', color: '#8e8e8a', textureScale: 6,
      windows: { shape: 'ribbon', heightRatio: 0.5, frameColor: '#2a2c30' }, trim: { color: '#6e6e6a', baseHeight: 4 } },
    roofs: ['gravel', 'membrane', 'membrane'],
  },
  /** Inferred from `wall_palette: soft_plaster` only (not a catalog facade_look): lime render and painted boards. */
  soft_plaster: {
    variants: [
      { label: 'lime render', weight: 3, kind: 'stucco', asset: 'stone_concrete.stucco_plaster.warm', color: '#eadfcb', textureScale: 4,
        windows: { widthRatio: 0.44, heightRatio: 0.6, frameColor: '#ffffff', bayWidth: 3.0 }, trim: { color: '#fbf7ee', corniceHeight: 0.5, baseHeight: 0.9, parapetHeight: 0.5 }, roughness: 0.95 },
      { label: 'painted clapboard', weight: 2, kind: 'timber', asset: 'timber.horizontal_planks.warm', color: '#ddd3c0', textureScale: 2.4,
        windows: { widthRatio: 0.4, heightRatio: 0.58, frameColor: '#ffffff', bayWidth: 2.7 }, trim: { color: '#ffffff', corners: 'pilaster', cornerWidth: 0.35, corniceHeight: 0.4 } },
    ],
    tower: { label: 'rendered tower', weight: 1, kind: 'stucco', asset: 'stone_concrete.stucco_plaster.warm', color: '#e2d9c9', textureScale: 5,
      windows: { shape: 'ribbon', heightRatio: 0.52, frameColor: '#f4f1ea' }, trim: { color: '#f7f3ea', baseHeight: 3, parapetHeight: 0.8 } },
    roofs: ['tile', 'membrane', 'tile'],
  },
  paper_cutout: {
    variants: [
      { label: 'pastel cut-paper', weight: 3, kind: 'plaster', asset: 'stone_concrete.stucco_plaster.pastel', color: '#e9c9cf', textureScale: 5,
        windows: { widthRatio: 0.5, heightRatio: 0.6, frameColor: '#ffffff', glassColor: '#7d8aa8' }, trim: { color: '#ffffff', corniceHeight: 0.6, stringCourses: true }, roughness: 1, weathering: 0 },
      { label: 'mint cut-paper', weight: 2, kind: 'plaster', asset: 'stone_concrete.stucco_plaster.pastel', color: '#c7e3d4', textureScale: 5,
        windows: { shape: 'arched', widthRatio: 0.46, heightRatio: 0.62, frameColor: '#ffffff', glassColor: '#8191ad' }, trim: { color: '#ffffff', corniceHeight: 0.5 }, roughness: 1, weathering: 0 },
    ],
    tower: { label: 'paper tower', weight: 1, kind: 'plaster', asset: 'stone_concrete.stucco_plaster.pastel', color: '#d9d2ec', textureScale: 6,
      windows: { shape: 'ribbon', frameColor: '#ffffff', glassColor: '#8a95b3' }, trim: { color: '#ffffff', corniceHeight: 0.8 }, roughness: 1, weathering: 0 },
    roofs: ['membrane', 'membrane', 'tile'],
  },
};

/** The plain fallback when only windows/glow/finish/roofs are active. */
const PLAIN: (typeof FAMILIES)[string] = {
  variants: [
    { label: 'plain render', weight: 1, kind: 'concrete', color: '#d7d3cd', textureScale: 4, windows: {}, trim: {}, roughness: 0.95, weathering: 0.05 },
  ],
  tower: { label: 'plain tower', weight: 1, kind: 'concrete', color: '#cfcac3', textureScale: 5, windows: { shape: 'ribbon' }, trim: {} },
  roofs: ['membrane'],
};

const WINDOWS: Readonly<Record<string, { shape?: WindowShape; lit: number; glow: string }>> = {
  sparse_warm: { lit: 0.14, glow: '#ffcf8a' },
  randomized_warm: { lit: 0.36, glow: '#ffc47a' },
  office_cool: { shape: 'ribbon', lit: 0.45, glow: '#e8f3ff' },
  full_grid: { lit: 0.68, glow: '#ffe2b0' },
  neon_accent: { shape: 'ribbon', lit: 0.32, glow: '#ff4fd8' },
};
const GLOW: Readonly<Record<string, { colors: readonly string[]; strength: number; lit: number }>> = {
  warm_low: { colors: ['#ffc777'], strength: 0.9, lit: 0.05 },
  warm_high: { colors: ['#ffd08a'], strength: 1.5, lit: 0.18 },
  cold_white: { colors: ['#eef6ff'], strength: 1.1, lit: 0.1 },
  blue: { colors: ['#7fc2ff'], strength: 1.2, lit: 0.1 },
  mixed: { colors: ['#ffc777', '#9fd4ff', '#ff8fd0'], strength: 1.2, lit: 0.12 },
};
const FINISH: Readonly<Record<string, { roughness?: number; reflectivity?: number; weathering?: number }>> = {
  weathered: { weathering: 0.6, roughness: 0.95 },
  polished: { roughness: 0.4, reflectivity: 0.25, weathering: 0 },
  glassy_illusion: { roughness: 0.22, reflectivity: 0.48, weathering: 0 },
  wet_sheen: { roughness: 0.3, reflectivity: 0.38, weathering: 0.3 },
};
/** roof_palette (base-theme value) → roof surface, preferred over the family's roofs. */
const ROOF_PALETTE: Readonly<Record<string, { kind: RoofKind; surface: SurfaceKind; asset?: string; color: string }>> = {
  terracotta: { kind: 'tile', surface: 'brick', asset: 'roofing.clay_roof_tiles.warm', color: '#9c4f35' },
  slate: { kind: 'tile', surface: 'stone', asset: 'roofing.slate_shingles.cool', color: '#4c5460' },
  copper: { kind: 'seam', surface: 'metal', asset: 'roofing.standing_seam.cool', color: '#6f9e8a' },
  gold: { kind: 'seam', surface: 'metal', asset: 'roofing.standing_seam.cool', color: '#b8954a' },
  cream: { kind: 'membrane', surface: 'concrete', color: '#e8e0cf' },
  midnight: { kind: 'membrane', surface: 'concrete', color: '#2a2f45' },
  pastel: { kind: 'membrane', surface: 'plaster', color: '#e7d4e4' },
};
const ROOF_KIND: Readonly<Record<RoofKind, { surface: SurfaceKind; asset?: string; color: string; scale: number }>> = {
  membrane: { surface: 'concrete', asset: 'stone_concrete.pitted_concrete.cool', color: '#8d8f92', scale: 6 },
  gravel: { surface: 'stone', asset: 'pavement.rounded_cobbles.cool', color: '#8a8780', scale: 2.5 },
  tile: { surface: 'brick', asset: 'roofing.clay_roof_tiles.warm', color: '#9c4f35', scale: 4 },
  seam: { surface: 'metal', asset: 'roofing.standing_seam.cool', color: '#7b8590', scale: 4 },
  green: { surface: 'stone', asset: 'nature_ground.moss.warm', color: '#6b8a4f', scale: 3 },
  solar: { surface: 'glass', asset: 'glass_metal.window_grid.cool', color: '#2c3e57', scale: 3 },
};

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Wall palette (a base-theme value the compiler already resolves) → the facade family it implies
 * when no explicit `facade_look` is active, so a world's wall colour also shapes its architecture.
 */
export const WALL_LOOK: Readonly<Record<string, string>> = {
  sandstone: 'stone_blocks',
  brick_amber: 'brick_illustration',
  soft_plaster: 'soft_plaster',
  weathered_stone: 'stone_blocks',
  concrete_gray: 'smooth_cement',
  slate: 'stone_blocks',
  glass_cyan: 'glass_grid',
  glass_violet: 'glass_grid',
  gold_tone: 'stone_blocks',
  pastel: 'paper_cutout',
  ink_black: 'glass_grid',
};
/** Inferred looks are quieter than requested ones. */
const INFERRED = 0.75;
/** The wall palette also picks which member of the family leads the street. */
const LEAD_VARIANT: Readonly<Record<string, string>> = {
  slate: 'granite blocks', weathered_stone: 'granite blocks', sandstone: 'limestone ashlar', gold_tone: 'limestone ashlar',
  concrete_gray: 'board-formed concrete', soft_plaster: 'lime render', brick_amber: 'red running bond', glass_cyan: 'glass curtain', glass_violet: 'glass curtain',
};

/** Base-theme greenery that reads as a planted city: green roofs join the roofscape. */
const VERDANT_PARK: Readonly<Record<string, number>> = { sage: 1, spring: 0.75, summer_lush: 0.6, storybook: 0.5 };
const VERDANT_WOOD: Readonly<Record<string, number>> = { deep_forest: 1, olive: 0.85, teal_illustrative: 0.5 };
/** Grades that read as bright and cheerful: painted facades join the street. */
const CHEERFUL: Readonly<Record<string, number>> = { sunwashed: 1, pastel: 0.85, watercolor: 0.6 };
const PAINTED: readonly Variant[] = [
  { label: 'mustard painted render', weight: 1, tint: 0.88, kind: 'plaster', asset: 'stone_concrete.stucco_plaster.pastel', color: '#efc163', textureScale: 4,
    windows: { widthRatio: 0.45, heightRatio: 0.6, frameColor: '#ffffff' }, trim: { color: '#ffffff', corniceHeight: 0.5 }, weathering: 0.04 },
  { label: 'coral painted render', weight: 1, tint: 0.88, kind: 'plaster', asset: 'stone_concrete.stucco_plaster.pastel', color: '#ea8f78', textureScale: 4,
    windows: { shape: 'arched', widthRatio: 0.42, heightRatio: 0.62, frameColor: '#ffffff' }, trim: { color: '#fff6ea', corniceHeight: 0.5 }, weathering: 0.04 },
  { label: 'sea-glass painted boards', weight: 1, tint: 0.88, kind: 'timber', asset: 'timber.horizontal_planks.warm', color: '#8fcbc2', textureScale: 2.4,
    windows: { widthRatio: 0.4, heightRatio: 0.58, frameColor: '#ffffff' }, trim: { color: '#ffffff', corners: 'pilaster', cornerWidth: 0.35 }, weathering: 0.04 },
];

/** Share of a base-theme value from a table, at its resolved strength. */
function sceneShare(scene: SceneView, key: string, table: Readonly<Record<string, number>>): number {
  const v = scene.resolved[key];
  return v && table[v] ? table[v]! * (scene.strengths[key] ?? 0) : 0;
}
/** Both parks and woods must read verdant (one alone is a preset's incidental greenery). */
export const verdancyOf = (scene: SceneView) =>
  Math.min(sceneShare(scene, 'natural_land.park_palette', VERDANT_PARK), sceneShare(scene, 'natural_land.wood_palette', VERDANT_WOOD));
export const cheerOf = (scene: SceneView) => sceneShare(scene, 'global_grade.palette_family', CHEERFUL);

function inferredLook(scene: SceneView): { style: string; intensity: number } | null {
  if (scene.context?.materialsEnabled === false) return null;
  const wall = scene.resolved['building_surfaces.wall_palette'];
  const style = wall ? WALL_LOOK[wall] : undefined;
  const strength = scene.strengths['building_surfaces.wall_palette'] ?? 0;
  return style && strength > 0 ? { style, intensity: strength * INFERRED } : null;
}

/** 0..1: how strongly building treatments are present (claimed values, or a look inferred from the wall palette). 0 ⇒ native extrusions. */
export function buildingPresence(section: BuildingPlan, scene?: SceneView): number {
  const explicit = section.enabled ? KEYS.reduce((m, key) => Math.max(m, section.treatments[key.slice(key.indexOf('.') + 1)]?.intensity ?? 0), 0) : 0;
  return Math.max(explicit, scene ? inferredLook(scene)?.intensity ?? 0 : 0);
}

/** Night factor from the scene's ground lightness (dark land ⇒ night lighting, lit windows). */
export const nightOf = (scene: SceneView) => clamp01((0.42 - luminance(scene.palette.land)) / 0.3);

/** Low-sun share of the base theme's sky mode / light preset: warm, raking light and lit windows over a still-light ground. */
const DUSK_SKY: Readonly<Record<string, number>> = { golden_hour: 0.55, rose_dusk: 0.8, purple_twilight: 1, warm_dawn: 0.35, storm_gray: 0.25 };
const DUSK_LIGHT: Readonly<Record<string, number>> = { golden_hour: 0.55, blue_hour: 0.9, moonlit: 1, noir: 0.7, neon_reflection: 0.8, overcast: 0.2 };
export function duskOf(scene: SceneView): number {
  const of = (key: string, table: Readonly<Record<string, number>>) => {
    const v = scene.resolved[key];
    return v && table[v] ? table[v]! * Math.min(1, (scene.strengths[key] ?? 0) * 1.25) : 0;
  };
  return clamp01(Math.max(of('sky_and_horizon.sky_mode', DUSK_SKY), of('lighting_and_shadows.light_preset', DUSK_LIGHT)));
}

/**
 * The scene's light is MapLibre's viewport-anchored [radial, azimuth°, polar°]. Blends can land behind
 * the city (azimuth near 0°, the top of the screen), which leaves every facade the camera sees in shadow.
 * The buildings' key light is kept in the viewer's half, mirrored so left/right and elevation are kept.
 */
export function frontKeyAzimuth(viewportAzimuth: number): number {
  const d = ((((viewportAzimuth + 180) % 360) + 360) % 360) - 180; // signed, 0 = top of the screen
  const front = Math.abs(d) < 90 ? Math.sign(d || 1) * (180 - Math.abs(d)) : d;
  return (front + 360) % 360;
}

/**
 * The appearance for this frame, or null when no building treatment is active
 * (the renderer then unmounts and MapLibre's native extrusions return).
 */
export function appearanceFromScene(section: BuildingPlan, env: RenderEnv, scene: SceneView): BuildingAppearance | null {
  const presence = buildingPresence(section, scene);
  if (presence <= 0) return null;
  const t = section.enabled ? section.treatments : {};
  const seed = env.seed;
  const requested = t.facade_look ? { style: t.facade_look.style, intensity: t.facade_look.intensity } : null;
  const inferred = inferredLook(scene);
  // The stronger look leads the street; a different, weaker one still contributes a variant.
  const [lead, second] = requested && !(inferred && inferred.intensity > requested.intensity) ? [requested, inferred] : [inferred, requested];
  const look = lead?.style;
  const family = (look && FAMILIES[look]) || PLAIN;
  const lookStrength = lead?.intensity ?? 0;
  const night = nightOf(scene);
  const navigating = env.mode.navigation !== 'browse';

  // Colours: the family's material colour pulled toward the world's wall colours (wall_palette via the palette).
  const pull = 0.35 + 0.3 * (1 - lookStrength);
  const lowColor = env.palette.building3d, midColor = env.palette.building3dMid, highColor = env.palette.building3dHigh;

  const win = t.window_pattern ? WINDOWS[t.window_pattern.style] : undefined;
  const glow = t.window_glow ? GLOW[t.window_glow.style] : undefined;
  const finish = t.building_material_finish ? FINISH[t.building_material_finish.style] : undefined;
  const finishAmt = t.building_material_finish?.intensity ?? 0;
  const winAmt = t.window_pattern?.intensity ?? 0;
  const glowAmt = t.window_glow?.intensity ?? 0;

  const dusk = duskOf(scene) * (1 - night);
  const litBase = 0.04 + night * 0.25 + dusk * 0.12;
  const lit = clamp01(litBase + (win ? win.lit * (0.5 + winAmt) : 0) + (glow ? glow.lit * glowAmt : 0) + night * 0.15);

  const facadeOf = (v: Variant, index: number, color: string, heightRange?: [number, number], pullScale = 1): FacadeTreatment => {
    const glowColors = glow?.colors ?? [win?.glow ?? '#ffcf8a'];
    const neon = t.window_pattern?.style === 'neon_accent';
    const glowColor = neon ? (index % 2 ? '#3ef0ff' : '#ff4fd8') : glowColors[index % glowColors.length]!;
    const mixFinish = (base: number | undefined, f: number | undefined, fallback: number) =>
      f === undefined ? base ?? fallback : (base ?? fallback) + (f - (base ?? fallback)) * clamp01(finishAmt * 1.4);
    return {
      label: v.label,
      // Seeded weight jitter: different worlds favour different members of the family.
      weight: v.weight * (0.55 + 0.9 * unitHash(subSeed(seed, 'facade-weight'), `${look ?? 'plain'}:${v.label}`)),
      ...(heightRange ? { heightRange } : v.heightRange ? { heightRange: v.heightRange } : {}),
      wall: surface({
        kind: v.kind,
        ...(v.asset ? { asset: v.asset } : {}),
        color: mixHex(v.color, color, pull * pullScale),
        tintStrength: v.tint ?? 0.4 + 0.25 * (1 - lookStrength),
        textureScale: v.textureScale,
        roughness: mixFinish(v.roughness, finish?.roughness, 0.85),
        reflectivity: mixFinish(v.reflectivity, finish?.reflectivity, 0.05),
        weathering: mixFinish(v.weathering, finish?.weathering, 0.12),
      }),
      windows: windows({
        ...v.windows,
        ...(win?.shape && v.windows.shape !== 'curtain' ? { shape: win.shape } : {}),
        litFraction: lit,
        glowColor,
      }),
      trim: trim(v.trim),
    };
  };

  const leadVariant = LEAD_VARIANT[scene.resolved['building_surfaces.wall_palette'] ?? ''];
  const facades: FacadeTreatment[] = family.variants.map((v, i) =>
    facadeOf(v.label === leadVariant ? { ...v, weight: v.weight * 2.5 } : v, i, i % 2 ? midColor : lowColor, [0, 45]));
  const secondFamily = second && second.style !== look ? FAMILIES[second.style] : undefined;
  if (secondFamily && second) {
    const v = secondFamily.variants[0]!;
    facades.push(facadeOf({ ...v, weight: v.weight * Math.min(1, second.intensity / Math.max(lookStrength, 0.01)) }, facades.length, lowColor, [0, 45]));
  }
  // Bright, cheerful grades paint part of the low-rise street (colour kept, only lightly pulled to the palette).
  const cheer = cheerOf(scene);
  if (cheer > 0.3) for (const v of PAINTED) facades.push(facadeOf({ ...v, weight: 3.2 * cheer }, facades.length, lowColor, [0, 45], 0.3));
  facades.push(facadeOf(family.tower, facades.length, highColor, [45, 1000]));

  // Roofs: the world's roof palette wins, then roof details, then the family's own roofs.
  const roofPalette = scene.resolved['building_surfaces.roof_palette'];
  const paletteRoof = roofPalette ? ROOF_PALETTE[roofPalette] : undefined;
  const kinds: RoofKind[] = [...family.roofs];
  if (t.roof_details?.style === 'illustrated_equipment') kinds.push('solar', 'gravel');
  if (t.roof_details?.style === 'abstract_hatch') kinds.push('seam', 'seam');
  const roofs: RoofTreatment[] = kinds.slice(0, 5).map((kind, i) => {
    const k = ROOF_KIND[kind];
    return {
      label: kind,
      weight: 1 + unitHash(subSeed(seed, 'roof-weight'), `${kind}:${i}`),
      kind,
      alignToFootprint: true,
      surface: surface({ kind: k.surface, ...(k.asset ? { asset: k.asset } : {}), color: mixHex(k.color, env.palette.building3d, 0.25), textureScale: k.scale, tintStrength: 0.4 }),
    };
  });
  // A planted city: green roofs join the roofscape (ahead of the family's own roofs, which may be cut at 6).
  const verdant = verdancyOf(scene) * (1 - Math.max(night, dusk));
  if (verdant > 0.35) {
    const g = ROOF_KIND.green;
    roofs.unshift({ label: 'green roofs', weight: 4 * verdant, kind: 'green', alignToFootprint: true,
      surface: surface({ kind: g.surface, asset: g.asset!, color: g.color, textureScale: g.scale, tintStrength: 0.45 }) });
  }
  if (paletteRoof) {
    roofs.unshift({
      label: `palette ${roofPalette}`,
      weight: 3,
      kind: paletteRoof.kind,
      alignToFootprint: true,
      surface: surface({ kind: paletteRoof.surface, ...(paletteRoof.asset ? { asset: paletteRoof.asset } : {}), color: paletteRoof.color, textureScale: 4, tintStrength: 0.55 }),
    });
  }

  // Lighting: the scene's key light (MapLibre light position: [radial, azimuth°, polar°], viewport-anchored),
  // lowered and warmed toward the horizon at dusk.
  const [, azimuth, polar] = scene.lighting.position;
  const altitude = Math.min(80, Math.max(8, 90 - polar));
  const glowStrength = (0.55 + night * 1.1 + dusk * 0.5) * (glow ? 0.7 + 0.6 * glow.strength * glowAmt : 1);
  return {
    version: 1,
    // Navigation keeps the city's materials (compiler rule: palette kept) but calms them.
    strength: clamp01((0.3 + 0.9 * presence) * (navigating ? 0.6 : 1)),
    facades: facades.slice(0, 8),
    roofs: roofs.slice(0, 6),
    lighting: {
      sunAzimuth: frontKeyAzimuth(azimuth),
      sunAnchor: 'viewport',
      sunAltitude: altitude + (Math.min(altitude, 16) - altitude) * dusk,
      sunColor: mixHex(mixHex('#fff3df', scene.lighting.color, 0.5), scene.sky.horizonColor, 0.45 * dusk),
      // Shadowed walls keep about MapLibre's native extrusion floor by day; night and dusk deepen them.
      ambient: (0.5 + 0.2 * scene.lighting.intensity) * (1 - night * 0.35) * (1 - dusk * 0.2),
      night: (navigating ? 0.6 : 1) * Math.max(night, dusk * 0.22),
      glowStrength: navigating ? Math.min(glowStrength, 0.6) : glowStrength,
      skyColor: scene.sky.skyColor,
      horizonColor: scene.sky.horizonColor,
    },
    variation: {
      seed: `city-${seed >>> 0}`,
      colorJitter: 0.12 + 0.25 * section.variation.amount,
      floorJitter: 0.3,
      districtSize: section.variation.cellMeters,
      districtCoherence: 0.45 + 0.4 * section.variation.amount,
    },
  };
}
