import { describe, expect, it, vi } from 'vitest';
import { previewAllCapabilities } from '../capabilities';
import { SCENE_CATALOG } from '../catalog';
import { compileScene, type CompileInput } from '../compile';
import { createSceneSession, type SceneUpdate } from '../session';
import { intent } from './fixtures';
import type { ScenePresetId } from '../presets';

const ALL = previewAllCapabilities(SCENE_CATALOG);
const v = (version: number, presets: Array<[ScenePresetId, number]>, extra = {}) => intent(presets, { sessionVersion: version, ...extra });
const look = (s: { sessionVersion: number; diagnostics: unknown; hash: string }) => ({ ...s, sessionVersion: 0, diagnostics: [] });

function recorder() {
  const updates: SceneUpdate[] = [];
  return { updates, listener: (u: SceneUpdate) => void updates.push(u) };
}

describe('createSceneSession: basics', () => {
  it('starts on the account/neutral scene and emits only on change', () => {
    const session = createSceneSession();
    expect(session.getState().hash).toBe(compileScene().hash);
    const { updates, listener } = recorder();
    session.subscribe(listener);
    expect(session.submit('s1', 1, v(1, [['amber_refuge', 0.5]]))).toBe('applied');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ reason: 'intent', transitionMs: 800 });
    expect(updates[0].diff.palette.length).toBeGreaterThan(0);
    expect(updates[0].previous.source).toBe('neutral');
    expect(session.getState().sessionVersion).toBe(1);
  });

  it('a re-delivered identical look is a no-op, but the version still advances', () => {
    const session = createSceneSession();
    const { updates, listener } = recorder();
    session.subscribe(listener);
    session.submit('s1', 1, v(1, [['amber_refuge', 0.5]]));
    expect(session.submit('s1', 2, v(2, [['amber_refuge', 0.5]]))).toBe('unchanged');
    expect(updates).toHaveLength(1);
    expect(session.getState().sessionVersion).toBe(2);
  });
});

describe('stale rejection', () => {
  it('rejects an older version of the current session', () => {
    const session = createSceneSession();
    session.submit('s1', 3, v(3, [['noir_nocturne', 0.6]]));
    const before = session.getState();
    expect(session.submit('s1', 2, v(2, [['amber_refuge', 0.9]]))).toBe('stale');
    expect(session.getState()).toBe(before);
  });

  it('accepts a better intent for the same version (model after fallback)', () => {
    const session = createSceneSession();
    session.submit('s1', 4, v(4, [], { descriptors: ['cozy'] }));
    expect(session.submit('s1', 4, v(4, [['amber_refuge', 0.7], ['retro_atlas', 0.2]]))).toBe('applied');
    expect(session.getState().presets[0]).toEqual({ id: 'amber_refuge', weight: 0.7 });
  });

  it('rejects an intent produced for a different version than it was delivered under', () => {
    const session = createSceneSession();
    session.submit('s1', 5, v(5, [['noir_nocturne', 0.5]]));
    expect(session.submit('s1', 6, v(5, [['neon_city', 0.9]]))).toBe('stale');
    expect(session.submit('s1', 6, v(9, [['neon_city', 0.9]]))).toBe('rejected');
    expect(session.getState().presets[0].id).toBe('noir_nocturne');
  });

  it('retires replaced and cleared sessions so their late answers cannot return', () => {
    const session = createSceneSession();
    session.submit('old', 5, v(5, [['noir_nocturne', 0.5]]));
    session.submit('new', 1, v(1, [['sunlit_coast', 0.5]]));
    expect(session.submit('old', 6, v(6, [['noir_nocturne', 0.9]]))).toBe('stale');
    session.clear();
    expect(session.getState().source).toBe('neutral');
    expect(session.submit('new', 2, v(2, [['sunlit_coast', 0.9]]))).toBe('stale');
  });

  it('rejects malformed submissions and keeps the scene', () => {
    const session = createSceneSession();
    session.submit('s1', 1, v(1, [['amber_refuge', 0.5]]));
    const before = session.getState();
    for (const [id, ver, raw] of [['', 2, v(2, [])], ['s1', -1, v(-1, [])], ['s1', 2.5, v(2, [])], ['s1', 2, 'neon please'], ['s1', 2, { schemaVersion: '9' }]] as const) {
      expect(session.submit(id, ver, raw)).toBe('rejected');
    }
    expect(session.getState()).toBe(before);
  });

  it('a null intent means "no scene for this version": the account/neutral scene shows', () => {
    const session = createSceneSession({ account: { tags: { outdoor: 1 }, strength: 0.8 } });
    session.submit('s1', 1, v(1, [['noir_nocturne', 0.8]]));
    expect(session.submit('s1', 2, null)).toBe('applied');
    expect(session.getState().source).toBe('account');
  });
});

describe('caching and restoration', () => {
  it('undoing an answer restores exactly the scene shown before', () => {
    const session = createSceneSession({ capabilities: ALL });
    const { updates, listener } = recorder();
    session.subscribe(listener);
    session.submit('s1', 1, v(1, [['amber_refuge', 0.4]]));
    const shown = session.getState();
    session.submit('s1', 2, v(2, [['amber_refuge', 0.3], ['neon_city', 0.3]]));
    expect(session.submit('s1', 3, v(3, [['amber_refuge', 0.4]]))).toBe('applied');
    expect(updates.at(-1)!.reason).toBe('restore');
    expect(look(session.getState())).toEqual(look(shown));
    expect(session.getState().hash).toBe(shown.hash);
    expect(session.getState().sessionVersion).toBe(3);
  });

  it('ending navigation restores the browse scene from cache without recompiling', () => {
    const session = createSceneSession({ capabilities: ALL });
    session.submit('s1', 1, v(1, [['neon_city', 0.8]]));
    const browse = session.getState();
    const compiles = session.stats().compiles;
    session.setContext({ navigation: 'route' });
    expect(session.getState().overlays.every((o) => o.key === 'air_and_atmosphere.vignette')).toBe(true);
    session.setContext({ navigation: 'browse' });
    expect(session.getState().hash).toBe(browse.hash);
    expect(session.stats()).toMatchObject({ compiles: compiles + 1, cacheHits: 1 });
  });

  it('bounds the cache', () => {
    const session = createSceneSession({ cacheSize: 3 });
    for (let i = 1; i <= 8; i++) session.submit('s1', i, v(i, [['amber_refuge', i / 10]]));
    expect(session.stats().cached).toBe(3);
  });

  it('caches by content, not by object identity or version', () => {
    const compile = vi.fn((input: CompileInput) => compileScene(input));
    const session = createSceneSession({ compile });
    session.submit('s1', 1, v(1, [['retro_atlas', 0.5]]));
    session.submit('s1', 2, JSON.parse(JSON.stringify(v(2, [['retro_atlas', 0.5]]))));
    expect(compile).toHaveBeenCalledTimes(2); // initial scene + first submit
  });
});

describe('hysteresis through the session', () => {
  const GLOW = 'marker_recommendations.pin_glow';
  const weights = [0.12, 0.07, 0.09, 0.07, 0.09, 0.075];

  it('a value hovering near its threshold does not flicker', () => {
    const raw = weights.map((w) => compileScene({ outing: v(1, [['neon_city', w]]), capabilities: ALL }).resolved[GLOW]);
    expect(new Set(raw).size).toBe(2); // the bare compiler flickers on/off

    const session = createSceneSession({ capabilities: ALL });
    const shown = weights.map((w, i) => (session.submit('s1', i + 1, v(i + 1, [['neon_city', w]])), session.getState().resolved[GLOW]));
    expect(shown).toEqual(weights.map(() => 'neon_halo'));
  });

  it('is deterministic: the same inputs give the same sequence of looks', () => {
    const run = () => {
      const session = createSceneSession({ capabilities: ALL });
      const hashes: string[] = [];
      session.subscribe((u) => hashes.push(u.state.hash));
      weights.forEach((w, i) => session.submit('s1', i + 1, v(i + 1, [['neon_city', w], ['amber_refuge', 0.3 - w]])));
      session.setContext({ reducedMotion: true });
      session.submit('s1', 99, v(99, [['woodland_story', 0.6]]));
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});

describe('context, account and lifecycle', () => {
  it('reduced motion shortens the transition it reports', () => {
    const session = createSceneSession({ context: { reducedMotion: true } });
    const { updates, listener } = recorder();
    session.subscribe(listener);
    session.submit('s1', 1, v(1, [['dream_pastel', 0.6]]));
    expect(updates[0].transitionMs).toBeLessThanOrEqual(150);
  });

  it('account taste applies only without an outing scene', () => {
    const session = createSceneSession();
    session.setAccount({ tags: { cozy: 1 }, strength: 0.7 });
    expect(session.getState().source).toBe('account');
    session.submit('s1', 1, v(1, [['neon_city', 0.6]]));
    session.setAccount({ tags: { outdoor: 1 }, strength: 1 });
    expect(session.getState().source).toBe('outing');
    expect(session.getState().presets[0].id).toBe('neon_city');
  });

  it('a failing listener does not starve the others and is reported', () => {
    const onError = vi.fn();
    const session = createSceneSession({ onError });
    const good = vi.fn();
    session.subscribe(() => {
      throw new Error('renderer exploded');
    });
    session.subscribe(good);
    session.submit('s1', 1, v(1, [['amber_refuge', 0.5]]));
    expect(good).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'renderer exploded' }));
  });

  it('a compiler failure keeps the current scene', () => {
    const onError = vi.fn();
    let fail = false;
    const session = createSceneSession({ onError, compile: (i) => (fail ? (() => { throw new Error('boom'); })() : compileScene(i)) });
    const before = session.getState();
    fail = true;
    expect(session.submit('s1', 1, v(1, [['noir_nocturne', 0.5]]))).toBe('rejected');
    expect(session.getState()).toBe(before);
    expect(onError).toHaveBeenCalled();
  });

  it('unsubscribe and destroy stop all updates and release listeners', () => {
    const session = createSceneSession();
    const a = vi.fn();
    const off = session.subscribe(a);
    off();
    session.subscribe(vi.fn());
    expect(session.stats().listeners).toBe(1);
    session.destroy();
    expect(session.stats()).toMatchObject({ listeners: 0, cached: 0 });
    expect(session.submit('s1', 1, v(1, [['noir_nocturne', 0.5]]))).toBe('rejected');
    expect(a).not.toHaveBeenCalled();
  });
});
