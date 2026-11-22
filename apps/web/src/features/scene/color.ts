/**
 * Perceptual color math for the scene compiler (OKLab / OKLCH, Björn Ottosson 2020).
 *
 * Blending in OKLab keeps mid-points vivid and evenly bright, where the sRGB
 * mixing in vibeTheme/color.ts turns e.g. indigo + amber into muddy grey.
 * WCAG contrast is reused from vibeTheme so both modules measure the same way.
 */
export { contrastRatio } from '../vibeTheme/color';

export type Lab = readonly [L: number, a: number, b: number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function parseHex(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Expected #rrggbb, got ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = parseHex(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/**
 * OKLab → `#rrggbb`. Out-of-gamut colors keep their lightness and hue and lose
 * chroma (binary search) instead of being clipped per channel, which would
 * shift the hue.
 */
export function labToHex(lab: Lab): string {
  const L = Math.min(1, Math.max(0, lab[0]));
  let rgb = labToLinear([L, lab[1], lab[2]]);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(labToLinear([L, lab[1] * k, lab[2] * k]))) lo = k;
      else hi = k;
    }
    rgb = labToLinear([L, lab[1] * lo, lab[2] * lo]);
  }
  return `#${rgb
    .map((c) => Math.round(toGamma(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Interpolate in OKLab; t is clamped to [0, 1]. Returns `a` unchanged at t = 0. */
export function mixOk(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  if (k === 0) return a;
  if (k === 1) return b;
  const x = hexToLab(a);
  const y = hexToLab(b);
  return labToHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]);
}

export const lightness = (hex: string) => hexToLab(hex)[0];

/** Hue (degrees) of a color as an a/b unit vector, for tints. */
export function hueVector(hex: string): [number, number] {
  const [, a, b] = hexToLab(hex);
  const c = Math.hypot(a, b) || 1;
  return [a / c, b / c];
}
