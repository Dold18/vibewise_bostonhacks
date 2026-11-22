/**
 * City engine: turns each SceneState from the one Scene Session into one
 * CityPlan and hands every registered renderer its own section.
 *
 * - Registration: renderers declare capabilities synchronously. The engine
 *   checks section ownership and exclusivity, and composes the capability
 *   profile the Scene Session compiles against (so only drawable values reach
 *   SceneState).
 * - Isolation: a renderer that throws is counted and, after `maxFailures`
 *   consecutive failures (or a failed init), retired: disposed, its
 *   capabilities withdrawn (`onCapabilitiesChange`). The others never notice.
 * - Change detection: a renderer is called only when its section or env hash
 *   changed. Late-initializing renderers get the latest frame when ready.
 * - Lifecycle: init → update* → dispose. destroy() disposes everything.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AssetRegistry } from '../scene/assets';
import { MAP_RENDERER_V1, type CapabilityProfile, type SceneFeature } from '../scene/capabilities';
import { SCENE_CATALOG, type SceneKey } from '../scene/catalog';
import { hashString, stableStringify, type SceneState } from '../scene/state';
import { createAssetResolver, type AssetResolverOptions } from './assets';
import { overBudget } from './budget';
import {
  CityContractError, SECTION_IDS,
  type AnyCityRenderer, type AssetResolver, type CityPlan, type CityPlanner, type RenderFrame, type ResourceBudget,
  type SectionId, type Transition,
} from './contracts';
import { baselinePlanner, enforcePolicy, releasedPlan, sceneView } from './plan';
import { sectionOf } from './routing';

export type RendererStatus = 'pending' | 'ready' | 'retired' | 'disposed';

export interface CityEngineOptions {
  readonly renderers: readonly AnyCityRenderer[];
  readonly assets: AssetRegistry;
  /** Composition planner; defaults to `baselinePlanner`, which is also the fallback if it throws. */
  readonly planner?: CityPlanner;
  /**
   * Profile for everything not drawn by a city renderer (default MAP_RENDERER_V1,
   * the base theme). A key claimed by a city renderer replaces the base's values.
   */
  readonly base?: CapabilityProfile;
  readonly map?: MapLibreMap | null;
  readonly overlay?: HTMLElement | null;
  readonly loadImage?: AssetResolverOptions['loadImage'];
  /** Consecutive update() failures before a renderer is retired. Default 3. */
  readonly maxFailures?: number;
  readonly onError?: (error: unknown, rendererId: string | null) => void;
  /** The composed profile changed (a renderer was retired). Feed it to `SceneSession.setCapabilities`. */
  readonly onCapabilitiesChange?: (profile: CapabilityProfile) => void;
}

export interface RendererStats {
  readonly id: string;
  readonly section: SectionId;
  readonly status: RendererStatus;
  readonly deliveries: number;
  readonly failures: number;
  readonly claims: readonly SceneKey[];
  readonly usage: Partial<ResourceBudget> | null;
  readonly overBudget: readonly string[];
}

export interface CityEngineStats {
  readonly planHash: string | null;
  readonly sceneHash: string | null;
  readonly seed: number | null;
  readonly plannerFallbacks: number;
  readonly renderers: readonly RendererStats[];
}

export interface CityEngine {
  /** Base profile with every live renderer's claims: hand to mountScene / createSceneSession. */
  capabilities(): CapabilityProfile;
  /** Keys and features currently claimed by live renderers (for the legacy bridge). */
  claims(): { readonly keys: ReadonlySet<SceneKey>; readonly features: ReadonlySet<SceneFeature> };
  /** Derive the plan for `state` and deliver changed sections. `null` releases: every section fades out. */
  render(state: SceneState | null, timing?: { readonly transitionMs?: number }): void;
  plan(): CityPlan | null;
  readonly assets: AssetResolver;
  /** Resolves when every renderer's init has settled. */
  ready(): Promise<void>;
  stats(): CityEngineStats;
  destroy(): void;
}

interface Slot {
  readonly renderer: AnyCityRenderer;
  status: RendererStatus;
  deliveries: number;
  failures: number;
  lastHash: string | null;
  pending: RenderFrame<SectionId> | null;
}

/** Validate claims: the renderer's section owns every key, values are catalog values, nobody else claimed it. */
function validate(renderers: readonly AnyCityRenderer[]) {
  const ids = new Set<string>();
  const owner = new Map<SceneKey, string>();
  for (const r of renderers) {
    if (!r || typeof r.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(r.id)) throw new CityContractError(`renderer id must be kebab-case: ${String(r?.id)}`);
    if (ids.has(r.id)) throw new CityContractError(`duplicate renderer id ${r.id}`);
    ids.add(r.id);
    if (!SECTION_IDS.includes(r.section)) throw new CityContractError(`${r.id}: unknown section ${String(r.section)}`);
    for (const [key, values] of Object.entries(r.capabilities.values ?? {})) {
      const setting = SCENE_CATALOG.byKey.get(key);
      if (!setting) throw new CityContractError(`${r.id}: ${key} is not a catalog setting`);
      if (sectionOf(key) !== r.section) throw new CityContractError(`${r.id}: ${key} belongs to ${sectionOf(key) ?? 'no city section'}, not ${r.section}`);
      const bad = values.filter((v) => !setting.values.includes(v));
      if (bad.length) throw new CityContractError(`${r.id}: ${key} has no values ${bad.join(', ')}`);
      const prior = owner.get(key);
      if (prior) throw new CityContractError(`${key} claimed by both ${prior} and ${r.id}`);
      owner.set(key, r.id);
    }
    if (r.capabilities.features?.includes('set_piece_3d') && r.section !== 'decorations') {
      throw new CityContractError(`${r.id}: set_piece_3d belongs to decorations`);
    }
  }
}

export function createCityEngine(options: CityEngineOptions): CityEngine {
  validate(options.renderers);
  const base = options.base ?? MAP_RENDERER_V1;
  const planner = options.planner ?? baselinePlanner;
  const maxFailures = Math.max(1, options.maxFailures ?? 3);
  const assets = createAssetResolver(options.assets, { loadImage: options.loadImage });
  const slots: Slot[] = options.renderers.map((renderer) => ({ renderer, status: 'pending', deliveries: 0, failures: 0, lastHash: null, pending: null }));
  const inits: Promise<void>[] = [];
  let plan: CityPlan | null = null;
  let lastState: SceneState | null = null;
  let lastReason: Transition['reason'] = 'update';
  let plannerFallbacks = 0;
  let destroyed = false;
  let profile: CapabilityProfile;

  const report = (error: unknown, id: string | null) => {
    try {
      options.onError?.(error, id);
    } catch {
      /* a reporter must not break rendering */
    }
  };

  const live = () => slots.filter((s) => s.status === 'pending' || s.status === 'ready');

  function compose(): CapabilityProfile {
    const values = new Map(base.values);
    const features = new Set(base.features);
    const ids: string[] = [];
    for (const { renderer } of live()) {
      ids.push(renderer.id);
      for (const [key, v] of Object.entries(renderer.capabilities.values ?? {})) values.set(key, new Set(v));
      for (const f of renderer.capabilities.features ?? []) features.add(f);
    }
    return Object.freeze({ id: `${base.id}+city(${ids.join(',')})`, values, features });
  }

  function retire(slot: Slot, error: unknown) {
    if (slot.status === 'retired' || slot.status === 'disposed') return;
    report(error, slot.renderer.id);
    slot.status = 'retired';
    slot.pending = null;
    try {
      slot.renderer.dispose();
    } catch (e) {
      report(e, slot.renderer.id);
    }
    const hadClaims = Object.keys(slot.renderer.capabilities.values ?? {}).length > 0 || (slot.renderer.capabilities.features?.length ?? 0) > 0;
    if (hadClaims && !destroyed) {
      profile = compose();
      try {
        options.onCapabilitiesChange?.(profile);
      } catch (e) {
        report(e, null);
      }
    }
  }

  let view: { state: SceneState; plan: CityPlan; scene: SceneState } | null = null;
  const viewOf = (state: SceneState, p: CityPlan) => {
    if (view?.state !== state || view.plan !== p) view = { state, plan: p, scene: sceneView(state, p) };
    return view.scene;
  };

  function frameFor(slot: Slot, p: CityPlan, transition: Transition, state: SceneState): RenderFrame<SectionId> {
    const section = slot.renderer.section;
    return Object.freeze({
      section: p.sections[section],
      env: Object.freeze({ seed: p.seed, tier: p.tier, mode: p.mode, palette: p.palette, budget: p.budget[section] }),
      scene: viewOf(state, p),
      transition,
      planHash: p.hash,
    }) as RenderFrame<SectionId>;
  }

  function deliver(slot: Slot, frame: RenderFrame<SectionId>) {
    // The scene view is a pure function of (scene hash, plan hash); renderers dedupe their own derived inputs.
    const hash = hashString(stableStringify({ section: frame.section, env: frame.env, scene: frame.scene.hash, plan: frame.planHash }));
    if (hash === slot.lastHash) return;
    try {
      (slot.renderer.update as (f: RenderFrame<SectionId>) => void)(frame);
      slot.lastHash = hash;
      slot.deliveries++;
      slot.failures = 0;
    } catch (error) {
      slot.failures++;
      if (slot.failures >= maxFailures) retire(slot, error);
      else report(error, slot.renderer.id);
    }
  }

  // Initialize every renderer; a sync failure retires it before the first compile sees its claims.
  for (const slot of slots) {
    const { renderer } = slot;
    const ctx = {
      map: options.map ?? null,
      overlay: options.overlay ?? null,
      assets,
      idPrefix: `city-${renderer.id}-`,
      reportError: (error: unknown) => report(error, renderer.id),
    };
    const ready = () => {
      if (slot.status !== 'pending' || destroyed) return;
      slot.status = 'ready';
      const frame = slot.pending;
      slot.pending = null;
      if (frame) deliver(slot, { ...frame, transition: { durationMs: 0, reason: 'ready' } });
    };
    try {
      const result = renderer.init?.(ctx);
      if (result && typeof (result as Promise<void>).then === 'function') {
        inits.push((result as Promise<void>).then(ready, (error) => retire(slot, error)));
      } else ready();
    } catch (error) {
      slot.status = 'retired';
      report(error, renderer.id);
      try {
        renderer.dispose();
      } catch (e) {
        report(e, renderer.id);
      }
    }
  }
  profile = compose();

  function derive(state: SceneState): CityPlan {
    let raw: CityPlan;
    try {
      raw = planner({ state, assets });
    } catch (error) {
      plannerFallbacks++;
      report(error, null);
      raw = baselinePlanner({ state, assets });
    }
    return enforcePolicy(raw, state, assets);
  }

  let rendering = false;
  let queued: { state: SceneState | null; timing?: { readonly transitionMs?: number } } | null = null;

  function renderNow(state: SceneState | null, timing?: { readonly transitionMs?: number }) {
    let transition: Transition;
    if (state) {
      lastState = state;
      plan = derive(state);
      transition = { durationMs: Math.max(0, timing?.transitionMs ?? state.motion.transitionMs), reason: 'update' };
    } else {
      if (!lastState) return;
      plan = releasedPlan(lastState, assets);
      transition = { durationMs: Math.max(0, timing?.transitionMs ?? lastState.motion.transitionMs), reason: 'release' };
    }
    lastReason = transition.reason;
    const source = lastState!;
    for (const slot of slots) {
      if (slot.status === 'pending') slot.pending = frameFor(slot, plan, transition, source);
      else if (slot.status === 'ready') deliver(slot, frameFor(slot, plan, transition, source));
    }
  }

  // Context restored (or workers restarted): MapLibre rebuilt the style without custom layers. Once the
  // rebuilt style has loaded, every live renderer drops its dead GPU state and gets the current frame again.
  const map = options.map ?? null;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  const onContextRestored = () => {
    clearTimeout(recovery);
    let tries = 0;
    const recover = () => {
      if (destroyed || !map) return;
      if (!map.isStyleLoaded() && tries++ < 150) {
        recovery = setTimeout(recover, 100);
        return;
      }
      for (const slot of slots) {
        if (slot.status !== 'ready') continue;
        try {
          slot.renderer.contextRestored?.();
        } catch (error) {
          report(error, slot.renderer.id);
        }
        slot.lastHash = null;
      }
      if (plan && lastState) {
        const transition: Transition = { durationMs: 0, reason: lastReason === 'release' ? 'release' : 'ready' };
        for (const slot of slots) if (slot.status === 'ready') deliver(slot, frameFor(slot, plan, transition, lastState));
      }
    };
    recover();
  };
  map?.on('webglcontextrestored', onContextRestored);

  return {
    capabilities: () => profile,
    claims() {
      const keys = new Set<SceneKey>();
      const features = new Set<SceneFeature>();
      for (const { renderer } of live()) {
        for (const k of Object.keys(renderer.capabilities.values ?? {})) keys.add(k);
        for (const f of renderer.capabilities.features ?? []) features.add(f);
      }
      return { keys, features };
    },
    render(state, timing) {
      if (destroyed) return;
      // Retiring a renderer can recompile the session synchronously, which renders
      // again: finish this pass first, then apply only the newest request.
      if (rendering) {
        queued = { state, timing };
        return;
      }
      rendering = true;
      try {
        renderNow(state, timing);
        while (queued && !destroyed) {
          const next: { state: SceneState | null; timing?: { readonly transitionMs?: number } } = queued;
          queued = null;
          renderNow(next.state, next.timing);
        }
      } finally {
        rendering = false;
      }
    },
    plan: () => plan,
    assets,
    ready: () => Promise.all(inits).then(() => undefined),
    stats() {
      return {
        planHash: plan?.hash ?? null,
        sceneHash: plan?.sceneHash ?? null,
        seed: plan?.seed ?? null,
        plannerFallbacks,
        renderers: slots.map((slot) => {
          let usage: Partial<ResourceBudget> | null = null;
          try {
            usage = slot.status === 'ready' ? (slot.renderer.usage?.() ?? null) : null;
          } catch (e) {
            report(e, slot.renderer.id);
          }
          return {
            id: slot.renderer.id,
            section: slot.renderer.section,
            status: slot.status,
            deliveries: slot.deliveries,
            failures: slot.failures,
            claims: Object.keys(slot.renderer.capabilities.values ?? {}),
            usage,
            overBudget: plan && usage ? overBudget(usage, plan.budget[slot.renderer.section]) : [],
          };
        }),
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(recovery);
      map?.off('webglcontextrestored', onContextRestored);
      for (const slot of slots) {
        if (slot.status === 'retired' || slot.status === 'disposed') continue;
        slot.status = 'disposed';
        try {
          slot.renderer.dispose();
        } catch (e) {
          report(e, slot.renderer.id);
        }
      }
      assets.clear();
    },
  };
}
