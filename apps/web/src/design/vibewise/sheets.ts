/**
 * Layered-sheet silhouettes for the Vibewise V3 identity.
 *
 * `cradlePath` is the V1 3C "Button Cradle" geometry, ported verbatim from the
 * identity exploration (design/identity-exploration/js/shapes.js, `outline()`
 * with SHAPES.cradle's parameters): a single concave 38px scoop with 9px
 * fillets at the top-right corner that holds the collapse button, 18px
 * corners and a generous 34px bottom-left. `sheetPath` is V2 B's quiet
 * rounded sheet (26/10/26/10), used for secondary panels without the scoop.
 *
 * Both are pure functions of the element size. `paintSheet` draws the coral
 * backing (offset 6px right / 7px down) and the paper front with the *same*
 * path, and a ResizeObserver redraws them so the recess never scales.
 */
const f = (v: number) => +v.toFixed(2);

export interface Radii { tl: number; tr: number; br: number; bl: number }
export interface Scoop { R: number; fr: number }

/** V1 `outline()` — rounded rectangle with an optional concave top-right scoop. */
export function outline(w: number, h: number, { radii, scoop = null }: { radii: Radii; scoop?: Scoop | null }): string {
  const x0 = 0, y0 = 0, x1 = w, y1 = h;
  const { tl, tr, br, bl } = radii;
  let d = `M${f(x0 + tl)} ${f(y0)}`;
  if (scoop) {
    // Concave quarter-scoop at the top-right corner, softened by two fillets.
    const { R, fr } = scoop;
    const k = Math.sqrt((R + fr) ** 2 - fr ** 2);
    const F1 = [x1 - k, y0 + fr];
    const F2 = [x1 - fr, y0 + k];
    const T1 = [x1 + ((F1[0] - x1) * R) / (R + fr), y0 + ((F1[1] - y0) * R) / (R + fr)];
    const T2 = [x1 + ((F2[0] - x1) * R) / (R + fr), y0 + ((F2[1] - y0) * R) / (R + fr)];
    d += ` L${f(F1[0])} ${f(y0)}`;
    d += ` A${fr} ${fr} 0 0 1 ${f(T1[0])} ${f(T1[1])} A${R} ${R} 0 0 0 ${f(T2[0])} ${f(T2[1])} A${fr} ${fr} 0 0 1 ${f(x1)} ${f(F2[1])}`;
  } else {
    d += ` L${f(x1 - tr)} ${f(y0)}`;
    d += ` A${tr} ${tr} 0 0 1 ${f(x1)} ${f(y0 + tr)}`;
  }
  d += ` L${f(x1)} ${f(y1 - br)}`;
  d += ` A${br} ${br} 0 0 1 ${f(x1 - br)} ${f(y1)}`;
  d += ` L${f(x0 + bl)} ${f(y1)}`;
  d += ` A${bl} ${bl} 0 0 1 ${f(x0)} ${f(y1 - bl)}`;
  d += ` L${f(x0)} ${f(y0 + tl)}`;
  d += ` A${tl} ${tl} 0 0 1 ${f(x0 + tl)} ${f(y0)} Z`;
  return d;
}

/** The approved V1 3C parameters. */
export const CRADLE = { radii: { tl: 18, tr: 0, br: 18, bl: 34 }, scoop: { R: 38, fr: 9 } } as const;
/** Where the cradle button's centre sits, measured from the top-right corner. */
export const CRADLE_BUTTON = { right: 15, top: 16, hit: 44 } as const;
/** V2 B coral registration offset. */
export const REGISTER = { x: 6, y: 7 } as const;

export const cradlePath = (w: number, h: number) => outline(w, h, { radii: { ...CRADLE.radii }, scoop: { ...CRADLE.scoop } });
export const sheetPath = (w: number, h: number) => outline(w, h, { radii: { tl: 26, tr: 10, br: 26, bl: 10 } });

export type SheetKind = 'cradle' | 'sheet';

/** Markup for the two registered layers at a given size. */
export function sheetSvg(kind: SheetKind, w: number, h: number): string {
  const d = kind === 'cradle' ? cradlePath(w, h) : sheetPath(w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w + REGISTER.x + 2)}" height="${f(h + REGISTER.y + 2)}" viewBox="0 0 ${f(w + REGISTER.x + 2)} ${f(h + REGISTER.y + 2)}" aria-hidden="true" focusable="false">`
    + `<path class="vw-sheet-back" d="${d}" transform="translate(${REGISTER.x} ${REGISTER.y})"/>`
    + `<path class="vw-sheet-front" d="${d}"/></svg>`;
}

/**
 * Give `host` a layered-sheet background. Inserts an aria-hidden
 * `.vw-sheet-art` layer as its first child and repaints on resize. The host
 * keeps its own content, handlers and focus order untouched.
 */
export function paintSheet(host: HTMLElement, kind: SheetKind): () => void {
  const art = document.createElement('div');
  art.className = 'vw-sheet-art';
  art.setAttribute('aria-hidden', 'true');
  host.prepend(art);
  host.classList.add('vw-sheet', `vw-sheet--${kind}`);
  let last = '';
  const paint = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    const key = `${w}x${h}`;
    if (key === last) return;
    last = key;
    art.innerHTML = sheetSvg(kind, w, h);
  };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint);
  ro?.observe(host);
  paint();
  return () => {
    ro?.disconnect();
    art.remove();
  };
}
