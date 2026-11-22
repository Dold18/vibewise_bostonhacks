import { ICON_ART, ICON_NAME_BY_ART } from '../../design/icons';

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | null | undefined | false;

/** Create an element. `true` attrs render as empty attributes; false/null/undefined are omitted. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

let counter = 0;
/** Unique DOM id for ARIA relationships. */
export const uid = (prefix: string) => `vb-${prefix}-${++counter}`;

/**
 * Inline SVG icon. `art` is Vibenta icon artwork (design/icons.ts: layered
 * markup); a bare 24×24 path string is still accepted. Decorative: hidden
 * from assistive tech, so buttons keep their own accessible labels.
 */
export function icon(art: string, size = 20, className = 'vb-icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const name = ICON_NAME_BY_ART.get(art);
  svg.setAttribute('class', `${className} vx-icon${name ? ` vx-icon--${name}` : ''}`);
  if (art.trimStart().startsWith('<')) {
    svg.innerHTML = art;
  } else {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', art);
    svg.append(p);
  }
  return svg;
}

/** The app's icon vocabulary, drawn as the Vibenta icon family (design/icons.ts). */
export const ICONS = {
  chevronDown: ICON_ART.chevronDown,
  check: ICON_ART.check,
  search: ICON_ART.search,
  myLocation: ICON_ART.myLocation,
  train: ICON_ART.train,
  school: ICON_ART.school,
  landmark: ICON_ART.landmark,
  close: ICON_ART.close,
  bookmark: ICON_ART.saved,
  bookmarkFilled: ICON_ART.savedFilled,
  recenter: ICON_ART.recenter,
  swap: ICON_ART.swap,
  directions: ICON_ART.navigate,
  arrowBack: ICON_ART.back,
  tune: ICON_ART.preferences,
  photo: ICON_ART.photo,
};

/**
 * Close a popup when the pointer goes down, or focus moves, outside `root`.
 * Returns a cleanup function.
 */
export function onOutsideInteraction(root: HTMLElement, isOpen: () => boolean, close: () => void): () => void {
  const pointer = (e: PointerEvent) => {
    if (isOpen() && !root.contains(e.target as Node)) close();
  };
  const focus = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (isOpen() && next && !root.contains(next)) close();
  };
  document.addEventListener('pointerdown', pointer, true);
  root.addEventListener('focusout', focus);
  return () => {
    document.removeEventListener('pointerdown', pointer, true);
    root.removeEventListener('focusout', focus);
  };
}
