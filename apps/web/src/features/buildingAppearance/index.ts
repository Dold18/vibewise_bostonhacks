/**
 * Universal building appearance engine — public entry point.
 *
 *   const engine = mountBuildingAppearance(map, appearance);
 *   engine.update(nextAppearance);   // any composable combination
 *   engine.destroy();                // restores MapLibre's native extrusions
 *
 * While mounted, the native `building-3d*` extrusion layers are hidden and the
 * same OpenMapTiles footprints/heights are drawn by a custom layer in their
 * slot of the style (below labels, routes and DOM markers). Pitch fade and the
 * z14→z15 height ramp mirror the native layers so camera behaviour is unchanged.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { BUILDING_3D_LAYER, BUILDING_3D_LAYERS, BUILDING_3D_OPACITY } from '../../mapStyle';
import { loadAssetLibrary, rasterize, type AssetLibrary } from './assets';
import { normalizeAppearance, type BuildingAppearance, type ValidationIssue } from './contract';
import { BuildingAppearanceLayer, type RendererStats, type StagedLayers } from './layer';
import { assetRefs, hexToRgb, type LayerTable } from './uniforms';

export * from './contract';
export { assignBuilding, eligibleFacades } from './rules';

export const BUILDING_APPEARANCE_LAYER = 'building-appearance';
const LAYER_SIZE = 512;

export interface BuildingAppearanceEngine {
  /** Show `appearance` on the shared scene clock (`durationMs`; 0 = at once). The latest call wins. */
  update(appearance: BuildingAppearance, durationMs?: number): Promise<void>;
  /** Fade the restyle back to the neutral base; resolves when it no longer shows (then destroy()). */
  release(durationMs: number): Promise<void>;
  /** Resolves once the first configuration's textures are on the GPU. */
  ready: Promise<void>;
  stats(): RendererStats & { textures: string[]; missingAssets: string[]; issues: ValidationIssue[]; textureMs: number };
  destroy(): void;
}

export interface MountOptions {
  /** Mesh budget; nearest-to-centre buildings inside the padded view win. */
  maxBuildings?: number;
  /** Fraction of the view size added on each side of the built area. */
  boundsPadding?: number;
  /** The first look rises from the neutral base over this long once its mesh exists (0 = at once). */
  initialFadeMs?: number;
}

export function mountBuildingAppearance(map: MapLibreMap, initial: BuildingAppearance, options: MountOptions = {}): BuildingAppearanceEngine {
  let destroyed = false;
  let library: Promise<AssetLibrary> | null = null;
  let textures: string[] = [];
  let missingAssets: string[] = [];
  let issues: ValidationIssue[] = [];
  let textureMs = 0;
  let loadedKey = '';
  let current = initial;
  let generation = 0;

  const layer = new BuildingAppearanceLayer({
    id: BUILDING_APPEARANCE_LAYER,
    sourceId: 'openmaptiles',
    sourceLayer: 'building',
    maxBuildings: options.maxBuildings ?? 24000,
    boundsPadding: options.boundsPadding ?? 0.3,
    opacity: () => {
      const v = map.getLayer(BUILDING_3D_LAYER) ? map.getPaintProperty(BUILDING_3D_LAYER, 'fill-extrusion-opacity') : BUILDING_3D_OPACITY;
      return typeof v === 'number' ? Math.min(1, v / BUILDING_3D_OPACITY) : 1;
    },
    neutralColor: () => {
      const v = map.getLayer(BUILDING_3D_LAYER) ? map.getPaintProperty(BUILDING_3D_LAYER, 'fill-extrusion-color') : null;
      return typeof v === 'string' && v.startsWith('#') ? hexToRgb(v) : [0.92, 0.91, 0.89];
    },
  });

  const nativeVisibility = new Map<string, unknown>();
  let meshReady = false;
  const hideNative = () => {
    if (destroyed || !map.getStyle()) return;
    for (const id of BUILDING_3D_LAYERS) {
      if (!map.getLayer(id)) continue;
      if (!nativeVisibility.has(id)) nativeVisibility.set(id, map.getLayoutProperty(id, 'visibility') ?? 'visible');
      map.setLayoutProperty(id, 'visibility', 'none');
    }
  };
  // The native extrusions stay until the first restyled mesh is on the GPU: never a frame without buildings.
  layer.onFirstUpload(() => {
    meshReady = true;
    hideNative();
  });
  const install = () => {
    if (destroyed || !map.getStyle()) return;
    if (meshReady) hideNative();
    if (!map.getLayer(BUILDING_APPEARANCE_LAYER)) {
      const ids = map.getStyle().layers.map((l) => l.id);
      const last = Math.max(...BUILDING_3D_LAYERS.map((id) => ids.indexOf(id)));
      const before = last >= 0 ? ids[last + 1] : undefined;
      map.addLayer(layer, before);
    }
  };

  /** The atlas for `a`, or null when the one on the GPU already serves it. Not applied here: the layer stages it. */
  async function loadTextures(a: BuildingAppearance): Promise<(StagedLayers & { key: string }) | null> {
    const refs = assetRefs(a);
    const key = refs.join('|');
    if (key === loadedKey) return null;
    const t0 = performance.now();
    library ??= loadAssetLibrary();
    const lib = await library;
    const resolved = refs.map((r) => lib.resolve(r));
    const found = resolved.filter((r): r is NonNullable<typeof r> => !!r);
    const pixels = await rasterize(found, LAYER_SIZE);
    if (destroyed) return null;
    const white = new Uint8ClampedArray(LAYER_SIZE * LAYER_SIZE * 4).fill(255);
    const table: LayerTable = new Map();
    found.forEach((r, i) => table.set(r.ref, i + 1));
    textures = found.map((r) => r.ref);
    missingAssets = refs.filter((r) => !lib.resolve(r));
    textureMs = performance.now() - t0;
    return { pixels: [white, ...pixels], table, size: LAYER_SIZE, key };
  }

  async function update(next: BuildingAppearance, durationMs = 0) {
    const mine = ++generation;
    const n = normalizeAppearance(next);
    issues = n.issues;
    current = n.appearance;
    const target = current;
    const layers = await loadTextures(target);
    // A newer update arrived while this atlas loaded: it wins (its own atlas load stages it).
    if (destroyed || mine !== generation) return;
    if (layers) loadedKey = layers.key;
    layer.stage(target, layers, durationMs);
  }

  const onStyleLoad = () => install();
  // The style may be parsed while tiles are still streaming (isStyleLoaded() is false then).
  if (map.getLayer(BUILDING_3D_LAYER)) install();
  map.on('style.load', onStyleLoad);
  const ready = update(current, options.initialFadeMs ?? 0);

  return {
    update,
    release: (durationMs) => (destroyed ? Promise.resolve() : layer.release(durationMs)),
    ready,
    stats: () => ({ ...layer.getStats(), textures, missingAssets, issues, textureMs }),
    destroy() {
      destroyed = true;
      map.off('style.load', onStyleLoad);
      if (map.getLayer(BUILDING_APPEARANCE_LAYER)) map.removeLayer(BUILDING_APPEARANCE_LAYER);
      for (const [id, vis] of nativeVisibility) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis as 'visible' | 'none');
      nativeVisibility.clear();
    },
  };
}
