/**
 * composeWorld: interpreted signals + session seed → a Composition.
 *
 * The algorithm (deterministic, no model, no network):
 *
 *   1. Interpret signals into a style point, hint tags, confidence, presence.
 *   2. Displace the point by the session's small "personality" offset.
 *   3. Derive a color harmony (scheme + dominant/secondary/accent hues) and a
 *      proportional emphasis across subsystems (architecture-forward,
 *      atmosphere-forward, ...), both biased by style and varied by seed.
 *   4. Seed the coherence context with explicit requests and time-of-day tags.
 *   5. For each slot in order (keystone light first), score every component:
 *        fit(style, ideal) + hint bonus − avoid penalty + harmony fit
 *        + seed noise (fixed per session and component)
 *      Components whose tags conflict with what is already chosen are
 *      excluded; the slot's plain fallback competes with a score that rises
 *      when this world de-emphasizes the subsystem. The best wins; the
 *      previous winner is kept while it stays within a small margin.
 *   6. Add harmony-driven tints and accent, focal-point emphasis and explicit
 *      requests; enforce the world's visual-density cap.
 *   7. Derive non-catalog parameters (architectural variation, decoration
 *      intent) from the same seed and style.
 *
 * Because per-session noise is fixed, a small change in style only flips slots
 * whose top candidates were nearly tied: worlds evolve, they do not reshuffle.
 */
import { SCENE_CATALOG, type SceneCatalog, type SceneKey } from '../catalog';
import type { SceneContext } from '../state';
import { hashString, stableStringify, DEFAULT_CONTEXT } from '../state';
import { ACCENTS } from '../swatches';
import { AXES, clamp, fit, round3, type Axis, type StyleVector } from './axes';
import {
  assignOf, EMPHASIS_SUBSYSTEMS, HINT_GATE, SLOTS, type Component, type EmphasisSubsystem, type Slot,
} from './components';
import { harmonyFor, hueFit, nearestByHue, valueSample, type Harmony } from './harmony';
import { signed, unit } from './random';
import { interpretSignals, type CompositionSignals, type Interpretation } from './signals';
import { EXCLUSIVE, EXPLICIT_ONLY_TAGS, MAX_PARTICLE_SYSTEMS, tagsOf } from './tags';

export const COMPOSER_VERSION = 'composer/0.1.0';

/** Seed noise amplitude: how far apart two candidates may score and still swap between sessions. */
export const VARIATION = 0.13;
/** A previous pick survives while it scores within this margin of the new best. */
export const STICKY_MARGIN = 0.035;
/** Maximum personality displacement per axis. */
export const PERSONALITY = 0.15;

export type AssignmentSource = 'explicit' | 'component' | 'harmony' | 'focal';
export interface Assignment {
  readonly key: SceneKey;
  readonly value: string;
  /** 0..1 */
  readonly intensity: number;
  readonly source: AssignmentSource;
  readonly slot?: string;
}

export interface Pick {
  readonly slot: string;
  /** Component ID, or `plain` (the slot is left as the plain map). */
  readonly component: string;
  readonly score: number;
  readonly runnerUp: string | null;
  readonly margin: number;
  readonly sticky: boolean;
  /** Components excluded for coherence (first few, for reports). */
  readonly excluded: readonly string[];
}

export type SecondaryFocal = 'waterfront' | 'skyline' | 'streets' | 'parks' | 'none';

export interface ArchitectureParams {
  /** 0..1: how much neighbouring buildings alternate facade treatments. */
  readonly facadeVariation: number;
  /** 0..1: share of windows lit (only meaningful when a window style is active). */
  readonly windowLitRatio: number;
  /** 0..1: lit-window placement randomness (0 = regular grid). */
  readonly windowRandomness: number;
  /** 0..1: how often roofs carry detail. */
  readonly roofDetailFrequency: number;
  /** 0..1: how strongly tall buildings differ from low ones. */
  readonly heightEmphasis: number;
  /** 0..1: share of tall buildings that receive the accent hue (landmarks). */
  readonly landmarkAccentShare: number;
  /** Spatial scale of per-block variation (larger = broader districts). */
  readonly districtScale: number;
}

export interface DecorIntent {
  /** Abstract asset families, strongest first; resolved to verified IDs by decor.ts. */
  readonly families: readonly { readonly id: string; readonly weight: number }[];
  /** 0..1 overall decoration density (already scaled by confidence and performance). */
  readonly density: number;
  readonly distribution: 'clustered' | 'scattered' | 'along_streets' | 'ring_around_focus';
  readonly anchor: 'top_matches' | 'selected_venue' | 'waterfront' | 'major_streets' | 'parks';
  readonly motion: 'static' | 'ambient';
}

export interface Composition {
  readonly version: typeof COMPOSER_VERSION;
  readonly seed: string;
  /** Hash of everything below except `interpretation` (equal id ⇒ identical world). */
  readonly id: string;
  readonly interpretation: Interpretation;
  /** The style point after the session's personality offset. */
  readonly style: StyleVector;
  readonly presence: number;
  readonly harmony: Harmony;
  readonly emphasis: Readonly<Record<EmphasisSubsystem, number>>;
  readonly focal: { readonly primary: 'recommendations'; readonly secondary: SecondaryFocal };
  readonly picks: readonly Pick[];
  readonly assignments: readonly Assignment[];
  /** Coherence tags of everything chosen. */
  readonly tags: readonly string[];
  readonly density: { readonly cap: number; readonly used: number; readonly dropped: readonly SceneKey[] };
  readonly architecture: ArchitectureParams;
  readonly decor: DecorIntent;
}

export interface ComposeOptions {
  readonly context?: Partial<SceneContext>;
  /** The composition on screen; enables stickiness. */
  readonly previous?: Composition | null;
  readonly catalog?: SceneCatalog;
}

const pos = (n: number) => Math.max(0, n);
const clamp01 = (n: number) => clamp(n, 0, 1);

/** Strong statements (a particle system, a whole artistic medium) need a clearly better fit than the plain map. */
const PLAIN_BIAS: Readonly<Record<string, number>> = { particles: 0.16, medium: 0.05, props: 0.05 };

/** Time of day → coherence tags that must hold for the whole world. */
const TIME_TAGS: Readonly<Record<string, readonly string[]>> = {
  dawn: ['morning'], morning: ['day', 'morning'], midday: ['day', 'noon'], afternoon: ['day'],
  golden: ['evening'], dusk: ['dusk'], night: ['night'], late_night: ['night'],
};

/** Overlay-like keys that count against the visual-density cap. */
const DECORATIVE_GROUPS = new Set(['air_and_atmosphere', 'cinematic_and_artistic']);
const DECORATIVE_KEYS = new Set<SceneKey>(['lighting_and_shadows.bloom', 'natural_land.leaf_particles', 'sky_and_horizon.starfield']);
export const isDecorative = (key: SceneKey) => DECORATIVE_GROUPS.has(key.split('.')[0]) || DECORATIVE_KEYS.has(key);

function conflicts(tags: readonly string[], held: ReadonlySet<string>): string | null {
  for (const [a, b] of EXCLUSIVE) {
    if ((tags.includes(a) && held.has(b)) || (tags.includes(b) && held.has(a))) return `${a}×${b}`;
  }
  return null;
}

function emphasisFor(style: StyleVector, hints: Readonly<Record<string, number>>, seed: string): Record<EmphasisSubsystem, number> {
  const medium = Math.max(0, ...['paper', 'painterly', 'graphic', 'digital', 'noir', 'cinematic'].map((t) => hints[t] ?? 0));
  const raw: Record<EmphasisSubsystem, number> = {
    light: 0.15 + 0.35 * pos(-style.luminance),
    architecture: 0.2 + 0.3 * Math.abs(style.ornament) + 0.2 * pos(-style.era) + 0.1 * pos(style.era),
    ground: 0.15 + 0.2 * pos(style.grit) + 0.2 * pos(style.moisture),
    environment: 0.15 + 0.4 * pos(style.nature) + 0.15 * (hints.coastal ?? 0),
    atmosphere: 0.15 + 0.3 * pos(style.moisture) + 0.2 * pos(style.softness) + 0.15 * pos(-style.luminance),
    artistry: 0.05 + 0.35 * Math.min(1, medium),
  };
  // Seeded proportional emphasis: the same vibe can be architecture-forward for one user and atmosphere-forward for another.
  for (const s of EMPHASIS_SUBSYSTEMS) raw[s] *= Math.exp(0.55 * signed(seed, 'emphasis', s));
  const total = EMPHASIS_SUBSYSTEMS.reduce((n, s) => n + raw[s], 0);
  return Object.fromEntries(EMPHASIS_SUBSYSTEMS.map((s) => [s, round3(raw[s] / total)])) as Record<EmphasisSubsystem, number>;
}

function chooseFocal(style: StyleVector, hints: Readonly<Record<string, number>>, seed: string): SecondaryFocal {
  const weights: Record<SecondaryFocal, number> = {
    waterfront: 0.15 + (hints.coastal ?? 0) * 0.8 + pos(style.moisture) * 0.2,
    skyline: 0.15 + pos(-style.era) * 0.5 + pos(-style.luminance) * 0.2,
    streets: 0.15 + pos(style.energy) * 0.4 + pos(style.grit) * 0.3,
    parks: 0.15 + pos(style.nature) * 0.7,
    none: 0.25 + pos(style.intimacy) * 0.3,
  };
  let best: SecondaryFocal = 'none';
  let top = -Infinity;
  for (const f of Object.keys(weights) as SecondaryFocal[]) {
    const s = weights[f] + 0.3 * unit(seed, 'focal', f);
    if (s > top) [top, best] = [s, f];
  }
  return best;
}

export function composeWorld(signals: CompositionSignals | null | undefined, seed: string, options: ComposeOptions = {}): Composition {
  const catalog = options.catalog ?? SCENE_CATALOG;
  const context: SceneContext = { ...DEFAULT_CONTEXT, ...options.context };
  const interp = interpretSignals(signals, catalog);
  const previous = options.previous && options.previous.seed === seed ? options.previous : null;

  // 2. Personality offset.
  const style = Object.freeze(
    Object.fromEntries(AXES.map((a: Axis) => [a, round3(clamp(interp.style[a] + PERSONALITY * signed(seed, 'personality', a)))])),
  ) as StyleVector;

  const harmony = harmonyFor(style, interp.hints, seed);
  const emphasis = emphasisFor(style, interp.hints, seed);
  const maxEmphasis = Math.max(...EMPHASIS_SUBSYSTEMS.map((s) => emphasis[s]));
  const relEmphasis = (slot: Slot) => (slot.subsystem === 'core' ? 0.75 : emphasis[slot.subsystem] / maxEmphasis);

  const assignments = new Map<SceneKey, Assignment>();
  const held = new Set<string>();
  const holdTags = (tags: readonly string[]) => tags.forEach((t) => held.add(t));
  let particles = 0;

  // 4. Explicit requests and time of day frame the world.
  const explicitKeys = new Set(interp.explicit.map((o) => o.key));
  for (const o of interp.explicit) {
    const tags = tagsOf(o.key, o.value);
    assignments.set(o.key, { key: o.key, value: o.value, intensity: o.intensity ?? Math.max(0.6, interp.boldness), source: 'explicit' });
    holdTags(tags);
    if (tags.includes('particles')) particles++;
  }
  if (interp.timeOfDay) holdTags(TIME_TAGS[interp.timeOfDay]);

  const empty = interp.presence === 0;
  const picks: Pick[] = [];

  // 5. One component per slot.
  for (const slot of SLOTS) {
    if (empty) {
      picks.push({ slot: slot.id, component: 'plain', score: 0, runnerUp: null, margin: 0, sticky: false, excluded: [] });
      continue;
    }
    const rel = relEmphasis(slot);
    const plainBase = (slot.id === 'sky_light' ? 0.38 : slot.subsystem === 'core' ? 0.5 : 0.42 + 0.24 * (1 - rel)) + (PLAIN_BIAS[slot.id] ?? 0);
    const scored: Array<{ c: Component | null; id: string; score: number; tags: readonly string[] }> = [
      { c: null, id: 'plain', score: plainBase + VARIATION * unit(seed, slot.id, 'plain'), tags: [] },
    ];
    const excluded: string[] = [];
    for (const comp of slot.components) {
      if (comp.gate && !comp.gate.some((t) => (interp.hints[t] ?? 0) >= HINT_GATE)) continue;
      const entries = Object.entries(comp.assign).filter(([key]) => !explicitKeys.has(key) && catalog.byKey.has(key));
      if (!entries.length) continue;
      const tags = [...new Set(entries.flatMap(([key, a]) => tagsOf(key, assignOf(a).value)))];
      if (tags.some((t) => EXPLICIT_ONLY_TAGS.has(t))) continue;
      const clash = conflicts(tags, held);
      if (clash || (tags.includes('particles') && particles >= MAX_PARTICLE_SYSTEMS)) {
        excluded.push(`${comp.id} (${clash ?? 'one particle system'})`);
        continue;
      }
      const hint = Math.min(0.3, 0.2 * Math.max(0, ...tags.map((t) => interp.hints[t] ?? 0)));
      const avoid = 0.5 * Math.max(0, ...tags.map((t) => interp.avoidTags[t] ?? 0));
      const colors = entries.map(([key, a]) => valueSample(key, assignOf(a).value)).filter((s) => s !== null);
      const harmonyBonus = colors.length ? 0.4 * (colors.reduce((s, x) => s + hueFit(harmony, x), 0) / colors.length - 0.75) : 0;
      // Artificial light reads as wrong in bright daylight even where it is not a hard conflict.
      const daylight = tags.includes('lamps') ? 0.5 * pos(style.luminance) : 0;
      const score = fit(style, comp.ideal) + hint - avoid - daylight + harmonyBonus + VARIATION * unit(seed, slot.id, comp.id);
      scored.push({ c: comp, id: comp.id, score, tags });
    }
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    let chosen = scored[0];
    let sticky = false;
    const before = previous?.picks.find((p) => p.slot === slot.id)?.component;
    if (before && before !== chosen.id) {
      const kept = scored.find((s) => s.id === before);
      if (kept && kept.score >= chosen.score - STICKY_MARGIN) {
        chosen = kept;
        sticky = true;
      }
    }
    const runner = scored.find((s) => s !== chosen) ?? null;
    picks.push({
      slot: slot.id, component: chosen.id, score: round3(chosen.score), runnerUp: runner?.id ?? null,
      margin: round3(runner ? chosen.score - runner.score : 1), sticky, excluded: excluded.slice(0, 6),
    });
    if (!chosen.c) continue;
    const mult = 0.7 + 0.45 * rel;
    for (const [key, a] of Object.entries(chosen.c.assign)) {
      if (explicitKeys.has(key) || !catalog.byKey.has(key)) continue;
      const { value, strength } = assignOf(a);
      if (value === catalog.byKey.get(key)!.default) continue;
      assignments.set(key, { key, value, intensity: round3(clamp(strength * interp.boldness * mult, 0.12, 1)), source: 'component', slot: slot.id });
    }
    holdTags(chosen.tags);
    if (chosen.tags.includes('particles')) particles++;
  }

  // 6a. Harmony: grade tints follow the hue roles; the UI accent takes the accent role.
  const focal = empty ? 'none' : chooseFocal(style, interp.hints, seed);
  if (!empty) {
    const tint = (key: SceneKey, hue: number, strength: number) => {
      if (explicitKeys.has(key) || assignments.has(key)) return;
      const values = catalog.byKey.get(key)?.values ?? [];
      const near = nearestByHue(key, values, hue);
      if (near && near.distance <= 40) {
        assignments.set(key, { key, value: near.value, intensity: round3(clamp(strength * interp.boldness, 0.12, 1)), source: 'harmony' });
      }
    };
    tint('global_grade.hue_bias', harmony.roles.dominant, 0.3 + 0.3 * pos(style.chroma));
    tint('global_grade.shadow_tint', harmony.roles.secondary, 0.45);
    tint('global_grade.highlight_tint', harmony.roles.accent, 0.4);
    const accent = nearestByHue('interface_and_cards.accent_token', Object.keys(ACCENTS), harmony.roles.accent);
    if (accent && !explicitKeys.has('interface_and_cards.accent_token')) {
      assignments.set('interface_and_cards.accent_token', { key: 'interface_and_cards.accent_token', value: accent.value, intensity: 1, source: 'harmony' });
    }

    // 6b. Focal points: recommendations always lead; non-matches recede as confidence grows.
    const addFocal = (key: SceneKey, value: string, intensity: number) => {
      if (explicitKeys.has(key) || assignments.has(key)) return;
      const tags = tagsOf(key, value);
      if (conflicts(tags, held)) return;
      assignments.set(key, { key, value, intensity: round3(clamp(intensity, 0.12, 1)), source: 'focal' });
      holdTags(tags);
    };
    if (interp.confidence >= 0.35) addFocal('marker_recommendations.match_scale', interp.confidence >= 0.7 ? 'moderate' : 'subtle', interp.confidence);
    if (interp.confidence >= 0.6) addFocal('marker_recommendations.low_match_treatment', 'dim', interp.confidence * 0.8);
    if (interp.confidence >= 0.7) addFocal('neighborhood_and_places.local_hotspots', 'top3', interp.confidence * 0.7);
    const accentNear = (key: SceneKey, values: string[]) => nearestByHue(key, values, harmony.roles.accent)?.value;
    if (focal === 'waterfront') {
      const v = accentNear('water_and_coast.coastline_line', ['gold', 'luminous_cyan']);
      if (v) addFocal('water_and_coast.coastline_line', v, 0.6 * interp.boldness);
    } else if (focal === 'skyline') {
      const v = accentNear('building_surfaces.height_color_treatment', ['warm_towers', 'cool_towers', 'gold_towers']) ?? 'cool_towers';
      addFocal('building_surfaces.height_color_treatment', v, 0.55 * interp.boldness);
    } else if (focal === 'streets') {
      addFocal('roads_and_ground.major_road_emphasis', 'strong', 0.5 * interp.boldness);
    } else if (focal === 'parks') {
      addFocal('natural_land.park_glow', 'soft_green', 0.5 * interp.boldness);
    }
  }

  // 6c. Visual density: decorative layers are capped by energy, ornament, confidence and performance.
  const cap = empty
    ? 0
    : Math.min(
        { low: 3, medium: 6, high: 8 }[context.performance],
        Math.max(2, Math.round(2 + 1.25 * (style.ornament + 1) + 0.75 * (style.energy + 1) + interp.confidence)),
      );
  const decorative = [...assignments.values()].filter((a) => isDecorative(a.key) && a.source !== 'explicit');
  decorative.sort((a, b) => a.intensity - b.intensity || (a.key < b.key ? 1 : -1));
  const dropped: SceneKey[] = [];
  const explicitDecorative = [...assignments.values()].filter((a) => isDecorative(a.key) && a.source === 'explicit').length;
  while (decorative.length + explicitDecorative > cap && decorative.length) {
    const weakest = decorative.shift()!;
    assignments.delete(weakest.key);
    dropped.push(weakest.key);
  }

  // 7. Non-catalog parameters.
  const lum = style.luminance;
  const architecture: ArchitectureParams = Object.freeze({
    facadeVariation: round3(clamp01(0.2 + 0.3 * pos(style.ornament) + 0.2 * pos(style.grit) + 0.3 * unit(seed, 'arch', 'facade'))),
    windowLitRatio: round3(lum < 0 ? clamp01(0.15 + 0.5 * pos(-lum) + 0.2 * pos(style.energy) + 0.15 * unit(seed, 'arch', 'lit')) : 0.04),
    windowRandomness: round3(clamp01(0.25 + 0.35 * pos(style.grit) + 0.25 * pos(style.softness) + 0.3 * unit(seed, 'arch', 'random') - 0.3 * pos(-style.ornament))),
    roofDetailFrequency: round3(clamp01(0.1 + 0.4 * pos(style.ornament) + 0.15 * pos(style.era) + 0.3 * unit(seed, 'arch', 'roof'))),
    heightEmphasis: round3(clamp01(0.25 + 0.4 * pos(-style.era) + 0.15 * pos(style.energy) + 0.25 * unit(seed, 'arch', 'height'))),
    landmarkAccentShare: round3(clamp01(0.04 + 0.12 * unit(seed, 'arch', 'landmark') + 0.06 * pos(style.ornament))),
    districtScale: round3(0.6 + unit(seed, 'arch', 'district')),
  });
  const decor = decorIntent(style, interp, context, seed, focal, emphasis);

  const finalAssignments = [...assignments.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const tags = [...held].sort();
  const body = {
    seed, style, presence: interp.presence, harmony, emphasis, focal: { primary: 'recommendations' as const, secondary: focal },
    picks, assignments: finalAssignments, tags, density: { cap, used: decorative.length + explicitDecorative, dropped }, architecture, decor,
  };
  return Object.freeze({
    version: COMPOSER_VERSION,
    id: hashString(stableStringify(body)),
    interpretation: interp,
    ...body,
  });
}

/** Abstract decoration families and their affinity; never cuisine, culture or observance specific. */
export const DECOR_FAMILIES: ReadonlyArray<{ readonly id: string; readonly ideal: Partial<Record<Axis, number>>; readonly hint?: string; readonly gate?: string }> = [
  { id: 'streetscape', ideal: { energy: 0.3, nature: -0.4 } },
  { id: 'cafe_terrace', ideal: { warmth: 0.5, intimacy: 0.5, energy: -0.2 } },
  { id: 'lounge', ideal: { luminance: -0.6, grit: -0.3, intimacy: 0.5 } },
  { id: 'greenery', ideal: { nature: 0.8 } },
  { id: 'lighting_accents', ideal: { warmth: 0.6, luminance: -0.4 }, hint: 'warm-glow' },
  { id: 'storybook', ideal: { softness: 0.7, ornament: 0.6, era: 0.4 }, hint: 'whimsy' },
  { id: 'futurist', ideal: { era: -0.9, chroma: 0.6, luminance: -0.4 }, hint: 'futurist' },
  { id: 'market_festival', ideal: { energy: 0.8, chroma: 0.6, intimacy: -0.5 } },
  { id: 'coastal', ideal: { nature: 0.4, moisture: 0.4 }, hint: 'coastal' },
  { id: 'arcade', ideal: { energy: 0.7, chroma: 0.8, era: -0.3 }, hint: 'digital', gate: 'digital' },
  // Spooky props only when the user's own words ask for them; "moody" never implies haunted.
  { id: 'haunted', ideal: { luminance: -0.6, era: 0.5 }, hint: 'spooky', gate: 'spooky' },
];

function decorIntent(
  style: StyleVector, interp: Interpretation, context: SceneContext, seed: string, focal: SecondaryFocal,
  emphasis: Readonly<Record<EmphasisSubsystem, number>>,
): DecorIntent {
  if (interp.presence === 0) return { families: [], density: 0, distribution: 'scattered', anchor: 'top_matches', motion: 'static' };
  const families = DECOR_FAMILIES
    .filter((f) => !f.gate || (interp.hints[f.gate] ?? 0) >= HINT_GATE)
    .map((f) => ({ id: f.id, weight: round3(fit(style, f.ideal) + (f.hint ? 0.25 * (interp.hints[f.hint] ?? 0) : 0) + 0.12 * unit(seed, 'decor', f.id)) }))
    .sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))
    .slice(0, 3);
  const perf = { low: 0.4, medium: 0.75, high: 1 }[context.performance];
  const density = round3(clamp01((0.25 + 0.35 * pos(style.ornament) + 0.25 * pos(style.energy) + 0.6 * emphasis.artistry) * interp.confidence * perf));
  const distributions: DecorIntent['distribution'][] = ['clustered', 'scattered', 'along_streets', 'ring_around_focus'];
  const dWeights = [0.3 + pos(style.intimacy) * 0.6, 0.3 + pos(style.nature) * 0.3, 0.3 + pos(style.energy) * 0.5, 0.35 + pos(style.ornament) * 0.3];
  const distribution = distributions[dWeights.map((w, i) => w + 0.25 * unit(seed, 'distribution', i)).reduce((bi, w, i, arr) => (w > arr[bi] ? i : bi), 0)];
  const anchor: DecorIntent['anchor'] = interp.venue?.verified
    ? 'selected_venue'
    : focal === 'waterfront' ? 'waterfront' : focal === 'parks' ? 'parks' : focal === 'streets' ? 'major_streets' : 'top_matches';
  return { families, density, distribution, anchor, motion: context.reducedMotion ? 'static' : 'ambient' };
}
