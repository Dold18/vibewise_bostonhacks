import { describe, expect, it } from 'vitest';
import { basePalette, type Palette } from '../../../mapStyle';
import { PIN_COLORS } from '../../../pinColors';
import { VIBE_KEYS, type VibeKey } from '../../account/vibes';
import { blendPalette, MAX_SHIFT, type BlendResult } from '../blend';
import { contrastRatio } from '../color';
import { VIBE_PALETTES } from '../palettes';

const zeros = () => Object.fromEntries(VIBE_KEYS.map((k) => [k, 0])) as Record<VibeKey, number>;
const tagsOf = (scores: Partial<Record<VibeKey, number>>) => ({ ...zeros(), ...scores });

const pinFloor = Math.min(...Object.values(PIN_COLORS).map((c) => contrastRatio(c, basePalette.land)));

function weakestPin(result: BlendResult): number {
  if (result.darkMode) return contrastRatio('#ffffff', result.palette.land);
  return Math.min(...Object.values(PIN_COLORS).map((c) => contrastRatio(c, result.palette.land)));
}

function assertReadable(result: BlendResult, label: string) {
  const p = result.palette;
  expect(contrastRatio(p.textPrimary, p.land), `${label} textPrimary`).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(p.textSecondary, p.land), `${label} textSecondary`).toBeGreaterThanOrEqual(3);
  expect(weakestPin(result), `${label} pins`).toBeGreaterThanOrEqual(pinFloor - 1e-6);
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('blendPalette', () => {
  it('returns the base palette at strength 0', () => {
    const result = blendPalette(basePalette, tagsOf({ cozy: 1 }), 0);
    expect(result).toEqual({ palette: basePalette, darkMode: false, appliedStrength: 0 });
  });

  it('returns the base palette when no vibe reaches the threshold', () => {
    const tags = Object.fromEntries(VIBE_KEYS.map((k) => [k, 0.2])) as Record<VibeKey, number>;
    expect(blendPalette(basePalette, tags, 1).palette).toEqual(basePalette);
  });

  it('moves cozy land toward its target', () => {
    const result = blendPalette(basePalette, tagsOf({ cozy: 1 }), 1);
    expect(result.palette.land).not.toBe(basePalette.land);
    expect(result.appliedStrength).toBeGreaterThan(0);
  });

  it('never moves a color more than MAX_SHIFT of the way to its target', () => {
    for (const key of VIBE_KEYS) {
      const { palette } = blendPalette(basePalette, tagsOf({ [key]: 1 }), 1);
      const targets = VIBE_PALETTES[key];
      for (const k of Object.keys(targets) as (keyof Palette)[]) {
        if (['textPrimary', 'textSecondary', 'halo', 'neighbourhoodLabel', 'waterLabel'].includes(k)) continue;
        const base = channels(basePalette[k]);
        const target = channels(targets[k]!);
        const got = channels(palette[k]);
        got.forEach((c, i) => {
          expect(Math.abs(c - base[i]), `${key}.${k}`).toBeLessThanOrEqual(MAX_SHIFT * Math.abs(target[i] - base[i]) + 1);
        });
      }
    }
  });

  it('all single vibes and pairs satisfy the contrast bars', () => {
    for (const a of VIBE_KEYS) {
      assertReadable(blendPalette(basePalette, tagsOf({ [a]: 1 }), 1), a);
      for (const b of VIBE_KEYS) {
        if (b <= a) continue;
        assertReadable(blendPalette(basePalette, tagsOf({ [a]: 1, [b]: 1 }), 1), `${a}+${b}`);
      }
    }
  });

  it('late_night at full strength goes dark or tones itself down', () => {
    const result = blendPalette(basePalette, tagsOf({ late_night: 1 }), 1);
    expect(result.darkMode || result.appliedStrength < 1).toBe(true);
  });

  it('defines targets for every vibe', () => {
    for (const key of VIBE_KEYS) expect(Object.keys(VIBE_PALETTES[key]).length).toBeGreaterThan(0);
  });
});
