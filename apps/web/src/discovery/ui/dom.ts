import { vwIcon, type IconName } from '../../design/vibewise/icons';

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
 * A Vibewise V3 icon (src/design/vibewise/icons). Decorative: hidden from
 * assistive tech and contributes no text to its button. Optical cuts are used
 * at 24px and below, detailed masters above, as the V3 icon rules specify.
 */
export function icon(name: IconName, size = 20, className = 'vb-icon'): SVGSVGElement {
  return vwIcon(name, { size, className: `vw-icon ${className}` });
}

/** Interface actions → V3 icon names. */
export const ICONS = {
  chevronDown: 'chevron',
  check: 'check',
  search: 'search',
  myLocation: 'recenter',
  train: 'train',
  school: 'culture',
  landmark: 'pin',
  close: 'close',
  bookmark: 'saved',
  bookmarkFilled: 'saved',
  recenter: 'recenter',
  swap: 'swap',
  directions: 'navigate',
  arrowBack: 'back',
  tune: 'preferences',
  photo: 'photo',
  upload: 'upload',
  walk: 'walk',
  warning: 'warning',
  info: 'info',
  person: 'person',
  minus: 'minus',
  plus: 'plus',
  external: 'external',
} as const satisfies Record<string, IconName>;

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
