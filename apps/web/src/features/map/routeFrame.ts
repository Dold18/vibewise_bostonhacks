import type { Rect } from './popupPlacement';
/** Edge-adjacent cards reserve their edge. Cap padding to leave a usable map viewport. */
export function paddingAround(container: Rect, obstacles: Rect[], margin = 20) {
  const p = { top: margin, bottom: margin, left: margin, right: margin };
  const w = container.right - container.left, h = container.bottom - container.top;
  for (const r of obstacles) {
    const wide = r.right - r.left > w * .5;
    if (wide && r.top <= container.top + margin) p.top = Math.max(p.top, r.bottom - container.top + margin);
    else if (wide && r.bottom >= container.bottom - margin * 3) p.bottom = Math.max(p.bottom, container.bottom - r.top + margin);
    else if (r.left <= container.left + p.left + margin) p.left = Math.max(p.left, r.right - container.left + margin);
    else if (r.right >= container.right - margin) p.right = Math.max(p.right, container.right - r.left + margin);
  }
  const scaleX = Math.min(1, w * .7 / (p.left + p.right));
  const scaleY = Math.min(1, h * .8 / (p.top + p.bottom));
  p.left *= scaleX; p.right *= scaleX; p.top *= scaleY; p.bottom *= scaleY;
  return p;
}
