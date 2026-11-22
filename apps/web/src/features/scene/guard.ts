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

/** Pick the pin treatment; nudge the ground only if no treatment works. */
function fixPins(land: string): { land: string; whiteEdge: boolean } {
  if (pinsPass(land, false)) return { land, whiteEdge: false };
  if (pinsPass(land, true)) return { land, whiteEdge: true };
  for (let i = 1; i <= 100; i++) {
    const down = shiftL(land, -STEP * i);
    if (pinsPass(down, true)) return { land: down, whiteEdge: true };
    const up = shiftL(land, STEP * i);
    if (pinsPass(up, false)) return { land: up, whiteEdge: false };
  }
  return { land: B.land, whiteEdge: false };
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
  readonly corrections: readonly string[];
}

/**
 * @param preferred the label system the scene asked for, if any; otherwise the
 *                  palette's own labels are tried first.
 */
export function guardPalette(input: Palette, preferred: TextSet | null): GuardResult {
  const corrections: string[] = [];
  const pins = fixPins(input.land);
  if (pins.land !== input.land) corrections.push(`land: lightness nudged ${input.land} → ${pins.land} so pins stay visible`);
  const grounded = { ...input, land: pins.land };

  const own = preferred ?? textOf(input);
  const sets = [own, DARK_TEXT, LIGHT_TEXT];
  let chosen = sets.find((s) => labelsPass({ ...grounded, ...s }));
  if (!chosen) {
    const made = synthesizeLabels(grounded, own);
    const changed = TEXT_KEYS.filter((k) => made[k] !== own[k]).map((k) => `${k} ${own[k]} → ${made[k]}`);
    corrections.push(`labels: pushed toward ${lightness(made.textPrimary) < lightness(grounded.land) ? 'black' : 'white'} for contrast (${changed.join(', ')})`);
    chosen = made;
  } else if (chosen !== own) {
    corrections.push(`labels: switched to ${chosen === LIGHT_TEXT ? 'light' : 'dark'} text for contrast`);
  }
  const palette = fixWaterLabel({ ...grounded, ...chosen }, corrections);
  return { palette, darkMode: pins.whiteEdge, corrections };
}

function fixWaterLabel(p: Palette, corrections: string[]): Palette {
  if (contrastRatio(p.waterLabel, p.water) >= FLOORS.water) return p;
  const darken = contrastRatio('#000000', p.water) >= contrastRatio('#ffffff', p.water);
  let label = p.waterLabel;
  for (let i = 0; i < 100 && contrastRatio(label, p.water) < FLOORS.water; i++) label = shiftL(label, darken ? -STEP : STEP);
  corrections.push(`waterLabel: ${p.waterLabel} → ${label} for contrast on water`);
  return { ...p, waterLabel: label };
}
