/**
 * The Vibenta wordmark: original hand-lettered SVG (not a font).
 *
 * Marker-drawn lowercase letters with a little per-letter tilt, printed twice:
 * an off-register color pass (`vx-wm-print`) under the ink pass (`vx-wm-ink`),
 * and a starburst in place of the dot on the "i". Colors come from CSS
 * (`--vx-wm-ink`, `--vx-wm-print`, `--vx-wm-spark`) so it sits on any surface.
 */
const LETTERS: readonly { d: string; tilt: number; cx: number }[] = [
  { d: 'M3.6 17.4c2.4 5.9 4.5 11.8 6.9 17.7 2.3-6 4.7-11.9 7.4-17.8', tilt: -4, cx: 10 }, // v
  { d: 'M24.6 18.6c.3 5.5.3 11 .1 16.5', tilt: 2, cx: 25 }, // i (stem)
  { d: 'M32.4 4.6c.5 10.2.5 20.4.2 30.6M32.8 24.4c2.6-6.8 14.6-7.6 14.7 1.4.1 8.6-10.5 11.6-14.6 6.3', tilt: -2, cx: 40 }, // b
  { d: 'M54.6 26.6c4.6-.4 9.2-.7 13.9-.6.1-8.9-13.7-9.9-14.2.1-.5 9 9.3 12.1 14.6 5.9', tilt: 3, cx: 61 }, // e
  { d: 'M75.2 35.4c-.2-5.8-.2-11.6.1-17.3M75.4 24.6c2.6-7.6 13.4-8.2 13.7-.4.2 3.7.1 7.4-.1 11.1', tilt: -3, cx: 82 }, // n
  { d: 'M99.6 6.8c.2 7.9.2 15.8.1 23.7-.1 5.2 4.6 5.8 7.8 3.5M93.6 17.2c4.9-.4 9.8-.7 14.7-.8', tilt: 4, cx: 101 }, // t
  { d: 'M126.4 22.6c-4.4-7.2-14.8-4.6-15 4.4-.2 8.9 10.6 10.4 14.9 1.6M127.2 17.6c-.2 4.6-.2 9.3.4 13.9.3 2.6 1.9 3.6 3.6 3.3', tilt: -2, cx: 121 }, // a
];
// 8-point burst over the "i", slightly irregular like a stamped sticker.
const SPARK = 'M24.8 1.6l1.5 3.5 3.6-1.1-1.7 3.4 3.5 1.6-3.6 1.2 1.3 3.6-3.4-1.6-1.5 3.5-1.3-3.6-3.5 1.4 1.5-3.5-3.5-1.4 3.6-1.4-1.4-3.5 3.5 1.3z';

export function wordmarkSvg(title = 'Vibenta'): string {
  const strokes = LETTERS.map((l) => `<path d="${l.d}" transform="rotate(${l.tilt} ${l.cx} 26)"/>`).join('');
  return (
    `<svg class="vx-wordmark" viewBox="0 0 136 40" role="img" aria-label="${title}">` +
    `<g class="vx-wm-print" transform="translate(2.4 2.2)">${strokes}</g>` +
    `<g class="vx-wm-ink">${strokes}</g>` +
    `<path class="vx-wm-spark" d="${SPARK}"/>` +
    `</svg>`
  );
}
