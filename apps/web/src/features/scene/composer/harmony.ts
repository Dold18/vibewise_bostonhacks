/**
 * Color relationships, measured on the colors the map actually renders.
 *
 * A world picks a harmony scheme (analogous, complementary, split,
 * triadic, monochrome) and three hue roles: dominant (~60%), secondary (~30%)
 * and accent (~10%, reserved for focal points such as recommended places).
 * Candidate values are scored by how well their real swatch hue fits a role,
 * and finished palettes are scored the same way, so "harmony" is a measurable
 * property of the output rather than a promise in a comment.
 *
 * Hues are OKLab hue angles (degrees), the space swatches.ts already uses.
 */
import { basePalette, type Palette, type PaletteKey } from '../../../mapStyle';
import type { SceneKey } from '../catalog';
import { hexToLab, labToHex } from '../color';
import { ACCENTS, HIGHLIGHT_TINT, HUE_BIAS, PALETTE_SWATCHES, SHADOW_TINT, FOG_COLORS } from '../swatches';
import { round3, type StyleVector } from './axes';
import { signed, unit } from './random';

export type Scheme = 'analogous' | 'complementary' | 'split' | 'triadic' | 'monochrome';

export interface Harmony {
  readonly scheme: Scheme;
  /** Hue angles in degrees. */
  readonly roles: { readonly dominant: number; readonly secondary: number; readonly accent: number };
  /** Display swatches for each role (OKLab L 0.68, chroma 0.12). */
  readonly swatches: { readonly dominant: string; readonly secondary: string; readonly accent: string };
}

export interface HueSample {
  readonly hue: number;
  readonly chroma: number;
  readonly lightness: number;
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;
export const angularDistance = (a: number, b: number) => {
  const d = Math.abs(norm(a) - norm(b)) % 360;
  return d > 180 ? 360 - d : d;
};

export function sample(hex: string): HueSample {
  const [L, a, b] = hexToLab(hex);
  return { hue: norm((Math.atan2(b, a) * 180) / Math.PI), chroma: Math.hypot(a, b), lightness: L };
}

const fromHue = (hue: number, L = 0.68, C = 0.12) => labToHex([L, C * Math.cos((hue * Math.PI) / 180), C * Math.sin((hue * Math.PI) / 180)]);
const tintSample = ([hue, magnitude]: readonly [number, number]): HueSample => ({ hue, chroma: magnitude * 3, lightness: 0.7 });

/** Hues for color-bearing values that have no palette swatch (window glows, trims, rims...). */
const EXTRA_HUES: Readonly<Record<SceneKey, Readonly<Record<string, string>>>> = {
  'lighting_and_shadows.light_color': { amber: '#ffb35c', gold: '#ffd166', pink: '#ff9ec7', violet: '#a98bff', cyan: '#7fe7ff', icy_blue: '#bcd8ff' },
  'lighting_and_shadows.rim_light': { warm_edge: '#ffb35c', cool_edge: '#9cc9ff', neon_pink: '#ff4fa3', neon_cyan: '#3fe7ff' },
  'lighting_and_shadows.bounce_light': { amber: '#ffb35c', violet: '#a98bff', cyan: '#7fe7ff', mixed_neon: '#d65cff' },
  'building_surfaces.window_glow': { warm_low: '#ffc98a', warm_high: '#ffb35c', cold_white: '#e6f0ff', blue: '#7fb2ff', mixed: '#e08cff' },
  'building_surfaces.emissive_trim': { fine_gold: '#e8c25a', fine_cyan: '#3fe7ff', fine_magenta: '#ff4fd1' },
  'building_surfaces.building_outline': { cream: '#f4e7c8', gold: '#d9b44a', cyan_glow: '#3fe7ff', magenta_glow: '#ff4fd1' },
  'roads_and_ground.street_lights': { sparse_amber: '#ffb35c', dense_amber: '#ffb35c', cold_white: '#e6f0ff', neon: '#ff4fd1' },
  'water_and_coast.coastline_line': { gold: '#d9b44a', luminous_cyan: '#3fe7ff' },
  'water_and_coast.reflected_colors': { gold: '#e8c25a', blue: '#6fa8ff', rose: '#ff9ec7', mixed_neon: '#d65cff' },
  'air_and_atmosphere.fog_hue': { silver: '#c9ced4', pearl: '#ece6f0', blue: '#8fa6c8', violet: '#a48ad6', warm_gold: '#e8c27a', rose: '#e7a3b5' },
  'marker_recommendations.pin_glow': { warm_halo: '#ffb35c', neon_halo: '#ff4fd1' },
};

/** Representative color of a catalog value, or null when it carries no hue. */
export function valueSample(key: SceneKey, value: string): HueSample | null {
  const swatch = PALETTE_SWATCHES[key]?.[value];
  if (swatch) {
    const colors = Object.values(typeof swatch === 'function' ? swatch(basePalette) : swatch).filter((c): c is string => typeof c === 'string');
    if (!colors.length) return null;
    // Mean in OKLab keeps the swatch's dominant hue.
    const labs = colors.map(hexToLab);
    const mean = [0, 1, 2].map((i) => labs.reduce((s, l) => s + l[i], 0) / labs.length) as [number, number, number];
    return sample(labToHex(mean));
  }
  if (key === 'global_grade.hue_bias' && HUE_BIAS[value]) return tintSample(HUE_BIAS[value]);
  if (key === 'global_grade.shadow_tint' && SHADOW_TINT[value]) return tintSample(SHADOW_TINT[value]);
  if (key === 'global_grade.highlight_tint' && HIGHLIGHT_TINT[value]) return tintSample(HIGHLIGHT_TINT[value]);
  if (key === 'interface_and_cards.accent_token' && ACCENTS[value]) return sample(ACCENTS[value]);
  if (key === 'sky_and_horizon.fog_horizon_color' && FOG_COLORS[value]) return sample(FOG_COLORS[value]);
  const extra = EXTRA_HUES[key]?.[value];
  return extra ? sample(extra) : null;
}

/** Below this OKLab chroma a color reads as neutral and fits any scheme. */
export const ACHROMATIC = 0.035;

/** 0..1 fit of one color to a harmony: 1 on a role hue, 0 at 90° away. Neutrals fit well; weak colors matter less. */
export function hueFit(h: Harmony, s: HueSample | null): number {
  if (!s || s.chroma < ACHROMATIC) return 0.85;
  const { dominant, secondary, accent } = h.roles;
  const d = Math.min(angularDistance(s.hue, dominant), angularDistance(s.hue, secondary), angularDistance(s.hue, accent));
  const raw = Math.max(0, 1 - d / 90);
  const weight = Math.min(1, s.chroma / 0.09);
  return round3(1 - (1 - raw) * weight);
}

const SCHEME_OFFSETS: Readonly<Record<Scheme, readonly [number, number]>> = {
  analogous: [32, -38],
  complementary: [24, 180],
  split: [150, 210],
  triadic: [120, 240],
  monochrome: [0, 0],
};
const SCHEMES = Object.keys(SCHEME_OFFSETS) as Scheme[];

/**
 * Harmony for a style point. The dominant hue is a circular mean of hue
 * anchors weighted by the style (warm ⇒ amber, cool ⇒ blue, organic ⇒ green,
 * futurist + vivid ⇒ violet/magenta, soft + warm ⇒ rose, coastal ⇒ sea blue),
 * plus a per-session jitter; the scheme is chosen by vividness, energy and
 * ornament with seeded noise among close candidates.
 */
export function harmonyFor(style: StyleVector, hints: Readonly<Record<string, number>>, seed: string): Harmony {
  const pos = (n: number) => Math.max(0, n);
  // Each family has a few equally valid hues; the session seed picks one (copper vs amber vs gold, cyan vs magenta neon...).
  const variant = (family: string, hues: readonly number[]) => hues[Math.floor(unit(seed, 'hue-family', family) * hues.length)];
  const anchors: Array<[number, number]> = [
    [variant('warm', [45, 65, 88]), pos(style.warmth) + 0.15],
    [variant('cool', [220, 250, 272]), pos(-style.warmth) + 0.1],
    [variant('organic', [125, 145, 165]), pos(style.nature) * 0.8],
    [variant('neon', [200, 300, 330]), pos(-style.era) * pos(style.chroma) * 1.4 + (hints.neon ?? 0) * 0.6],
    [355, pos(style.softness) * pos(style.warmth + 0.3) * 0.7 + (hints.pastel ?? 0) * 0.3],
    [215, (hints.coastal ?? 0) * 0.6],
    [275, pos(-style.luminance) * pos(-style.warmth + 0.2) * 0.6],
  ];
  let x = 0;
  let y = 0;
  for (const [hue, w] of anchors) {
    x += w * Math.cos((hue * Math.PI) / 180);
    y += w * Math.sin((hue * Math.PI) / 180);
  }
  const mean = Math.hypot(x, y) < 1e-6 ? unit(seed, 'hue') * 360 : (Math.atan2(y, x) * 180) / Math.PI;
  const dominant = norm(Math.round(mean + signed(seed, 'hue-jitter') * 18));

  const weights: Record<Scheme, number> = {
    analogous: 0.5 + pos(style.softness) * 0.5 + pos(-style.energy) * 0.5,
    complementary: 0.25 + pos(style.energy) * 0.6 + pos(style.chroma) * 0.4 + pos(-style.luminance) * 0.3,
    split: 0.3 + pos(style.ornament) * 0.4,
    triadic: pos(style.chroma) * pos(style.energy) * 1.1,
    monochrome: 0.05 + pos(-style.chroma) * 1.2 + pos(-style.ornament) * 0.3,
  };
  let scheme: Scheme = 'analogous';
  let best = -Infinity;
  for (const s of SCHEMES) {
    const score = weights[s] + 0.35 * unit(seed, 'scheme', s);
    if (score > best) [best, scheme] = [score, s];
  }
  const [o2, o3] = SCHEME_OFFSETS[scheme];
  const roles = { dominant, secondary: norm(dominant + o2), accent: norm(dominant + o3) };
  return Object.freeze({
    scheme,
    roles: Object.freeze(roles),
    swatches: Object.freeze({
      dominant: fromHue(roles.dominant),
      secondary: fromHue(roles.secondary, 0.6, 0.1),
      // Monochrome accents separate by lightness instead of hue.
      accent: scheme === 'monochrome' ? fromHue(roles.accent, 0.5, 0.16) : fromHue(roles.accent, 0.66, 0.15),
    }),
  });
}

/** Nearest value of `values` to a target hue (by their real colors), with the distance. */
export function nearestByHue(key: SceneKey, values: readonly string[], hue: number): { value: string; distance: number } | null {
  let best: { value: string; distance: number } | null = null;
  for (const v of values) {
    const s = valueSample(key, v);
    if (!s || s.chroma < ACHROMATIC) continue;
    const d = angularDistance(s.hue, hue);
    if (!best || d < best.distance) best = { value: v, distance: d };
  }
  return best;
}

/** Palette entries that carry the world's color (functional colors like highways and text are excluded). */
export const HARMONY_KEYS: readonly PaletteKey[] = [
  'land', 'urban', 'water', 'park', 'wood', 'sand', 'building', 'building3d', 'building3dMid', 'building3dHigh',
  'roadMajor', 'roadMajorCasing', 'roadMinor', 'roadCasing', 'path', 'sky', 'horizon',
];

export interface PaletteHarmony {
  /** Chroma-weighted mean fit of palette colors to the harmony's roles (0..1). */
  readonly score: number;
  /** Distinct hue families among clearly chromatic palette colors (40° clusters). */
  readonly hueFamilies: number;
}

export function paletteHarmony(palette: Palette, h: Harmony): PaletteHarmony {
  const samples = HARMONY_KEYS.map((k) => sample(palette[k]));
  const score = samples.reduce((s, x) => s + hueFit(h, x), 0) / samples.length;
  const hues = samples.filter((x) => x.chroma >= 0.05).map((x) => x.hue).sort((a, b) => a - b);
  let families = 0;
  const centers: number[] = [];
  for (const hue of hues) {
    if (!centers.some((c) => angularDistance(c, hue) <= 40)) {
      centers.push(hue);
      families++;
    }
  }
  return { score: round3(score), hueFamilies: families };
}
