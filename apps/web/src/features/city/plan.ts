/**
 * SceneState → CityPlan.
 *
 * - `baselinePlanner`: the minimal, faithful translation (one Treatment per
 *   non-default catalog setting routed to a section). The composition
 *   workstream replaces/extends it in `composition/`; the engine falls back to
 *   it if that planner throws.
 * - `enforcePolicy`: applied by the engine to EVERY plan, whoever wrote it.
 *   Navigation safety, reduced motion, user toggles, section ownership,
 *   manifest-backed assets, value ranges and budgets live here, once.
 */
import { MATERIALS } from '../scene/materials';
import { ATMOSPHERE } from '../scene/atmosphere';
import { SCENE_CATALOG, type SceneKey } from '../scene/catalog';
import { hashString, stableStringify, type SceneState } from '../scene/state';
import type { Palette } from '../../mapStyle';
import { allocateBudget, clampBudget } from './budget';
import {
  CITY_PLAN_VERSION, SECTION_IDS,
  type AssetRef, type AssetResolver, type CityPlan, type CityPlanner, type CitySections, type DecorationElement,
  type PerformanceTier, type RenderMode, type SectionId, type Treatment, type Variation,
} from './contracts';
import { DECORATION_ANCHORS, sectionOf, settingId } from './routing';
import { subSeed, toSeed } from './seed';

/**
 * Preferred asset per catalog value, from the asset renderers already in the
 * repo (scene/materials.ts, scene/atmosphere.ts). Manifests only map assets to
 * keys; this is the only value-level knowledge so far. Composition may refine it.
 */
const ASSET_HINTS: Readonly<Record<SceneKey, Readonly<Record<string, string>>>> = { ...MATERIALS, ...ATMOSPHERE };

/** Baseline spatial variation per section (composition tunes these per vibe). */
const VARIATION: Readonly<Record<SectionId, { amount: number; cellMeters: number }>> = {
  buildings: { amount: 0.35, cellMeters: 120 },
  streets: { amount: 0.25, cellMeters: 200 },
  decorations: { amount: 0.5, cellMeters: 80 },
  atmosphere: { amount: 0, cellMeters: 600 },
};

/**
 * Under a route or focused destination (the compiler's ratified `navigation_legibility`
 * rule: "palette kept; overlays/decorations off"):
 * - atmosphere: only a soft vignette survives;
 * - decorations: off;
 * - buildings and streets: kept, because they are the city's material identity and the
 *   compiler keeps them too. Their renderers apply their own documented legibility
 *   reductions from `env.mode.navigation` (calmer textures, lamps/glows off), and every
 *   route, stop and label layer draws above them.
 */
export const NAVIGATION_POLICY = Object.freeze({
  keepAtmosphere: Object.freeze(['air_and_atmosphere.vignette']) as readonly SceneKey[],
  atmosphereCap: 0.35,
  keepSections: Object.freeze(['buildings', 'streets']) as readonly SectionId[],
});

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};
const HEX = /^#[0-9a-f]{6}$/i;

function assetsFor(assets: AssetResolver, key: SceneKey, value: string): AssetRef[] {
  const hinted = ASSET_HINTS[key]?.[value];
  const out: AssetRef[] = [];
  const first = hinted ? assets.resolve(hinted) : null;
  if (first) out.push(first);
  for (const ref of assets.texturesFor(key)) if (!out.some((r) => r.id === ref.id)) out.push(ref);
  return out.slice(0, 8);
}

export const tierOf = (state: SceneState): PerformanceTier => state.context?.performance ?? 'medium';

function modeOf(state: SceneState): RenderMode {
  const navigation = state.context?.navigation ?? 'browse';
  const reducedMotion = state.context?.reducedMotion ?? false;
  return {
    navigation,
    reducedMotion,
    ambientMotion: state.motion.ambient && !reducedMotion && navigation === 'browse' && tierOf(state) !== 'low',
    darkMode: state.darkMode,
  };
}

function sectionColors(p: Palette) {
  return {
    buildings: { footprint: p.building, outline: p.buildingOutline, low: p.building3d, mid: p.building3dMid, high: p.building3dHigh, light: p.light },
    streets: {
      land: p.land, urban: p.urban, roadMinor: p.roadMinor, roadMajor: p.roadMajor, roadCasing: p.roadCasing,
      path: p.path, rail: p.rail, park: p.park, wood: p.wood, sand: p.sand, water: p.water,
    },
    atmosphere: { sky: p.sky, horizon: p.horizon, fog: p.horizon, light: p.light },
  };
}

const variation = (seed: number, section: SectionId): Variation => ({ ...VARIATION[section], seed: subSeed(seed, `variation:${section}`) });

/** Plan hash over everything except the hash itself. */
export const planHash = (plan: Omit<CityPlan, 'hash'>): string => hashString(stableStringify({ ...plan, hash: undefined }));

/** The minimal faithful SceneState → CityPlan translation. Pure and deterministic. */
export const baselinePlanner: CityPlanner = ({ state, assets }) => {
  const seed = toSeed(state.context?.variationSeed);
  const tier = tierOf(state);
  const buckets: Record<SectionId, Record<string, Treatment | DecorationElement>> = { buildings: {}, streets: {}, decorations: {}, atmosphere: {} };
  const unrouted: SceneKey[] = [];

  for (const setting of SCENE_CATALOG.settings) {
    const value = state.resolved[setting.key];
    const strength = state.strengths[setting.key] ?? 0;
    if (value === undefined || value === setting.default || !(strength > 0)) continue;
    const section = sectionOf(setting.key);
    if (!section) {
      unrouted.push(setting.key);
      continue;
    }
    const id = settingId(setting.key);
    const treatment: Treatment = {
      key: setting.key,
      style: value,
      intensity: clamp(strength, 0, 1, 0),
      scale: 1,
      tint: null,
      assets: assetsFor(assets, setting.key, value),
      seed: subSeed(seed, setting.key),
    };
    buckets[section][id] = section === 'decorations' ? { ...treatment, anchor: DECORATION_ANCHORS[id] ?? 'plaza', tags: [] } : treatment;
  }

  const colors = sectionColors(state.palette);
  const setPiece = state.setPiece
    ? {
        layoutId: state.setPiece.layoutId,
        hero: state.setPiece.heroAssetIds.flatMap((id) => assets.resolve(id) ?? []),
        accent: state.setPiece.accentAssetIds.flatMap((id) => assets.resolve(id) ?? []),
      }
    : null;
  const any = (s: SectionId) => Object.keys(buckets[s]).length > 0;
  const sections: CitySections = {
    buildings: { enabled: any('buildings'), treatments: buckets.buildings, variation: variation(seed, 'buildings'), colors: colors.buildings },
    streets: { enabled: any('streets'), treatments: buckets.streets, variation: variation(seed, 'streets'), colors: colors.streets },
    decorations: {
      enabled: any('decorations') || !!setPiece,
      treatments: buckets.decorations as Record<string, DecorationElement>,
      variation: variation(seed, 'decorations'),
      setPiece,
    },
    atmosphere: {
      enabled: any('atmosphere'),
      treatments: buckets.atmosphere,
      variation: variation(seed, 'atmosphere'),
      colors: { ...colors.atmosphere, fog: state.sky.fogColor },
      light: { color: state.lighting.color, intensity: state.lighting.intensity },
    },
  };

  const plan: Omit<CityPlan, 'hash'> = {
    version: CITY_PLAN_VERSION,
    sceneHash: state.hash,
    seed,
    tier,
    mode: modeOf(state),
    palette: state.palette,
    budget: allocateBudget(tier),
    sections,
    unrouted,
    notes: [],
  };
  return { ...plan, hash: planHash(plan) };
};

/**
 * Make any planner's output safe and honest. Never trusts the planner for:
 * mode, seed, tier, palette, section colors, navigation safety, toggles,
 * section ownership of keys, asset IDs, value ranges or budget totals.
 */
export function enforcePolicy(plan: CityPlan, state: SceneState, assets: AssetResolver): CityPlan {
  const ctx = state.context;
  const mode = modeOf(state);
  const browsing = mode.navigation === 'browse';
  const tier = tierOf(state);
  const seed = toSeed(ctx?.variationSeed);
  const notes = [...(Array.isArray(plan.notes) ? plan.notes : [])];
  const colors = sectionColors(state.palette);

  const cleanAssets = (list: readonly AssetRef[] | undefined): AssetRef[] =>
    (Array.isArray(list) ? list : []).flatMap((a) => {
      const ref = a && typeof a.id === 'string' ? assets.resolve(a.id) : null;
      if (!ref) notes.push(`dropped asset not in a manifest: ${String(a?.id)}`);
      return ref ? [ref] : [];
    });

  function clean<T extends Treatment>(section: SectionId, input: Readonly<Record<string, T>> | undefined): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [id, t] of Object.entries(input ?? {})) {
      if (!t || typeof t.key !== 'string' || sectionOf(t.key) !== section || settingId(t.key) !== id) {
        notes.push(`dropped ${String(t?.key ?? id)}: not owned by ${section}`);
        continue;
      }
      let intensity = clamp(t.intensity, 0, 1, 0);
      if (!browsing && !NAVIGATION_POLICY.keepSections.includes(section)) {
        intensity = section === 'atmosphere' && NAVIGATION_POLICY.keepAtmosphere.includes(t.key) ? Math.min(intensity, NAVIGATION_POLICY.atmosphereCap) : 0;
      }
      if (intensity <= 0) continue;
      out[id] = {
        ...t,
        style: String(t.style),
        intensity,
        scale: clamp(t.scale, 0.25, 4, 1),
        tint: typeof t.tint === 'string' && HEX.test(t.tint) ? t.tint : null,
        assets: cleanAssets(t.assets),
        seed: toSeed(t.seed),
      };
    }
    return out;
  }

  const cleanVariation = (v: Variation | undefined, section: SectionId): Variation => ({
    amount: clamp(v?.amount, 0, 1, VARIATION[section].amount),
    cellMeters: clamp(v?.cellMeters, 10, 5000, VARIATION[section].cellMeters),
    seed: v ? toSeed(v.seed) : subSeed(seed, `variation:${section}`),
  });

  const s = plan.sections;
  const buildings = clean('buildings', s?.buildings?.treatments);
  const streets = clean('streets', s?.streets?.treatments);
  const atmosphere = clean('atmosphere', s?.atmosphere?.treatments);
  const decorations = Object.fromEntries(
    Object.entries(clean('decorations', s?.decorations?.treatments)).map(([id, t]) => [
      id,
      { ...t, anchor: t.anchor ?? DECORATION_ANCHORS[id] ?? 'plaza', tags: Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string') : [] },
    ]),
  ) as Record<string, DecorationElement>;
  const sp = s?.decorations?.setPiece;
  const setPiece =
    browsing && ctx?.installationsEnabled !== false && sp && typeof sp.layoutId === 'string'
      ? { layoutId: sp.layoutId, hero: cleanAssets(sp.hero), accent: cleanAssets(sp.accent) }
      : null;

  const surfaces = ctx?.materialsEnabled !== false;
  const has = (t: object) => Object.keys(t).length > 0;
  const sections: CitySections = {
    buildings: {
      enabled: surfaces && s?.buildings?.enabled !== false && has(buildings),
      treatments: surfaces ? buildings : {},
      variation: cleanVariation(s?.buildings?.variation, 'buildings'),
      colors: colors.buildings,
    },
    streets: {
      enabled: surfaces && s?.streets?.enabled !== false && has(streets),
      treatments: surfaces ? streets : {},
      variation: cleanVariation(s?.streets?.variation, 'streets'),
      colors: colors.streets,
    },
    decorations: {
      enabled: browsing && s?.decorations?.enabled !== false && (has(decorations) || !!setPiece),
      treatments: browsing ? decorations : {},
      variation: cleanVariation(s?.decorations?.variation, 'decorations'),
      setPiece,
    },
    atmosphere: {
      enabled: ctx?.atmosphereEnabled !== false && s?.atmosphere?.enabled !== false && has(atmosphere),
      treatments: ctx?.atmosphereEnabled !== false ? atmosphere : {},
      variation: cleanVariation(s?.atmosphere?.variation, 'atmosphere'),
      colors: { ...colors.atmosphere, fog: state.sky.fogColor },
      light: { color: state.lighting.color, intensity: state.lighting.intensity },
    },
  };

  const safe: Omit<CityPlan, 'hash'> = {
    version: CITY_PLAN_VERSION,
    sceneHash: state.hash,
    seed,
    tier,
    mode,
    palette: state.palette,
    budget: clampBudget(tier, plan.budget ?? allocateBudget(tier)),
    sections,
    unrouted: Array.isArray(plan.unrouted) ? plan.unrouted.filter((k) => typeof k === 'string') : [],
    notes,
  };
  return Object.freeze({ ...safe, hash: planHash(safe) });
}

/** The plan for "no scene" (released): every section disabled. */
export function releasedPlan(state: SceneState, assets: AssetResolver): CityPlan {
  const empty = Object.fromEntries(SECTION_IDS.map((id) => [id, { enabled: false, treatments: {} }]));
  return enforcePolicy({ ...baselinePlanner({ state, assets }), sections: empty as unknown as CitySections }, state, assets);
}

/**
 * The policy-applied SceneState renderers read (contracts.ts `SceneView`): every
 * key routed to a city section carries the plan's intensity (0 when the policy
 * dropped it), and the set piece follows the plan. Everything else is the
 * compiled state unchanged. Pure; same (state, plan) ⇒ same view.
 */
export function sceneView(state: SceneState, plan: CityPlan): SceneState {
  const strengths: Record<SceneKey, number> = {};
  for (const [key, strength] of Object.entries(state.strengths)) {
    const section = sectionOf(key);
    if (!section) {
      strengths[key] = strength;
      continue;
    }
    const t = plan.sections[section].enabled ? plan.sections[section].treatments[settingId(key)] : undefined;
    if (t && t.intensity > 0) strengths[key] = t.intensity;
  }
  const setPiece = plan.sections.decorations.setPiece && state.setPiece ? state.setPiece : null;
  return Object.freeze({ ...state, strengths, setPiece });
}
