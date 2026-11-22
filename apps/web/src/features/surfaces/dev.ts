/**
 * Dev/QA bridge: drive the surface renderer on the **live** map before the
 * app entry is wired (the entry point is owned by integration). Loaded from
 * the browser console in a Vite dev build:
 *
 *   const qa = (await import('/src/features/surfaces/dev.ts')).attachSurfaceQa(window.vibentaScene);
 *   qa.preset('noir_nocturne');            // live palette (real session) + surfaces (same intent)
 *   qa.material('cobbles'); qa.wear(0.9);  // QA overrides
 *   qa.stats();
 *
 * `preset/describe/submit` send the intent to the real Scene Session (so
 * palette, light and sky change exactly as in the app) and compile the same
 * intent with the surface capabilities for the surface renderer. Once the
 * entry point passes `withSurfaceCapabilities` and calls `connectSurfaces`,
 * this mirror is unnecessary.
 */
import { compileScene, MAP_RENDERER_V1, type ScenePresetId } from '../scene';
import { withSurfaceCapabilities } from './capabilities';
import { loadGrains } from './grains';
import type { RoadMaterial, SurfaceOverrides, WalkMaterial, GroundMaterial, GreenMaterial } from './recipe';
import { mountSurfaces, type SurfaceMap } from './renderer';

interface SceneDevHookLike {
  readonly map: unknown;
  submit(intent: Record<string, unknown>): unknown;
  clear(): void;
  navigation(mode: boolean | 'route' | 'focus'): void;
}

export function attachSurfaceQa(hook: SceneDevHookLike) {
  const map = hook.map as SurfaceMap;
  const surfaces = mountSurfaces(map, { onError: (e) => console.error('[surfaces]', e) });
  const capabilities = withSurfaceCapabilities(MAP_RENDERER_V1);
  let overrides: SurfaceOverrides = {};
  let version = 0;
  void loadGrains('/scene-assets', (e) => console.warn('[surfaces] grain', e)).then((g) => surfaces.setGrains(g));

  const submit = (intent: Record<string, unknown>) => {
    hook.submit(intent);
    const outing = { schemaVersion: '1.0.0', presets: [], descriptors: [], overrides: [], ...intent, sessionVersion: ++version };
    const state = compileScene({ outing: outing as never, capabilities });
    surfaces.setScene(state);
    return state;
  };
  const override = (o: SurfaceOverrides) => {
    overrides = { ...overrides, ...o };
    surfaces.setOverrides(overrides);
    return surfaces.recipe();
  };

  return {
    surfaces,
    preset(idOrMix: ScenePresetId | Array<[ScenePresetId, number]>, weight = 1) {
      const mix = typeof idOrMix === 'string' ? [[idOrMix, weight] as [ScenePresetId, number]] : idOrMix;
      return submit({ presets: mix.map(([id, w]) => ({ id, weight: w })) });
    },
    describe: (...descriptors: string[]) => submit({ descriptors }),
    /** e.g. `override('roads_and_ground.street_material', 'cobblestone_illustration')`. */
    override: (key: string, value: string, presets: Array<[ScenePresetId, number]> = []) =>
      submit({ presets: presets.map(([id, w]) => ({ id, weight: w })), overrides: [{ key, value, strength: 1 }] }),
    submit,
    material: (m: RoadMaterial | undefined) => override({ roadMaterial: m }),
    walk: (m: WalkMaterial | undefined) => override({ walkMaterial: m }),
    ground: (m: GroundMaterial | undefined) => override({ groundMaterial: m }),
    green: (m: GreenMaterial | undefined) => override({ greenMaterial: m }),
    wear: (w: number | undefined) => override({ wear: w }),
    wet: (w: number | undefined) => override({ wet: w }),
    scale: (s: number | undefined) => override({ scale: s }),
    intensity: (k: number | undefined) => override({ intensity: k }),
    resetOverrides: () => {
      overrides = {};
      surfaces.setOverrides({});
      return surfaces.recipe();
    },
    navigation(mode: boolean | 'route' | 'focus') {
      hook.navigation(mode);
      surfaces.setNavigation(mode === true ? 'route' : mode === false ? 'browse' : mode);
    },
    clear() {
      hook.clear();
      surfaces.setScene(null);
    },
    recipe: () => surfaces.recipe(),
    stats: () => surfaces.stats(),
    flush: () => surfaces.flush(),
    destroy: () => surfaces.destroy(),
  };
}
