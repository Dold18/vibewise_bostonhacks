/**
 * Workstream: BUILDING APPEARANCE (Chat 2), connected at City Changer integration.
 *
 * Adapter from `CityPlan.sections.buildings` to the building appearance engine
 * (features/buildingAppearance): a MapLibre custom 3D layer that re-extrudes
 * the real OpenMapTiles footprints and heights with procedural facades,
 * windows, trim and roofs. Mounted lazily on the first frame that asks for a
 * building treatment; unmounted (native extrusions restored) when none is active.
 *
 * Claims only the values `appearance.ts` really realizes. Window light is read
 * here from `building_surfaces.window_glow` (the same value the atmosphere
 * renderer reports as accents), so lit windows and bloom always agree.
 */
import type { BuildingAppearanceEngine } from '../../buildingAppearance';
import type { BuildingAppearance } from '../../buildingAppearance/contract';
import type { CityHostOptions, CityRenderer, RendererContext } from '../contracts';
import { appearanceFromScene, BUILDING_VALUES } from './appearance';

export { appearanceFromScene, BUILDING_VALUES, buildingPresence } from './appearance';

export interface BuildingRendererStats {
  readonly mounted: boolean;
  readonly updates: number;
  readonly skipped: number;
  readonly engine: ReturnType<BuildingAppearanceEngine['stats']> | null;
  readonly appearance: BuildingAppearance | null;
}

export function createBuildingRenderer(_host: CityHostOptions): CityRenderer<'buildings'> & { stats(): BuildingRendererStats } {
  let ctx: RendererContext | null = null;
  let engine: BuildingAppearanceEngine | null = null;
  let mounting: Promise<void> | null = null;
  let current: BuildingAppearance | null = null;
  let currentKey = '';
  let updates = 0;
  let skipped = 0;
  let disposed = false;

  const apply = async (next: BuildingAppearance | null, durationMs: number) => {
    const key = next ? JSON.stringify(next) : '';
    if (key === currentKey) {
      skipped++;
      return;
    }
    currentKey = key;
    current = next;
    updates++;
    const map = ctx?.map;
    if (!map) return;
    if (!next) {
      // Fade back to the neutral base on the scene clock, then hand the city back to the native extrusions
      // (unless a new look arrived meanwhile: then that look takes over the same engine).
      const fading = engine;
      if (!fading) return;
      await fading.release(durationMs);
      if (current === null && engine === fading) {
        fading.destroy();
        engine = null;
      }
      return;
    }
    if (engine) {
      await engine.update(next, durationMs);
      return;
    }
    // Code-split: the shader/geometry engine loads only when a world first restyles buildings.
    mounting ??= import('../../buildingAppearance')
      .then(({ mountBuildingAppearance }) => {
        if (disposed || !current) return;
        engine = mountBuildingAppearance(map, current, { initialFadeMs: durationMs });
      })
      .finally(() => {
        mounting = null;
      });
    await mounting;
    // A newer appearance may have arrived while the module loaded.
    const mounted = engine as BuildingAppearanceEngine | null; // assigned inside the import callback
    if (mounted && current && current !== next) await mounted.update(current, durationMs);
  };

  return {
    id: 'buildings',
    section: 'buildings',
    capabilities: { values: BUILDING_VALUES },
    init(c) {
      ctx = c;
    },
    update({ section, env, scene, transition }) {
      // Phones (low tier) get no custom WebGL layers, and a released scene is the plain map:
      // in both cases the native extrusions stay.
      const next = env.budget.customLayers > 0 && transition.reason !== 'release' ? appearanceFromScene(section, env, scene) : null;
      apply(next, transition.durationMs).catch((error) => ctx?.reportError(error));
    },
    contextRestored() {
      // The custom layer and its buffers died with the context; the re-delivered frame mounts a fresh engine.
      const dead = engine;
      engine = null;
      currentKey = '';
      try {
        dead?.destroy();
      } catch {
        /* its layer is already gone */
      }
    },
    usage: () => ({ customLayers: engine ? 1 : 0, textureMB: engine ? engine.stats().textures.length + 1 : 0 }),
    stats: () => ({ mounted: !!engine, updates, skipped, engine: engine?.stats() ?? null, appearance: current }),
    dispose() {
      disposed = true;
      engine?.destroy();
      engine = null;
    },
  };
}
