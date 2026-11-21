import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

const MAX_SIDE_PX = 800;
const MIN_SIDE_PX = 400;
const WEBP_QUALITY = 75;

export type ProcessedImage =
  | { ok: true; webp: Uint8Array; width: number; height: number }
  | { ok: false; reason: 'too_small' | 'not_image' };

/** Object path in the place-photos bucket: stable per (place, source URL). */
export function storagePathFor(restaurantId: number, url: string): string {
  return `pipeline/${restaurantId}/${createHash('sha256').update(url).digest('hex').slice(0, 16)}.webp`;
}

/** Resize to at most 800 px on the longest side (never upscaled), WebP q75, metadata stripped. */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { failOn: 'error' }).metadata();
  } catch {
    return { ok: false, reason: 'not_image' };
  }
  if (!meta.width || !meta.height) return { ok: false, reason: 'not_image' };
  // The short side is the same before and after EXIF rotation.
  if (Math.min(meta.width, meta.height) < MIN_SIDE_PX) return { ok: false, reason: 'too_small' };
  try {
    const { data, info } = await sharp(bytes, { failOn: 'error' })
      .rotate() // apply EXIF orientation; output carries no metadata
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, webp: new Uint8Array(data), width: info.width, height: info.height };
  } catch {
    return { ok: false, reason: 'not_image' };
  }
}
