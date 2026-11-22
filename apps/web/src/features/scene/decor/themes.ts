/**
 * Scene → decoration theme. Reads only the compiler's SceneState (the shared,
 * evolving understanding of the vibe) so decorations, palette and set piece
 * always agree. Aesthetic presets map to aesthetic motifs; cuisine, music,
 * culture and observance never follow from an aesthetic alone.
 */
import type { SceneState } from '../state';
import type { AssetRegistry } from '../assets';
import { PRESETS, type ScenePresetId } from '../presets';
import { MOTIFS, themeAllowed, themesOfModel, type GateContext, type Motif, type MotifWeights } from './catalog';
import { decodeEvidence, type Theme, type ThemeEvidence } from './evidence';
import type { LayoutRecord } from '../assets';

/** A hero layout or set piece may appear only if every model in it is authorized (no partial themes). */
export function layoutAllowed(layout: LayoutRecord | undefined, themes: ReadonlySet<Theme>): boolean {
  if (!layout) return false;
  const ids = new Set<string>([...layout.heroAssetIds, ...layout.accentAssetIds]);
  for (const slot of Object.values(layout.slots ?? {})) for (const p of slot.placements) ids.add(p.assetId);
  return [...ids].every((id) => themeAllowed(themesOfModel(id), themes));
}

/** An explicit theme also says how the street should look: these motifs rank its (now eligible) assets. */
const THEME_MOTIFS: Readonly<Record<Theme, MotifWeights>> = {
  spooky: { nocturne: 1 }, halloween: { nocturne: 0.8, playful: 0.3 }, winter_holiday: { winter: 1, cozy: 0.4 }, festive: { market: 0.6, playful: 0.6 },
  cyberpunk: { neon: 1 }, scifi: { scifi: 1 }, nautical: { coastal: 1 }, tropical: { coastal: 0.8 }, fantasy: { storybook: 1 }, market: { market: 1 },
  arcade: { playful: 1, neon: 0.3 }, sweets: { playful: 0.8 }, blossom: { woodland: 0.6, playful: 0.3 }, desert: { coastal: 0.3 }, domestic: { cozy: 1 },
};

/** Layouts that an explicit seasonal request (the user's own words) may stage. */
const SEASONAL_LAYOUTS: Readonly<Record<string, Theme>> = { winter_festive: 'winter_holiday' };

/** Preset → motif affinities. Pure data; a new preset needs one row, no new scene code. */
export const PRESET_MOTIFS: Readonly<Record<string, MotifWeights>> = {
  neutral: {},
  amber_refuge: { cozy: 1, market: 0.5, woodland: 0.3, storybook: 0.2 },
  noir_nocturne: { nocturne: 1, cozy: 0.25, retro_urban: 0.15 },
  neon_city: { neon: 1, playful: 0.4, scifi: 0.35, retro_urban: 0.2 },
  dream_pastel: { playful: 1, storybook: 0.6, woodland: 0.3 },
  sunlit_coast: { coastal: 1, modern: 0.35, woodland: 0.2, playful: 0.2 },
  woodland_story: { woodland: 1, storybook: 0.8, cozy: 0.2 },
  underground_indie: { retro_urban: 1, market: 0.5, neon: 0.25, cozy: 0.2 },
  retro_atlas: { retro_urban: 1, storybook: 0.3, cozy: 0.3, market: 0.2 },
  minimal_modern: { modern: 1, woodland: 0.3 },
};

/**
 * Compiled catalog values → motif affinities (added at City Changer integration).
 * The procedural composer uses presets only as weak anchors, so a composed world
 * themes its decorations through the aesthetic values the compiler resolved,
 * weighted by their strengths. Aesthetic values only: cuisine, music, culture,
 * observance and seasonal props stay behind their gates (catalog.ts).
 */
export const VALUE_MOTIFS: Readonly<Record<string, Readonly<Record<string, MotifWeights>>>> = {
  'global_grade.palette_family': {
    warm_amber: { cozy: 1 }, cool_blue: { modern: 0.7, coastal: 0.4 }, neon_night: { neon: 1, scifi: 0.3 }, pastel: { playful: 0.8, storybook: 0.5 },
    earthy: { woodland: 1 }, monochrome: { modern: 1 }, vintage_film: { retro_urban: 1 }, sunwashed: { coastal: 1, playful: 0.3 },
    luxury_dark: { nocturne: 1 }, watercolor: { storybook: 1, woodland: 0.3 }, paper_atlas: { retro_urban: 0.7, storybook: 0.5 },
  },
  'cinematic_and_artistic.render_aesthetic': {
    editorial_atlas: { modern: 0.5, retro_urban: 0.4 }, watercolor: { storybook: 1 }, storybook: { storybook: 1, woodland: 0.4 }, noir: { nocturne: 1 },
    cyberpunk: { neon: 1, scifi: 0.6 }, vintage_film: { retro_urban: 1 }, retro_game: { playful: 1, neon: 0.4 }, blueprint: { modern: 0.6, scifi: 0.4 },
    paper_diorama: { storybook: 0.8, playful: 0.4 }, comic_ink: { playful: 0.8, retro_urban: 0.4 },
  },
  'building_surfaces.facade_look': {
    brick_illustration: { retro_urban: 0.4, cozy: 0.3 }, stone_blocks: { storybook: 0.3, cozy: 0.2 }, glass_grid: { modern: 0.7, scifi: 0.2 },
    wood_slats: { woodland: 0.6, cozy: 0.3 }, smooth_cement: { modern: 0.6 }, paper_cutout: { storybook: 0.6, playful: 0.4 },
  },
  'roads_and_ground.street_lights': { sparse_amber: { cozy: 0.5, nocturne: 0.3 }, dense_amber: { cozy: 0.6, market: 0.3 }, cold_white: { modern: 0.5 }, neon: { neon: 0.8 } },
  'natural_land.floral_accents': { delicate: { woodland: 0.5 }, wildflowers: { woodland: 0.7, playful: 0.3 }, bright_spring: { playful: 0.7, woodland: 0.4 } },
  'natural_land.park_glow': { soft_green: { woodland: 0.5 }, golden_sun: { cozy: 0.4, woodland: 0.3 }, storybook: { storybook: 0.8 } },
  'sky_and_horizon.sky_mode': {
    night_indigo: { nocturne: 0.5 }, purple_twilight: { neon: 0.3, nocturne: 0.3 }, dream_pastel: { playful: 0.4, storybook: 0.4 },
    golden_hour: { cozy: 0.3 }, clear_blue: { coastal: 0.3 }, storm_gray: { nocturne: 0.3 },
  },
  'water_and_coast.water_palette': { turquoise: { coastal: 0.6 }, aqua: { coastal: 0.6 } },
  'air_and_atmosphere.fireflies': { few: { woodland: 0.4, storybook: 0.3 }, gentle: { woodland: 0.5, storybook: 0.3 }, many: { woodland: 0.5, storybook: 0.4 } },
};

/** Motif pulls and their peak strength from the resolved values (0 when none apply). */
export function motifsFromValues(state: SceneState | null): { motifs: MotifWeights; strength: number } {
  const motifs: Record<string, number> = {};
  let strength = 0;
  for (const [key, table] of Object.entries(VALUE_MOTIFS)) {
    const value = state?.resolved?.[key];
    const w = value ? state?.strengths?.[key] ?? 0 : 0;
    const pulls = value ? table[value] : undefined;
    if (!pulls || !(w > 0)) continue;
    strength = Math.max(strength, w);
    for (const [m, v] of Object.entries(pulls)) motifs[m] = (motifs[m] ?? 0) + v * w;
  }
  return { motifs, strength };
}

/** Layout mood/context words → motifs, so an authored layout's theme feeds the open city too. */
const LAYOUT_WORDS: ReadonlyArray<[RegExp, MotifWeights]> = [
  [/haunt|ghost|spook|myster/, { nocturne: 1 }],
  [/cyber|neon|electronic|futur/, { neon: 1, scifi: 0.3 }],
  [/fantasy|storybook/, { storybook: 1 }],
  [/market|stall|carnival/, { market: 1, playful: 0.3 }],
  [/harbor|waterfront|coastal|seafood/, { coastal: 1 }],
  [/retro|diner|nostalg/, { retro_urban: 1 }],
  [/cozy|warm|intimate|romantic/, { cozy: 1 }],
  [/playful|arcade|whims|bright/, { playful: 1 }],
  [/sci-fi|space/, { scifi: 1 }],
  [/winter|holiday/, { winter: 1 }],
  [/natural|garden|picnic|calm/, { woodland: 1 }],
  [/modern|city dining/, { modern: 1 }],
];

export interface DecorTheme {
  readonly motifs: MotifWeights;
  /** 0..1: how strongly the vibe has emerged (scales density; 0 = no decoration). */
  readonly strength: number;
  readonly progress: number;
  readonly gates: GateContext;
  /** Hero layout IDs eligible for this scene (vibe-selected, or the compiler's verified set piece). */
  readonly heroLayouts: readonly string[];
  readonly hidden: boolean;
  /** The explicit evidence behind every non-neutral theme (provenance; dev diagnostics). */
  readonly evidence: readonly ThemeEvidence[];
  readonly reducedMotion: boolean;
  readonly performance: 'low' | 'medium' | 'high';
  /** Stable key for caching: quantized so tiny weight drifts don't reshuffle the city. */
  readonly key: string;
}

export interface ThemeOverrides {
  readonly motifs?: MotifWeights;
  readonly explicitContext?: readonly string[];
  readonly seasonal?: boolean;
  readonly observanceOptIn?: boolean;
  readonly progress?: number;
  readonly layouts?: readonly string[];
  /** Explicit evidence (tests and dev tools); otherwise read from SceneContext.themeEvidence. */
  readonly evidence?: readonly ThemeEvidence[];
}

/** 0.1 steps; the epsilon keeps float noise on exact .x5 table values from flipping the rounding. */
const quantize = (v: number) => Math.round(v * 10 + 1e-6) / 10;

export function motifsFromLayout(mood: string, context: string): MotifWeights {
  const text = `${mood} ${context}`.toLowerCase(), out: Record<string, number> = {};
  for (const [pattern, motifs] of LAYOUT_WORDS) if (pattern.test(text)) for (const [m, w] of Object.entries(motifs)) out[m] = Math.max(out[m] ?? 0, w);
  return out;
}

export function deriveTheme(state: SceneState | null, assets: AssetRegistry | null, overrides: ThemeOverrides = {}, layoutContext: ReadonlyMap<string, string> = new Map()): DecorTheme {
  const ctx = state?.context;
  // Evidence belongs to the outing that produced it; SceneSession.clear() drops it with the outing.
  // (Not gated on `source`: an outing with no style words encodes an empty intent, yet "Christmas" still counts.)
  const evidence = overrides.evidence ?? decodeEvidence(ctx?.themeEvidence);
  const themes = new Set<Theme>(evidence.map((e) => e.theme));
  const allowed = (id: string) => layoutAllowed(assets?.layouts.get(id), themes);
  const motifs: Record<string, number> = {};
  let presetStrength = 0;
  for (const p of state?.presets ?? []) {
    const table = PRESET_MOTIFS[p.id] ?? {};
    if (p.id !== 'neutral') presetStrength += p.weight;
    for (const [m, w] of Object.entries(table)) motifs[m] = (motifs[m] ?? 0) + w * p.weight;
  }
  // Compiled values add to the preset pulls (half weight: presets remain the stronger signal when present).
  const fromValues = motifsFromValues(state);
  for (const [m, w] of Object.entries(fromValues.motifs)) motifs[m] = (motifs[m] ?? 0) + 0.5 * w;
  presetStrength = Math.max(presetStrength, fromValues.strength);
  // The user's explicit themes are the strongest signal there is: "Christmas in Boston" has no style
  // words, yet it clearly asks for decorations.
  for (const e of evidence) for (const [m, w] of Object.entries(THEME_MOTIFS[e.theme])) motifs[m] = Math.max(motifs[m] ?? 0, w * Math.max(1, presetStrength));
  if (evidence.length) presetStrength = Math.max(presetStrength, 0.75);
  const activatedIds = new Set<string>();
  const heroLayouts: string[] = [];
  // A vibe-selected set piece comes from preset anchors, so it is staged only when its whole theme was
  // asked for. Any other activation was already authorized by the compiler (explicit or verified context).
  const sp = state?.setPiece;
  const setPiece = sp && (assets?.layouts.get(sp.layoutId)?.activation !== 'vibe_selected' || allowed(sp.layoutId)) ? sp : null;
  if (setPiece) {
    for (const id of [...setPiece.heroAssetIds, ...setPiece.accentAssetIds]) activatedIds.add(id);
    heroLayouts.push(setPiece.layoutId);
    const layout = assets?.layouts.get(setPiece.layoutId);
    if (layout) for (const [m, w] of Object.entries(motifsFromLayout(layout.mood, layoutContext.get(layout.id) ?? ''))) motifs[m] = Math.max(motifs[m] ?? 0, w * 0.6);
  }
  if (overrides.motifs) { for (const k of Object.keys(motifs)) delete motifs[k]; Object.assign(motifs, overrides.motifs); }
  // Normalize so the dominant motif is 1; strength carries the magnitude.
  const peak = Math.max(0, ...Object.values(motifs));
  const normalized: MotifWeights = {};
  for (const m of MOTIFS) if ((motifs[m] ?? 0) > 0 && peak > 0) normalized[m as Motif] = quantize(motifs[m]! / peak);

  const progress = overrides.progress ?? ctx?.discoveryProgress ?? Math.min(1, presetStrength);
  const strength = overrides.motifs ? 1 : Math.min(1, presetStrength) * (0.35 + 0.65 * progress);
  // The compiler's own preset → set-piece mapping comes first (same source as the existing set piece).
  for (const p of state?.presets ?? []) for (const id of p.weight >= 0.35 ? PRESETS[p.id as ScenePresetId]?.setPieces ?? [] : [])
    if (!heroLayouts.includes(id) && assets?.layouts.get(id)?.activation === 'vibe_selected' && allowed(id)) heroLayouts.push(id);
  // Then any vibe-selected layout whose *whole* motif profile fits (normalized by the layout's own motif mass,
  // so a "playful spooky" layout does not follow a purely playful vibe). Activation rule: vibe alone may trigger only these.
  for (const layout of assets?.layouts.values() ?? []) {
    if (layout.activation !== 'vibe_selected' || heroLayouts.includes(layout.id) || !allowed(layout.id)) continue;
    const lm = motifsFromLayout(layout.mood, `${layout.id.replace(/_/g, ' ')} ${layoutContext.get(layout.id) ?? ''}`);
    const mass = MOTIFS.reduce((s, m) => s + (lm[m] ?? 0), 0);
    const affinity = mass > 0 ? MOTIFS.reduce((s, m) => s + (lm[m] ?? 0) * (normalized[m] ?? 0), 0) / mass : 0;
    if (affinity > 0.5) heroLayouts.push(layout.id);
  }
  for (const [id, theme] of Object.entries(SEASONAL_LAYOUTS)) if (themes.has(theme) && !heroLayouts.includes(id) && allowed(id)) heroLayouts.push(id);
  for (const id of overrides.layouts ?? []) if (!heroLayouts.includes(id)) heroLayouts.push(id);

  const gates: GateContext = {
    explicitContext: new Set(overrides.explicitContext ?? []),
    // The user's own holiday words are the explicit seasonal context the seasonal gate asks for.
    seasonal: overrides.seasonal ?? themes.has('winter_holiday'),
    observanceOptIn: overrides.observanceOptIn ?? ctx?.observanceOptIn ?? false,
    activatedIds,
    themes,
  };
  const hidden = (ctx?.navigation ?? 'browse') !== 'browse' || ctx?.installationsEnabled === false;
  const key = JSON.stringify([normalized, quantize(strength), quantize(progress), [...gates.explicitContext].sort(), gates.seasonal, gates.observanceOptIn, [...activatedIds].sort(), heroLayouts, [...themes]]);
  return { motifs: normalized, strength, progress, gates, heroLayouts, hidden, evidence, reducedMotion: ctx?.reducedMotion ?? false, performance: ctx?.performance ?? 'medium', key };
}
