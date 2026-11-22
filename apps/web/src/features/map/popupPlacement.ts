/**
 * Camera placement for the destination popup, so it stays clear of the
 * discovery panel without ever moving or collapsing the panel.
 *
 * All values are screen pixels relative to the map container. The popup is
 * assumed to sit above its pin (MapLibre's `bottom` anchor, which it picks
 * whenever there's room). Pure functions, so they're tested without a map.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Breathing room kept between the popup and the panel or the map edge. */
export const PLACEMENT_MARGIN = 12;

const width = (r: Rect) => Math.max(0, r.right - r.left);
const height = (r: Rect) => Math.max(0, r.bottom - r.top);
const area = (r: Rect) => width(r) * height(r);
const inset = (r: Rect, m: number): Rect => ({ left: r.left + m, top: r.top + m, right: r.right - m, bottom: r.bottom - m });
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * The largest part of the map the panel doesn't cover: right of it on
 * desktop, above it for the phone bottom sheet, below a collapsed summary.
 */
export function freeRegion(container: Rect, panel: Rect | null, margin = PLACEMENT_MARGIN): Rect {
  const inner = inset(container, margin);
  if (!panel || area(panel) === 0 || !overlaps(panel, container)) return inner;
  const candidates: Rect[] = [
    { ...inner, left: Math.max(inner.left, panel.right + margin) },
    { ...inner, right: Math.min(inner.right, panel.left - margin) },
    { ...inner, top: Math.max(inner.top, panel.bottom + margin) },
    { ...inner, bottom: Math.min(inner.bottom, panel.top - margin) },
  ];
  return candidates.reduce((best, r) => (area(r) > area(best) ? r : best));
}

/** Where a popup of `size` sits when anchored above a pin at `pin`, `gap` px above its tip. */
export function popupRectAbove(pin: Point, size: Size, gap: number): Rect {
  return {
    left: pin.x - size.width / 2,
    right: pin.x + size.width / 2,
    top: pin.y - gap - size.height,
    bottom: pin.y - gap,
  };
}

/**
 * Shift along one axis that brings [lo, hi] inside the region [rLo, rHi].
 * When it's too big for the region it stays inside the map [cLo, cHi]
 * instead, overlapping the panel only by the excess.
 */
function axisShift(lo: number, hi: number, rLo: number, rHi: number, cLo: number, cHi: number): number {
  const size = hi - lo;
  if (size > rHi - rLo) return Math.max(cLo, Math.min(rLo, cHi - size)) - lo;
  if (lo < rLo) return rLo - lo;
  if (hi > rHi) return rHi - hi;
  return 0;
}

/**
 * How far (screen px) the map should move a just-selected pin so its popup is
 * clear of the panel and inside the map. `null` when it already is, so
 * selecting a pin never moves the camera needlessly.
 */
export function popupRevealShift(
  pin: Point,
  size: Size,
  gap: number,
  container: Rect,
  panel: Rect | null,
  margin = PLACEMENT_MARGIN,
): Point | null {
  const region = freeRegion(container, panel, margin);
  const map = inset(container, margin);
  const rect = popupRectAbove(pin, size, gap);
  const dx = axisShift(rect.left, rect.right, region.left, region.right, map.left, map.right);
  let dy = axisShift(rect.top, rect.bottom, region.top, region.bottom, map.top, map.bottom);
  // Never push the pin itself off the map.
  dy = Math.min(dy, map.bottom - pin.y);
  return Math.abs(dx) < 1 && Math.abs(dy) < 1 ? null : { x: dx, y: dy };
}

/**
 * Where to put a place we fly to (search results, saved places): the middle
 * of the free region, nudged so the popup above it fits.
 */
export function pinTarget(size: Size, gap: number, container: Rect, panel: Rect | null, margin = PLACEMENT_MARGIN): Point {
  const region = freeRegion(container, panel, margin);
  const centre = { x: (region.left + region.right) / 2, y: (region.top + region.bottom) / 2 };
  const shift = popupRevealShift(centre, size, gap, container, panel, margin);
  return shift ? { x: centre.x + shift.x, y: centre.y + shift.y } : centre;
}
