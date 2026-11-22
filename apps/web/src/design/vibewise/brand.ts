/**
 * Vibewise wordmarks and static-markup icon hydration.
 *
 * The three wordmarks are hand-cut V3 artwork (no font underneath):
 *  - stacked: the Preferences sheet header (min. 44px wide)
 *  - horizontal: broader spaces (min. 94px wide)
 *  - compact: the VW monogram, below those sizes; never body text or a venue icon
 */
import stackedUrl from './wordmarks/stacked.svg';
import horizontalUrl from './wordmarks/horizontal.svg';
import compactUrl from './wordmarks/compact.svg';
import apertureUrl from './art/aperture.svg';
import { ICON_NAMES, vwIcon, type IconName } from './icons';

export const PRODUCT_NAME = 'Vibewise';

export type WordmarkVariant = 'stacked' | 'horizontal' | 'compact';
const WORDMARKS: Record<WordmarkVariant, { url: string; ratio: number }> = {
  // viewBox aspect ratios of the source artwork.
  stacked: { url: stackedUrl, ratio: 224 / 198 },
  horizontal: { url: horizontalUrl, ratio: 414 / 105 },
  compact: { url: compactUrl, ratio: 120 / 80 },
};

export function wordmark(variant: WordmarkVariant, { height, decorative = false }: { height: number; decorative?: boolean }): HTMLImageElement {
  const img = document.createElement('img');
  img.src = WORDMARKS[variant].url;
  img.className = `vw-wordmark vw-wordmark--${variant}`;
  img.alt = decorative ? '' : PRODUCT_NAME;
  img.height = height;
  if (WORDMARKS[variant].ratio) img.width = Math.round(height * WORDMARKS[variant].ratio);
  img.decoding = 'async';
  img.draggable = false;
  return img;
}

/** The cut-paper bloom with an open eye: introduction and completion only. */
export function apertureArt(size: number): HTMLImageElement {
  const img = document.createElement('img');
  img.src = apertureUrl;
  img.className = 'vw-aperture';
  img.alt = '';
  img.width = size;
  img.height = size;
  img.decoding = 'async';
  img.draggable = false;
  return img;
}

const isIconName = (v: string | undefined): v is IconName => !!v && (ICON_NAMES as readonly string[]).includes(v);

/**
 * Replace `<span data-vw-icon="name" data-size="22">` placeholders in static
 * markup (index.html) with V3 icons. The placeholder keeps its id/class, so
 * scripts that rotate or toggle it (the compass needle) keep working.
 */
export function hydrateIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-vw-icon]')) {
    const name = el.dataset.vwIcon;
    if (!isIconName(name) || el.firstElementChild) continue;
    el.append(vwIcon(name, { size: Number(el.dataset.size ?? 24) }));
  }
}
