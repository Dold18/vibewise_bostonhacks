/**
 * The scene-asset SVGs the atmosphere renderer samples, by verified manifest
 * ID (public/scene-assets/v1 and v2 manifests; a test checks every entry).
 *
 * Textures are used as *detail maps*: the renderer reads their luminance
 * around its mean, so the asset supplies the texture and the scene supplies
 * the color. v2 atlas cells are cropped and tiled with mirrored repeat to
 * hide cell seams; v1 noise tiles use stitched turbulence and repeat cleanly.
 */
import type { ScalarKey } from './params';

export type TextureSlot = 'grain' | 'paper' | 'mottle' | 'watercolor' | 'halftone' | 'scanlines' | 'grid' | 'scratches';

export interface TextureAsset {
  readonly slot: TextureSlot;
  /** Manifest asset ID. */
  readonly assetId: string;
  /** Path under public/ (an SVG file or a v2 atlas). */
  readonly file: string;
  /** Atlas cell [x, y, w, h] in atlas pixels, for v2 assets. */
  readonly rect?: readonly [number, number, number, number];
  /** Atlas size in pixels (v2 atlases are 1024 × 1024). */
  readonly atlasSize?: number;
  readonly wrap: 'repeat' | 'mirror';
  /**
   * `detail`: luminance over white, used around its mean (grain, fibres, washes).
   * `mask`: alpha coverage normalized to 0..1 (dots, lines, scratches), colored by params.
   */
  readonly mode: 'detail' | 'mask';
  /** Raster size of the tile. */
  readonly size: number;
  /** The params that need this texture; it is loaded only when one is on. */
  readonly usedBy: readonly ScalarKey[];
}

export const TEXTURE_ASSETS: readonly TextureAsset[] = [
  { slot: 'grain', assetId: 'film-grain', file: 'scene-assets/v1/film-grain.svg', wrap: 'repeat', mode: 'detail', size: 256, usedBy: ['grain'] },
  { slot: 'paper', assetId: 'paper-grain', file: 'scene-assets/v1/paper-grain.svg', wrap: 'repeat', mode: 'detail', size: 256, usedBy: ['paper'] },
  { slot: 'mottle', assetId: 'art_print.antique_paper.warm', file: 'scene-assets/v2/art_print.svg', rect: [0, 768, 256, 256], atlasSize: 1024, wrap: 'mirror', mode: 'detail', size: 256, usedBy: ['paper'] },
  { slot: 'watercolor', assetId: 'art_print.watercolor_wash.cool', file: 'scene-assets/v2/art_print.svg', rect: [256, 0, 256, 256], atlasSize: 1024, wrap: 'mirror', mode: 'detail', size: 256, usedBy: ['watercolor'] },
  { slot: 'halftone', assetId: 'halftone', file: 'scene-assets/v1/halftone.svg', wrap: 'repeat', mode: 'mask', size: 256, usedBy: ['halftone'] },
  { slot: 'scanlines', assetId: 'scanlines', file: 'scene-assets/v1/scanlines.svg', wrap: 'repeat', mode: 'mask', size: 256, usedBy: ['scanlines'] },
  { slot: 'grid', assetId: 'blueprint-grid', file: 'scene-assets/v1/blueprint-grid.svg', wrap: 'repeat', mode: 'mask', size: 256, usedBy: ['grid'] },
  { slot: 'scratches', assetId: 'film-scratches', file: 'scene-assets/v1/film-scratches.svg', wrap: 'repeat', mode: 'mask', size: 256, usedBy: ['scratches', 'leak'] },
];

export const TEXTURE_SLOTS: readonly TextureSlot[] = TEXTURE_ASSETS.map((a) => a.slot);
