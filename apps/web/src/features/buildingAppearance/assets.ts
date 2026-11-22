/**
 * Resolves material references against the existing scene-asset library and
 * rasterises them into square layers for a WebGL texture array.
 *
 * - v2 atlas cells (`brick_masonry.running_bond.warm`) come from
 *   /scene-assets/v2/manifest.json (`atlas` + pixel `rect`).
 * - v1 single SVGs (`stone-blocks`) come from /scene-assets/v1/manifest.json.
 */

export interface ResolvedAsset {
  ref: string;
  url: string;
  /** Source rect in the SVG's own pixel space. */
  rect: [number, number, number, number];
  /** SVG intrinsic size. */
  size: [number, number];
}

interface V2Manifest {
  assets: { id: string; atlas: string; rect: [number, number, number, number] }[];
}
interface V1Manifest {
  assets: { id: string; file: string; size?: [number, number] }[];
}

export interface AssetLibrary {
  resolve(ref: string): ResolvedAsset | null;
  ids(): string[];
}

export function createAssetLibrary(v2: V2Manifest | null, v1: V1Manifest | null, root: string): AssetLibrary {
  const table = new Map<string, ResolvedAsset>();
  for (const a of v2?.assets ?? []) {
    table.set(a.id, { ref: a.id, url: `${root}v2/${a.atlas}`, rect: a.rect, size: [1024, 1024] });
  }
  for (const a of v1?.assets ?? []) {
    const size = a.size ?? [256, 256];
    table.set(a.id, { ref: a.id, url: `${root}v1/${a.file}`, rect: [0, 0, size[0], size[1]], size });
  }
  return { resolve: (ref) => table.get(ref) ?? null, ids: () => [...table.keys()] };
}

export async function loadAssetLibrary(root = `${import.meta.env.BASE_URL}scene-assets/`): Promise<AssetLibrary> {
  const get = async <T>(url: string): Promise<T | null> => {
    try {
      const r = await fetch(url);
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [v2, v1] = await Promise.all([get<V2Manifest>(`${root}v2/manifest.json`), get<V1Manifest>(`${root}v1/manifest.json`)]);
  return createAssetLibrary(v2, v1, root);
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string, size: [number, number], scale: number): Promise<HTMLImageElement> {
  const key = `${url}@${scale}`;
  let p = imageCache.get(key);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image(size[0] * scale, size[1] * scale);
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
    imageCache.set(key, p);
    p.catch(() => imageCache.delete(key));
  }
  return p;
}

/**
 * Rasterise resolved assets into `layerSize`² RGBA pixel arrays. Each SVG is
 * drawn at a resolution where its source cell maps 1:1 onto a layer, so a
 * 256-px atlas cell becomes a crisp 512-px texture layer.
 */
export async function rasterize(assets: readonly ResolvedAsset[], layerSize = 512): Promise<Uint8ClampedArray[]> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = layerSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  const out: Uint8ClampedArray[] = [];
  for (const a of assets) {
    const [x, y, w] = a.rect;
    const scale = layerSize / w;
    const img = await loadImage(a.url, a.size, scale);
    ctx.clearRect(0, 0, layerSize, layerSize);
    // Draw the whole SVG scaled so the cell rect fills the canvas (vector-sharp).
    ctx.drawImage(img, -x * scale, -y * scale, a.size[0] * scale, a.size[1] * scale);
    out.push(ctx.getImageData(0, 0, layerSize, layerSize).data);
  }
  return out;
}
