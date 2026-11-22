/**
 * Live-map integration: Scene Session → mountScene → vibeTheme setScene → map.
 * Uses the real session, compiler and theme controller on a strict fake map
 * that fails on any non-paint call (camera, setStyle, layers, handlers).
 */
import { describe, expect, it } from 'vitest';
import { basePalette } from '../../../mapStyle';
import type { AccountState, AccountStore } from '../../account/session';
import { sceneStyleOf, startThemeController } from '../../vibeTheme/controller';
import { fakeEffects, fakeMap } from '../../vibeTheme/__tests__/fakeMap';
import { MAP_RENDERER_V1 } from '../capabilities';
import { hexToLab, lightness } from '../color';
import { compileScene } from '../compile';
import { ringPasses } from '../guard';
import { mountScene, type MediaQueryLike } from '../mount';
import type { ScenePresetId } from '../presets';
import type { SceneState } from '../state';
import { intent } from './fixtures';

function harness({ loaded = true, reducedMotion = false } = {}) {
  const f = fakeMap({ loaded });
  const effects = fakeEffects();
  let state: AccountState = { status: 'signed_out' };
  const subs = new Set<(s: AccountState) => void>();
  const account = {
    getState: () => state,
    subscribe: (fn: (s: AccountState) => void) => (subs.add(fn), () => void subs.delete(fn)),
  } as unknown as AccountStore;
  const theme = startThemeController(f.map, account, { effects });
  const frames: Array<() => void> = [];
  const ticks: Array<() => void> = [];
  const mqListeners = new Set<(e: { matches: boolean }) => void>();
  const query: MediaQueryLike = {
    matches: reducedMotion,
    addEventListener: (_, fn) => void mqListeners.add(fn),
    removeEventListener: (_, fn) => void mqListeners.delete(fn),
  };
  const scene = mountScene({ theme, account, reducedMotion: query, schedule: (fn) => frames.push(fn), defer: (fn) => ticks.push(fn) });
  let version = 0;
  const run = (q: Array<() => void>) => q.splice(0).forEach((fn) => fn());
  return {
    f,
    effects,
    scene,
    frames,
    /** One quiz answer → one SceneIntent → session. */
    answer(presets: Array<[ScenePresetId, number]>, extra = {}) {
      version++;
      return scene.session.submit('outing', version, intent(presets, { sessionVersion: version, ...extra }));
    },
    frame: () => run(frames),
    tick: () => run(ticks),
    settle() {
      run(ticks);
      run(frames);
    },
    setReducedMotion: (matches: boolean) => mqListeners.forEach((fn) => fn({ matches })),
    setAccount(next: AccountState) {
      state = next;
      subs.forEach((fn) => fn(state));
    },
    /** The live map shows exactly this compiled scene. */
    shows(s: SceneState) {
      f.expectStyle(s.palette, sceneStyleOf(s));
    },
  };
}

const compiled = (presets: Array<[ScenePresetId, number]>, context = {}) =>
  compileScene({ outing: intent(presets), capabilities: MAP_RENDERER_V1, context });

describe('neutral baseline with the always-on pin ring', () => {
  it('mounting on a fresh map changes nothing: the neutral scene is exactly the plain map', () => {
    const h = harness();
    const s = h.scene.session.getState();
    expect(s.palette).toEqual(basePalette);
    expect(s.pinEdge).toBe('two_tone');
    expect(s.darkMode).toBe(false);
    expect(h.f.counts).toMatchObject({ setPaintProperty: 0, setLight: 0, setSky: 0 });
    expect(h.f.unexpected).toEqual([]);
  });
});

describe('preset transitions on the live map', () => {
  it('neutral → amber_refuge → neon_city → noir_nocturne, each landing exactly', () => {
    const h = harness();
    for (const id of ['amber_refuge', 'neon_city', 'noir_nocturne'] as const) {
      expect(h.answer([[id, 1]])).toBe('applied');
      h.frame();
      h.shows(h.scene.session.getState());
      expect(h.scene.session.getState().palette).toEqual(compiled([[id, 1]]).palette);
    }
    expect(h.f.unexpected).toEqual([]);
  });

  it('moves the light (and pin shadows) with the scene', () => {
    const h = harness();
    h.answer([['neon_city', 1]]);
    h.frame();
    expect(h.f.light()).toMatchObject({ position: [1.4, 115, 55] }); // back_lit
    expect(h.f.cssVars['--pin-shadow-angle']).toBe('295deg');
  });
});

describe('quiz flow', () => {
  it('progressive answers deepen the scene step by step', () => {
    const h = harness();
    const distances: number[] = [];
    for (const w of [0.15, 0.3, 0.45, 0.6, 0.75]) {
      h.answer([['amber_refuge', w]]);
      h.frame();
      h.shows(h.scene.session.getState());
      const [a, b] = [hexToLab(h.scene.session.getState().palette.building3d), hexToLab(basePalette.building3d)];
      distances.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThan(distances[i - 1]);
  });

  it('undoing an answer restores the earlier scene on the map', () => {
    const h = harness();
    h.answer([['woodland_story', 0.4]]);
    h.frame();
    const before = h.scene.session.getState();
    h.answer([['woodland_story', 0.3], ['neon_city', 0.4]]);
    h.frame();
    h.answer([['woodland_story', 0.4]]); // the engine publishes undo as a new version
    h.frame();
    h.shows(before);
    expect(h.scene.session.getState().hash).toBe(before.hash);
  });

  it('a repeated identical answer does no map work', () => {
    const h = harness();
    h.answer([['retro_atlas', 0.5]]);
    h.frame();
    const counts = { ...h.f.counts };
    h.answer([['retro_atlas', 0.5]]);
    h.frame();
    expect(h.f.counts).toEqual(counts);
  });

  it('rapid successive intents cost one paint pass and land on the newest scene', () => {
    const h = harness();
    const ids: ScenePresetId[] = ['amber_refuge', 'neon_city', 'noir_nocturne', 'dream_pastel', 'sunlit_coast'];
    for (let i = 0; i < 25; i++) h.answer([[ids[i % ids.length], 0.3 + (i % 7) / 10]]);
    expect(h.scene.session.submit('outing', 3, intent([['minimal_modern', 1]], { sessionVersion: 3 }))).toBe('stale');
    expect(h.frames).toHaveLength(1);
    h.frame();
    h.shows(h.scene.session.getState());
    expect(h.scene.session.getState().sessionVersion).toBe(25);
  });
});

describe('navigation', () => {
  it('starting and ending navigation keeps the palette, lifts dim light, then restores it', () => {
    const h = harness();
    h.answer([['noir_nocturne', 1]]);
    h.frame();
    const browse = h.scene.session.getState();
    const paintCalls = h.f.counts.setPaintProperty;
    h.scene.setNavigation(true);
    h.settle();
    expect(h.f.counts.setPaintProperty).toBe(paintCalls); // palette untouched
    expect(h.f.light()).toMatchObject({ intensity: 0.28 }); // safe lighting
    expect(h.scene.session.getState().palette).toEqual(browse.palette);
    h.scene.setNavigation(false);
    h.settle();
    h.shows(browse);
    expect(h.f.light()).toMatchObject({ intensity: 0.2 });
  });

  it('switching between selected destinations does not end navigation', () => {
    const h = harness();
    h.answer([['noir_nocturne', 1]]);
    h.frame();
    h.scene.setNavigation(true);
    h.settle();
    const compiles = h.scene.session.stats().compiles;
    const counts = { ...h.f.counts };
    // main.ts showRouteTo(): cancelRoute() then a new route, in one handler.
    h.scene.setNavigation(false);
    h.scene.setNavigation(true);
    h.settle();
    expect(h.scene.session.stats().compiles).toBe(compiles);
    expect(h.f.counts).toEqual(counts);
  });

  it('MBTA route layers, camera and handlers are never touched by any scene change', () => {
    const h = harness();
    h.answer([['neon_city', 1]]);
    h.frame();
    h.scene.setNavigation(true);
    h.settle();
    h.answer([['amber_refuge', 0.8]]);
    h.frame();
    h.scene.setNavigation(false);
    h.settle();
    h.scene.session.clear();
    h.frame();
    h.f.expectStyle(basePalette); // includes route-layer equality
    expect(h.f.unexpected).toEqual([]); // no jumpTo/easeTo/flyTo/setZoom/setStyle/removeLayer/on/...
    expect(h.f.counts.off).toEqual([]);
  });
});

describe('pins on light, medium and dark grounds', () => {
  it.each([
    ['light', [['sunlit_coast', 1]]],
    ['medium', [['neon_city', 0.45]]],
    ['dark', [['noir_nocturne', 1]]],
  ] as const)('%s ground: ring-visible pins, no ground nudging, no white-edge mode', (_, presets) => {
    const h = harness();
    h.answer(presets.map(([id, w]) => [id, w]));
    h.frame();
    const s = h.scene.session.getState();
    expect(s.pinEdge).toBe('two_tone');
    expect(s.darkMode).toBe(false);
    expect(ringPasses(s.palette.land)).toBe(true);
    expect(s.diagnostics.some((d) => d.detail.startsWith('land:'))).toBe(false);
    expect(h.effects.renders.at(-1)!.darkMode).toBe(false);
  });

  it('covers genuinely different ground lightness', () => {
    const L = (p: Array<[ScenePresetId, number]>) => lightness(compiled(p).palette.land);
    expect(L([['sunlit_coast', 1]])).toBeGreaterThan(0.9);
    expect(L([['neon_city', 0.45]])).toBeGreaterThan(0.45);
    expect(L([['neon_city', 0.45]])).toBeLessThan(0.85);
    expect(L([['noir_nocturne', 1]])).toBeLessThan(0.3);
  });
});

describe('reduced motion, account taste and teardown', () => {
  it('reduced motion makes color changes near-instant, and follows the system setting live', () => {
    const h = harness({ reducedMotion: true });
    h.answer([['dream_pastel', 0.8]]);
    h.frame();
    expect((h.f.paint.get('water')!['fill-color-transition'] as { duration: number }).duration).toBeLessThanOrEqual(150);
    h.setReducedMotion(false);
    h.frame();
    expect((h.f.paint.get('water')!['fill-color-transition'] as { duration: number }).duration).toBe(800);
  });

  it('saved account taste shows through the scene until an outing scene exists', () => {
    const h = harness();
    h.setAccount({
      status: 'signed_in', user: { id: 'u', email: 'u@test.local' }, profile: { effectsEnabled: true }, events: [{ id: 1 } as never],
      taste: { strength: 0.8, profile: { tags: { cozy: 1 } } } as never,
    });
    h.frame();
    expect(h.scene.session.getState().source).toBe('account');
    h.shows(h.scene.session.getState());
    h.answer([['neon_city', 0.7]]);
    h.frame();
    expect(h.scene.session.getState().source).toBe('outing');
  });

  it('restoring the original scene: clear → plain map; destroy → plain map and account mode', () => {
    const h = harness();
    h.answer([['neon_city', 1]]);
    h.frame();
    h.scene.session.clear();
    h.frame();
    h.f.expectStyle(basePalette);
    h.answer([['amber_refuge', 1]]);
    h.frame();
    h.scene.destroy();
    h.f.expectStyle(basePalette);
    expect(h.answer([['noir_nocturne', 1]])).toBe('rejected');
  });

  it('waits for the map style to load before painting', () => {
    const h = harness({ loaded: false });
    h.answer([['neon_city', 1]]);
    h.frame();
    expect(h.f.counts.setPaintProperty).toBe(0);
    h.f.load();
    h.shows(h.scene.session.getState());
  });
});
