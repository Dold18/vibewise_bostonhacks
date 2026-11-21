/**
 * Blend the base map palette toward a user's top vibes, without ever making
 * labels or pins harder to read than the rules below allow.
 *
 * Each top vibe pulls the entries it defines toward its target by
 * `MAX_SHIFT × strength × score`. Vibes are applied weakest first so the
 * strongest one has the last word; averaging a dark vibe with a light one
 * would land on mid-grey, which fails every contrast check.
 *
 * Contrast guard, checked after blending:
 * - `textPrimary` ≥ 4.5:1 and `textSecondary` ≥ 3:1 against `land`;
 * - the weakest pin ≥ the weakest pin on today's map (restaurant orange, ~2.6:1).
 * If the dark-text palette fails, the light-text set is tried, with pins
 * outlined in white (that outline is what's measured). If both fail, the
 * blend is weakened in steps until one passes; strength 0 is today's map.
 */
import { basePalette, type Palette } from '../../mapStyle';
import { PIN_COLORS } from '../../pinColors';
import { topVibesOf } from '../account/taste';
import type { VibeKey } from '../account/vibes';
import { contrastRatio, mix } from './color';
import { LIGHT_TEXT, VIBE_PALETTES } from './palettes';

export const MAX_SHIFT = 0.6;
const STEP = 0.05;
const TEXT_PRIMARY_MIN = 4.5;
const TEXT_SECONDARY_MIN = 3;
/** White outline drawn around pins on a dark map (see effects.css). */
export const DARK_PIN_EDGE = '#ffffff';

const PIN_FLOOR = Math.min(...Object.values(PIN_COLORS).map((c) => contrastRatio(c, basePalette.land)));

export interface BlendResult {
  palette: Palette;
  /** Light text and white-outlined pins. */
  darkMode: boolean;
  /** The strength actually used after the contrast guard; ≤ the requested strength. */
  appliedStrength: number;
}

export function blendPalette(base: Palette, tags: Record<VibeKey, number>, strength: number): BlendResult {
  const weakestFirst = topVibesOf(tags).reverse();
  for (let step = 0; ; step++) {
    const s = Math.max(0, Math.round((strength - step * STEP) * 1000) / 1000);
    if (s <= 0 || weakestFirst.length === 0) return { palette: { ...base }, darkMode: false, appliedStrength: 0 };

    const palette = { ...base };
    for (const { key, score } of weakestFirst) {
      const amount = MAX_SHIFT * s * score;
      for (const [k, target] of Object.entries(VIBE_PALETTES[key]) as [keyof Palette, string][]) {
        palette[k] = mix(palette[k], target, amount);
      }
    }
    if (readable(palette, false)) return { palette, darkMode: false, appliedStrength: s };
    const dark = { ...palette, ...LIGHT_TEXT };
    if (readable(dark, true)) return { palette: dark, darkMode: true, appliedStrength: s };
  }
}

function readable(p: Palette, darkMode: boolean): boolean {
  if (contrastRatio(p.textPrimary, p.land) < TEXT_PRIMARY_MIN) return false;
  if (contrastRatio(p.textSecondary, p.land) < TEXT_SECONDARY_MIN) return false;
  const pins = darkMode ? [DARK_PIN_EDGE] : Object.values(PIN_COLORS);
  return Math.min(...pins.map((c) => contrastRatio(c, p.land))) >= PIN_FLOOR - 1e-9;
}
