/**
 * encodeComposition: Composition → SceneIntent, verified by the real compiler.
 *
 * The Scene Compiler and Scene Session stay the source of truth. The composer
 * speaks to them exactly like the model does, through a SceneIntent: up to
 * `maxWeightedPresets` presets as *anchors* (influences, never the output) and
 * up to `composerOverrideLimit` overrides (the session accepts that budget only
 * when the driver submits with `source: 'composer'`). Encoding is an optimization:
 *
 *   1. Rank presets by distance to the world's style point; score every subset
 *      of the nearest few by an emulation of the compiler's weighing step: the
 *      important residual left after the override budget is spent (renderable
 *      keys weigh most, then sky/light/architecture...), plus a cost for every
 *      hard conflict the anchors would bring. The cheapest few sets and the
 *      empty set are then fully encoded and compiled; the one that realizes
 *      the most importance-weighted world wins.
 *   2. Spend overrides on the most important values the anchors get wrong.
 *   3. Compile the intent with every capability enabled and run the hard
 *      coherence checks on what the compiler *resolved*. Repair violations
 *      introduced by anchors (override the anchor's value back to the target
 *      or to the default); if the budget cannot fix it, drop the weakest anchor
 *      and retry. With no anchors the intent is a subset of a coherent
 *      composition, and the rules are pairwise, so the ladder always ends
 *      coherent.
 */
import { previewAllCapabilities, PALETTE_ADAPTER_V0, supports, type CapabilityProfile } from '../capabilities';
import { SCENE_CATALOG, type SceneCatalog, type SceneKey } from '../catalog';
import { compileScene } from '../compile';
import { MIN_DISCRETE_WEIGHT } from '../constraints';
import type { AssetRegistry } from '../assets';
import { SCENE_SCHEMA_VERSION, type SceneOverride, type WeightedPreset } from '../intent';
import { choiceOf, PRESETS, PRESET_IDS, type ScenePresetId } from '../presets';
import { DEFAULT_CONTEXT, type SceneContext, type SceneState } from '../state';
import { PALETTE_SWATCHES } from '../swatches';
import { distance, round3, type Pull, type StyleVector } from './axes';
import { checkCoherence, type CoherenceReport, type Violation } from './coherence';
import { tagConflicts } from './tags';
import type { Assignment, Composition } from './compose';

/** Where each preset sits in the style space. Presets are influences the encoder may lean on, not a menu. */
export const PRESET_ANCHORS: Readonly<Record<Exclude<ScenePresetId, 'neutral'>, Pull>> = {
  amber_refuge: { warmth: 0.8, luminance: 0, softness: 0.4, intimacy: 0.6, era: 0.3, energy: -0.3 },
  noir_nocturne: { luminance: -0.8, chroma: -0.6, grit: -0.2, intimacy: 0.5, warmth: 0.1 },
  neon_city: { luminance: -0.8, chroma: 0.9, era: -0.8, energy: 0.6 },
  dream_pastel: { softness: 0.9, luminance: 0.4, chroma: 0.1, ornament: 0.3 },
  sunlit_coast: { luminance: 0.9, warmth: 0.3, nature: 0.4, moisture: 0.3, energy: 0.3 },
  woodland_story: { nature: 0.9, softness: 0.5, era: 0.3, energy: -0.4 },
  underground_indie: { grit: 0.9, luminance: -0.4, chroma: -0.2, era: 0.2 },
  retro_atlas: { era: 0.9, chroma: -0.3, ornament: 0.3 },
  minimal_modern: { ornament: -0.9, grit: -0.6, era: -0.6, chroma: -0.4 },
};

const GROUP_WEIGHT: Readonly<Record<string, number>> = {
  sky_and_horizon: 1, lighting_and_shadows: 0.95, building_surfaces: 0.95, global_grade: 0.9, roads_and_ground: 0.85,
  natural_land: 0.75, water_and_coast: 0.75, air_and_atmosphere: 0.6, cinematic_and_artistic: 0.6, text_and_labels: 0.5,
  marker_recommendations: 0.45, interface_and_cards: 0.4, neighborhood_and_places: 0.35, animation_and_morph: 0.3,
};
/** How many nearest presets the anchor search considers. */
export const ANCHOR_CANDIDATES = 5;

export interface EncodeOptions {
  readonly version: number;
  /** The renderer the intent is optimized for (renderable values weigh 3×). Default: palette adapter. */
  readonly capabilities?: CapabilityProfile;
  readonly catalog?: SceneCatalog;
  readonly context?: Partial<SceneContext>;
  readonly assets?: AssetRegistry | null;
}

export interface Unrealized {
  readonly key: SceneKey;
  readonly value: string;
  readonly resolved: string;
  readonly reason: 'override_budget' | 'compiler_rule';
}

export interface Encoding {
  /** A plain SceneIntent object, ready for `SceneSession.submit` (untrusted path, sanitized there). */
  readonly intent: {
    readonly schemaVersion: typeof SCENE_SCHEMA_VERSION;
    readonly sessionVersion: number;
    readonly presets: readonly WeightedPreset[];
    readonly descriptors: readonly string[];
    readonly overrides: readonly SceneOverride[];
  };
  readonly anchors: readonly WeightedPreset[];
  /** Share of the composition's values the compiler resolved exactly (all capabilities enabled). */
  readonly fidelity: number;
  /**
   * Same, restricted to values the target renderer can draw, compiled with the
   * target renderer; blended values count in proportion to their strength.
   */
  readonly renderableFidelity: number;
  readonly unrealized: readonly Unrealized[];
  readonly repairs: readonly string[];
  /** Hard coherence of the compiled scene (all capabilities enabled). */
  readonly coherence: CoherenceReport;
  /** The full-capability compile used for verification (for previews; renderers use the session's state). */
  readonly preview: SceneState;
}

type Target = ReadonlyMap<SceneKey, Assignment>;

function importance(a: Assignment, capabilities: CapabilityProfile, catalog: SceneCatalog): number {
  if (a.source === 'explicit') return 1000;
  const setting = catalog.byKey.get(a.key)!;
  const renderable = supports(capabilities, a.key, a.value, setting.default) && a.value !== setting.default ? 3 : 1;
  return renderable * (GROUP_WEIGHT[setting.group.id] ?? 0.4) * (0.4 + 0.6 * a.intensity);
}

/** What the compiler's weighing step would resolve for a key from anchors alone (rules not applied). */
function anchorWinner(anchors: readonly WeightedPreset[], key: SceneKey, catalog: SceneCatalog): string {
  const setting = catalog.byKey.get(key)!;
  if (!setting.group.aiSelectable) return setting.default;
  const votes = new Map<string, number>();
  for (const { id, weight } of anchors) {
    const choice = PRESETS[id].settings[key];
    if (choice === undefined) continue;
    const { value, strength } = choiceOf(choice);
    votes.set(value, (votes.get(value) ?? 0) + weight * strength);
  }
  let best: [string, number] | null = null;
  for (const [v, w] of votes) {
    if (!best || w > best[1] + 1e-9 || (Math.abs(w - best[1]) <= 1e-9 && setting.values.indexOf(v) < setting.values.indexOf(best[0]))) best = [v, w];
  }
  return best && best[0] !== setting.default && best[1] >= MIN_DISCRETE_WEIGHT ? best[0] : setting.default;
}

function anchorWeights(style: StyleVector, ids: readonly Exclude<ScenePresetId, 'neutral'>[], presence: number): WeightedPreset[] {
  const sims = ids.map((id) => Math.exp(-(distance(style, PRESET_ANCHORS[id]) ** 2) / 1.5));
  const total = sims.reduce((s, x) => s + x, 0) || 1;
  return ids
    .map((id, i) => ({ id, weight: round3((sims[i] / total) * presence) }))
    .filter((p) => p.weight > 0)
    .sort((a, b) => b.weight - a.weight || PRESET_IDS.indexOf(a.id) - PRESET_IDS.indexOf(b.id));
}

function subsets<T>(items: readonly T[], max: number): T[][] {
  const out: T[][] = [[]];
  const rec = (start: number, acc: T[]) => {
    for (let i = start; i < items.length; i++) {
      const next = [...acc, items[i]];
      out.push(next);
      if (next.length < max) rec(i + 1, next);
    }
  };
  rec(0, []);
  return out;
}

/**
 * Keys realized as a *blend* (palette swatches and the global grade): showing
 * the right value is not enough, it must also be strong enough, or a "moonlit"
 * park at 27% still reads as a daytime park.
 */
const isContinuous = (key: SceneKey) => key in PALETTE_SWATCHES || key.startsWith('global_grade.');
/** Share of its intended strength a continuous value must reach to count as realized. */
export const MIN_STRENGTH_SHARE = 0.6;

function anchorStrength(anchors: readonly WeightedPreset[], key: SceneKey, value: string): number {
  let s = 0;
  for (const { id, weight } of anchors) {
    const choice = PRESETS[id].settings[key];
    if (choice === undefined) continue;
    const c = choiceOf(choice);
    if (c.value === value) s += weight * c.strength;
  }
  return s;
}

/** 0 (missing) .. 1 (realized) for a value given what was resolved and how strongly. */
function realization(a: Assignment, resolved: string, strength: number | undefined): number {
  if (resolved !== a.value) return 0;
  if (!isContinuous(a.key)) return 1;
  return Math.min(1, (strength ?? 0) / (MIN_STRENGTH_SHARE * a.intensity));
}

/** Overrides the anchors need, most important first (a too-weak blend counts in proportion to its deficit). */
function mismatches(target: Target, anchors: readonly WeightedPreset[], capabilities: CapabilityProfile, catalog: SceneCatalog) {
  return [...target.values()]
    .map((a) => {
      const shown = anchorWinner(anchors, a.key, catalog);
      const got = realization(a, shown, anchorStrength(anchors, a.key, a.value));
      return { a, w: importance(a, capabilities, catalog) * (1 - got) };
    })
    .filter((m) => m.w > 1e-6)
    .sort((x, y) => y.w - x.w || (x.a.key < y.a.key ? -1 : 1));
}

/** Emulated conflicts: what the anchors plus the top overrides would resolve, checked against the hard tag rules. */
function emulatedConflicts(target: Target, anchors: readonly WeightedPreset[], overridden: ReadonlySet<SceneKey>, catalog: SceneCatalog): number {
  const active: Array<[SceneKey, string]> = [];
  for (const s of catalog.settings) {
    if (!s.group.aiSelectable) continue;
    const v = overridden.has(s.key) ? target.get(s.key)!.value : anchorWinner(anchors, s.key, catalog);
    if (v !== s.default) active.push([s.key, v]);
  }
  return new Set(tagConflicts(active).map((c) => [c.a.key, c.b.key].sort().join('|'))).size;
}

/** Candidate anchor sets, cheapest first, by an emulation of the compiler's weighing step. */
function rankAnchorSets(composition: Composition, target: Target, capabilities: CapabilityProfile, catalog: SceneCatalog): WeightedPreset[][] {
  const ids = (Object.keys(PRESET_ANCHORS) as Exclude<ScenePresetId, 'neutral'>[])
    .map((id) => ({ id, d: distance(composition.style, PRESET_ANCHORS[id]) }))
    .sort((a, b) => a.d - b.d || PRESET_IDS.indexOf(a.id) - PRESET_IDS.indexOf(b.id))
    .slice(0, ANCHOR_CANDIDATES)
    .map((x) => x.id);
  const ranked: Array<{ anchors: WeightedPreset[]; cost: number; sim: number }> = [];
  for (const subset of subsets(ids, catalog.maxWeightedPresets)) {
    const anchors = anchorWeights(composition.style, subset, composition.presence);
    const miss = mismatches(target, anchors, capabilities, catalog);
    const residual = miss.slice(catalog.composerOverrideLimit).reduce((s, m) => s + m.w, 0);
    // Values the anchors add that the composition did not ask for: small cost, they dilute the world's identity.
    let extras = 0;
    for (const s of catalog.settings) {
      if (target.has(s.key) || !s.group.aiSelectable) continue;
      if (anchorWinner(anchors, s.key, catalog) !== s.default) extras += 0.12 * (GROUP_WEIGHT[s.group.id] ?? 0.4);
    }
    // Every conflict the anchors bring costs a repair, i.e. an override slot taken from the world itself.
    const conflicts = emulatedConflicts(target, anchors, new Set(miss.slice(0, catalog.composerOverrideLimit).map((m) => m.a.key)), catalog);
    const cost = round3(residual + extras + CONFLICT_COST * conflicts + 0.02 * subset.length);
    const sim = -subset.reduce((s, id) => s + distance(composition.style, PRESET_ANCHORS[id]), 0);
    ranked.push({ anchors, cost, sim });
  }
  ranked.sort((a, b) => a.cost - b.cost || b.sim - a.sim);
  return ranked.map((r) => r.anchors);
}

/** Conflict cost in importance units (about one renderable override). */
export const CONFLICT_COST = 1.5;
/** How many of the cheapest anchor sets are fully encoded and compiled (the empty set always is too). */
export const FULL_CANDIDATES = 3;

export function encodeComposition(composition: Composition, options: EncodeOptions): Encoding {
  const catalog = options.catalog ?? SCENE_CATALOG;
  const capabilities = options.capabilities ?? PALETTE_ADAPTER_V0;
  const preview = previewAllCapabilities(catalog);
  const context: SceneContext = { ...DEFAULT_CONTEXT, ...options.context, navigation: 'browse' };
  const target: Target = new Map(composition.assignments.map((a) => [a.key, a]));
  const explicitKeys = new Set(composition.assignments.filter((a) => a.source === 'explicit').map((a) => a.key));
  const limit = catalog.composerOverrideLimit;

  const build = (anchors: readonly WeightedPreset[], overrides: readonly SceneOverride[]): Encoding['intent'] => ({
    schemaVersion: SCENE_SCHEMA_VERSION,
    sessionVersion: options.version,
    presets: anchors,
    descriptors: [] as string[],
    overrides,
  });
  const compileWith = (intent: Encoding['intent']) =>
    compileScene({ outing: intent, outingTrust: 'composer', capabilities: preview, context, catalog, assets: options.assets ?? null });
  const check = (state: SceneState) => checkCoherence(state.resolved, { catalog, densityCap: composition.density.cap, explicitKeys });

  /** Overrides, repair loop and anchor-dropping ladder for one starting anchor set. */
  function encodeWith(start: readonly WeightedPreset[]): { encoding: Encoding; score: number } {
    const repairs: string[] = [];
    let anchors = start;
    for (;;) {
      const ranked = mismatches(target, anchors, capabilities, catalog);
      const overrides = new Map<SceneKey, { o: SceneOverride; w: number; fix: boolean }>();
      for (const { a, w } of ranked.slice(0, limit)) overrides.set(a.key, { o: { key: a.key, value: a.value, intensity: a.intensity }, w, fix: false });

      let intent = build(anchors, [...overrides.values()].map((x) => x.o));
      let state = compileWith(intent);
      let report = check(state);
      for (let round = 0; round < 8 && !report.ok; round++) {
        let changed = false;
        for (const v of report.violations) {
          // Prefer fixing a value the composition did not ask for; never touch explicit requests.
          const candidates = [...v.keys].filter((k) => !explicitKeys.has(k)).sort((x, y) => Number(target.get(x)?.value === state.resolved[x]) - Number(target.get(y)?.value === state.resolved[y]));
          for (const key of candidates) {
            const wanted = target.get(key);
            if (wanted && wanted.value === state.resolved[key]) continue; // the composition's own value is not the problem
            const fixValue = wanted?.value ?? catalog.byKey.get(key)!.default;
            if (overrides.get(key)?.o.value === fixValue) continue;
            if (!overrides.has(key) && overrides.size >= limit) {
              const victim = [...overrides.entries()].filter(([k, x]) => !x.fix && !explicitKeys.has(k)).sort((x, y) => x[1].w - y[1].w)[0];
              if (!victim) continue;
              overrides.delete(victim[0]);
            }
            overrides.set(key, { o: wanted ? { key, value: fixValue, intensity: wanted.intensity } : { key, value: fixValue }, w: Infinity, fix: true });
            repairs.push(`${v.rule}: ${key} ${state.resolved[key]} → ${fixValue}`);
            changed = true;
            break;
          }
        }
        if (!changed) break;
        intent = build(anchors, [...overrides.values()].map((x) => x.o));
        state = compileWith(intent);
        report = check(state);
      }
      if (report.ok || anchors.length === 0) {
        const unrealized: Unrealized[] = [];
        let realized = 0;
        let score = 0;
        for (const a of target.values()) {
          const got = realization(a, state.resolved[a.key], state.strengths[a.key]);
          score += importance(a, capabilities, catalog) * got;
          if (state.resolved[a.key] === a.value) realized++;
          else unrealized.push({ key: a.key, value: a.value, resolved: state.resolved[a.key], reason: overrides.has(a.key) ? 'compiler_rule' : 'override_budget' });
        }
        const live = compileScene({ outing: intent, outingTrust: 'composer', capabilities, context, catalog, assets: options.assets ?? null });
        const drawable = [...target.values()].filter((a) => supports(capabilities, a.key, a.value, catalog.byKey.get(a.key)!.default));
        const drawn = drawable.reduce((n, a) => n + realization(a, live.resolved[a.key], live.strengths[a.key]), 0);
        // An incoherent result (only possible if explicit requests conflict with each other) never wins.
        if (!report.ok) score = -Infinity;
        return {
          score,
          encoding: Object.freeze({
            intent,
            anchors,
            fidelity: target.size ? round3(realized / target.size) : 1,
            renderableFidelity: drawable.length ? round3(drawn / drawable.length) : 1,
            unrealized,
            repairs,
            coherence: report,
            preview: state,
          }),
        };
      }
      repairs.push(`anchors ${anchors.map((p) => p.id).join('+')} could not be made coherent within ${limit} overrides; dropped ${anchors[anchors.length - 1].id}`);
      anchors = anchorWeights(composition.style, anchors.slice(0, -1).map((p) => p.id as Exclude<ScenePresetId, 'neutral'>), composition.presence);
    }
  }

  if (!target.size) return encodeWith([]).encoding;
  const candidates = rankAnchorSets(composition, target, capabilities, catalog).slice(0, FULL_CANDIDATES);
  if (!candidates.some((c) => c.length === 0)) candidates.push([]);
  let best: { encoding: Encoding; score: number } | null = null;
  for (const anchors of candidates) {
    const r = encodeWith(anchors);
    if (!best || r.score > best.score + 1e-9) best = r;
  }
  return best!.encoding;
}

/**
 * Repair an intent against a state the session actually produced. The session
 * feeds the previous scene back as `previous` (hysteresis), which can keep a
 * low-weight anchor value alive that verification without history never saw.
 * Each offending key that is neither explicit nor the composition's own value
 * gets an override (the composition's value, else the default); an override
 * replaces the slot's choices, so nothing can be held there any more.
 */
export function repairIntent(
  intent: Encoding['intent'], violations: readonly Violation[], resolved: Readonly<Record<SceneKey, string>>, composition: Composition,
  catalog: SceneCatalog = SCENE_CATALOG,
): { intent: Encoding['intent']; repairs: string[] } | null {
  const target = new Map(composition.assignments.map((a) => [a.key, a]));
  const overrides = new Map(intent.overrides.map((o) => [o.key, o]));
  const fixed = new Set<SceneKey>();
  const repairs: string[] = [];
  for (const v of violations) {
    for (const key of v.keys) {
      const wanted = target.get(key);
      if (wanted?.source === 'explicit' || (wanted && wanted.value === resolved[key]) || fixed.has(key)) continue;
      const value = wanted?.value ?? catalog.byKey.get(key)!.default;
      if (!overrides.has(key) && overrides.size >= catalog.composerOverrideLimit) {
        const victim = [...overrides.values()]
          .filter((o) => !fixed.has(o.key) && target.get(o.key)?.source !== 'explicit')
          .sort((a, b) => (a.intensity ?? 1) - (b.intensity ?? 1) || (a.key < b.key ? -1 : 1))[0];
        if (!victim) continue;
        overrides.delete(victim.key);
      }
      overrides.set(key, wanted ? { key, value, intensity: wanted.intensity } : { key, value });
      fixed.add(key);
      repairs.push(`session ${v.rule}: ${key} ${resolved[key]} → ${value}`);
      break;
    }
  }
  return repairs.length ? { intent: { ...intent, overrides: [...overrides.values()] }, repairs } : null;
}
