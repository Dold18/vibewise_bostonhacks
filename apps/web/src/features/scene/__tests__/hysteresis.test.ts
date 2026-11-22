/** Compiler-level hysteresis (via `previous`) and the guard's continuity rules. */
import { describe, expect, it } from 'vitest';
import { basePalette } from '../../../mapStyle';
import { PALETTE_ADAPTER_V0, previewAllCapabilities, withFeatures } from '../capabilities';
import { SCENE_CATALOG } from '../catalog';
import { hexToLab } from '../color';
import { compileScene } from '../compile';
import { HYSTERESIS, MIN_DISCRETE_WEIGHT } from '../constraints';
import { guardPalette, ringPasses } from '../guard';
import { intent } from './fixtures';

const ALL = previewAllCapabilities(SCENE_CATALOG);
const GLOW = 'marker_recommendations.pin_glow';
const SKY = 'sky_and_horizon.sky_mode';
const neon = (w: number, previous?: ReturnType<typeof compileScene>) => compileScene({ outing: intent([['neon_city', w]]), capabilities: ALL, previous });
const dE = (a: string, b: string) => {
  const [x, y] = [hexToLab(a), hexToLab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

describe('discrete hysteresis', () => {
  it('has an enter/exit band around the plain threshold', () => {
    expect(HYSTERESIS.exit).toBeLessThan(MIN_DISCRETE_WEIGHT);
    expect(HYSTERESIS.enter).toBeGreaterThan(MIN_DISCRETE_WEIGHT);
  });

  it('a value that is off needs the enter weight to appear', () => {
    const off = compileScene({ capabilities: ALL });
    expect(neon(0.09).resolved[GLOW]).toBe('neon_halo'); // no history: plain threshold
    expect(neon(0.09, off).resolved[GLOW]).toBe('none');
    expect(neon(0.11, off).resolved[GLOW]).toBe('neon_halo');
  });

  it('a value that is on stays until it drops below the exit weight', () => {
    const on = neon(0.12);
    expect(neon(0.07).resolved[GLOW]).toBe('none'); // no history: would flicker off
    expect(neon(0.07, on).resolved[GLOW]).toBe('neon_halo');
    expect(neon(0.05, on).resolved[GLOW]).toBe('none');
  });

  it('a held value survives a close challenger but yields to a clear one', () => {
    const scene = (noir: number, neonW: number, previous?: ReturnType<typeof compileScene>) =>
      compileScene({ outing: intent([['noir_jazz', noir], ['neon_city', neonW]]), previous });
    const first = scene(0.5, 0.47);
    expect(first.resolved[SKY]).toBe('night_indigo');
    expect(scene(0.47, 0.5).resolved[SKY]).toBe('purple_twilight');
    expect(scene(0.47, 0.5, first).resolved[SKY]).toBe('night_indigo');
    expect(scene(0.38, 0.5, first).resolved[SKY]).toBe('purple_twilight');
  });

  it('never lets history leak into a neutral scene', () => {
    const dark = compileScene({ outing: intent([['noir_jazz', 1]]) });
    const back = compileScene({ previous: dark });
    expect(back.palette).toEqual(basePalette);
    expect(back.pinEdge).toBe('none');
    for (const s of SCENE_CATALOG.settings) expect(back.resolved[s.key]).toBe(s.default);
  });

  it('is still a pure function: the same previous gives the same result', () => {
    const prev = neon(0.3);
    expect(neon(0.31, prev)).toEqual(neon(0.31, prev));
  });
});

describe('guard continuity', () => {
  const darkGround = { ...basePalette, land: '#0b0c12', textPrimary: '#f1f3f4', textSecondary: '#c4c7cc', neighbourhoodLabel: '#aab0b8', halo: '#1a1d24' };

  it('keeps the previous pin edge while it still passes', () => {
    // On a very dark ground both plain and white-edged pins pass.
    expect(guardPalette(darkGround, null).pinEdge).toBe('none');
    expect(guardPalette(darkGround, null, { previous: { pinEdge: 'white', palette: darkGround } }).pinEdge).toBe('white');
  });

  it('with the proposed contrast ring never nudges the ground', () => {
    for (const land of ['#ffffff', '#c8c8c8', '#9a9a9a', '#777777', '#555555', '#2a2a2a', '#000000']) {
      expect(ringPasses(land)).toBe(true);
      const r = guardPalette({ ...basePalette, land }, null, { contrastRing: true });
      expect(r.palette.land).toBe(land);
      expect(r.pinEdge).toBe('two_tone');
    }
  });
});

describe('the proposed pin contrast ring makes light→dark transitions continuous', () => {
  const ramp = (profile: typeof PALETTE_ADAPTER_V0) => {
    const lands: string[] = [];
    for (let w = 0; w <= 1.0001; w += 0.05) lands.push(compileScene({ outing: intent([['neon_city', w]]), capabilities: profile }).palette.land);
    return lands.slice(1).map((land, i) => dE(lands[i], land));
  };

  it('today (V0): the ground jumps once across the pin dead band', () => {
    expect(Math.max(...ramp(PALETTE_ADAPTER_V0))).toBeGreaterThan(0.15);
  });

  it('with the ring: every 5% step is a small step', () => {
    expect(Math.max(...ramp(withFeatures(PALETTE_ADAPTER_V0, 'pin_contrast_ring')))).toBeLessThan(0.06);
  });
});
