/**
 * World decoration engine — public entry.
 *
 * Integration (proposed; owned by the runtime integrator, not applied here):
 *
 *   // features/scene/runtime.ts, inside mountAssetRuntime, next to `models`:
 *   const decor = preview3d ? (await import('./decor')).mountRuntimeDecor(map, runtimeAssets) : null;
 *   // render(state): decor?.render(state);  stats(): decor: decor?.stats() ?? null;  destroy(): decor?.destroy();
 *
 * Until then, `attachWorldDecor()` in ./dev.ts mounts it on the live dev map.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AssetRegistry } from '../assets';
import { STAGING_CANDIDATES } from '../placement';
import layouts from '../../../../public/scene-assets/third-party/composites/layouts.v1.json';
import metrics from './data/asset-metrics.v1.json';
import type { AssetMetrics } from './catalog';
import { mountWorldDecor, type WorldDecorOptions } from './engine';

export const ASSET_METRICS = metrics.assets as Readonly<Record<string, AssetMetrics>>;
export const LAYOUT_CONTEXT: ReadonlyMap<string, string> = new Map((layouts.scenes as Array<{ id: string; context: string }>).map((s) => [s.id, s.context]));

/** Mount with the bundled manifests, measured metrics, layout contexts and the existing set-piece stage. */
export function mountRuntimeDecor(map: MapLibreMap, assets: AssetRegistry, options: Partial<WorldDecorOptions> = {}) {
  return mountWorldDecor(map, {
    assets, metrics: ASSET_METRICS, layoutContext: LAYOUT_CONTEXT, stage: STAGING_CANDIDATES, routeSources: ['transit-route'],
    ...options,
  });
}

export { mountWorldDecor } from './engine';
export type { WorldDecor, WorldDecorOptions, Exclusion } from './engine';
export { DEFAULT_CONFIG, DENSITY_PRESETS, PERFORMANCE_BUDGETS, type DecorConfig, type DecorConfigInput } from './config';
export { MOTIFS, type Motif, type MotifWeights } from './catalog';
