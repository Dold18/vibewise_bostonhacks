/**
 * Vibewise V3 icon family (identity exploration commit e4588f4).
 *
 * The 80 SVG files in ./icons are copied unchanged from the approved V3
 * gallery: 40 actions, each with a detailed master (`name.svg`, coral/lime
 * registration through --ia / --iw) and an optical small cut (`name-sm.svg`)
 * for controls at 24px and below. They are read once as raw text and cloned
 * per use, so no SVG markup is duplicated through the codebase.
 *
 * Icons are decorative by default: titles and role="img" are removed and the
 * element is aria-hidden, so a button's text (and textContent, which QA
 * scripts match on) is exactly its visible label. Pass `label` only when the
 * icon is the sole content of a control.
 */
const RAW = import.meta.glob<string>('./icons/*.svg', { query: '?raw', import: 'default', eager: true });

export const ICON_NAMES = [
  'back', 'check', 'chevron', 'clock', 'close', 'coffee', 'compass', 'culture', 'deal', 'discover',
  'edit', 'external', 'eye', 'food', 'help', 'info', 'leaf', 'logout', 'minus', 'moon',
  'music', 'navigate', 'person', 'phone', 'photo', 'pin', 'play', 'plus', 'preferences', 'recenter',
  'refresh', 'saved', 'search', 'sun', 'swap', 'train', 'upload', 'volume', 'walk', 'warning',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/**
 * Detailed masters read best from 28px up; the V3 rule is "optical files at
 * ≤24px". `auto` picks by size; `detailed`/`optical` force a cut.
 */
export type IconCut = 'auto' | 'detailed' | 'optical';

export interface IconOptions {
  size?: number;
  cut?: IconCut;
  className?: string;
  /** Accessible name. Omit for decorative icons next to visible text. */
  label?: string;
}

export function iconSource(name: IconName, cut: Exclude<IconCut, 'auto'>): string {
  const raw = RAW[`./icons/${name}${cut === 'optical' ? '-sm' : ''}.svg`];
  if (raw === undefined) throw new Error(`Unknown Vibewise icon: ${name}`);
  return raw;
}

/** Strip the gallery's per-file title/role/size so callers control them. */
export function normalizeIconMarkup(raw: string): string {
  return raw
    .replace(/<title>[\s\S]*?<\/title>\s*/g, '')
    .replace(/\s(role|aria-label|width|height)="[^"]*"/g, (m, _attr: string, offset: number, all: string) =>
      // Only strip attributes on the root <svg> element.
      offset < all.indexOf('>') ? '' : m,
    )
    .trim();
}

const templates = new Map<string, SVGSVGElement>();

function template(name: IconName, cut: Exclude<IconCut, 'auto'>): SVGSVGElement {
  const key = `${name}:${cut}`;
  let svg = templates.get(key);
  if (!svg) {
    const host = document.createElement('template');
    host.innerHTML = normalizeIconMarkup(iconSource(name, cut));
    svg = host.content.firstElementChild as SVGSVGElement;
    templates.set(key, svg);
  }
  return svg;
}

export function resolveCut(size: number, cut: IconCut = 'auto'): Exclude<IconCut, 'auto'> {
  return cut === 'auto' ? (size <= 24 ? 'optical' : 'detailed') : cut;
}

/** A fresh inline SVG for one of the V3 icons. Color follows `currentColor`. */
export function vwIcon(name: IconName, { size = 24, cut = 'auto', className = 'vw-icon', label }: IconOptions = {}): SVGSVGElement {
  const svg = template(name, resolveCut(size, cut)).cloneNode(true) as SVGSVGElement;
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `${className} vw-icon-${name}`);
  svg.setAttribute('focusable', 'false');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** Same icon as an HTML string, for modules that build markup with innerHTML. */
export function vwIconHtml(name: IconName, options: IconOptions = {}): string {
  return vwIcon(name, options).outerHTML;
}

/**
 * Map categories (osm.ts CATEGORIES ids) to the V3 glyph used on popups and
 * badges. Pins keep their pinColors.ts hues; the glyph adds a non-color cue.
 */
export const CATEGORY_ICON: Record<string, IconName> = {
  restaurants: 'food',
  coffee: 'coffee',
  bars: 'music',
  parks: 'leaf',
  museums: 'culture',
  landmarks: 'pin',
  entertainment: 'discover',
  search: 'search',
};

/** The popup receives the category's emoji; resolve it back to the V3 glyph. */
const EMOJI_ICON: Record<string, IconName> = {
  '🍴': 'food',
  '☕': 'coffee',
  '🍸': 'music',
  '🌳': 'leaf',
  '🏛️': 'culture',
  '🏛': 'culture',
  '🗿': 'pin',
  '🎭': 'discover',
};

export function iconForCategoryMark(mark: string | undefined): IconName {
  return (mark && (EMOJI_ICON[mark] ?? CATEGORY_ICON[mark])) || 'pin';
}
