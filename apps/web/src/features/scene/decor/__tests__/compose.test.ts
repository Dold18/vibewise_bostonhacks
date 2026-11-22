import { describe, expect, it } from 'vitest';
import { composeCell, composeHero, layoutRadius, OPEN_SPACE_KEEP, OPEN_SPACE_M2, selectCast, type HeroLayout, type Placement } from '../compose';
import { DEFAULT_CONFIG, resolveConfig, type DecorConfigInput } from '../config';
import { FAMILIES } from '../catalog';
import { surfaceCandidates } from '../surfaces';
import { deriveTheme, type DecorTheme } from '../themes';
import type { Theme } from '../evidence';
import { catalog, runtimeAssets, syntheticCity } from './fixtures';

const g = syntheticCity();
const asked = (...themes: Theme[]) => themes.map((t) => ({ theme: t, term: t, source: 'vibe' as const }));
const theme = (motifs: Record<string, number>, progress = 1, evidence: ReturnType<typeof asked> = []): DecorTheme => deriveTheme(null, runtimeAssets, { motifs, progress, evidence });
const cfg = (input: DecorConfigInput = {}) => resolveConfig(DEFAULT_CONFIG, input);
/** Compose a 3×3 block of 100 m "cells" over the synthetic city. */
function world(t: DecorTheme, input: DecorConfigInput = {}) {
  const config = cfg(input), cast = selectCast(catalog, t, config), out: Placement[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const rect = [30 + i * 200, -30 - (j + 1) * 200, 30 + (i + 1) * 200, -30 - j * 200] as const;
    out.push(...composeCell({ cellKey: `c${i}${j}`, rect, candidates: surfaceCandidates(g, rect), cast, theme: t, config }));
  }
  return { out, cast, config };
}
// A haunted request: the user asked for spooky props, and the noir motifs rank them.
const noir = theme({ nocturne: 1, cozy: 0.3 }, 1, asked('spooky'));
const coast = theme({ coastal: 1, modern: 0.4 });

describe('cast selection', () => {
  it('is coherent with the motifs and bounded by the budgets', () => {
    const config = cfg();
    const cast = selectCast(catalog, noir, config);
    const all = [...cast.secondary, ...cast.micro];
    expect(cast.secondary.length).toBeGreaterThanOrEqual(4);
    expect(all.every((e) => (e.asset.motifs.nocturne ?? 0) > 0 || (e.asset.motifs.cozy ?? 0) > 0)).toBe(true);
    expect(all.reduce((s, e) => s + e.asset.metrics.prims, 0)).toBeLessThanOrEqual(config.budget.maxDrawCalls);
    expect(all.length).toBeLessThanOrEqual(config.budget.maxAssets);
    // Structural roles: something rhythmic and something that can anchor a cluster.
    expect(cast.secondary.some((e) => FAMILIES[e.asset.family].linear)).toBe(true);
    expect(cast.secondary.some((e) => FAMILIES[e.asset.family].anchor)).toBe(true);
  });

  it('never casts a themed prop from derived motifs alone (dark is not haunted)', () => {
    const dark = selectCast(catalog, theme({ nocturne: 1, cozy: 0.3 }), cfg({ castSize: { micro: 12, secondary: 12 } }));
    const all = [...dark.secondary, ...dark.micro];
    expect(all.length).toBeGreaterThan(0); // neutral lamps, trees and planting still dress the street
    for (const e of all) expect(e.asset.themes).toContain('neutral');
    expect(all.some((e) => /ghost|grave|crypt|pumpkin|holiday-kit|halloween/.test(e.asset.id))).toBe(false);
  });

  it('never casts gated props from an aesthetic alone', () => {
    const cast = selectCast(catalog, theme({ playful: 1, cozy: 1, market: 1 }), cfg({ castSize: { micro: 12, secondary: 12 }, budget: { maxAssets: 40, maxDrawCalls: 200 } }));
    for (const e of [...cast.secondary, ...cast.micro]) expect(e.asset.gate).toBe('always');
  });

  it('different seeds pick different (but still relevant) casts', () => {
    const ids = (seed: string) => selectCast(catalog, theme({ storybook: 1, woodland: 0.8, cozy: 0.4 }), cfg({ seed })).secondary.map((e) => e.asset.id).join();
    const variants = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(ids));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe('cell composition', () => {
  it('is a pure function of seed, theme, config and map', () => {
    expect(world(noir, { seed: 's1' }).out).toEqual(world(noir, { seed: 's1' }).out);
  });

  it('different seeds give distinct distributions on the same streets', () => {
    const a = world(noir, { seed: 'alpha', density: 1 }).out, b = world(noir, { seed: 'beta', density: 1 }).out;
    const key = (p: Placement) => `${Math.round(p.x)},${Math.round(p.y)}`;
    const shared = a.filter((p) => b.some((q) => key(q) === key(p))).length;
    expect(shared / Math.max(a.length, 1)).toBeLessThan(0.5);
  });

  it('density scales the amount of decoration', () => {
    const count = (density: number) => world(noir, { seed: 'd', density }).out.filter((p) => p.tier === 'secondary').length;
    const low = count(0.3), medium = count(0.6), high = count(1);
    expect(low).toBeLessThan(high);
    expect(medium).toBeLessThanOrEqual(high);
    expect(high).toBeGreaterThanOrEqual(12);
  });

  it('respects spacing, cell margins and never overlaps solid bodies', () => {
    const { out, config } = world(noir, { seed: 'spacing', density: 1 });
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!, b = out[j]!, d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(d).toBeGreaterThanOrEqual(a.base + b.base + 0.6 - 1e-9);
      if (a.tier === b.tier) expect(d).toBeGreaterThanOrEqual(config.minSpacing[a.tier] - 1e-9);
    }
    for (const p of out) {
      if (p.surface === 'rooftop') expect(p.z).toBe(g.roofAt(p.x, p.y));
      else { expect(p.z).toBe(0); expect(g.areaAt('building', p.x, p.y)).toBeUndefined(); }
    }
  });

  it('uses several spatial patterns, surfaces and a natural size distribution', () => {
    const { out } = world(theme({ storybook: 1, woodland: 0.8, cozy: 0.5, market: 0.5 }), { seed: 'mix', density: 1 });
    const patterns = new Set(out.map((p) => p.pattern));
    expect(patterns.size).toBeGreaterThanOrEqual(3);
    expect(new Set(out.map((p) => p.surface)).size).toBeGreaterThanOrEqual(3);
    const sizes = out.filter((p) => p.tier === 'secondary').map((p) => Math.round(p.size * 10));
    expect(new Set(sizes).size).toBeGreaterThan(sizes.length * 0.5);
  });

  it('decorates rooftops (visible above street canyons) with rooftop-capable families only', () => {
    const { out } = world(noir, { seed: 'roof', density: 1 });
    const roof = out.filter((p) => p.pattern === 'rooftop');
    expect(roof.length).toBeGreaterThan(0);
    for (const p of roof) expect(FAMILIES[catalog.assets.get(p.assetId)!.family].surfaces).toContain('rooftop');
  });

  it('clustering shifts the mix from dispersed accents toward vignettes and groves', () => {
    const share = (clustering: number) => {
      const out = world(theme({ storybook: 1, woodland: 1, market: 0.6 }), { seed: 'cl', density: 1, clustering }).out;
      return out.filter((p) => p.pattern === 'vignette' || p.pattern === 'grove').length / Math.max(1, out.length);
    };
    expect(share(1)).toBeGreaterThan(share(0));
  });

  it('a different theme reuses the same rules with different assets (no per-scene code)', () => {
    const a = new Set(world(noir, { seed: 'x', density: 1 }).out.map((p) => p.assetId));
    const b = new Set(world(coast, { seed: 'x', density: 1 }).out.map((p) => p.assetId));
    expect([...a].filter((id) => b.has(id)).length).toBeLessThan(Math.min(a.size, b.size));
  });

  it('produces nothing for a neutral (zero-strength) scene', () => {
    expect(world(deriveTheme(null, runtimeAssets)).out).toHaveLength(0);
  });
});

describe('hero installations', () => {
  const layout = runtimeAssets.layouts.get('haunted_street') as unknown as HeroLayout;
  it('reuse authored two-slot layouts on verified open ground', () => {
    // Large open park region.
    const big = syntheticCity();
    big.addArea('park', 'park', [Float64Array.from([700, -1500, 1300, -1500, 1300, -900, 700, -900, 700, -1500])]);
    const out = composeHero({ regionKey: 'r', rect: [650, -1550, 1350, -850], geometry: big, layouts: [layout], config: cfg({ seed: 'h' }) });
    expect(out.length).toBe(Object.values(layout.slots).reduce((s, slot) => s + slot.placements.length, 0));
    expect(new Set(out.map((p) => p.group.split(':').pop()))).toEqual(new Set(['hero_installation', 'ambient_accent']));
    for (const p of out) expect(big.areaAt('park', p.x, p.y)).toBeDefined();
    expect(layoutRadius(layout)).toBeGreaterThan(3);
  });

  it('refuse to squeeze into a dense block', () => {
    expect(composeHero({ regionKey: 'r', rect: [30, -160, 160, -30], geometry: g, layouts: [layout], config: cfg() })).toHaveLength(0);
  });
});

describe('major open spaces', () => {
  it('leave most of a large park bare (Boston Common stays a park), a little less for an explicit theme', () => {
    const rect = [30, -630, 630, -30] as const;
    const base = surfaceCandidates(g, rect).filter((c) => c.surface === 'park' || c.surface === 'path_edge');
    expect(base.length).toBeGreaterThan(20);
    const asOpenSpace = base.map((c) => ({ ...c, open: OPEN_SPACE_M2 * 5 }));
    const count = (cands: typeof base, t: DecorTheme) => {
      const config = cfg();
      return composeCell({ cellKey: 'common', rect, candidates: cands, cast: selectCast(catalog, t, config), theme: t, config }).length;
    };
    const ordinary = theme({ woodland: 1, cozy: 0.5 });
    const small = count(base, ordinary), large = count(asOpenSpace, ordinary);
    expect(large).toBeLessThan(small);
    expect(large).toBeGreaterThan(0); // still a park with some trees, not an empty lawn
    expect(count(asOpenSpace, theme({ woodland: 1, cozy: 0.5 }, 1, asked('fantasy')))).toBeGreaterThanOrEqual(large);
    expect(OPEN_SPACE_KEEP.ordinary).toBeLessThan(OPEN_SPACE_KEEP.themed);
  });
});
