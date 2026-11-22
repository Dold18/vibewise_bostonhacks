/**
 * Workstream: ATMOSPHERE AND VISUAL EFFECTS (Chat 5), connected at City Changer integration.
 *
 * Adapter from `CityPlan.sections.atmosphere` to the atmosphere renderer
 * (features/atmosphere): world-space height fog, rain/snow, particles, and a
 * screen grade (haze, print/film, grain, vignette, bloom, shafts) as two
 * MapLibre custom layers inserted below routes, the focus mask and every symbol
 * layer. The legacy DOM overlays keep drawing only keys this does not claim.
 *
 * Claims exactly the values the renderer realizes (`ATMOSPHERE_VALUES`), minus
 * keys owned elsewhere: `building_surfaces.window_glow` (the building renderer
 * draws windows) and base-theme keys such as `sky_and_horizon.horizon_glow`,
 * which it still reads from the scene view.
 */
import type { AtmosphereRenderer } from '../../atmosphere';
import { ATMOSPHERE_VALUES } from '../../atmosphere/fromScene';
import type { CityHostOptions, CityRenderer } from '../contracts';
import { sectionOf } from '../routing';

export const ATMOSPHERE_CLAIMS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(ATMOSPHERE_VALUES).filter(([key]) => sectionOf(key) === 'atmosphere'),
);

export function createAtmosphereRenderer(_host: CityHostOptions): CityRenderer<'atmosphere'> & { renderer(): AtmosphereRenderer | null } {
  let atmosphere: AtmosphereRenderer | null = null;
  let remount: (() => AtmosphereRenderer) | null = null;
  let disposed = false;

  return {
    id: 'atmosphere',
    section: 'atmosphere',
    capabilities: { values: ATMOSPHERE_CLAIMS },
    async init(c) {
      if (!c.map) return;
      const { mountAtmosphere } = await import('../../atmosphere');
      if (disposed) return;
      // Lazy: touches the map (layers, buffers, textures) only once a scene asks for atmosphere.
      const map = c.map;
      remount = () => mountAtmosphere(map, { devGlobal: import.meta.env?.DEV === true });
      atmosphere = remount();
    },
    contextRestored() {
      // Its layers and GPU buffers died with the context; the re-delivered frame sets the scene again.
      if (!atmosphere || !remount || disposed) return;
      try {
        atmosphere.destroy();
      } catch {
        /* its layers are already gone */
      }
      atmosphere = remount();
    },
    update({ env, scene, transition }) {
      if (!atmosphere) return;
      // Second guard beside the compiler's navigation rule and the engine policy.
      atmosphere.setNavigation(env.mode.navigation);
      // Phones (low tier) get no custom WebGL layers: the atmosphere fades out and removes its layers.
      const off = transition.reason === 'release' || scene.context?.atmosphereEnabled === false || env.budget.customLayers <= 0;
      atmosphere.setScene(off ? null : scene, { transitionMs: transition.durationMs });
    },
    usage: () => {
      if (!atmosphere) return {};
      const s = atmosphere.stats();
      return { customLayers: s.layers ? 2 : 0, textureMB: Math.round((s.gpuBytes.textures / (1024 * 1024)) * 10) / 10 };
    },
    renderer: () => atmosphere,
    dispose() {
      disposed = true;
      atmosphere?.destroy();
      atmosphere = null;
    },
  };
}
