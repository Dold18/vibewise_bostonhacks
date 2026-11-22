import { describe, expect, it, vi } from 'vitest';
import { MAP_RENDERER_V1 } from '../../scene/capabilities';
import { createSceneSession } from '../../scene/session';
import { assetCapabilities } from '../../scene/runtime';
import { createCityEngine } from '../engine';
import { CityContractError, type CityRenderer } from '../contracts';
import { cityPlanner, cityRenderers } from '../registry';
import { residualState } from '../legacyBridge';
import { fakeImage, intent, recorder, runtimeAssets, scene } from './helpers';

const GLOW = { 'building_surfaces.window_glow': ['warm_low', 'warm_high'] };
const RAIN = { 'air_and_atmosphere.rain': ['drizzle', 'light'] };
const overrides = [
  { key: 'building_surfaces.window_glow', value: 'warm_low', intensity: 0.8 },
  { key: 'air_and_atmosphere.rain', value: 'drizzle', intensity: 0.7 },
];

function pair() {
  const buildings = recorder('test-buildings', 'buildings', GLOW);
  const atmosphere = recorder('test-atmosphere', 'atmosphere', RAIN);
  const engine = createCityEngine({ renderers: [buildings.renderer, atmosphere.renderer], assets: runtimeAssets, loadImage: fakeImage });
  return { buildings, atmosphere, engine };
}

describe('one SceneState-derived plan, independent renderers', () => {
  it('gives each renderer only its own section of the same plan', () => {
    const { buildings, atmosphere, engine } = pair();
    engine.render(scene(engine.capabilities(), [['noir_nocturne', 0.6]], overrides));

    const b = buildings.last();
    const a = atmosphere.last();
    expect(b.planHash).toBe(a.planHash);
    expect(b.env.seed).toBe(7);
    expect(a.env.seed).toBe(7);
    expect(b.section.treatments.window_glow).toMatchObject({ key: 'building_surfaces.window_glow', style: 'warm_low' });
    expect(b.section.treatments.window_glow!.intensity).toBeGreaterThan(0);
    expect(a.section.treatments.rain).toMatchObject({ style: 'drizzle' });
    // Neither sees the other's settings or section shape.
    expect(b.section.treatments.rain).toBeUndefined();
    expect(a.section.treatments.window_glow).toBeUndefined();
    expect(Object.keys(b.section).sort()).toEqual(['colors', 'enabled', 'treatments', 'variation']);
    expect(Object.keys(a.section).sort()).toEqual(['colors', 'enabled', 'light', 'treatments', 'variation']);
    expect(b.env.budget).toEqual(engine.plan()!.budget.buildings);
  });

  it('a renderer runs alone with no other system registered', () => {
    const atmosphere = recorder('solo', 'atmosphere', RAIN);
    const engine = createCityEngine({ renderers: [atmosphere.renderer], assets: runtimeAssets, loadImage: fakeImage });
    engine.render(scene(engine.capabilities(), [['neon_city', 0.5]], overrides));
    expect(atmosphere.last().section.treatments.rain?.style).toBe('drizzle');
    // Its unclaimed neighbor's value is clipped by the compiler, not silently dropped by a renderer.
    expect(engine.plan()!.sections.buildings.treatments.window_glow).toBeUndefined();
  });

  it('only claimed values reach SceneState: registration is what makes a value live', () => {
    const plain = scene(MAP_RENDERER_V1, [['noir_nocturne', 0.6]], overrides);
    expect(plain.resolved['building_surfaces.window_glow']).toBe('off');
    expect(plain.disabled.some((d) => d.key === 'building_surfaces.window_glow')).toBe(true);

    const { engine } = pair();
    const claimed = scene(engine.capabilities(), [['noir_nocturne', 0.6]], overrides);
    expect(claimed.resolved['building_surfaces.window_glow']).toBe('warm_low');
  });

  it('calls a renderer only when its own section changed', () => {
    const { buildings, atmosphere, engine } = pair();
    const caps = engine.capabilities();
    engine.render(scene(caps, [['noir_nocturne', 0.6]], overrides));
    engine.render(scene(caps, [['noir_nocturne', 0.6]], overrides));
    expect(buildings.frames).toHaveLength(1);
    expect(atmosphere.frames).toHaveLength(1);

    engine.render(scene(caps, [['noir_nocturne', 0.6]], [overrides[0]!, { ...overrides[1]!, value: 'light' }]));
    expect(atmosphere.frames).toHaveLength(2);
    expect(atmosphere.last().section.treatments.rain?.style).toBe('light');
    expect(buildings.frames.length).toBeLessThanOrEqual(2); // palette may shift; window glow did not
    expect(buildings.last().section.treatments.window_glow?.style).toBe('warm_low');
  });

  it('releases: every section fades out on a null scene', () => {
    const { buildings, engine } = pair();
    engine.render(scene(engine.capabilities(), [['noir_nocturne', 0.6]], overrides));
    engine.render(null);
    expect(buildings.last().transition.reason).toBe('release');
    expect(buildings.last().section.enabled).toBe(false);
  });
});

describe('registration and capabilities', () => {
  const make = (renderers: CityRenderer[]) => () => createCityEngine({ renderers: renderers as never, assets: runtimeAssets });

  it('rejects two renderers claiming one key, foreign keys, base-theme keys and invented values', () => {
    expect(make([recorder('a', 'buildings', GLOW).renderer, recorder('b', 'buildings', GLOW).renderer])).toThrow(CityContractError);
    expect(make([recorder('a', 'buildings', RAIN).renderer])).toThrow(/belongs to atmosphere/);
    expect(make([recorder('a', 'atmosphere', { 'global_grade.saturation': ['muted'] }).renderer])).toThrow(/no city section/);
    expect(make([recorder('a', 'buildings', { 'building_surfaces.window_glow': ['plasma'] }).renderer])).toThrow(/no values plasma/);
    expect(make([recorder('a', 'buildings').renderer, recorder('a', 'streets').renderer])).toThrow(/duplicate/);
    expect(make([{ ...recorder('a', 'buildings').renderer, capabilities: { features: ['set_piece_3d'] } }])).toThrow(/decorations/);
  });

  it('a claimed key replaces the base profile values; others keep the base', () => {
    const base = assetCapabilities(false);
    const streets = recorder('streets-x', 'streets', { 'roads_and_ground.wet_sheen': ['subtle'] });
    const engine = createCityEngine({ renderers: [streets.renderer], assets: runtimeAssets, base });
    const profile = engine.capabilities();
    expect([...profile.values.get('roads_and_ground.wet_sheen')!]).toEqual(['subtle']);
    expect(profile.values.get('air_and_atmosphere.rain')).toEqual(base.values.get('air_and_atmosphere.rain'));
    expect(engine.claims().keys.has('roads_and_ground.wet_sheen')).toBe(true);
  });

  it('the real workstream registry and planner construct without conflicts', async () => {
    const engine = createCityEngine({ renderers: cityRenderers({ preview3d: false }), planner: cityPlanner(), assets: runtimeAssets, base: assetCapabilities(false) });
    expect(engine.stats().renderers.map((r) => r.section).sort()).toEqual(['atmosphere', 'buildings', 'decorations', 'streets']);
    await engine.ready(); // streets and atmosphere initialize asynchronously (code-split modules)
    engine.render(scene(engine.capabilities(), [['woodland_story', 0.7], ['retro_atlas', 0.3]]));
    expect(engine.stats().renderers.every((r) => r.status === 'ready')).toBe(true);
  });
});

describe('isolation and lifecycle', () => {
  it('a throwing renderer is retired after repeated failures; its neighbor never notices', () => {
    const errors: string[] = [];
    const onCapabilitiesChange = vi.fn();
    const broken = recorder('broken', 'buildings', GLOW, { update: () => { throw new Error('shader exploded'); } });
    const healthy = recorder('healthy', 'atmosphere', RAIN);
    const engine = createCityEngine({ renderers: [broken.renderer, healthy.renderer], assets: runtimeAssets, onCapabilitiesChange, onError: (_e, id) => errors.push(String(id)) });
    const state = scene(engine.capabilities(), [['noir_nocturne', 0.6]], overrides);
    for (let i = 0; i < 3; i++) engine.render(state);

    expect(healthy.frames).toHaveLength(1);
    const stats = engine.stats().renderers.find((r) => r.id === 'broken')!;
    expect(stats.status).toBe('retired');
    expect(broken.dispose).toHaveBeenCalledOnce();
    expect(errors.filter((id) => id === 'broken')).toHaveLength(3);
    // Its claims are withdrawn so the compiler stops reporting window glow as live.
    expect(onCapabilitiesChange).toHaveBeenCalledOnce();
    expect(onCapabilitiesChange.mock.calls[0]![0].values.has('building_surfaces.window_glow')).toBe(false);
  });

  it('async init: frames wait for ready and arrive as the newest one; a failed init withdraws claims', async () => {
    let finish!: () => void;
    const slow = recorder('slow', 'buildings', GLOW, { init: () => new Promise<void>((r) => (finish = r)) });
    const failing = recorder('failing', 'atmosphere', RAIN, { init: () => Promise.reject(new Error('no WebGL')) });
    const onCapabilitiesChange = vi.fn();
    const engine = createCityEngine({ renderers: [slow.renderer, failing.renderer], assets: runtimeAssets, onCapabilitiesChange, onError: () => {} });
    const caps = engine.capabilities();
    engine.render(scene(caps, [['noir_nocturne', 0.3]], overrides));
    engine.render(scene(caps, [['noir_nocturne', 0.9]], overrides));
    expect(slow.frames).toHaveLength(0);
    finish();
    await engine.ready();
    expect(slow.frames).toHaveLength(1);
    expect(slow.last().transition.reason).toBe('ready');
    expect(slow.last().planHash).toBe(engine.plan()!.hash);
    expect(failing.frames).toHaveLength(0);
    expect(engine.stats().renderers.find((r) => r.id === 'failing')!.status).toBe('retired');
    expect(onCapabilitiesChange.mock.calls.at(-1)![0].values.has('air_and_atmosphere.rain')).toBe(false);
  });

  it('a synchronous init failure never enters the capability profile', () => {
    const bad = recorder('bad', 'atmosphere', RAIN, { init: () => { throw new Error('boom'); } });
    const engine = createCityEngine({ renderers: [bad.renderer], assets: runtimeAssets, onError: () => {} });
    expect(engine.capabilities().values.has('air_and_atmosphere.rain')).toBe(false);
  });

  it('destroy disposes every live renderer exactly once and stops rendering', () => {
    const { buildings, atmosphere, engine } = pair();
    engine.destroy();
    engine.destroy();
    engine.render(scene(MAP_RENDERER_V1, [['neon_city', 1]]));
    expect(buildings.dispose).toHaveBeenCalledOnce();
    expect(atmosphere.dispose).toHaveBeenCalledOnce();
    expect(buildings.frames).toHaveLength(0);
  });

  it('a throwing planner falls back to the baseline plan', () => {
    const atmosphere = recorder('a', 'atmosphere', RAIN);
    const engine = createCityEngine({ renderers: [atmosphere.renderer], assets: runtimeAssets, planner: () => { throw new Error('bad composition'); }, onError: () => {} });
    engine.render(scene(engine.capabilities(), [['neon_city', 0.5]], overrides));
    expect(engine.stats().plannerFallbacks).toBe(1);
    expect(atmosphere.last().section.treatments.rain?.style).toBe('drizzle');
  });

  it('reports usage above a renderer’s share of the budget', () => {
    const greedy = recorder('greedy', 'atmosphere', RAIN, { usage: () => ({ particles: 100_000, overlayElements: 1 }) });
    const engine = createCityEngine({ renderers: [greedy.renderer], assets: runtimeAssets });
    engine.render(scene(engine.capabilities(), [['neon_city', 0.5]], overrides));
    const [stats] = engine.stats().renderers;
    expect(stats!.overBudget).toEqual([expect.stringMatching(/^particles 100000 > \d+$/)]);
  });
});

describe('with the one authoritative Scene Session', () => {
  it('drives renderers end to end, and a retired renderer’s values leave SceneState', () => {
    let fail = false;
    const buildings = recorder('test-buildings', 'buildings', GLOW, {
      update(frame) {
        if (fail) throw new Error('context lost');
        buildings.frames.push(frame);
      },
    });
    const atmosphere = recorder('test-atmosphere', 'atmosphere', RAIN);
    let session!: ReturnType<typeof createSceneSession>;
    const engine = createCityEngine({
      renderers: [buildings.renderer, atmosphere.renderer],
      assets: runtimeAssets,
      maxFailures: 1,
      onError: () => {},
      onCapabilitiesChange: (p) => session.setCapabilities(p), // re-enters render(); the engine finishes the pass first
    });
    session = createSceneSession({ capabilities: engine.capabilities(), assets: runtimeAssets, context: { variationSeed: 11 } });
    session.subscribe((u) => engine.render(u.state, { transitionMs: u.transitionMs }));
    engine.render(session.getState());

    expect(session.submit('outing-1', 1, intent([['noir_nocturne', 0.6]], { overrides }))).toBe('applied');
    expect(buildings.last().section.treatments.window_glow?.style).toBe('warm_low');
    expect(atmosphere.last().env.seed).toBe(11);

    fail = true;
    session.submit('outing-1', 2, intent([['noir_nocturne', 0.7]], { overrides, sessionVersion: 2 }));
    expect(session.getState().resolved['building_surfaces.window_glow']).toBe('off');
    expect(engine.plan()!.sceneHash).toBe(session.getState().hash);
    // Atmosphere's section did not change, so it was not called again: what it shows is current.
    expect(atmosphere.last().section).toEqual(engine.plan()!.sections.atmosphere);
    expect(atmosphere.last().section.treatments.rain?.style).toBe('drizzle');
  });
});

describe('legacy bridge', () => {
  it('hands the pre-engine asset runtime only unclaimed keys', () => {
    const state = scene(assetCapabilities(true), [['noir_nocturne', 1]], [{ key: 'roads_and_ground.wet_sheen', value: 'subtle', intensity: 0.6 }]);
    expect(state.strengths['roads_and_ground.wet_sheen']).toBeGreaterThan(0);
    const residual = residualState(state, { keys: new Set(['roads_and_ground.wet_sheen']), features: new Set(['set_piece_3d']) });
    expect(residual.strengths['roads_and_ground.wet_sheen']).toBeUndefined();
    expect(residual.setPiece).toBeNull();
    expect(Object.keys(residual.strengths).length).toBe(Object.keys(state.strengths).length - 1);
    expect(residualState(state, { keys: new Set(), features: new Set() })).toBe(state);
  });
});

describe('WebGL context restore', () => {
  /** Just the map surface the engine uses for recovery. */
  function fakeMap() {
    const handlers = new Map<string, () => void>();
    let loaded = false;
    const map = {
      on: (e: string, f: () => void) => void handlers.set(e, f),
      off: (e: string) => void handlers.delete(e),
      isStyleLoaded: () => loaded,
    };
    return { map, restore: () => handlers.get('webglcontextrestored')?.(), setLoaded: (v: boolean) => { loaded = v; }, listening: () => handlers.has('webglcontextrestored') };
  }

  it('waits for the rebuilt style, then has every renderer rebuild from the current frame', async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeMap();
      const restored = vi.fn();
      const buildings = recorder('test-buildings', 'buildings', GLOW, { contextRestored: restored });
      const engine = createCityEngine({ renderers: [buildings.renderer], assets: runtimeAssets, loadImage: fakeImage, map: fake.map as never });
      engine.render(scene(engine.capabilities(), [['noir_nocturne', 0.6]], overrides));
      const before = buildings.frames.length;
      const planHash = buildings.last().planHash;

      fake.restore();
      expect(restored).not.toHaveBeenCalled(); // the rebuilt style is still loading
      fake.setLoaded(true);
      await vi.advanceTimersByTimeAsync(150);
      expect(restored).toHaveBeenCalledTimes(1);
      expect(buildings.frames.length).toBe(before + 1); // re-delivered even though nothing changed
      expect(buildings.last().planHash).toBe(planHash);
      expect(buildings.last().transition).toEqual({ durationMs: 0, reason: 'ready' });

      engine.destroy();
      expect(fake.listening()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a released scene released', () => {
    const fake = fakeMap();
    fake.setLoaded(true);
    const buildings = recorder('test-buildings', 'buildings', GLOW);
    const engine = createCityEngine({ renderers: [buildings.renderer], assets: runtimeAssets, loadImage: fakeImage, map: fake.map as never });
    engine.render(scene(engine.capabilities(), [['noir_nocturne', 0.6]], overrides));
    engine.render(null);
    fake.restore();
    expect(buildings.last().transition.reason).toBe('release');
  });
});
