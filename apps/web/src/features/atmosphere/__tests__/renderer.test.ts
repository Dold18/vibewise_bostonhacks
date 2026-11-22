import { describe, expect, it } from 'vitest';
import { compileScene } from '../../scene/compile';
import { MAP_RENDERER_V2 } from '../../scene/capabilities';
import type { ScenePresetId } from '../../scene/presets';
import { intent } from '../../scene/__tests__/fixtures';
import { anchorLayer, mountAtmosphere, type AtmosphereMap, type MediaQueryLike } from '../renderer';
import { GRADE_LAYER_ID } from '../gradeLayer';
import { WORLD_LAYER_ID } from '../worldLayer';

const BASE_LAYERS = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill' },
  { id: 'building-3d-b6', type: 'fill-extrusion' },
  { id: 'water-label', type: 'symbol' },
  { id: 'place-city', type: 'symbol' },
];

function harness({ reducedMotion = false, layers = BASE_LAYERS } = {}) {
  let style = [...layers];
  const calls: string[] = [];
  let repaints = 0;
  let t = 0;
  const frames: Array<(t: number) => void> = [];
  const mqListeners = new Set<(e: { matches: boolean }) => void>();
  const mq: MediaQueryLike = {
    matches: reducedMotion,
    addEventListener: (_, fn) => void mqListeners.add(fn),
    removeEventListener: (_, fn) => void mqListeners.delete(fn),
  };
  const map = {
    isStyleLoaded: () => true,
    once: () => map,
    getStyle: () => (calls.push('getStyle'), { layers: style }),
    getLayer: (id: string) => style.find((l) => l.id === id),
    addLayer: (layer: { id: string; type: string; renderingMode?: string }, before?: string) => {
      calls.push(`addLayer ${layer.id} before ${before}`);
      const i = before ? style.findIndex((l) => l.id === before) : style.length;
      style.splice(i, 0, { id: layer.id, type: layer.type });
      return map;
    },
    removeLayer: (id: string) => {
      calls.push(`removeLayer ${id}`);
      style = style.filter((l) => l.id !== id);
      return map;
    },
    triggerRepaint: () => void repaints++,
  } as unknown as AtmosphereMap;
  const atmosphere = mountAtmosphere(map, {
    quality: 'high',
    reducedMotion: mq,
    now: () => t,
    requestFrame: (fn) => void frames.push(fn),
    baseUrl: '/',
  });
  /** Advance the clock by `ms`, running queued frames every 16 ms. */
  const advance = (ms: number) => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 16);
      for (const fn of frames.splice(0)) fn(t);
    }
  };
  return {
    atmosphere, calls, advance, style: () => style.map((l) => l.id), repaints: () => repaints, pending: () => frames.length,
    setReducedMotion: (m: boolean) => mqListeners.forEach((fn) => fn({ matches: m })),
  };
}

const sceneOf = (presets: Array<[ScenePresetId, number]>, overrides: Array<{ key: string; value: string; intensity?: number }> = [], navigation: 'browse' | 'route' = 'browse') =>
  compileScene({ outing: intent(presets, { overrides }), capabilities: MAP_RENDERER_V2, context: { performance: 'high', navigation } });

describe('atmosphere renderer lifecycle', () => {
  it('neutral scenes never touch the map', () => {
    const h = harness();
    h.atmosphere.setScene(compileScene({ capabilities: MAP_RENDERER_V2 }));
    h.atmosphere.setScene(null);
    h.advance(2000);
    expect(h.calls).toEqual([]);
    expect(h.repaints()).toBe(0);
  });

  it('adds world then grade layers right after the buildings, below every symbol layer', () => {
    const h = harness();
    h.atmosphere.setScene(sceneOf([['noir_nocturne', 1]]));
    expect(h.style()).toEqual(['background', 'water', 'building-3d-b6', WORLD_LAYER_ID, GRADE_LAYER_ID, 'water-label', 'place-city']);
  });

  it('stays below routes and the focus mask when they already exist', () => {
    expect(anchorLayer([...BASE_LAYERS.slice(0, 3), { id: 'vb-map-focus', type: 'fill' }, { id: 'transit-route-casing', type: 'line' }, ...BASE_LAYERS.slice(3)])).toBe('vb-map-focus');
    expect(anchorLayer([...BASE_LAYERS.slice(0, 3), { id: 'transit-route-casing', type: 'line' }, ...BASE_LAYERS.slice(3)])).toBe('transit-route-casing');
  });

  it('a static atmosphere repaints only during its transition, then stops', () => {
    const h = harness();
    const s = sceneOf([], [{ key: 'air_and_atmosphere.vignette', value: 'cinematic', intensity: 0.8 }, { key: 'cinematic_and_artistic.paper_texture', value: 'cream_fiber', intensity: 0.8 }]);
    h.atmosphere.setScene(s, { transitionMs: 800 });
    h.advance(1200);
    const after = h.repaints();
    expect(after).toBeGreaterThan(10); // the fade itself animates
    h.advance(5000);
    expect(h.repaints()).toBe(after); // no constant GPU work afterwards
    expect(h.pending()).toBe(0);
    expect(h.atmosphere.stats().plan.fps).toBe(0);
  });

  it('animated weather repaints at the tier’s capped rate, not every frame forever at random', () => {
    const h = harness();
    h.atmosphere.setScene(sceneOf([], [{ key: 'air_and_atmosphere.rain', value: 'cinematic', intensity: 0.8 }]), { transitionMs: 0 });
    h.advance(100);
    const start = h.repaints();
    h.advance(1000);
    const perSecond = h.repaints() - start;
    expect(perSecond).toBeGreaterThan(25);
    expect(perSecond).toBeLessThanOrEqual(32);
    expect(h.atmosphere.stats().animating).toBe(true);
  });

  it('reduced motion stops the loop but keeps a still atmosphere', () => {
    const h = harness();
    h.atmosphere.setScene(sceneOf([], [{ key: 'air_and_atmosphere.snow', value: 'gentle', intensity: 0.8 }]), { transitionMs: 0 });
    h.advance(200);
    h.setReducedMotion(true);
    h.advance(400);
    const r = h.repaints();
    h.advance(3000);
    expect(h.repaints()).toBe(r);
    const plan = h.atmosphere.plan();
    expect(plan.params.motion).toBe(0);
    expect(plan.params.snow).toBeGreaterThan(0);
    expect(h.style()).toContain(WORLD_LAYER_ID);
  });

  it('fades back to nothing, then removes its layers', () => {
    const h = harness();
    h.atmosphere.setScene(sceneOf([['neon_city', 1]]), { transitionMs: 0 });
    h.advance(100);
    h.atmosphere.setScene(compileScene({ capabilities: MAP_RENDERER_V2 }), { transitionMs: 600 });
    h.advance(300);
    expect(h.style()).toContain(GRADE_LAYER_ID); // still fading
    h.advance(600);
    expect(h.style()).not.toContain(GRADE_LAYER_ID);
    expect(h.style()).not.toContain(WORLD_LAYER_ID);
  });

  it('navigation scenes from the compiler keep only the soft vignette', () => {
    const h = harness();
    h.atmosphere.setScene(sceneOf([['noir_nocturne', 1]], [], 'route'), { transitionMs: 0 });
    const p = h.atmosphere.plan();
    expect(p.params.fogDensity).toBe(0);
    expect(p.params.grain).toBe(0);
    expect(p.params.vignette).toBeGreaterThan(0);
    expect(p.params.vignette).toBeLessThanOrEqual(0.35);
    expect(p.world.active).toBe(false);
  });

  it('a direct override is still composed (navigation guard applies to it too)', () => {
    const h = harness();
    h.atmosphere.setOverride({ fogDensity: 0.7, rain: 0.5, grain: 0.4 }, { transitionMs: 0 });
    expect(h.atmosphere.plan().params.rain).toBeGreaterThan(0.3);
    h.atmosphere.setNavigation('route');
    h.advance(2000);
    expect(h.atmosphere.plan().params.rain).toBe(0);
    expect(h.atmosphere.plan().params.fogDensity).toBe(0);
  });

  it('exports window-light accents for the building renderer', () => {
    const h = harness();
    const seen: unknown[] = [];
    h.atmosphere.onAccents((a) => seen.push(a));
    h.atmosphere.setScene(sceneOf([], [{ key: 'building_surfaces.window_glow', value: 'warm_high', intensity: 1 }]));
    expect(seen.at(-1)).toMatchObject({ windowLight: 0.65 });
  });

  it('destroy removes its layers and stops', () => {
    const h = harness();
    h.atmosphere.setScene(sceneOf([['amber_refuge', 1]]));
    h.atmosphere.destroy();
    expect(h.style()).not.toContain(WORLD_LAYER_ID);
    h.advance(1000);
    expect(h.calls.filter((c) => c.startsWith('addLayer')).length).toBe(2);
  });
});
