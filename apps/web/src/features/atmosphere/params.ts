/**
 * Atmosphere parameters: one flat vector of independent, continuous controls.
 *
 * Every visual system reads its own amounts, so fog, grain, warm light and
 * precipitation combine in any proportion without a prebuilt theme, and every
 * change (including switching "kinds", e.g. film grain → paper) is a smooth
 * numeric tween rather than a class swap.
 */

export type RGB = readonly [number, number, number];

/** Scalar controls, all 0..1 unless noted. */
export const SCALAR_KEYS = [
  // World-space (depth-tested against 3D buildings)
  'fogDensity', // sliced exponential height fog
  'fogHeight', // scale height: 0 → 12 m, 1 → 120 m
  'fogDrift', // contrast of drifting fog banks
  'rain',
  'snow',
  'wind', // -1..1, lateral slant/drift of precipitation and particles
  'dust',
  'sparkle',
  'fireflies',
  'petals',
  // Screen-space (drawn below routes and labels)
  'hazeHorizon',
  'hazeEdge',
  'hazeGround',
  'wash', // sky-to-ground atmospheric color wash
  'grain',
  'grainSize', // 0 fine … 1 coarse
  'paper',
  'watercolor',
  'halftone',
  'scanlines',
  'grid',
  'scratches',
  'vignette',
  'glow', // stylized bloom from the rendered frame
  'glowThreshold', // 0 → blooms mid-tones, 1 → only the brightest pixels
  'shafts', // light shafts from the scene light direction
  'leak', // light leak / film burn
  // Global
  'motion', // environmental animation intensity (falling/flying particles)
  'drift', // slow ambient drift of fog banks, shafts and leaks; 0 keeps them still (no repaints)
  'density', // weather and particle density multiplier
  // Exported only (building renderer owns windows)
  'windowLight',
] as const;
export type ScalarKey = (typeof SCALAR_KEYS)[number];

export const COLOR_KEYS = [
  'fogColor',
  'hazeColor',
  'washTop',
  'washBottom',
  'vignetteColor',
  'paperColor',
  'gridColor',
  'glowColor',
  'shaftColor',
  'leakColor',
  'sparkleColor',
  'windowColor',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export type AtmosphereParams = { readonly [K in ScalarKey]: number } & { readonly [K in ColorKey]: RGB };
export type MutableParams = { -readonly [K in ScalarKey]: number } & { -readonly [K in ColorKey]: RGB };

/** Signed scalars; everything else is clamped to 0..1. */
const SIGNED = new Set<ScalarKey>(['wind']);

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const rgbToHex = (c: RGB) =>
  `#${c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('')}`;

export const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : n);
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Relative luminance (sRGB coefficients on gamma values; adequate for lightness decisions). */
export const luminance = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export const NEUTRAL_PARAMS: AtmosphereParams = Object.freeze({
  fogDensity: 0, fogHeight: 0.35, fogDrift: 0.5, rain: 0, snow: 0, wind: 0.15,
  dust: 0, sparkle: 0, fireflies: 0, petals: 0,
  hazeHorizon: 0, hazeEdge: 0, hazeGround: 0, wash: 0,
  grain: 0, grainSize: 0.3, paper: 0, watercolor: 0, halftone: 0, scanlines: 0, grid: 0, scratches: 0,
  vignette: 0, glow: 0, glowThreshold: 0.7, shafts: 0, leak: 0,
  motion: 0.6, drift: 0, density: 1, windowLight: 0,
  fogColor: hexToRgb('#dfe6ee'), hazeColor: hexToRgb('#e9f2fb'),
  washTop: hexToRgb('#e9f2fb'), washBottom: hexToRgb('#f3efe6'),
  vignetteColor: hexToRgb('#0a101b'), paperColor: hexToRgb('#f3ead6'), gridColor: hexToRgb('#3d6f9e'),
  glowColor: hexToRgb('#fff1d6'), shaftColor: hexToRgb('#ffe7ae'), leakColor: hexToRgb('#ff9a4d'),
  sparkleColor: hexToRgb('#fff6c8'), windowColor: hexToRgb('#ffb05c'),
});

/** Scalars whose value matters for "is anything visible?" (excludes shape/style knobs). */
export const AMOUNT_KEYS: readonly ScalarKey[] = [
  'fogDensity', 'rain', 'snow', 'dust', 'sparkle', 'fireflies', 'petals',
  'hazeHorizon', 'hazeEdge', 'hazeGround', 'wash', 'grain', 'paper', 'watercolor', 'halftone',
  'scanlines', 'grid', 'scratches', 'vignette', 'glow', 'shafts', 'leak',
];
export const WORLD_KEYS: readonly ScalarKey[] = ['fogDensity', 'rain', 'snow', 'dust', 'sparkle', 'fireflies', 'petals'];
export const PARTICLE_KEYS: readonly ScalarKey[] = ['rain', 'snow', 'dust', 'sparkle', 'fireflies', 'petals'];

/** Smallest amount treated as "on"; below it a pass is skipped entirely. */
export const EPSILON = 0.004;

export function isEmpty(p: AtmosphereParams): boolean {
  return AMOUNT_KEYS.every((k) => p[k] < EPSILON);
}

/** Validated copy: unknown keys dropped, scalars clamped, colors accepted as RGB or hex. */
export function sanitizeParams(input: Partial<Record<string, unknown>>, base: AtmosphereParams = NEUTRAL_PARAMS): AtmosphereParams {
  const out = { ...base } as MutableParams;
  for (const k of SCALAR_KEYS) {
    const v = input[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = SIGNED.has(k) ? Math.max(-1, Math.min(1, v)) : clamp01(v);
  }
  for (const k of COLOR_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) out[k] = hexToRgb(v);
    else if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) out[k] = v.map(clamp01) as unknown as RGB;
  }
  return Object.freeze(out);
}

export function lerpParams(a: AtmosphereParams, b: AtmosphereParams, t: number): AtmosphereParams {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = {} as MutableParams;
  for (const k of SCALAR_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  for (const k of COLOR_KEYS) out[k] = mixRgb(a[k], b[k], t);
  return out;
}

export function paramsEqual(a: AtmosphereParams, b: AtmosphereParams, eps = 1e-4): boolean {
  for (const k of SCALAR_KEYS) if (Math.abs(a[k] - b[k]) > eps) return false;
  for (const k of COLOR_KEYS) for (let i = 0; i < 3; i++) if (Math.abs(a[k][i] - b[k][i]) > eps) return false;
  return true;
}
