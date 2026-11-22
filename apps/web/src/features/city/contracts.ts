/**
 * City engine contract: the ONLY types shared by the city renderers and the
 * composition planner. Owned by the architecture/integration workstream;
 * changing anything here needs that workstream's approval (docs/CITY_ENGINE.md).
 *
 *   Scene Session (one, authoritative)
 *        │ SceneState (compiled, sanitized, capability-clipped, contrast-guarded)
 *        ▼
 *   CityPlanner (composition)  ──►  enforcePolicy (engine: safety, budgets, assets)
 *        │ CityPlan: one plan, four sections, one seed
 *        ▼
 *   CityEngine ──► buildings │ streets │ decorations │ atmosphere renderers
 *                  (each sees only its own section + the shared RenderEnv)
 *
 * Renderers never see SceneIntent, Gemini output, or each other.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Palette } from '../../mapStyle';
import type { SceneFeature } from '../scene/capabilities';
import type { SceneKey } from '../scene/catalog';
import type { SceneState } from '../scene/state';

export const CITY_PLAN_VERSION = 1 as const;

/** The four rendering systems. Composition is not a section: it produces the plan. */
export type SectionId = 'buildings' | 'streets' | 'decorations' | 'atmosphere';
export const SECTION_IDS: readonly SectionId[] = Object.freeze(['buildings', 'streets', 'decorations', 'atmosphere']);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * A manifest-backed asset. Only the AssetResolver creates these, and the engine
 * drops any AssetRef in a plan whose ID does not resolve: an asset that is not
 * in a manifest under public/scene-assets can never reach a renderer.
 */
export interface AssetRef {
  readonly id: string;
  readonly kind: 'svg' | 'model';
  /** Same-origin URL under `/scene-assets/`. */
  readonly uri: string;
  /** Atlas cell `[x, y, w, h]` in source pixels (SVG atlases only). */
  readonly rect?: readonly number[];
}

export interface AssetResolver {
  /** Manifest lookup; null for unknown IDs. */
  resolve(id: string): AssetRef | null;
  /** Verified SVG textures the manifests declare for a catalog key. */
  texturesFor(key: SceneKey): readonly AssetRef[];
  /** Models whose manifest tags include every given tag (sorted by ID). */
  modelsTagged(tags: readonly string[]): readonly AssetRef[];
  /**
   * Decode an SVG (or its atlas cell) to a 256×256 image. Cached and shared by
   * every renderer on the engine, so two systems never decode the same file twice.
   */
  loadImage(ref: AssetRef): Promise<ImageData>;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * One continuously adjustable treatment, realized from one catalog setting.
 * The catalog value picks the style family; everything else is continuous, so
 * any combination of treatments across sections is a valid city.
 */
export interface Treatment {
  /** Catalog setting this realizes, e.g. `building_surfaces.window_glow`. */
  readonly key: SceneKey;
  /** The resolved catalog value: the style family (discrete), e.g. `warm_low`. */
  readonly style: string;
  /** 0..1, continuous. Navigation safety is already applied; 0 means draw nothing. */
  readonly intensity: number;
  /** Pattern/feature size multiplier, [0.25, 4]; 1 = authored size. */
  readonly scale: number;
  /** Optional `#rrggbb` tint chosen by composition (usually palette-derived). */
  readonly tint: string | null;
  /** Manifest-verified candidates, preferred first. Empty is valid: procedural treatments need no file. */
  readonly assets: readonly AssetRef[];
  /** Deterministic sub-seed (uint32) for this treatment. */
  readonly seed: number;
}

/** Spatial variation, so a treatment is not painted uniformly across the city. */
export interface Variation {
  /** 0 = uniform; 1 = maximum per-feature/per-area variation. */
  readonly amount: number;
  /** Characteristic size of a variation cell in meters (≈80 a block, ≈600 a district). */
  readonly cellMeters: number;
  /** uint32 */
  readonly seed: number;
}

interface SectionBase<T extends Treatment = Treatment> {
  /** False: draw nothing (navigation, a user/dev toggle, or no treatments). Fade out; never throw. */
  readonly enabled: boolean;
  /** Keyed by catalog setting ID (the part after the dot), e.g. `facade_look`. */
  readonly treatments: Readonly<Record<string, T>>;
  readonly variation: Variation;
}

/** Facades, windows, roofs, outlines and trim on the real 3D building geometry. */
export interface BuildingPlan extends SectionBase {
  /** The base theme already paints these; use them to stay coherent, never to repaint them. */
  readonly colors: {
    readonly footprint: string;
    readonly outline: string;
    readonly low: string;
    readonly mid: string;
    readonly high: string;
    readonly light: string;
  };
}

/** Road surfaces, paths, rail, ground, parks, sand and water. */
export interface StreetPlan extends SectionBase {
  readonly colors: {
    readonly land: string;
    readonly urban: string;
    readonly roadMinor: string;
    readonly roadMajor: string;
    readonly roadCasing: string;
    readonly path: string;
    readonly rail: string;
    readonly park: string;
    readonly wood: string;
    readonly sand: string;
    readonly water: string;
  };
}

/** Where decoration instances may stand. All anchors stay off roads, labels, pins and routes. */
export type DecorationAnchor = 'street' | 'park' | 'water' | 'plaza' | 'skyline' | 'venue' | 'stage';

export interface DecorationElement extends Treatment {
  readonly anchor: DecorationAnchor;
  /** Model/SVG tags composition wants for this element (e.g. `['street', 'nightlife']`). */
  readonly tags: readonly string[];
}

export interface SetPiecePlan {
  readonly layoutId: string;
  readonly hero: readonly AssetRef[];
  readonly accent: readonly AssetRef[];
}

/** Spatially distributed themed objects, plus the compiler's late-stage set piece. */
export interface DecorationPlan extends SectionBase<DecorationElement> {
  readonly setPiece: SetPiecePlan | null;
}

/** Overlays, particles, sky, fog, light and other screen/scene-wide effects. */
export interface AtmospherePlan extends SectionBase {
  readonly colors: { readonly sky: string; readonly horizon: string; readonly fog: string; readonly light: string };
  /** The scene light (the base theme already applies it to the map; effects should agree). */
  readonly light: { readonly color: string; readonly intensity: number };
}

export interface CitySections {
  readonly buildings: BuildingPlan;
  readonly streets: StreetPlan;
  readonly decorations: DecorationPlan;
  readonly atmosphere: AtmospherePlan;
}

export type PerformanceTier = 'low' | 'medium' | 'high';

/** Shared, countable rendering resources. Every renderer reports usage in these units. */
export interface ResourceBudget {
  /** Layers this renderer added to the MapLibre style. */
  readonly styleLayers: number;
  /** Decoded image/texture memory, MB. */
  readonly textureMB: number;
  /** Placed 3D model instances. */
  readonly modelInstances: number;
  /** Simultaneously animated particles. */
  readonly particles: number;
  /** DOM/CSS overlay elements above the map canvas. */
  readonly overlayElements: number;
  /** MapLibre custom (WebGL) layers. */
  readonly customLayers: number;
}
export type ResourceKey = keyof ResourceBudget;

export interface RenderMode {
  /** `route`/`focus`: a route or focused destination is on screen and legibility wins. */
  readonly navigation: 'browse' | 'route' | 'focus';
  readonly reducedMotion: boolean;
  /** Continuous ambient animation is allowed (false under reduced motion, navigation, or `low` tier). */
  readonly ambientMotion: boolean;
  /** The scene is dark (the base theme switched pins to their dark-scene edge). */
  readonly darkMode: boolean;
}

export interface CityPlan {
  readonly version: typeof CITY_PLAN_VERSION;
  /** `SceneState.hash` this plan was derived from. */
  readonly sceneHash: string;
  /** Hash of everything below; equal hash ⇒ identical city. */
  readonly hash: string;
  /** World seed (uint32), from `SceneContext.variationSeed`. */
  readonly seed: number;
  readonly tier: PerformanceTier;
  readonly mode: RenderMode;
  readonly palette: Palette;
  /** Per-section allocation; the engine keeps the sum within the tier total. */
  readonly budget: Readonly<Record<SectionId, ResourceBudget>>;
  readonly sections: CitySections;
  /** Non-default settings no city section realizes (base theme, pins, UI, camera). Informational. */
  readonly unrouted: readonly SceneKey[];
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// Planner (composition workstream)
// ---------------------------------------------------------------------------

export interface PlanInput {
  readonly state: SceneState;
  readonly assets: AssetResolver;
}

/**
 * Pure and deterministic: same input ⇒ same plan. No DOM, map, network,
 * wall clock or unseeded randomness (use `seed.ts`). The engine applies `enforcePolicy`
 * to whatever this returns, so a planner cannot break navigation safety,
 * budgets, section ownership or manifest-backed assets.
 */
export type CityPlanner = (input: PlanInput) => CityPlan;

// ---------------------------------------------------------------------------
// Renderers (buildings, streets, decorations, atmosphere workstreams)
// ---------------------------------------------------------------------------

/** What every renderer may read besides its own section. */
export interface RenderEnv {
  readonly seed: number;
  readonly tier: PerformanceTier;
  readonly mode: RenderMode;
  readonly palette: Palette;
  /** This renderer's own allocation. Stay within it; report usage via `usage()`. */
  readonly budget: ResourceBudget;
}

export interface Transition {
  /** Reach the new section over this long (reduced motion already applied by the session). */
  readonly durationMs: number;
  /** `ready`: first frame after async init. `release`: the scene was released; fade to nothing. */
  readonly reason: 'update' | 'ready' | 'release';
}

/**
 * Read-only, policy-applied view of the compiled SceneState a plan came from
 * (added at City Changer integration, see docs/CITY_CHANGER_INTEGRATION.md).
 *
 * The workstream renderers were built against SceneState and use it for
 * cross-section coherence (street materials inferred from the wall palette,
 * decoration motifs from the grade, fog from the sky). The view keeps that
 * input without a second source of truth: for every key routed to a city
 * section, `strengths` equals the plan's treatment intensity, so a key the
 * policy removed (navigation, a toggle, a failed asset) has strength 0 and
 * `setPiece` follows the plan. Never mutate it; never derive capabilities from it.
 */
export type SceneView = SceneState;

export interface RenderFrame<S extends SectionId> {
  readonly section: CitySections[S];
  readonly env: RenderEnv;
  /** The policy-applied scene this plan came from (see SceneView). */
  readonly scene: SceneView;
  readonly transition: Transition;
  /** The plan this frame came from. Frames arrive only on change, so a renderer's last planHash may be older than the engine's current plan. */
  readonly planHash: string;
}

export interface RendererContext {
  /** The live map; null when headless (tests) or on a stage without a map. */
  readonly map: MapLibreMap | null;
  /** Container above the map canvas for DOM/CSS overlays. Append your own child; remove it on dispose. */
  readonly overlay: HTMLElement | null;
  readonly assets: AssetResolver;
  /** Prefix for every style layer, source, image and DOM class this renderer creates. */
  readonly idPrefix: string;
  /** Non-fatal problems (a failed asset). Throwing from update() counts as a failure instead. */
  reportError(error: unknown): void;
}

/** Values this renderer really draws. Only these reach SceneState; everything else is clipped. */
export interface RendererCapabilities {
  readonly values?: Readonly<Record<SceneKey, readonly string[]>>;
  readonly features?: readonly SceneFeature[];
}

export interface CityRenderer<S extends SectionId = SectionId> {
  /** Unique; also the `idPrefix` stem. */
  readonly id: string;
  readonly section: S;
  /** Declared up front (synchronously). A key may be claimed by one renderer only. */
  readonly capabilities: RendererCapabilities;
  /** Optional async setup (load shaders, add layers). Frames arrive after it resolves; a rejection retires the renderer. */
  init?(ctx: RendererContext): void | Promise<void>;
  /** Called only when this renderer's section or env changed. Must be cheap and idempotent. */
  update(frame: RenderFrame<S>): void;
  /** Remove every layer, image, DOM node and listener this renderer created. */
  dispose(): void;
  usage?(): Partial<ResourceBudget>;
  /**
   * The WebGL context was restored (or MapLibre's workers restarted): the style was rebuilt from a
   * snapshot without custom layers, and every GPU resource is gone. Drop that state; the engine
   * re-delivers the current frame right after, so the renderer rebuilds from it.
   */
  contextRestored?(): void;
}

export type AnyCityRenderer = { [S in SectionId]: CityRenderer<S> }[SectionId];

/** Options the host passes to every workstream factory. */
export interface CityHostOptions {
  /** Development-only 3D installations (`?sceneAssets=1`). */
  readonly preview3d: boolean;
  /** Place world decorations (lazy-loads Three.js on first use). Default true. */
  readonly decorations?: boolean;
  /** Real places decorations must keep clear of (destination pins), in lng/lat. */
  readonly exclusions?: () => ReadonlyArray<{ readonly lng: number; readonly lat: number; readonly radius?: number }>;
}

export class CityContractError extends Error {}
