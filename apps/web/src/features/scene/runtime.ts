import type { Map as MapLibreMap } from 'maplibre-gl';
import { MAP_RENDERER_V1, type CapabilityProfile, type SceneFeature } from './capabilities';
import { ATMOSPHERE, mountAtmosphere } from './atmosphere';
import { MATERIALS, mountMaterials } from './materials';
import { runtimeAssets } from './registry';
import { createSvgCache } from './svg';
import type { SceneState } from './state';

export function assetCapabilities(preview3d: boolean): CapabilityProfile {
  return {
    id: preview3d ? 'map-assets-v2-dev-3d' : 'map-assets-v2',
    values: new Map([...MAP_RENDERER_V1.values, ...Object.entries({ ...ATMOSPHERE, ...MATERIALS }).map(([key, variants]) => [key, new Set(Object.keys(variants))] as const)]),
    features: new Set<SceneFeature>([...MAP_RENDERER_V1.features, 'svg_textures', ...(preview3d ? ['set_piece_3d' as const] : [])]),
  };
}

export async function mountAssetRuntime(map: MapLibreMap, preview3d: boolean) {
  const svg = createSvgCache(runtimeAssets);
  const atmosphere = mountAtmosphere(map.getCanvasContainer(), runtimeAssets);
  const materials = mountMaterials(map, svg);
  // No Three.js payload in ordinary production sessions, no models fetched until a late-stage scene.
  const models = preview3d ? (await import('./models')).mountModels(map, runtimeAssets) : null;
  const moving = () => atmosphere.setMoving(true), still = () => atmosphere.setMoving(false);
  map.on('movestart', moving); map.on('moveend', still);
  return {
    render(state: SceneState) { atmosphere.render(state); materials.render(state); models?.render(state); },
    stats: () => ({ atmosphere: atmosphere.stats(), materials: materials.stats(), models: models?.stats() ?? null }),
    destroy() { map.off('movestart', moving); map.off('moveend', still); atmosphere.destroy(); materials.destroy(); models?.destroy(); svg.clear(); },
  };
}
