/**
 * Workstream: STREET AND TERRAIN APPEARANCE (Chat 3), connected at City Changer integration.
 *
 * Adapter from `CityPlan.sections.streets` to the world surface renderer
 * (features/surfaces): procedural street, sidewalk, plaza, ground, park and
 * woodland materials painted into fixed pattern slots on layers that copy the
 * base road filters and widths, so the real street network is never altered.
 *
 * The surface renderer infers materials from the whole scene (wall palette,
 * grade, sky…) and honours explicit street values; it receives the engine's
 * policy-applied scene view, and the engine's navigation mode, for which it has
 * its own documented legibility policy (calmer textures, lamps and glows off).
 * Water keys stay with the legacy SVG renderer (not claimed here).
 */
import type { GrainSet, SurfaceRenderer } from '../../surfaces';
import { surfaceValues } from '../../surfaces/capabilities';
import { SURFACE_LAYER_IDS } from '../../surfaces/layers';
import type { CityHostOptions, CityRenderer } from '../contracts';
import { sectionOf } from '../routing';

/** Every surface key/value the street renderer draws (surfaces/capabilities.ts), as routed to streets. */
export const STREET_VALUES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [...surfaceValues()].filter(([key]) => sectionOf(key) === 'streets').map(([key, values]) => [key, [...values]]),
);

export function createStreetRenderer(_host: CityHostOptions): CityRenderer<'streets'> & { surfaces(): SurfaceRenderer | null } {
  let surfaces: SurfaceRenderer | null = null;
  let grains: GrainSet | null = null;
  let disposed = false;

  return {
    id: 'streets',
    section: 'streets',
    capabilities: { values: STREET_VALUES },
    async init(c) {
      if (!c.map) return;
      const { mountSurfaces, loadGrains } = await import('../../surfaces');
      if (disposed) return;
      surfaces = mountSurfaces(c.map as never, { onError: (e) => c.reportError(e) });
      // Micro-grain from real SVG assets; textures stay fully procedural if this fails.
      loadGrains()
        .then((g) => {
          grains = g;
          if (!disposed) surfaces?.setGrains(g);
        })
        .catch((e) => c.reportError(e));
    },
    update({ env, scene, transition }) {
      if (!surfaces) return;
      surfaces.setNavigation(env.mode.navigation);
      // Released scene or materials toggled off: the plain map (every layer fades out).
      // Otherwise the renderer infers ground materials from the whole scene, even when no
      // explicit street value is active (its presence follows the strongest scene value).
      const off = transition.reason === 'release' || scene.context?.materialsEnabled === false;
      // One clock: textures dip and swap on the delivered transition (reduced motion: short or instant).
      surfaces.setScene(off ? null : scene, { transitionMs: transition.durationMs });
    },
    usage: () => ({ styleLayers: surfaces ? SURFACE_LAYER_IDS.length : 0, textureMB: surfaces ? (grains ? 6 : 5) : 0 }),
    surfaces: () => surfaces,
    dispose() {
      disposed = true;
      surfaces?.destroy();
      surfaces = null;
    },
  };
}
