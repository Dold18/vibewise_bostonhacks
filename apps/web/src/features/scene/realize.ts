/**
 * Realization: weighted catalog choices → concrete render targets.
 *
 * The palette is continuous: every weighted choice of every palette setting
 * contributes in OKLab, so 0.48 noir + 0.32 neon + 0.20 amber is a genuine
 * blend and a small change in quiz weights is a small change on screen. Discrete
 * renderers (overlays, markers) read the dominant choice instead.
 */
import type { Palette, PaletteKey } from '../../mapStyle';
import type { SceneCatalog } from './catalog';
import { hexToLab, labToHex, mixOk, type Lab } from './color';
import { winner, type Work } from './constraints';
import {
  ACCENTS, CONTRAST, FOG_COLORS, HIGHLIGHT_TINT, HORIZON_BLEND, HUE_BIAS, LABEL_SYSTEMS, LIGHT_INTENSITY,
  LIGHT_POSITION, PALETTE_SWATCHES, RELATIONS, SATURATION, SHADOW_TINT, TEMPERATURE, TEXT_KEYS, TRANSITION_MS,
  type Swatch,
} from './swatches';
import type { Choice, SceneState } from './state';

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const TEXT = new Set<string>(TEXT_KEYS);
const choicesOf = (work: Work, key: string): readonly Choice[] => work.get(key)?.choices ?? [];

/** Resolve a swatch against the current palette and carry its anchors' dependents along. */
export function expandSwatch(swatch: Swatch, current: Palette, base: Palette): Partial<Palette> {
  const target: Partial<Palette> = { ...(typeof swatch === 'function' ? swatch(current) : swatch) };
  for (const [dep, anchor] of RELATIONS) {
    if (target[dep] !== undefined || target[anchor] === undefined) continue;
    const [dL, da, db] = sub(hexToLab(base[dep]), hexToLab(base[anchor]));
    const [L, a, b] = hexToLab(target[anchor]!);
    // Keep the plain-map offset; flip lightness only if it would leave the visible range.
    const nextL = L + dL < 0.06 || L + dL > 0.995 ? L - dL : L + dL;
    target[dep] = labToHex([nextL, a + da, b + db]);
  }
  return target;
}

const sub = (x: Lab, y: Lab): Lab => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];

/** Apply every palette setting's weighted swatches, in table order. */
function applySwatches(work: Work, base: Palette): Palette {
  let p: Palette = { ...base };
  for (const [key, table] of Object.entries(PALETTE_SWATCHES)) {
    const choices = choicesOf(work, key).filter((c) => table[c.value] && c.weight > 0);
    if (!choices.length) continue;
    const p0 = p;
    const acc = new Map<PaletteKey, [number, number, number]>();
    for (const c of choices) {
      for (const [k, hex] of Object.entries(expandSwatch(table[c.value], p0, base)) as [PaletteKey, string][]) {
        if (TEXT.has(k)) continue;
        const d = sub(hexToLab(hex), hexToLab(p0[k]));
        const prev = acc.get(k) ?? [0, 0, 0];
        acc.set(k, [prev[0] + d[0] * c.weight, prev[1] + d[1] * c.weight, prev[2] + d[2] * c.weight]);
      }
    }
    p = { ...p0 };
    for (const [k, [dL, da, db]] of acc) {
      const [L, a, b] = hexToLab(p0[k]);
      p[k] = labToHex([L + dL, a + da, b + db]);
    }
  }
  return p;
}

const tintVec = ([deg, mag]: readonly [number, number]): [number, number] => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r) * mag, Math.sin(r) * mag];
};

/** global_grade operators, aggregated over their weighted choices. Null when there is nothing to do. */
function gradeOps(work: Work) {
  const sum = <T>(key: string, table: Readonly<Record<string, T>>, f: (t: T, w: number) => void) => {
    let any = false;
    for (const c of choicesOf(work, key)) if (table[c.value] !== undefined && c.weight > 0) { f(table[c.value], c.weight); any = true; }
    return any;
  };
  let satLog = 0;
  const shift: [number, number] = [0, 0];
  const shadow: [number, number] = [0, 0];
  const highlight: [number, number] = [0, 0];
  const curves: { s: number; k: number; lift: number; w: number }[] = [];
  const used = [
    sum('global_grade.saturation', SATURATION, (f, w) => (satLog += w * Math.log(f))),
    sum('global_grade.temperature', TEMPERATURE, ([a, b], w) => { shift[0] += a * w; shift[1] += b * w; }),
    sum('global_grade.hue_bias', HUE_BIAS, (t, w) => { const [a, b] = tintVec(t); shift[0] += a * w; shift[1] += b * w; }),
    sum('global_grade.shadow_tint', SHADOW_TINT, (t, w) => { const [a, b] = tintVec(t); shadow[0] += a * w; shadow[1] += b * w; }),
    sum('global_grade.highlight_tint', HIGHLIGHT_TINT, (t, w) => { const [a, b] = tintVec(t); highlight[0] += a * w; highlight[1] += b * w; }),
    sum('global_grade.contrast_curve', CONTRAST, (c, w) => curves.push({ ...c, w })),
  ];
  if (!used.some(Boolean)) return null;
  const sat = Math.exp(satLog);
  return (hex: string): string => {
    let [L, a, b] = hexToLab(hex);
    for (const { s, k, lift, w } of curves) {
      const smooth = L * L * (3 - 2 * L);
      const curved = 0.5 + (L + (smooth - L) * s - 0.5) * k + lift;
      L += (curved - L) * w;
    }
    a = a * sat + shift[0] + shadow[0] * (1 - L) ** 2 + highlight[0] * L ** 2;
    b = b * sat + shift[1] + shadow[1] * (1 - L) ** 2 + highlight[1] * L ** 2;
    return labToHex([L, a, b]);
  };
}

/** Swatches, then grading. Text is left for the guard. */
export function realizePalette(work: Work, base: Palette): Palette {
  const p = applySwatches(work, base);
  const grade = gradeOps(work);
  if (!grade) return p;
  const out = { ...p };
  for (const k of Object.keys(out) as PaletteKey[]) if (!TEXT.has(k)) out[k] = grade(out[k]);
  return out;
}

/** The label system the scene asks for (chosen, never blended). */
export function preferredLabels(work: Work, catalog: SceneCatalog) {
  const w = winner(work, 'text_and_labels.label_color_system', catalog);
  return w ? LABEL_SYSTEMS[w.value] ?? null : null;
}

/** `base + Σ w·(v − base)` over a numeric table; `wrap` interpolates angles along the short arc. */
function blendNumber(work: Work, key: string, table: Readonly<Record<string, number>>, base: number, wrap = false): number {
  let out = base;
  for (const c of choicesOf(work, key)) {
    const v = table[c.value];
    if (v === undefined) continue;
    let d = v - base;
    if (wrap) d = ((((d + 180) % 360) + 360) % 360) - 180;
    out += d * c.weight;
  }
  return wrap ? round3(((out % 360) + 360) % 360) : round3(out);
}

export function realizeLighting(work: Work, palette: Palette): SceneState['lighting'] {
  const pos = (i: 0 | 1 | 2) =>
    blendNumber(work, 'lighting_and_shadows.light_angle', Object.fromEntries(Object.entries(LIGHT_POSITION).map(([k, v]) => [k, v[i]])), LIGHT_POSITION.standard[i], i === 1);
  return {
    color: palette.light,
    intensity: blendNumber(work, 'lighting_and_shadows.light_intensity', LIGHT_INTENSITY, LIGHT_INTENSITY.balanced),
    position: [pos(0), pos(1), pos(2)],
  };
}

export function realizeSky(work: Work, palette: Palette): SceneState['sky'] {
  let fog = palette.land;
  for (const c of choicesOf(work, 'sky_and_horizon.fog_horizon_color')) if (FOG_COLORS[c.value]) fog = mixOk(fog, FOG_COLORS[c.value], c.weight);
  const blend = (i: 0 | 1 | 2) =>
    blendNumber(work, 'sky_and_horizon.horizon_blend', Object.fromEntries(Object.entries(HORIZON_BLEND).map(([k, v]) => [k, v[i]])), HORIZON_BLEND.natural[i]);
  return { skyColor: palette.sky, horizonColor: palette.horizon, fogColor: fog, skyHorizonBlend: blend(0), horizonFogBlend: blend(1), fogGroundBlend: blend(2) };
}

const OVERLAY_GROUPS = new Set(['air_and_atmosphere', 'cinematic_and_artistic']);

export function realizeOverlays(work: Work, catalog: SceneCatalog, texturesFor: (key: string) => readonly string[]): SceneState['overlays'] {
  const out: SceneState['overlays'][number][] = [];
  for (const s of catalog.settings) {
    if (!OVERLAY_GROUPS.has(s.group.id)) continue;
    const w = winner(work, s.key, catalog);
    if (w) out.push({ key: s.key, value: w.value, opacity: round3(w.weight), textureIds: texturesFor(s.key) });
  }
  return out;
}

/** Dominant value of every setting in a group, keyed by setting id. */
export function groupValues(work: Work, catalog: SceneCatalog, group: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of catalog.settings) if (s.group.id === group) out[s.id] = winner(work, s.key, catalog)?.value ?? s.default;
  return out;
}

export function realizeUi(work: Work, catalog: SceneCatalog): SceneState['ui'] {
  const tokens = groupValues(work, catalog, 'interface_and_cards');
  return { accent: ACCENTS[tokens.accent_token] ?? null, tokens };
}

export function realizeMotion(work: Work, catalog: SceneCatalog, reducedMotion: boolean): SceneState['motion'] {
  const transition = winner(work, 'animation_and_morph.scene_transition', catalog)?.value ?? 'soft_crossfade';
  const pace = winner(work, 'animation_and_morph.ambient_pace', catalog);
  return {
    // Reduced motion keeps a near-instant fade: colors still change, nothing travels.
    transitionMs: reducedMotion ? Math.min(150, TRANSITION_MS[transition] ?? 800) : TRANSITION_MS[transition] ?? 800,
    ambient: !reducedMotion && pace !== null,
  };
}
