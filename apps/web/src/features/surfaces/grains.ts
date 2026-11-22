/**
 * Micro-grain from the repository's own SVG material library
 * (`public/scene-assets/v1/*.svg` tiles and `v2/*.svg` 4×4 atlases).
 *
 * Each asset is rasterized once to 256×256 and reduced to signed luminance
 * detail (−1..1). Textures multiply it in at a small amplitude, so the real
 * illustrated grain (asphalt grit, concrete pores, paper fibre, grass, moss,
 * stone) shows through the procedural structure in any palette. Browser only.
 */
import { GRAIN_FOR, type GrainMap } from './textures';

const SIZE = 256;

interface ManifestCell {
  readonly id: string;
  readonly atlas: string;
  readonly rect: readonly [number, number, number, number];
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** Luminance → zero-mean detail scaled so ±2.5σ maps to ±1. */
export function detailFromRgba(data: Uint8ClampedArray, size = SIZE): GrainMap {
  const n = size * size;
  const lum = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    lum[i] = l;
    mean += l;
  }
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (lum[i] - mean) ** 2;
  const sd = Math.sqrt(variance / n) || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, (lum[i] - mean) / (2.5 * sd)));
  return { size, data: out };
}

/** Load every grain referenced by GRAIN_FOR. Missing assets are skipped (textures stay procedural). */
export async function loadGrains(base = '/scene-assets', onError?: (e: unknown) => void): Promise<Map<string, GrainMap>> {
  const ids = [...new Set(Object.values(GRAIN_FOR))];
  const out = new Map<string, GrainMap>();
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return out;

  let cells: Map<string, ManifestCell> | null = null;
  const atlases = new Map<string, Promise<HTMLImageElement>>();
  for (const id of ids) {
    try {
      const [set, name] = id.split('/');
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (set === 'v1') {
        ctx.drawImage(await loadImage(`${base}/v1/${name}.svg`), 0, 0, SIZE, SIZE);
      } else {
        if (!cells) {
          const manifest = (await (await fetch(`${base}/v2/manifest.json`)).json()) as { assets: ManifestCell[] };
          cells = new Map(manifest.assets.map((a) => [a.id, a]));
        }
        const cell = cells.get(name);
        if (!cell) continue;
        if (!atlases.has(cell.atlas)) atlases.set(cell.atlas, loadImage(`${base}/v2/${cell.atlas}`));
        const atlas = await atlases.get(cell.atlas)!;
        const [x, y, w, h] = cell.rect;
        ctx.drawImage(atlas, x, y, w, h, 0, 0, SIZE, SIZE);
      }
      out.set(id, detailFromRgba(ctx.getImageData(0, 0, SIZE, SIZE).data));
    } catch (e) {
      onError?.(e);
    }
  }
  return out;
}
