/**
 * Hookups between the surface renderer and the rest of the app.
 *
 * Integration (one call in the app entry, owned by the integration owner):
 *
 *   const scene = mountScene({ ..., capabilities: withSurfaceCapabilities(MAP_RENDERER_V1) });
 *   const surfaces = mountSurfaces(map);
 *   connectSurfaces(surfaces, scene.session);
 *   // in syncTrip: surfaces.setNavigation(s.navigationOpen);
 */
import type { SurfaceAppearance } from './recipe';
import type { SurfaceRenderer } from './renderer';

/** Anything that publishes the shared appearance (the Scene Session does). */
export interface AppearanceSource {
  getState(): SurfaceAppearance;
  subscribe(listener: (update: { state: SurfaceAppearance }) => void): () => void;
}

/** Follow a scene session; coalesced to one surface update per frame by the renderer's own queue. */
export function connectSurfaces(renderer: SurfaceRenderer, source: AppearanceSource): () => void {
  renderer.setScene(source.getState());
  return source.subscribe(({ state }) => renderer.setScene(state));
}
