/**
 * Decluttering: when pins sit almost on top of each other on screen, show
 * only the most important one and hide the rest until zooming in spreads
 * them apart. Pins that merely overlap stay; only near-stacked ones go. This only
 * decides which markers are drawn: a hidden place still appears in the
 * search results list, but when browsing categories (no list) it is reached
 * by zooming in.
 *
 * Works in screen pixels, so it's rerun after the camera settles (main.ts).
 * Far pins in the tilted view are drawn smaller, so more of them fit.
 */

/** A pin's screen footprint: (x, y) is the tip it stands on, at bottom centre. */
export interface PinBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How close two pins' tips must be, as a fraction of their average size, for
 * one to be hidden: 0.35 means within ~10 px across and ~14 px up/down at
 * full size, i.e. the heads are mostly stacked. (1 would hide any overlap;
 * at the default view that hid 27 of 79 pins, this hides about 7.)
 */
export const CULL_CLOSENESS = 0.35;

/**
 * At this zoom and closer (street level; the default view is 16) every pin
 * shows, however close together: zooming in is how hidden pins are reached.
 */
export const CULL_MAX_ZOOM = 17;

/** Whether decluttering applies at `zoom`. */
export const cullsAtZoom = (zoom: number) => zoom < CULL_MAX_ZOOM;

const tooClose = (a: PinBox, b: PinBox) =>
  Math.abs(a.x - b.x) < (CULL_CLOSENESS * (a.width + b.width)) / 2 &&
  Math.abs(a.y - b.y) < (CULL_CLOSENESS * (a.height + b.height)) / 2;

/**
 * Greedy decluttering: walk `order` (most important first) and keep each pin
 * that isn't too close (CULL_CLOSENESS) to a pin already kept. Indices missing from `order` (e.g. off screen) are left visible and
 * don't block anything. Returns visibility per index of `boxes`.
 */
export function cullOverlapping(boxes: readonly PinBox[], order: readonly number[]): boolean[] {
  const visible = boxes.map(() => true);
  const kept: PinBox[] = [];
  for (const i of order) {
    const box = boxes[i];
    if (kept.some((k) => tooClose(k, box))) visible[i] = false;
    else kept.push(box);
  }
  return visible;
}

/**
 * Who wins an overlap: indices ordered by `scores`, highest first; equal
 * scores keep their original order (nearest the search centre first).
 * main.ts scores the selected pin, then trip and popup places, then deals on
 * now, then the vibe match (the pin's --pin-scale).
 */
export function cullOrder(scores: readonly number[]): number[] {
  return scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
}
