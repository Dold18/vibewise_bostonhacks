/**
 * Vibenta icon family — original artwork, drawn for this product.
 *
 * Language: screen-printed marker drawings. Every icon has
 *  - `vx-i-pop`: a flat color region, knocked slightly off-register (the
 *    misprint offset of a two-color poster run),
 *  - `vx-i-ink`: expressive marker linework in `currentColor`, deliberately a
 *    little imperfect (overshooting loops, uneven ends),
 *  - optional `vx-i-thin` details and `vx-i-dot` marks (glints, sparks).
 * The pop color comes from `--vx-icon-pop` (set per icon in identity CSS), so
 * meaning stays in the silhouette and color only adds rhythm.
 *
 * All art sits on a 24×24 grid and is tuned to read at 16–24 px.
 */
export type IconName =
  | 'search' | 'saved' | 'savedFilled' | 'recenter' | 'myLocation' | 'navigate' | 'preferences' | 'vibe'
  | 'zoomIn' | 'zoomOut' | 'compass' | 'close' | 'back' | 'chevronDown' | 'check' | 'train' | 'school'
  | 'landmark' | 'swap' | 'account' | 'price' | 'hours' | 'phone' | 'photo' | 'filters' | 'arrowRight';

const pop = (d: string) => `<path class="vx-i-pop" d="${d}"/>`;
const ink = (d: string) => `<path class="vx-i-ink" d="${d}"/>`;
const thin = (d: string) => `<path class="vx-i-ink vx-i-thin" d="${d}"/>`;
const dot = (cx: number, cy: number, r = 1.1) => `<circle class="vx-i-dot" cx="${cx}" cy="${cy}" r="${r}"/>`;

export const ICON_ART: Readonly<Record<IconName, string>> = {
  // Lens drawn as one overshooting loop; a pop "glass" sits off-register; a spark at the rim.
  search:
    pop('M10.6 5.9c2.9-.4 5.3 1.7 5.4 4.4.1 2.7-2.1 4.9-4.8 4.9-2.6 0-4.6-1.9-4.7-4.4-.1-2.3 1.7-4.5 4.1-4.9z') +
    ink('M11.2 3.7c3.6.1 6.4 2.9 6.2 6.5-.2 3.5-3.1 6.2-6.7 6.1-3.6-.1-6.4-3-6.2-6.5.1-3 2.4-5.6 5.4-6') +
    ink('M15.9 15.3c1.6 1.6 3.1 3.3 4.6 5') +
    thin('M8 9.2c.3-1.2 1.2-2.1 2.4-2.4') +
    thin('M20.2 2.6v2.6M18.9 3.9h2.6'),

  // Ribbon with a sculpted notch, a tiny stamped star.
  saved:
    pop('M13 6.6a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6z') +
    ink('M6.5 3.4c3.7-.3 7.4-.3 11.1 0 .3 5.8.3 11.6 0 17.4l-5.6-3.9-5.6 3.9c-.3-5.8-.2-11.6.1-17.4z') +
    thin('M12 7.1l.8 1.7 1.9.3-1.4 1.3.3 1.9-1.6-.9-1.7.9.4-1.9-1.4-1.3 1.9-.3z'),
  savedFilled:
    pop('M6.5 3.4c3.7-.3 7.4-.3 11.1 0 .3 5.8.3 11.6 0 17.4l-5.6-3.9-5.6 3.9c-.3-5.8-.2-11.6.1-17.4z') +
    ink('M6.5 3.4c3.7-.3 7.4-.3 11.1 0 .3 5.8.3 11.6 0 17.4l-5.6-3.9-5.6 3.9c-.3-5.8-.2-11.6.1-17.4z') +
    thin('M12 7.1l.8 1.7 1.9.3-1.4 1.3.3 1.9-1.6-.9-1.7.9.4-1.9-1.4-1.3 1.9-.3z'),

  // Hand-drawn target with a starburst bullseye.
  recenter:
    pop('M12.9 8.2l1.2 2.6 2.6 1.2-2.6 1.2-1.2 2.6-1.2-2.6-2.6-1.2 2.6-1.2z') +
    ink('M12.3 4.6c4-.1 7.2 3.1 7.1 7.1-.1 3.9-3.3 7-7.3 6.9-3.9-.1-7-3.3-6.9-7.2.1-3.6 2.9-6.6 6.5-6.8') +
    ink('M12 1.8v3M12.1 19.2v3M1.9 12h3M19.1 11.9h3') +
    thin('M12 8.4l1 2.3 2.3 1-2.3 1L12 15l-1-2.3-2.3-1 2.3-1z'),

  // Paper-plane locator arrow.
  myLocation:
    pop('M5.6 11.9 20.4 6.2l-5.7 14.6-1.5-6.4z') +
    ink('M3.8 11.2c5.3-2.4 10.6-4.6 16-6.7-2 5.4-4.3 10.7-6.7 16l-1.7-7.1z') +
    thin('M11.4 13.4l8.2-8.7'),

  // Road-sign diamond, turning arrow.
  navigate:
    pop('M13 3.8l8.2 8.2-8.2 8.2-8.2-8.2z') +
    ink('M12 2.7c3.1 3 6.2 6.1 9.3 9.3-3.1 3.1-6.2 6.2-9.3 9.3-3.1-3.1-6.2-6.2-9.3-9.3 3.1-3.2 6.2-6.3 9.3-9.3z') +
    ink('M9.1 15.3v-3.1c0-.9.6-1.5 1.5-1.5h4.6') +
    ink('M13.3 8.5l2.2 2.2-2.2 2.2'),

  // Three faders, knobs as pop discs at different heights.
  preferences:
    ink('M3.6 6.6c5.6-.2 11.2-.2 16.8 0M3.6 12.1c5.6-.1 11.2-.1 16.8 0M3.6 17.6c5.6-.2 11.2-.1 16.8.1') +
    pop('M9.1 4.2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8zM16.1 9.7a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8zM10.9 15.2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z') +
    thin('M8.3 4.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM15.3 10a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM10.1 15.4a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z'),

  // Burst with a sound wave: the "vibe" mark.
  vibe:
    pop('M13 4.2l1.5 3.6 3.9-1.2-1.7 3.6 3.7 1.6-3.7 1.4 1.5 3.7-3.7-1.6-1.5 3.8-1.3-3.8-3.7 1.6 1.4-3.7-3.6-1.4 3.6-1.6-1.6-3.6 3.8 1.2z') +
    ink('M12 2.7l1.6 4.2 4.4-1.4-2 4.1 4.2 1.8-4.2 1.6 1.7 4.2-4.2-1.8-1.5 4.3-1.5-4.3-4.2 1.8 1.7-4.2-4.2-1.6 4.2-1.8-2-4.1 4.4 1.4z') +
    thin('M9.3 12.3c.7-1.1 1.5-1.1 2.2 0s1.5 1.1 2.2 0 1.1-.9 1.4-.4'),

  zoomIn:
    pop('M13 8.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z') +
    ink('M12.1 5.1c.2 4.6.1 9.2-.2 13.8M5.2 12.1c4.6-.3 9.1-.3 13.7-.1'),
  zoomOut:
    pop('M8 10.3c3.6-.3 7.3-.3 10.9 0 .2 1.4.2 2.7 0 4.1-3.6.3-7.3.3-10.9 0-.2-1.4-.2-2.7 0-4.1z') +
    ink('M5.2 12.1c4.6-.3 9.1-.3 13.7-.1'),

  // North half printed in the pop color; south half outlined.
  compass:
    pop('M12 2.6l3.6 9.4H8.4z') +
    ink('M12 2.6l3.6 9.4H8.4z') +
    ink('M8.4 12h7.2L12 21.4z') +
    dot(12, 12, 1.2),

  close:
    pop('M12.8 9.7a3 3 0 1 1 0 6 3 3 0 0 1 0-6z') +
    ink('M6.1 6.4c4 3.6 7.8 7.4 11.5 11.4M17.8 6c-3.7 4-7.6 7.9-11.6 11.7'),

  back:
    ink('M19.7 12.3c-4.9-.4-9.9-.4-14.8-.1') +
    ink('M10.3 6.3c-2 1.9-3.9 3.9-5.8 5.9 2 1.8 3.9 3.7 5.8 5.6'),

  arrowRight:
    ink('M4.3 12.2c4.9-.4 9.9-.4 14.8-.1') +
    ink('M13.7 6.3c2 1.9 3.9 3.9 5.8 5.9-2 1.8-3.9 3.7-5.8 5.6'),

  chevronDown: ink('M6.3 9.3c2 1.9 3.9 3.8 5.8 5.7 1.9-2 3.8-3.9 5.7-5.8'),

  check: ink('M4.7 12.7c1.5 1.4 3 2.9 4.4 4.5 3.2-3.9 6.6-7.7 10.1-11.2'),

  // Tram front.
  train:
    pop('M8.2 6.9c2.9-.3 5.7-.3 8.6 0 .2 1.5.2 3 0 4.5-2.9.3-5.7.3-8.6 0-.2-1.5-.2-3 0-4.5z') +
    ink('M6.4 4.3c3.7-1 7.5-1 11.2 0 .5 3.8.5 7.5 0 11.3-3.7.6-7.5.6-11.2 0-.5-3.8-.5-7.5 0-11.3z') +
    ink('M8.8 16l-2 3.6M15.2 16l2 3.6') +
    dot(9, 13.2, 1) + dot(15, 13.2, 1) +
    thin('M9.8 2.4h4.4'),

  school:
    pop('M3.8 10.3 12.8 6l8.6 4.3-8.6 4.4z') +
    ink('M2.7 9.4C5.8 8 8.9 6.5 12 5c3.1 1.5 6.2 3 9.3 4.4-3.1 1.5-6.2 3-9.3 4.4-3.1-1.4-6.2-2.9-9.3-4.4z') +
    thin('M6.6 11.5v4.3c3.4 2.4 7.4 2.4 10.8 0v-4.3M19.4 10.4v5.2'),

  landmark:
    pop('M13.1 6.9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z') +
    ink('M12 21.3c-3.4-3.9-6.6-7.7-6.7-11.4C5.2 6.2 8.2 3.2 12 3.2s6.8 3 6.7 6.7c-.1 3.7-3.3 7.5-6.7 11.4z') +
    thin('M10.4 9.6a1.7 1.7 0 1 1 3.3 0 1.7 1.7 0 0 1-3.3 0z'),

  swap:
    pop('M10 6.4h4.6v11.2H10z') +
    ink('M8.4 19.3c-.2-4.7-.2-9.4 0-14.1M4.9 8.6c1.2-1.2 2.4-2.4 3.5-3.6 1.2 1.2 2.4 2.4 3.6 3.5') +
    ink('M15.6 4.7c.2 4.7.2 9.4 0 14.1M12 15.4c1.2 1.2 2.4 2.4 3.6 3.5 1.2-1.1 2.3-2.3 3.5-3.5'),

  account:
    pop('M12.9 4.8c2 0 3.5 1.6 3.5 3.5s-1.5 3.6-3.5 3.6-3.5-1.6-3.5-3.6 1.5-3.5 3.5-3.5z') +
    ink('M12 11.3c2.3 0 3.9-1.8 3.9-4S14.3 3.4 12 3.4 8.1 5.1 8.1 7.3s1.6 4 3.9 4z') +
    ink('M4.6 20.4c.6-3.8 3.6-6.1 7.4-6.1s6.8 2.3 7.4 6.1'),

  price:
    pop('M13 6.6c1.5 0 2.7.5 3.4 1.4-.4 3.6-6.6 3.1-6.6 6.6 0 1.4 1.2 2.4 3 2.4') +
    ink('M16.4 7.1c-.9-1.3-2.5-2-4.3-2-2.4 0-4.2 1.3-4.2 3.2 0 4.4 8.7 2.5 8.7 7 0 2-1.9 3.4-4.6 3.4-1.9 0-3.6-.8-4.6-2.2') +
    ink('M12 3c.1 6 .1 12 0 18'),

  hours:
    pop('M13 6.2v6.2l4.4 2.5c-1 1.8-2.6 2.9-4.4 3.2-3.4.2-6.2-2.4-6.1-5.8.1-3.1 2.8-5.9 6.1-6.1z') +
    ink('M12.3 3.6c4.6 0 8.3 3.7 8.2 8.3-.1 4.6-3.8 8.5-8.5 8.5-4.6-.1-8.4-3.8-8.3-8.5.1-4.3 3.4-7.9 7.6-8.3') +
    ink('M12 7.4v5.1l3.3 2'),

  phone:
    pop('M8.4 4.8l2.2 3-1.3 2c1.2 2.2 2.9 3.9 5.1 5.1l2-1.3 3 2.2-1.3 2.7c-6.4.1-11.9-5.4-11.8-11.8z') +
    ink('M7.2 3.6l2.7 3.6-1.6 2.4c1.4 2.6 3.4 4.6 6 6l2.4-1.6 3.6 2.7-1.6 3.2c-7.6.2-14.4-6.6-14.2-14.2z'),

  photo:
    pop('M4.4 13.6l4.2-3.4 3.2 2.6 3.4-4.2 4.4 5.2v3.4H4.4z') +
    ink('M3.4 5.2c5.8-.4 11.5-.4 17.2 0 .3 4.6.3 9.2 0 13.7-5.7.4-11.4.4-17.2 0-.3-4.5-.3-9.1 0-13.7z') +
    thin('M4 15.8l4.6-3.8 3.2 2.6 3.5-4.2 4.6 5.4') +
    dot(8.4, 8.9, 1.4),

  filters:
    pop('M5.2 5.4h14.6l-5.5 6.8v6.6l-3.4-1.8v-4.8z') +
    ink('M3.7 4.4c5.5-.3 11.1-.3 16.6 0l-6.1 7.4v7.7l-4.4-2.3v-5.4z'),
};

/** Full SVG markup for an icon (for innerHTML contexts: popups, markers, buttons). */
export function iconMarkup(name: IconName, size = 20, className = 'vb-icon'): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" class="${className} vx-icon vx-icon--${name}">${ICON_ART[name]}</svg>`;
}

/** Reverse lookup so the generic `icon()` helper can tag icons for per-icon pop colors. */
export const ICON_NAME_BY_ART: ReadonlyMap<string, IconName> = new Map(
  (Object.entries(ICON_ART) as [IconName, string][]).map(([name, art]) => [art, name]),
);
