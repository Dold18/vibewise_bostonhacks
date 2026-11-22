/**
 * z14 vector tiles for placement. Uses the basemap source's own tile URLs, so
 * requests are normally browser-cache hits for tiles MapLibre already loaded.
 * Decoded geometry is cached (LRU) and concurrent requests are deduplicated.
 */
import { buildTileGeometry, DECOR_SOURCE_LAYERS, SOURCE_ZOOM, tileKey, type TileGeometry, type TileId } from './geometry';
import { decodeMvt } from './mvt';

export interface TileSource {
  get(tile: TileId): Promise<TileGeometry | null>;
  stats(): { cached: number; requests: number; failures: number };
  destroy(): void;
}

export interface TileSourceOptions {
  /** Resolves the `{z}/{x}/{y}` tile URL template (e.g. from the map's vector source). */
  readonly template: () => Promise<string | null>;
  readonly fetcher?: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
  readonly maxTiles?: number;
}

export function createTileSource(options: TileSourceOptions): TileSource {
  const cache = new Map<string, Promise<TileGeometry | null>>();
  const controller = new AbortController();
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const max = options.maxTiles ?? 16;
  let requests = 0, failures = 0, template: Promise<string | null> | null = null;
  return {
    get(tile) {
      if (tile.z !== SOURCE_ZOOM) return Promise.reject(new Error(`decor tiles are z${SOURCE_ZOOM}`));
      const key = tileKey(tile);
      const hit = cache.get(key);
      if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // LRU touch
      const promise = (async () => {
        template ??= options.template();
        const url = await template;
        if (!url || controller.signal.aborted) return null;
        requests++;
        const response = await fetcher(url.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y)), { signal: controller.signal });
        if (!response.ok) throw new Error(`tile ${key} HTTP error`);
        return buildTileGeometry(tile, decodeMvt(await response.arrayBuffer(), DECOR_SOURCE_LAYERS));
      })().catch((error) => {
        failures++;
        if (cache.get(key) === promise) cache.delete(key);
        if (!controller.signal.aborted) console.warn('[decor] tile unavailable', key, error);
        return null;
      });
      cache.set(key, promise);
      while (cache.size > max) cache.delete(cache.keys().next().value!);
      return promise;
    },
    stats: () => ({ cached: cache.size, requests, failures }),
    destroy() { controller.abort(); cache.clear(); },
  };
}
