import { describe, expect, it } from 'vitest';
import type { AccountState, AccountStore } from '../../account/session';
import { MAP_RENDERER_V2 } from '../../scene/capabilities';
import { mountScene } from '../../scene/mount';
import { intent } from '../../scene/__tests__/fixtures';
import { startThemeController } from '../../vibeTheme/controller';
import { fakeAtmosphere, fakeEffects, fakeMap } from '../../vibeTheme/__tests__/fakeMap';
import { paramsFromScene, type AtmosphereSceneInput } from '../fromScene';

/** The live path: session → mount → theme controller → atmosphere renderer. */
function harness() {
  const f = fakeMap();
  const atmosphere = fakeAtmosphere();
  const account = { getState: (): AccountState => ({ status: 'signed_out' }), subscribe: () => () => {} } as unknown as AccountStore;
  const theme = startThemeController(f.map, account, { effects: fakeEffects(), atmosphere });
  const frames: Array<() => void> = [];
  const ticks: Array<() => void> = [];
  // A standalone mount that injects the atmosphere target must also declare its values (V2);
  // the live app gets them from the city engine's composed profile instead.
  const scene = mountScene({ theme, account, capabilities: MAP_RENDERER_V2, performance: 'high', schedule: (fn) => frames.push(fn), defer: (fn) => ticks.push(fn) });
  const settle = () => { ticks.splice(0).forEach((fn) => fn()); frames.splice(0).forEach((fn) => fn()); };
  return { f, atmosphere, scene, settle };
}

describe('atmosphere on the live scene path', () => {
  it('receives every compiled scene, with atmosphere, and never touches routes, camera or style', () => {
    const h = harness();
    h.scene.session.submit('outing', 1, intent([['noir_nocturne', 1]], { sessionVersion: 1 }));
    h.settle();
    const last = h.atmosphere.scenes.at(-1)!.scene as AtmosphereSceneInput;
    const p = paramsFromScene(last);
    expect(p.fogDensity).toBeGreaterThan(0);
    expect(p.vignette).toBeGreaterThan(0);
    expect(p.grain).toBeGreaterThan(0);
    expect(h.f.unexpected).toEqual([]);
  });

  it('navigation reaches the atmosphere directly, in the same tick as the compiler', () => {
    const h = harness();
    h.scene.setNavigation(true);
    h.settle();
    h.scene.setNavigation(false);
    h.settle();
    expect(h.atmosphere.navigation).toEqual(['route', 'browse']);
  });
});
