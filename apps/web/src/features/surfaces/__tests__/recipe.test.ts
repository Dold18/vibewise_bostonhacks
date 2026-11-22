import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_RENDERER_V1, PRESET_IDS } from '../../scene';
import { SCENE_CATALOG } from '../../scene/catalog';
import { surfaceValues } from '../capabilities';
import { deriveSurfaceRecipe, type SurfaceRecipe } from '../recipe';
import type { SceneState } from '../../scene/state';
import { scene, WORLDS } from './fixtures';

const intensities = (r: SurfaceRecipe) => [r.roads.intensity, r.walk.intensity, r.ground.intensity, r.green.intensity, r.wood.intensity, r.edges.intensity, r.lanes.intensity, r.lamps.intensity];

describe('surface recipe', () => {
  it('is the plain map with no scene, a neutral scene, or zero-weight presets', () => {
    for (const r of [deriveSurfaceRecipe(null), deriveSurfaceRecipe(scene([['neutral', 1]])), deriveSurfaceRecipe(scene([['neon_city', 0]]))]) {
      expect(r.presence).toBe(0);
      expect(intensities(r).every((x) => x === 0)).toBe(true);
    }
  });

  it('is deterministic', () => {
    for (const w of WORLDS) {
      const a = deriveSurfaceRecipe(scene([[w, 1]]));
      const b = deriveSurfaceRecipe(scene([[w, 1]]));
      expect(a).toEqual(b);
      expect(a.hash).toBe(b.hash);
    }
  });

  it('gives materially different worlds, not just colors', () => {
    const recipes = WORLDS.map((w) => deriveSurfaceRecipe(scene([[w, 1]])));
    expect(new Set(recipes.map((r) => r.roads.minor)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(recipes.map((r) => r.walk.material)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(recipes.map((r) => r.ground.material)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(recipes.map((r) => `${r.green.material}/${r.green.accent}`)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(recipes.map((r) => r.hash)).size).toBe(WORLDS.length);
  });

  it('scales with scene presence (a faint answer gives a faint city)', () => {
    const faint = deriveSurfaceRecipe(scene([['amber_refuge', 0.25]]));
    const full = deriveSurfaceRecipe(scene([['amber_refuge', 1]]));
    expect(faint.roads.intensity).toBeGreaterThan(0);
    expect(faint.roads.intensity).toBeLessThan(full.roads.intensity);
  });

  it('keeps motorways in the asphalt family and gives major roads a calmer variant', () => {
    const allowed = new Set(['asphalt', 'aged_asphalt', 'wet_asphalt', 'paper_sketch']);
    for (const w of WORLDS) {
      for (const m of ['cobbles', 'flagstone', 'brick_pavers', 'glazed_tiles', 'granite_setts'] as const) {
        const r = deriveSurfaceRecipe(scene([[w, 1]]), { roadMaterial: m });
        expect(allowed.has(r.roads.motorway)).toBe(true);
        expect(['cobbles', 'flagstone', 'brick_pavers']).not.toContain(r.roads.major);
      }
    }
  });

  it('honours explicit catalog values over inference', () => {
    const r = deriveSurfaceRecipe(scene([['sunlit_coast', 1]], [{ key: 'roads_and_ground.street_material', value: 'cobblestone_illustration' }]));
    expect(r.roads.minor).toBe('cobbles');
    expect(r.origins.roads).toBe('explicit');
    const wet = deriveSurfaceRecipe(scene([['minimal_modern', 1]], [{ key: 'roads_and_ground.wet_sheen', value: 'rainy_night' }]));
    expect(wet.wet).toBeGreaterThan(0.8);
    expect(wet.origins.wet).toBe('explicit');
  });

  it('wets the ground under falling rain (atmosphere draws the rain; the scene view carries it)', () => {
    const withRain = (s: SceneState) => ({ ...s, resolved: { ...s.resolved, 'air_and_atmosphere.rain': 'drizzle' }, strengths: { ...s.strengths, 'air_and_atmosphere.rain': 0.8 } }) as SceneState;
    const dry = scene([['amber_refuge', 1]]);
    expect(deriveSurfaceRecipe(dry).wet).toBe(0);
    const r = deriveSurfaceRecipe(withRain(dry));
    expect(r.wet).toBeCloseTo(0.45, 5);
    expect(r.origins.wet).toBe('inferred');
    // An explicit, wetter sheen still wins.
    const sheen = withRain(scene([['amber_refuge', 1]], [{ key: 'roads_and_ground.wet_sheen', value: 'rainy_night' }]));
    expect(deriveSurfaceRecipe(sheen).origins.wet).toBe('explicit');
  });

  it('realizes every claimed capability value as a distinct surface change', () => {
    const base = scene([['minimal_modern', 1]]);
    const baseHash = deriveSurfaceRecipe(base).hash;
    for (const [key, values] of surfaceValues()) {
      const seen = new Set<string>();
      for (const value of values) {
        const st = scene([['minimal_modern', 1]], [{ key, value }]);
        expect(st.resolved[key], `${key}=${value} must survive capability clipping`).toBe(value);
        const r = deriveSurfaceRecipe(st);
        expect(r.hash, `${key}=${value} changes nothing`).not.toBe(baseHash);
        seen.add(r.hash);
      }
      expect(seen.size, `${key}: values must look different`).toBe(values.size);
    }
  });

  it('only infers from appearance values that are really resolved (live profile drops surface keys)', () => {
    const live = deriveSurfaceRecipe(scene([['neon_city', 1]], [], MAP_RENDERER_V1));
    // wet_sheen is clipped by MAP_RENDERER_V1, but neon road color and palette still infer wet asphalt.
    expect(live.roads.minor).toBe('wet_asphalt');
    expect(live.origins.wet).toBe('inferred');
  });

  it('never refers to scene/preset names', () => {
    const src = readFileSync(new URL('../recipe.ts', import.meta.url), 'utf8');
    for (const id of PRESET_IDS) expect(src.includes(`'${id}'`), `recipe.ts mentions ${id}`).toBe(false);
  });

  it('references only real catalog keys and values in its affinity tables', () => {
    const src = readFileSync(new URL('../recipe.ts', import.meta.url), 'utf8');
    const tokens = [...src.matchAll(/'([a-z_]+\.[a-z_]+)=([a-z_*]+)'/g)];
    expect(tokens.length).toBeGreaterThan(40);
    for (const [, key, value] of tokens) {
      const setting = SCENE_CATALOG.byKey.get(key);
      expect(setting, key).toBeDefined();
      if (value !== '*') expect(setting!.values, `${key}=${value}`).toContain(value);
    }
  });
});
