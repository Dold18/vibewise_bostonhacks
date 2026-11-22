/**
 * Lazy SVG-asset textures. An asset is fetched and rasterized only when an
 * effect that uses it turns on, uploaded once, and kept until the atmosphere
 * layers are removed. GL uploads happen inside a layer's `render` (MapLibre
 * resets its GL state cache right after), never from an async callback.
 */
import { TEXTURE_ASSETS, type TextureAsset, type TextureSlot } from './assets';
import type { LayerStats } from './frame';

export interface Raster {
  readonly pixels: ImageData;
  /** Mean of the channel the shader reads (detail: luminance over white; mask: 1 at full coverage). */
  readonly mean: number;
}

type Entry =
  | { state: 'loading' }
  | { state: 'raster'; raster: Raster }
  | { state: 'ready'; tex: WebGLTexture; mean: number }
  | { state: 'failed' };

const atlasCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = atlasCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`[atmosphere] could not load ${url}`));
      img.src = url;
    });
    atlasCache.set(url, p);
  }
  return p;
}

/** Rasterize one asset tile into the channel layout the grade shader expects. */
export async function rasterize(asset: TextureAsset, baseUrl: string): Promise<Raster> {
  const img = await loadImage(`${baseUrl}${asset.file}`);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = asset.size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (asset.mode === 'detail') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, asset.size, asset.size);
  }
  if (asset.rect) {
    const [x, y, w, h] = asset.rect;
    const k = (img.naturalWidth || asset.atlasSize || 1024) / (asset.atlasSize ?? 1024);
    ctx.drawImage(img, x * k, y * k, w * k, h * k, 0, 0, asset.size, asset.size);
  } else {
    ctx.drawImage(img, 0, 0, asset.size, asset.size);
  }
  const data = ctx.getImageData(0, 0, asset.size, asset.size);
  const px = data.data;
  let sum = 0;
  if (asset.mode === 'detail') {
    for (let i = 0; i < px.length; i += 4) sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
  } else {
    let max = 1;
    for (let i = 3; i < px.length; i += 4) max = Math.max(max, px[i]);
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.round((px[i + 3] / max) * 255);
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
      sum += v / 255;
    }
  }
  return { pixels: data, mean: sum / (px.length / 4) };
}

export interface TextureStore {
  /** Ask for a slot; resolves in the background, then `onReady` asks for a repaint. */
  request(slot: TextureSlot): void;
  /** Upload any rasters that arrived. Call only from a layer's render(). */
  flushUploads(gl: WebGL2RenderingContext): void;
  /** Texture and mean for a slot, or a neutral 1×1 texture while it loads. */
  get(gl: WebGL2RenderingContext, slot: TextureSlot): { tex: WebGLTexture; mean: number; ready: boolean };
  dispose(gl: WebGL2RenderingContext): void;
}

export function createTextureStore(baseUrl: string, stats: LayerStats, onReady: () => void): TextureStore {
  const entries = new Map<TextureSlot, Entry>();
  const neutral = new Map<'detail' | 'mask', WebGLTexture>();
  const bySlot = new Map(TEXTURE_ASSETS.map((a) => [a.slot, a]));

  const neutralTex = (gl: WebGL2RenderingContext, mode: 'detail' | 'mask') => {
    let t = neutral.get(mode);
    if (!t) {
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      // detail: flat white (zero detail around a mean of 1); mask: no coverage.
      const v = mode === 'detail' ? 255 : 0;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([v, v, v, 255]));
      neutral.set(mode, t);
    }
    return t;
  };

  return {
    request(slot) {
      if (entries.has(slot)) return;
      const asset = bySlot.get(slot);
      if (!asset) return;
      entries.set(slot, { state: 'loading' });
      rasterize(asset, baseUrl).then(
        (raster) => {
          if (entries.get(slot)?.state !== 'loading') return;
          entries.set(slot, { state: 'raster', raster });
          onReady();
        },
        (error) => {
          entries.set(slot, { state: 'failed' });
          console.warn(String(error));
        },
      );
    },
    flushUploads(gl) {
      for (const [slot, e] of entries) {
        if (e.state !== 'raster') continue;
        const asset = bySlot.get(slot)!;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, e.raster.pixels);
        gl.generateMipmap(gl.TEXTURE_2D);
        const wrap = asset.wrap === 'mirror' ? gl.MIRRORED_REPEAT : gl.REPEAT;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        entries.set(slot, { state: 'ready', tex, mean: e.raster.mean });
        stats.textureBytes += Math.round(asset.size * asset.size * 4 * 1.33);
        stats.allocations++;
        stats.texturesLoaded.push(asset.assetId);
      }
    },
    get(gl, slot) {
      const e = entries.get(slot);
      if (e?.state === 'ready') return { tex: e.tex, mean: e.mean, ready: true };
      const mode = bySlot.get(slot)?.mode ?? 'detail';
      return { tex: neutralTex(gl, mode), mean: mode === 'detail' ? 1 : 0, ready: false };
    },
    dispose(gl) {
      for (const [slot, e] of entries) {
        if (e.state !== 'ready') continue;
        gl.deleteTexture(e.tex);
        const asset = bySlot.get(slot)!;
        stats.textureBytes -= Math.round(asset.size * asset.size * 4 * 1.33);
      }
      for (const t of neutral.values()) gl.deleteTexture(t);
      neutral.clear();
      entries.clear();
      stats.texturesLoaded.length = 0;
    },
  };
}
