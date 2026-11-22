/** Shared test helpers: real manifests from public/scene-assets and intent builders. */
import { readFileSync } from 'node:fs';
import { buildAssetRegistry } from '../assets';
import type { ScenePresetId } from '../presets';

const assetRoot = new URL('../../../../public/scene-assets/', import.meta.url);
export const readJson = (rel: string, root: URL = assetRoot): unknown => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

export function realManifests() {
  return {
    kaykit: readJson('third-party/kaykit/manifest.v1.json'),
    modelibr: readJson('third-party/modelibr/manifest.v1.json'),
    svgV1: readJson('v1/manifest.json'),
    svgV2: readJson('v2/manifest.json'),
    layouts: readJson('third-party/composites/layouts.v1.json'),
    requirementsMap: readJson('v1/requirements-map.v1.json'),
  };
}

export const realRegistry = () => buildAssetRegistry(realManifests());

export const docsCatalog = () => readJson('docs/scene/scene-effect-catalog.v1.json', new URL('../../../../../../', import.meta.url));

export function intent(
  presets: Array<[ScenePresetId, number]> = [],
  extra: { sessionVersion?: number; descriptors?: string[]; overrides?: Array<{ key: string; value: string; intensity?: number }> } = {},
) {
  return {
    schemaVersion: '1.0.0',
    sessionVersion: extra.sessionVersion ?? 1,
    presets: presets.map(([id, weight]) => ({ id, weight })),
    descriptors: extra.descriptors ?? [],
    overrides: extra.overrides ?? [],
  };
}

/** The worked example from docs/SCENE_COMPOSER_DESIGN.md §2. */
export const DESIGN_EXAMPLE = {
  schemaVersion: '1.0.0',
  sessionVersion: 7,
  presets: [
    { id: 'noir_nocturne', weight: 0.48 },
    { id: 'neon_city', weight: 0.32 },
    { id: 'amber_refuge', weight: 0.2 },
  ],
  descriptors: ['moody', 'rain-lit', 'intimate', 'cinematic'],
  overrides: [
    { key: 'sky_and_horizon.sky_mode', value: 'purple_twilight' },
    { key: 'lighting_and_shadows.light_color', value: 'amber', intensity: 0.55 },
    { key: 'roads_and_ground.wet_sheen', value: 'subtle', intensity: 0.4 },
    { key: 'air_and_atmosphere.fog_volume', value: 'whisper', intensity: 0.28 },
    { key: 'marker_recommendations.pin_glow', value: 'warm_halo' },
  ],
};
