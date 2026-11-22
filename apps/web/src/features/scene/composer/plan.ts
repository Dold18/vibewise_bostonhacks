/**
 * CityRenderPlan: the complete, validated rendering plan derived from the
 * Scene Session's compiled state (the source of truth) plus the composer's
 * non-catalog parameters.
 *
 * Rule: every catalog-keyed value in the plan is read from `SceneState.resolved`
 * — never from the composition — so the plan can never claim an effect the
 * compiler did not resolve or the renderer cannot draw. Values the world asked
 * for but this renderer cannot show are listed per section as `pending`.
 * Non-catalog parameters (architectural variation, decoration placement,
 * emphasis, harmony) come from the composition and are marked `proposed` until
 * a renderer consumes them.
 */
import type { CapabilityProfile } from '../capabilities';
import { SCENE_CATALOG, type SceneCatalog, type SceneKey } from '../catalog';
import type { SceneContext, SceneState } from '../state';
import { DEFAULT_CONTEXT } from '../state';
import { checkCoherence, type CoherenceReport } from './coherence';
import type { Composition, Pick } from './compose';
import { resolveDecor, RESTRICTED_TAGS, type AssetTagIndex, type DecorPlan } from './decor';
import type { Encoding } from './encode';
import { tagsOf } from './tags';

export const CITY_PLAN_SCHEMA = 'vibenta.city-plan/0.1' as const;

export interface PlanSection {
  /** Non-default resolved values in this section, by setting name (group prefix dropped where unambiguous). */
  readonly active: Readonly<Record<string, string>>;
  /** Effective strength (0..1) of each active value. */
  readonly strengths: Readonly<Record<string, number>>;
  /** Requested by the world but not drawn by this renderer. */
  readonly pending: readonly { readonly key: SceneKey; readonly value: string; readonly reason: string }[];
}

export interface CityRenderPlan {
  readonly schema: typeof CITY_PLAN_SCHEMA;
  readonly sceneHash: string;
  readonly compositionId: string;
  readonly seed: string;
  readonly capabilityProfile: string;
  readonly source: SceneState['source'];
  readonly presence: number;
  readonly confidence: number;
  readonly harmony: Composition['harmony'];
  readonly emphasis: Composition['emphasis'];
  readonly focal: Composition['focal'];
  readonly colors: {
    readonly ground: string; readonly buildings: string; readonly towers: string; readonly roads: string;
    readonly water: string; readonly parks: string; readonly sky: string; readonly horizon: string; readonly accent: string | null;
  };
  readonly lighting: PlanSection & {
    readonly key: SceneState['lighting'];
    readonly sky: SceneState['sky'];
    /** Compass azimuth and altitude of the key light, from the compiled light position. */
    readonly azimuthDeg: number;
    readonly altitudeDeg: number;
    readonly timeClass: 'day' | 'dusk' | 'night' | 'overcast' | 'stylized' | 'neutral';
  };
  readonly architecture: PlanSection & { readonly proposed: Composition['architecture'] };
  readonly streets: PlanSection;
  readonly environment: PlanSection;
  readonly atmosphere: PlanSection & { readonly overlays: SceneState['overlays'] };
  readonly artistry: PlanSection;
  readonly markers: PlanSection & { readonly pinEdge: SceneState['pinEdge']; readonly darkMode: boolean };
  readonly motion: PlanSection & { readonly transitionMs: number; readonly ambient: boolean };
  readonly decoration: DecorPlan;
  readonly coherence: CoherenceReport;
  readonly provenance: {
    readonly anchors: Encoding['anchors'];
    readonly overrides: number;
    readonly fidelity: number;
    readonly unrealized: Encoding['unrealized'];
    readonly repairs: Encoding['repairs'];
    readonly picks: readonly Pick[];
  };
  readonly safety: {
    readonly geometry: 'preserved';
    readonly verifiedVenue: string | null;
    /** Cultural/observance words heard but deliberately not styled. */
    readonly culturalTermsNotStyled: readonly string[];
  };
}

const SECTIONS: Readonly<Record<string, readonly string[]>> = {
  lighting: ['sky_and_horizon', 'lighting_and_shadows'],
  architecture: ['building_surfaces'],
  streets: ['roads_and_ground'],
  environment: ['natural_land', 'water_and_coast'],
  atmosphere: ['air_and_atmosphere'],
  artistry: ['cinematic_and_artistic', 'global_grade'],
  markers: ['marker_recommendations', 'neighborhood_and_places', 'interface_and_cards', 'text_and_labels'],
  motion: ['animation_and_morph'],
};

function section(state: SceneState, catalog: SceneCatalog, groups: readonly string[], composition: Composition): PlanSection {
  const active: Record<string, string> = {};
  const strengths: Record<string, number> = {};
  const short = groups.length === 1;
  for (const s of catalog.settings) {
    if (!groups.includes(s.group.id)) continue;
    const v = state.resolved[s.key];
    if (v === undefined || v === s.default) continue;
    const name = short ? s.key.split('.')[1] : s.key;
    active[name] = v;
    if (state.strengths[s.key] !== undefined) strengths[name] = state.strengths[s.key];
  }
  const pending = state.disabled
    .filter((d) => groups.includes(d.key.split('.')[0]))
    .map((d) => ({ key: d.key, value: d.value, reason: d.reason }));
  // A world value the compiler resolved differently for reasons other than capability (rules, budget).
  for (const a of composition.assignments) {
    if (!groups.includes(a.key.split('.')[0]) || state.resolved[a.key] === a.value) continue;
    if (pending.some((p) => p.key === a.key)) continue;
    pending.push({ key: a.key, value: a.value, reason: 'not resolved by the compiler (rule, budget or navigation)' });
  }
  return { active, strengths, pending };
}

function timeClass(resolved: Readonly<Record<SceneKey, string>>): CityRenderPlan['lighting']['timeClass'] {
  const tags = tagsOf('sky_and_horizon.sky_mode', resolved['sky_and_horizon.sky_mode']);
  if (tags.includes('night')) return 'night';
  if (tags.includes('dusk')) return 'dusk';
  if (tags.includes('day')) return 'day';
  if (tags.includes('overcast')) return 'overcast';
  if (tags.length) return 'stylized';
  return 'neutral';
}

export interface DerivePlanOptions {
  readonly encoding: Encoding;
  readonly context?: Partial<SceneContext>;
  readonly capabilities?: CapabilityProfile;
  readonly assetIndex?: AssetTagIndex | null;
  readonly catalog?: SceneCatalog;
}

export function deriveCityPlan(state: SceneState, composition: Composition, options: DerivePlanOptions): CityRenderPlan {
  const catalog = options.catalog ?? SCENE_CATALOG;
  // A state that carries its own context (proposed on feature/scene-asset-rendering) is the source of truth.
  const stateContext = (state as SceneState & { readonly context?: Partial<SceneContext> }).context;
  const context: SceneContext = { ...DEFAULT_CONTEXT, ...options.context, ...stateContext };
  const has3d = options.capabilities?.features.has('set_piece_3d') ?? false;
  const p = state.palette;
  const [, azimuth, polar] = state.lighting.position;
  const sec = (name: string) => section(state, catalog, SECTIONS[name], composition);
  const explicitKeys = new Set(composition.assignments.filter((a) => a.source === 'explicit').map((a) => a.key));
  return Object.freeze({
    schema: CITY_PLAN_SCHEMA,
    sceneHash: state.hash,
    compositionId: composition.id,
    seed: composition.seed,
    capabilityProfile: state.capabilityProfile,
    source: state.source,
    presence: composition.presence,
    confidence: composition.interpretation.confidence,
    harmony: composition.harmony,
    emphasis: composition.emphasis,
    focal: composition.focal,
    colors: {
      ground: p.land, buildings: p.building, towers: p.building3dHigh, roads: p.roadMajor, water: p.water, parks: p.park,
      sky: p.sky, horizon: p.horizon, accent: state.ui.accent,
    },
    lighting: { ...sec('lighting'), key: state.lighting, sky: state.sky, azimuthDeg: azimuth, altitudeDeg: 90 - polar, timeClass: timeClass(state.resolved) },
    architecture: { ...sec('architecture'), proposed: composition.architecture },
    streets: sec('streets'),
    environment: sec('environment'),
    atmosphere: { ...sec('atmosphere'), overlays: state.overlays },
    artistry: sec('artistry'),
    markers: { ...sec('markers'), pinEdge: state.pinEdge, darkMode: state.darkMode },
    motion: { ...sec('motion'), transitionMs: state.motion.transitionMs, ambient: state.motion.ambient },
    decoration: resolveDecor(composition.decor, state, context, composition.seed, composition.interpretation.venue, options.assetIndex ?? null, has3d),
    coherence: checkCoherence(state.resolved, { catalog, explicitKeys, palette: state.palette, harmony: composition.harmony }),
    provenance: {
      anchors: options.encoding.anchors,
      overrides: options.encoding.intent.overrides.length,
      fidelity: options.encoding.fidelity,
      unrealized: options.encoding.unrealized,
      repairs: options.encoding.repairs,
      picks: composition.picks,
    },
    safety: {
      geometry: 'preserved' as const,
      verifiedVenue: composition.interpretation.venue?.verified ? composition.interpretation.venue.placeId : null,
      culturalTermsNotStyled: composition.interpretation.culturalTerms,
    },
  });
}

/**
 * Structural validation of a plan before a renderer consumes it. Returns
 * human-readable problems (empty = valid).
 */
export function validatePlan(plan: CityRenderPlan, state: SceneState, index: AssetTagIndex | null, catalog: SceneCatalog = SCENE_CATALOG): string[] {
  const problems: string[] = [];
  if (plan.sceneHash !== state.hash) problems.push('plan was derived from a different scene state');
  for (const s of catalog.settings) {
    if (!s.group.aiSelectable && state.resolved[s.key] !== s.default) problems.push(`locked setting ${s.key} changed`);
  }
  if (!plan.coherence.ok) problems.push(...plan.coherence.violations.map((v) => `incoherent: ${v.detail}`));
  const d = plan.decoration;
  for (const f of d.families) {
    for (const id of f.assetIds) {
      const tags = index?.models.get(id);
      if (!tags) problems.push(`decoration ${id} is not a verified asset`);
      else if (tags.some((t) => RESTRICTED_TAGS.has(t))) problems.push(`decoration ${id} carries restricted tags (${tags.filter((t) => RESTRICTED_TAGS.has(t)).join(', ')})`);
    }
  }
  if (d.contextual) {
    const layout = index?.layouts.get(d.contextual.layoutId);
    if (!layout) problems.push(`contextual layout ${d.contextual.layoutId} is not verified`);
    if (layout?.activation === 'explicit_holiday_request_only' && !d.contextual.basis.startsWith('explicit opt-in')) problems.push('observance layout without explicit opt-in');
    if (layout?.activation === 'explicit_or_verified_context' && plan.safety.verifiedVenue === null) problems.push('venue-specific layout without a verified venue');
  }
  if (d.maxInstances < 0 || d.maxInstances > 24) problems.push('decoration count out of range');
  return problems;
}
