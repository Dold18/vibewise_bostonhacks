/**
 * Asset IDs → manifest-backed files. The registry is built from the manifests
 * under public/scene-assets (features/scene/registry.ts); this is the only way
 * a city plan or renderer turns an ID into a URL.
 */
import type { AssetRegistry } from '../scene/assets';
import type { SceneKey } from '../scene/catalog';
import { createSvgCache } from '../scene/svg';
import type { AssetRef, AssetResolver } from './contracts';

export interface AssetResolverOptions {
  /** Injected for tests and headless stages; defaults to the shared SVG decode cache (needs a DOM). */
  readonly loadImage?: (ref: AssetRef) => Promise<ImageData>;
}

export function createAssetResolver(registry: AssetRegistry, options: AssetResolverOptions = {}): AssetResolver & { clear(): void } {
  const refs = new Map<string, AssetRef | null>();
  let svg: ReturnType<typeof createSvgCache> | null = null;

  const resolve = (id: string): AssetRef | null => {
    if (refs.has(id)) return refs.get(id)!;
    const kind = registry.svg.has(id) ? 'svg' : registry.models.has(id) ? 'model' : null;
    const source = registry.sources?.get(id);
    const ref: AssetRef | null =
      kind && source && source.uri.startsWith('/scene-assets/') && !source.uri.includes('..')
        ? Object.freeze(source.rect ? { id, kind, uri: source.uri, rect: Object.freeze([...source.rect]) } : { id, kind, uri: source.uri })
        : null;
    refs.set(id, ref);
    return ref;
  };

  const many = (ids: Iterable<string>) => [...ids].flatMap((id) => resolve(id) ?? []);

  return {
    resolve,
    texturesFor: (key: SceneKey) => many(registry.texturesByKey.get(key) ?? []),
    modelsTagged(tags) {
      const ids = [...(registry.modelTags ?? new Map<string, readonly string[]>())]
        .filter(([, t]) => tags.every((tag) => t.includes(tag)))
        .map(([id]) => id)
        .sort();
      return many(ids);
    },
    loadImage(ref) {
      if (resolve(ref.id)?.kind !== 'svg') return Promise.reject(new Error(`Not a manifest SVG: ${ref.id}`));
      if (options.loadImage) return options.loadImage(ref);
      svg ??= createSvgCache(registry);
      return svg.load(ref.id);
    },
    clear() {
      svg?.clear();
    },
  };
}
