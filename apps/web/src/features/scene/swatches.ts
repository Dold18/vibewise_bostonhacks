/**
 * What catalog values look like: the realization tables.
 *
 * Each palette-driven catalog setting maps its values to the map palette
 * entries it owns. A swatch names only the entries it cares about; related
 * entries follow through RELATIONS, so `palette_family: neon_night` (which only
 * names `land` and `urban`) still darkens roads, footprints and paths coherently.
 *
 * A value with no entry here is not implemented. capabilities.ts derives the
 * supported-value list from these tables, so a new swatch is the only step
 * needed to make a value real.
 */
import type { Palette, PaletteKey } from '../../mapStyle';
import { hexToLab, labToHex, mixOk } from './color';

export type Swatch = Partial<Palette> | ((current: Palette) => Partial<Palette>);

/** Palette settings in application order: anchors (land, walls) before refinements (towers). */
export const PALETTE_SWATCHES: Readonly<Record<string, Readonly<Record<string, Swatch>>>> = {
  'global_grade.palette_family': {
    warm_amber: { land: '#fbefdc', urban: '#f4e0c2' },
    cool_blue: { land: '#eef3f8', urban: '#e2e9f1' },
    neon_night: { land: '#17142b', urban: '#1f1a3a' },
    pastel: { land: '#fbf2f6', urban: '#f3e6f2' },
    earthy: { land: '#efeadb', urban: '#e4dcc6' },
    monochrome: { land: '#ececec', urban: '#dedede' },
    vintage_film: { land: '#efe6d2', urban: '#e3d6bb' },
    sunwashed: { land: '#fbf8ef', urban: '#f3ecdc' },
    luxury_dark: { land: '#1b1d26', urban: '#23252f' },
    watercolor: { land: '#f7f4ec', urban: '#ece6da' },
    paper_atlas: { land: '#f1e7cf', urban: '#e6d8b8' },
  },
  'sky_and_horizon.sky_mode': {
    clear_blue: { sky: '#8fc3f2', horizon: '#e4f1fc' },
    warm_dawn: { sky: '#f6c9a8', horizon: '#fde7cf' },
    golden_hour: { sky: '#f2a65e', horizon: '#fcd9a4' },
    rose_dusk: { sky: '#d88fa8', horizon: '#f6c6c4' },
    purple_twilight: { sky: '#4b2f7a', horizon: '#c46aa8' },
    night_indigo: { sky: '#141a3c', horizon: '#3a3f6e' },
    storm_gray: { sky: '#7d8590', horizon: '#b9bec4' },
    dream_pastel: { sky: '#c9b6f0', horizon: '#fbd6e6' },
  },
  'sky_and_horizon.horizon_glow': {
    warm_band: { horizon: '#ffc98a' },
    cool_band: { horizon: '#a9d4f5' },
    rose_band: { horizon: '#f7a8bf' },
    neon_band: { horizon: '#ff4fb8' },
    pale_mist: { horizon: '#eef1f2' },
  },
  'lighting_and_shadows.light_color': {
    white: { light: '#ffffff' },
    amber: { light: '#ffc98a' },
    gold: { light: '#ffd970' },
    pink: { light: '#ffb3d9' },
    violet: { light: '#c9a6ff' },
    cyan: { light: '#9ff0ff' },
    icy_blue: { light: '#cfe6ff' },
  },
  'building_surfaces.roof_palette': {
    terracotta: { building: '#e0a184' },
    slate: { building: '#8b93a1' },
    copper: { building: '#c58b62' },
    gold: { building: '#e5c374' },
    cream: { building: '#f4ead6' },
    midnight: { building: '#262a45' },
    pastel: { building: '#eed7ea' },
  },
  'building_surfaces.wall_palette': {
    sandstone: { building3d: '#e6d2ac' },
    brick_amber: { building3d: '#d9a37a' },
    soft_plaster: { building3d: '#f4efe6' },
    weathered_stone: { building3d: '#c9c4b8' },
    concrete_gray: { building3d: '#c8cacc' },
    slate: { building3d: '#4a5262' },
    glass_cyan: { building3d: '#9fd6e0' },
    glass_violet: { building3d: '#6a4fa8' },
    gold_tone: { building3d: '#e2c27a' },
    pastel: { building3d: '#f1d3e6' },
    ink_black: { building3d: '#23242b' },
  },
  // Towers relative to the current wall color, so they compose with any wall_palette.
  'building_surfaces.height_color_treatment': {
    warm_towers: towers('#f0b27a', '#e48a4e'),
    cool_towers: towers('#9fb7e8', '#6f86d6'),
    gold_towers: towers('#f0d290', '#e0b44f'),
    dark_towers: towers('#1c1e2a', '#1c1e2a', 0.25, 0.5),
    muted_lowrise: (p) => ({ building3d: desaturate(p.building3d, 0.5) }),
  },
  'roads_and_ground.road_color': {
    ivory: { roadMinor: '#fffaf0', roadMajor: '#fffaf0' },
    warm_pavement: { roadMinor: '#f7e6cf', roadMajor: '#fbecd6' },
    cool_slate: { roadMinor: '#dfe5ec', roadMajor: '#e8edf2' },
    coal: { roadMinor: '#2b2d33', roadMajor: '#353840' },
    neon_dark: { roadMinor: '#241c3d', roadMajor: '#2e2350' },
    sandstone: { roadMinor: '#efdfc2', roadMajor: '#f4e6cc' },
  },
  'roads_and_ground.road_casing': {
    muted: { roadCasing: '#d6d4cf', roadMajorCasing: '#c9c6c0' },
    dark_ink: { roadCasing: '#4a4a52', roadMajorCasing: '#3a3a42' },
    warm_gold: { roadCasing: '#e0b46a', roadMajorCasing: '#d49a45' },
    neon_cyan: { roadCasing: '#22d3ee', roadMajorCasing: '#06b6d4' },
    neon_pink: { roadCasing: '#ff4fb8', roadMajorCasing: '#ff2e97' },
  },
  'water_and_coast.water_palette': {
    turquoise: { water: '#5fd0d6' },
    aqua: { water: '#8fd8e8' },
    deep_teal: { water: '#3f8f96' },
    midnight_navy: { water: '#182748' },
    silver: { water: '#b8c4cf' },
    purple_twilight: { water: '#3d2c6b' },
    black_ink: { water: '#101218' },
  },
  'natural_land.park_palette': {
    spring: { park: '#cdeeb0' },
    summer_lush: { park: '#9ed98a' },
    autumn: { park: '#e2c58a' },
    winter_muted: { park: '#c9d2c6' },
    sage: { park: '#c4d4bc' },
    storybook: { park: '#a9d99a' },
    moonlit: { park: '#1f3a3a' },
  },
  'natural_land.wood_palette': {
    deep_forest: { wood: '#5f9a6a' },
    olive: { wood: '#a9b37a' },
    golden_autumn: { wood: '#d9aa5a' },
    teal_illustrative: { wood: '#5fb3a5' },
    muted: { wood: '#b9c4b4' },
  },
  'natural_land.sand_palette': {
    cream: { sand: '#f6ecd6' },
    golden: { sand: '#f2d08a' },
    cold_gray: { sand: '#d8d8d4' },
    sunset_pink: { sand: '#f4c9c0' },
  },
};

/**
 * Label systems are chosen, never blended: halfway between dark and light text
 * is unreadable on everything. The contrast guard has the final say.
 */
export const LABEL_SYSTEMS: Readonly<Record<string, Pick<Palette, TextKey>>> = {
  warm_dark: { textPrimary: '#4a3626', textSecondary: '#6e5642', halo: '#fff8ee', neighbourhoodLabel: '#8a7462', waterLabel: '#3f6f9a' },
  cool_dark: { textPrimary: '#2f3b4a', textSecondary: '#4f5d6e', halo: '#f7fbff', neighbourhoodLabel: '#6f7c8c', waterLabel: '#2f6aa8' },
  light_on_dark: { textPrimary: '#f1f3f4', textSecondary: '#c4c7cc', halo: '#1a1d24', neighbourhoodLabel: '#aab0b8', waterLabel: '#9ec9f5' },
  gold_accent: { textPrimary: '#4d3a0e', textSecondary: '#6b5523', halo: '#fffaf0', neighbourhoodLabel: '#8c7440', waterLabel: '#3f6f9a' },
  cyan_accent: { textPrimary: '#0e3f4f', textSecondary: '#2b5d6c', halo: '#f5feff', neighbourhoodLabel: '#4f7f8c', waterLabel: '#1f6f9a' },
};

export const TEXT_KEYS = ['textPrimary', 'textSecondary', 'halo', 'neighbourhoodLabel', 'waterLabel'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

/**
 * `[dependent, anchor]`, in dependency order. When a swatch moves an anchor but
 * not a dependent, the dependent keeps its plain-map OKLab offset from the
 * anchor: footprints stay a shade off the ground, casings a shade off the road.
 */
export const RELATIONS: readonly (readonly [PaletteKey, PaletteKey])[] = [
  ['urban', 'land'],
  ['hospital', 'land'],
  ['school', 'land'],
  ['aeroway', 'land'],
  ['runway', 'aeroway'],
  ['path', 'land'],
  ['rail', 'land'],
  ['building', 'land'],
  ['buildingOutline', 'building'],
  ['building3d', 'building'],
  ['building3dMid', 'building3d'],
  ['building3dHigh', 'building3d'],
  ['roadMinor', 'land'],
  ['roadMajor', 'roadMinor'],
  ['roadCasing', 'roadMinor'],
  ['roadMajorCasing', 'roadCasing'],
  ['wood', 'park'],
  ['horizon', 'sky'],
];

/** Grade operators for global_grade settings: how each value bends every non-text color. */
export const SATURATION: Readonly<Record<string, number>> = {
  muted: 0.72, desaturated: 0.45, grayscale: 0.06, vibrant: 1.22, hypercolor: 1.45,
};
/** OKLab (Δa, Δb) added to every color. */
export const TEMPERATURE: Readonly<Record<string, readonly [number, number]>> = {
  candle_warm: [0.012, 0.045], sun_warm: [0.006, 0.03], twilight_cool: [0.012, -0.03], moon_blue: [-0.008, -0.04], ice_cold: [-0.018, -0.035],
};
/** OKLab hue angle (degrees) and magnitude of a tint. */
type Tint = readonly [hueDeg: number, magnitude: number];
export const HUE_BIAS: Readonly<Record<string, Tint>> = {
  amber: [70, 0.025], rose: [355, 0.025], violet: [305, 0.025], indigo: [275, 0.025], cyan: [200, 0.025],
  teal: [182, 0.025], green: [142, 0.025], copper: [45, 0.025], gold: [95, 0.025], slate: [250, 0.012],
};
export const SHADOW_TINT: Readonly<Record<string, Tint>> = {
  navy: [264, 0.04], purple: [305, 0.04], deep_teal: [190, 0.035], brown: [60, 0.03], warm_gray: [70, 0.015],
};
export const HIGHLIGHT_TINT: Readonly<Record<string, Tint>> = {
  cream: [90, 0.02], gold: [95, 0.03], peach: [55, 0.025], cyan: [200, 0.02], ice_blue: [240, 0.02], magenta: [340, 0.03],
};
/** Lightness curves; `s` is the S-curve strength, `k` a linear squeeze around mid-grey. */
export const CONTRAST: Readonly<Record<string, { s: number; k: number; lift: number }>> = {
  low_soft: { s: 0, k: 0.86, lift: 0 },
  high_filmic: { s: 0.35, k: 1, lift: 0 },
  dramatic: { s: 0.7, k: 1.05, lift: 0 },
  flat_print: { s: 0, k: 0.78, lift: 0.03 },
};

/** Numeric light/sky parameters (proposed adapter; see capabilities.ts). */
export const LIGHT_INTENSITY: Readonly<Record<string, number>> = { balanced: 0.35, dim: 0.2, subtle: 0.28, bright: 0.45, high_key: 0.55 };
/** MapLibre light position [radial, azimuthal°, polar°]. `standard` matches mapStyle.ts. */
export const LIGHT_POSITION: Readonly<Record<string, readonly [number, number, number]>> = {
  standard: [1.4, 295, 40],
  morning_low: [1.5, 80, 70],
  noon_high: [1.2, 300, 15],
  evening_low: [1.5, 250, 72],
  side_lit: [1.4, 200, 60],
  back_lit: [1.4, 115, 55],
};
/** [sky-horizon-blend, horizon-fog-blend, fog-ground-blend]. `natural` matches mapStyle.ts. */
export const HORIZON_BLEND: Readonly<Record<string, readonly [number, number, number]>> = {
  natural: [0.6, 0.7, 0.85],
  soft_diffuse: [0.85, 0.9, 0.92],
  sharp_silhouette: [0.3, 0.45, 0.75],
};
export const FOG_COLORS: Readonly<Record<string, string>> = {
  silver: '#c9ced4', blue_gray: '#7f8ea3', purple: '#6b4c9a', golden: '#e8bf7a', rose: '#e7a3b5',
};
/** Scene transition duration in ms. `soft_crossfade` matches THEME_TRANSITION_MS. */
export const TRANSITION_MS: Readonly<Record<string, number>> = {
  soft_crossfade: 800, quick_fade: 450, cinematic: 1400, deliberate: 1100, instant: 0,
};
/** UI accent tokens for interface_and_cards.accent_token. */
export const ACCENTS: Readonly<Record<string, string>> = {
  amber: '#d9822b', rose: '#d6457a', cyan: '#0e9fbf', teal: '#14a38b', violet: '#7c4ddb', gold: '#c9a227', forest: '#2f7d4f',
};

function towers(mid: string, high: string, kMid = 0.3, kHigh = 0.55): Swatch {
  return (p) => ({ building3dMid: mixOk(p.building3d, mid, kMid), building3dHigh: mixOk(p.building3d, high, kHigh) });
}

function desaturate(hex: string, keep: number): string {
  const [L, a, b] = hexToLab(hex);
  return labToHex([L, a * keep, b * keep]);
}
