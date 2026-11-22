/**
 * The live set of city systems. Each workstream changes only its own factory's
 * module; this list (integration-owned) does not need to change when they do.
 */
import { createAtmosphereRenderer } from './atmosphere';
import { createBuildingRenderer } from './buildings';
import { createCityPlanner } from './composition';
import type { AnyCityRenderer, CityHostOptions, CityPlanner } from './contracts';
import { createDecorationRenderer } from './decorations';
import { createStreetRenderer } from './streets';

export function cityRenderers(host: CityHostOptions): AnyCityRenderer[] {
  return [createBuildingRenderer(host), createStreetRenderer(host), createDecorationRenderer(host), createAtmosphereRenderer(host)];
}

export const cityPlanner = (): CityPlanner => createCityPlanner();
