/**
 * Contrast guard for a realized palette: labels, pins and water labels stay at
 * least as readable as WCAG targets, or as the plain map already is, whichever
 * is lower (so the plain map always passes untouched).
 *
 * Where vibeTheme's blend backs the whole theme off, this guard makes the
 * smallest correction that restores legibility, so the art direction survives:
 *
 * 1. Pins: plain pins if they pass; else white-edged pins (`vibe-dark`, the only
 *    thing that class changes); only if neither passes is the ground's lightness
 *    nudged, by the smallest amount in either direction.
 * 2. Labels: the requested label set, then the stock dark/light sets; if none
 *    passes, the requested set is pushed toward black or white until it does.
 *    Text adapts to the ground, never the reverse.
 */
import { basePalette, type Palette } from '../../mapStyle';
import { PIN_COLORS } from '../../pinColors';
import { DARK_PIN_EDGE } from '../vibeTheme/blend';
import { LIGHT_TEXT } from '../vibeTheme/palettes';
import { contrastRatio, hexToLab, labToHex, lightness, mixOk } from './color';
import { TEXT_KEYS, type TextKey } from './swatches';

type TextSet = Pick<Palette, TextKey>;

const floor = (target: number, a: string, b: string) => Math.min(target, contrastRatio(a, b)) - 1e-9;
const B = basePalette;
export const FLOORS = Object.freeze({
  primary: floor(4.5, B.textPrimary, B.land),
  secondary: floor(3, B.textSecondary, B.land),
  neighbourhood: floor(3, B.neighbourhoodLabel, B.land),
  halo: floor(4.5, B.textPrimary, B.halo),
  water: floor(3, B.waterLabel, B.water),
  pins: Math.min(...Object.values(PIN_COLORS).map((c) => contrastRatio(c, B.land))) - 1e-9,
});

const DARK_TEXT: TextSet = Object.fromEntries(TEXT_KEYS.map((k) => [k, B[k]])) as TextSet;
const textOf = (p: Palette): TextSet => Object.fromEntries(TEXT_KEYS.map((k) => [k, p[k]])) as TextSet;

export function labelsPass(p: Palette): boolean {
  return (
    contrastRatio(p.textPrimary, p.land) >= FLOORS.primary &&
    contrastRatio(p.textSecondary, p.land) >= FLOORS.secondary &&
    contrastRatio(p.neighbourhoodLabel, p.land) >= FLOORS.neighbourhood &&
    contrastRatio(p.textPrimary, p.halo) >= FLOORS.halo
  );
}

export function pinsPass(land: string, whiteEdge: boolean): boolean {
  const pins = whiteEdge ? [DARK_PIN_EDGE] : Object.values(PIN_COLORS);
  return Math.min(...pins.map((c) => contrastRatio(c, land))) >= FLOORS.pins;
}

/** Move a color's OKLab lightness by `dL`, keeping hue and chroma. */
function shiftL(hex: string, dL: number): string {
  const [L, a, b] = hexToLab(hex);
  return labToHex([L + dL, a, b]);
}

const STEP = 0.01;

/** Dark half of the proposed two-tone pin ring (the light half is DARK_PIN_EDGE, white). */
export const RING_DARK = '#1a1d24';
/** A two-tone ring is visible on any ground: one of its tones always contrasts. */
export const ringPasses = (land: string) => Math.max(contrastRatio(DARK_PIN_EDGE, land), contrastRatio(RING_DARK, land)) >= FLOORS.pins;

export type PinEdge = 'none' | 'white' | 'two_tone';

/** Pick the pin treatment (previous one first, for stability); nudge the ground only if none works. */
function fixPins(land: string, ring: boolean, previous?: PinEdge): { land: string; edge: PinEdge } {
  if (ring && ringPasses(land)) return { land, edge: 'two_tone' };
  const order: PinEdge[] = previous === 'white' ? ['white', 'none'] : ['none', 'white'];
  for (const edge of order) if (pinsPass(land, edge === 'white')) return { land, edge };
  for (let i = 1; i <= 100; i++) {
    const down = shiftL(land, -STEP * i);
    if (pinsPass(down, true)) return { land: down, edge: 'white' };
    const up = shiftL(land, STEP * i);
    if (pinsPass(up, false)) return { land: up, edge: 'none' };
  }
  return { land: B.land, edge: 'none' };
}

/** Push a label set toward black or white until it passes on `p.land`. */
function synthesizeLabels(p: Palette, start: TextSet): TextSet {
  const dark = contrastRatio('#000000', p.land) >= contrastRatio('#ffffff', p.land);
  const dir = dark ? -STEP : STEP;
  const push = (hex: string, min: number) => {
    let out = hex;
    for (let i = 0; i < 100 && contrastRatio(out, p.land) < min; i++) out = shiftL(out, dir);
    return out;
  };
  const textPrimary = push(start.textPrimary, FLOORS.primary);
  let halo = mixOk(p.land, dark ? '#ffffff' : '#000000', 0.6);
  for (let i = 0; i < 100 && contrastRatio(textPrimary, halo) < FLOORS.halo; i++) halo = shiftL(halo, -dir);
  return {
    textPrimary,
    textSecondary: push(start.textSecondary, FLOORS.secondary),
    neighbourhoodLabel: push(start.neighbourhoodLabel, FLOORS.neighbourhood),
    halo,
    waterLabel: start.waterLabel,
  };
}

export interface GuardResult {
  readonly palette: Palette;
  /** White-edged pins (vibeTheme's `vibe-dark` class). */
  readonly darkMode: boolean;
  readonly pinEdge: PinEdge;
  readonly corrections: readonly string[];
}

export interface GuardOptions {
  /** The renderer draws the two-tone pin ring: pins pass on any ground, so it is never nudged. */
  readonly contrastRing?: boolean;
  /** The scene on screen: its pin edge and labels are kept while they still pass (no flicker). */
  readonly previous?: { readonly pinEdge: PinEdge; readonly palette: Palette };
}

/**
 * @param preferred the label system the scene asked for, if any; otherwise the
 *                  palette's own labels are tried first.
 */
export function guardPalette(input: Palette, preferred: TextSet | null, options: GuardOptions = {}): GuardResult {
  const corrections: string[] = [];
  const pins = fixPins(input.land, options.contrastRing === true, options.previous?.pinEdge);
  if (pins.land !== input.land) corrections.push(`land: lightness nudged ${input.land} → ${pins.land} so pins stay visible`);
  const grounded = { ...input, land: pins.land };

  // Own/requested labels first; previous labels only matter once those fail, so a
  // neutral scene is always exactly the plain map, whatever was shown before.
  const own = preferred ?? textOf(input);
  const previous = options.previous ? textOf(options.previous.palette) : null;
  const sets = [own, previous, DARK_TEXT, LIGHT_TEXT].filter((x): x is TextSet => x !== null);
  let chosen = sets.find((s) => labelsPass({ ...grounded, ...s }));
  if (!chosen) {
    const made = synthesizeLabels(grounded, own);
    const changed = TEXT_KEYS.filter((k) => made[k] !== own[k]).map((k) => `${k} ${own[k]} → ${made[k]}`);
    corrections.push(`labels: pushed toward ${lightness(made.textPrimary) < lightness(grounded.land) ? 'black' : 'white'} for contrast (${changed.join(', ')})`);
    chosen = made;
  } else if (chosen === previous && chosen !== own) {
    corrections.push('labels: kept the previous labels for continuity');
  } else if (chosen !== own) {
    corrections.push(`labels: switched to ${chosen === LIGHT_TEXT ? 'light' : 'dark'} text for contrast`);
  }
  const palette = fixWaterLabel({ ...grounded, ...chosen }, corrections);
  return { palette, darkMode: pins.edge === 'white', pinEdge: pins.edge, corrections };
}

function fixWaterLabel(p: Palette, corrections: string[]): Palette {
  if (contrastRatio(p.waterLabel, p.water) >= FLOORS.water) return p;
  const darken = contrastRatio('#000000', p.water) >= contrastRatio('#ffffff', p.water);
  let label = p.waterLabel;
  for (let i = 0; i < 100 && contrastRatio(label, p.water) < FLOORS.water; i++) label = shiftL(label, darken ? -STEP : STEP);
  corrections.push(`waterLabel: ${p.waterLabel} → ${label} for contrast on water`);
  return { ...p, waterLabel: label };
}
