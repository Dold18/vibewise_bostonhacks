/**
 * Live-map surface renderer.
 *
 * Install once (images + layers), then every update is:
 *   recipe = deriveSurfaceRecipe(appearance)  → pure, deterministic
 *   textures whose spec changed               → repainted, `updateImage` in place
 *   paint values that changed                 → `setPaintProperty` (animated)
 * Never `setStyle`, never a pattern-name or filter change, so markers, routes,
 * the camera and loaded tiles are untouched (no tile reloads on world change).
 *
 * A material change fades the affected layers out, swaps the pixels, and fades
 * them back in, so the city never pops between worlds.
 */
import { hashString, stableStringify } from '../scene/state';
import { ALL_SLOTS, PIXEL_RATIO, SLOT_SIZE, SURFACE_LAYER_IDS, paintPlan, surfaceLayers, textureSpecs, type PaintValue } from './layers';
import { deriveSurfaceRecipe, type SurfaceAppearance, type SurfaceOverrides, type SurfaceRecipe } from './recipe';
import { paintTexture, type GrainSet, type TextureImage, type TextureSpec } from './textures';

/** The slice of MapLibre's Map the renderer uses (easy to fake in tests). */
export interface SurfaceMap {
  isStyleLoaded(): boolean | void;
  once(type: 'load', listener: () => void): unknown;
  on(type: 'styledata', listener: () => void): unknown;
  off(type: 'load' | 'styledata', listener: () => void): unknown;
  getStyle(): { layers?: readonly { id: string; type?: string }[] } | undefined;
  getLayer(id: string): unknown;
  addLayer(layer: never, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  hasImage(id: string): boolean;
  addImage(id: string, image: TextureImage, options?: { pixelRatio?: number }): unknown;
  updateImage(id: string, image: TextureImage): unknown;
  removeImage(id: string): unknown;
  setPaintProperty(layer: string, property: string, value: unknown): unknown;
  triggerRepaint?(): void;
}

export type NavigationMode = 'browse' | 'route' | 'focus';

export interface SurfaceRendererOptions {
  /** Micro-grain maps from real SVG assets (see grains.ts); can also arrive later via `setGrains`. */
  readonly grains?: GrainSet | null;
  readonly performance?: 'low' | 'medium' | 'high';
  /** Max ms of texture painting per frame before yielding (default 10). */
  readonly frameBudgetMs?: number;
  /** Duration of opacity/color changes (default 700 ms). */
  readonly transitionMs?: number;
  /** Injected in tests. */
  readonly schedule?: (fn: () => void) => void;
  readonly delay?: (fn: () => void, ms: number) => unknown;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

export interface SurfaceStats {
  installs: number;
  texturesPainted: number;
  paintMs: number;
  lastUpdateMs: number;
  imageUpdates: number;
  paintSets: number;
  recipeHash: string;
  /** Textures still being painted or waiting to swap (dev diagnostics). */
  pending?: number;
}

export interface SurfaceRenderer {
  /** The shared city appearance (a Scene Composer SceneState), or null for the plain map. */
  setScene(state: SurfaceAppearance | null, timing?: { readonly transitionMs?: number }): void;
  /** While a route or focused destination is shown, textures calm down and lamps/glows go off. */
  setNavigation(mode: NavigationMode | boolean): void;
  /** QA/dev only. */
  setOverrides(overrides: SurfaceOverrides): void;
  setGrains(grains: GrainSet | null): void;
  recipe(): SurfaceRecipe;
  stats(): Readonly<SurfaceStats>;
  /** Paint everything pending now (tests, screenshots). */
  flush(): void;
  destroy(): void;
}

const frame = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16));

/** Navigation and performance policy on top of the scene's recipe. */
export function effectiveRecipe(r: SurfaceRecipe, nav: NavigationMode, performance: 'low' | 'medium' | 'high'): SurfaceRecipe {
  let out = r;
  if (nav !== 'browse') {
    out = {
      ...out,
      roads: { ...out.roads, intensity: out.roads.intensity * 0.5 },
      walk: { ...out.walk, intensity: out.walk.intensity * 0.5 },
      ground: { ...out.ground, intensity: out.ground.intensity * 0.5 },
      green: { ...out.green, intensity: out.green.intensity * 0.6, edge: out.green.edge === 'glow' ? 'hedge' : out.green.edge },
      wood: { ...out.wood, intensity: out.wood.intensity * 0.6 },
      edges: { ...out.edges, intensity: out.edges.intensity * (out.edges.style === 'neon' ? 0.35 : 0.6) },
      lamps: { ...out.lamps, intensity: 0 },
    };
  }
  if (performance === 'low') out = { ...out, lamps: { ...out.lamps, intensity: 0 }, wood: { ...out.wood, intensity: 0 } };
  if (out === r) return r;
  // Re-hash: renderers skip updates on equal hashes, so a policy change must change it.
  const { hash: _base, ...look } = out;
  return { ...out, hash: hashString(stableStringify({ look, nav, performance })) };
}

export function mountSurfaces(map: SurfaceMap, options: SurfaceRendererOptions = {}): SurfaceRenderer {
  const schedule = options.schedule ?? frame;
  const delay = options.delay ?? ((fn, ms) => setTimeout(fn, ms));
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const budget = options.frameBudgetMs ?? 10;
  const transitionMs = options.transitionMs ?? 700;
  const perf = options.performance ?? 'medium';

  let appearance: SurfaceAppearance | null = null;
  let overrides: SurfaceOverrides = {};
  let nav: NavigationMode = 'browse';
  let grains: GrainSet | null = options.grains ?? null;
  let installed = false;
  let destroyed = false;
  let generation = 0;
  let current: SurfaceRecipe = deriveSurfaceRecipe(null);
  /** Spec JSON currently painted in each slot. */
  const painted = new Map<string, string>();
  /** Last value set per `layer|property`. */
  const paints = new Map<string, string>();
  let queue: Array<[string, TextureSpec]> = [];
  let pumping = false;
  let afterQueue: (() => void) | null = null;
  /** Textures painted off-screen for the pending swap (applied together, in one frame). */
  let staged: Array<[string, TextureImage, string]> = [];
  /** The scene's transition (shared clock); paint transitions follow it. */
  let duration = transitionMs;
  let durationSet = transitionMs;
  const stats: SurfaceStats = { installs: 0, texturesPainted: 0, paintMs: 0, lastUpdateMs: 0, imageUpdates: 0, paintSets: 0, recipeHash: current.hash };

  const fail = (e: unknown) => options.onError?.(e);

  function install() {
    if (destroyed) return;
    try {
      for (const { id, kind } of ALL_SLOTS) {
        if (map.hasImage(id)) continue;
        const [w, h] = SLOT_SIZE[kind];
        const blank = { width: w * PIXEL_RATIO, height: h * PIXEL_RATIO, data: new Uint8ClampedArray(w * h * PIXEL_RATIO * PIXEL_RATIO * 4) };
        map.addImage(id, blank, { pixelRatio: PIXEL_RATIO });
      }
      painted.clear();
      paints.clear();
      for (const { layer, after } of surfaceLayers()) {
        if (map.getLayer(layer.id)) continue;
        map.addLayer(layer as never, beforeIdAfter(map, after));
      }
      setTransitions(duration);
      installed = true;
      stats.installs++;
      update(true);
    } catch (e) {
      fail(e);
    }
  }

  const onLoad = () => install();
  // Re-install if something replaced the style (our layers disappear with it).
  const onStyleData = () => {
    if (installed && !destroyed && !map.getLayer(SURFACE_LAYER_IDS[0])) {
      installed = false;
      install();
    }
  };
  if (map.isStyleLoaded()) install();
  else map.once('load', onLoad);
  map.on('styledata', onStyleData);

  /** Opacity/color changes ease on the scene's clock; reset only when that duration changes. */
  function setTransitions(ms: number) {
    for (const { layer } of surfaceLayers()) {
      if (!map.getLayer(layer.id)) continue;
      const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
      for (const key of Object.keys(paint)) {
        if (/-(opacity|color|width|blur)$/.test(key)) map.setPaintProperty(layer.id, `${key}-transition`, { duration: ms, delay: 0 });
      }
    }
    durationSet = ms;
  }

  function setPaints(plan: PaintValue[], filter?: (p: PaintValue) => boolean) {
    for (const p of plan) {
      if (filter && !filter(p)) continue;
      const key = `${p.layer}|${p.property}`;
      const json = stableStringify(p.value);
      if (paints.get(key) === json) continue;
      if (!map.getLayer(p.layer)) continue;
      map.setPaintProperty(p.layer, p.property, p.value);
      paints.set(key, json);
      stats.paintSets++;
    }
  }

  /** Layers that show a given slot. */
  const LAYERS_OF_SLOT = (slot: string): string[] => {
    if (slot.startsWith('ws-tex-road-minor')) return ['ws-road-minor', 'ws-road-service'];
    if (slot.startsWith('ws-tex-road-major')) return ['ws-road-secondary', 'ws-road-primary'];
    if (slot === 'ws-tex-road-motorway') return ['ws-road-motorway'];
    if (slot === 'ws-tex-walk') return ['ws-walk'];
    if (slot === 'ws-tex-plaza') return ['ws-plaza'];
    if (slot === 'ws-tex-ground') return ['ws-ground'];
    if (slot === 'ws-tex-green') return ['ws-green-grass', 'ws-green-park', 'ws-green-pitch'];
    if (slot === 'ws-tex-wood') return ['ws-wood'];
    return ['ws-lamps'];
  };

  function update(force = false) {
    if (!installed || destroyed) return;
    const t0 = now();
    const recipe = effectiveRecipe(deriveSurfaceRecipe(appearance, overrides), nav, perf);
    if (!force && recipe.hash === current.hash && queue.length === 0) return;
    current = recipe;
    stats.recipeHash = recipe.hash;
    const gen = ++generation;
    const plan = paintPlan(recipe);

    if (durationSet !== duration) setTransitions(duration);
    const changed: Array<[string, TextureSpec]> = [];
    for (const [slot, spec] of textureSpecs(recipe)) {
      const json = stableStringify(spec) + (grains ? ':g' : '');
      if (painted.get(slot) !== json) changed.push([slot, spec]);
    }
    // Every visible texture that changes dips with its layers: all new textures are painted
    // off-screen, swapped in one frame at the bottom of the dip, and the layers rise again.
    // (Before: each texture popped in place as soon as it was painted, one per frame.)
    const hidden = new Set(changed.filter(([slot]) => painted.has(slot)).flatMap(([slot]) => LAYERS_OF_SLOT(slot)));
    const fadeMs = hidden.size && duration > 0 ? Math.min(300, duration * 0.4) : 0;
    if (fadeMs > 0) setPaints(plan.filter((p) => hidden.has(p.layer) && /opacity$/.test(p.property)).map((p) => ({ ...p, value: 0 })));
    setPaints(plan, (p) => !hidden.has(p.layer) || !/opacity$/.test(p.property));
    const swapAt = now() + fadeMs;
    enqueue(changed, () => {
      if (gen !== generation || destroyed) return;
      // Uploads run while the dipped layers are invisible, so they may span a few frames (no long
      // frame from a dozen texture uploads); the layers rise only after the last one.
      const swap = () => {
        if (gen !== generation || destroyed) return;
        const start = now();
        while (staged.length) {
          const [slot, image, json] = staged.shift()!;
          map.updateImage(slot, image);
          stats.imageUpdates++;
          painted.set(slot, json);
          if (fadeMs > 0 && staged.length && now() - start >= budget) { schedule(swap); return; }
        }
        setPaints(plan);
        map.triggerRepaint?.();
      };
      const wait = swapAt - now();
      if (wait > 1) delay(swap, wait);
      else swap();
    });
    stats.lastUpdateMs = now() - t0;
  }

  function enqueue(items: Array<[string, TextureSpec]>, then: () => void) {
    queue = items;
    staged = [];
    afterQueue = then;
    if (!pumping) {
      pumping = true;
      schedule(pump);
    }
  }

  function pump() {
    if (destroyed) return;
    const start = now();
    try {
      // At least one texture per frame, then more while within budget.
      while (queue.length) {
        const [slot, spec] = queue.shift()!;
        const t = now();
        const image = paintTexture(spec, grains ?? undefined);
        stats.paintMs += now() - t;
        stats.texturesPainted++;
        staged.push([slot, image, stableStringify(spec) + (grains ? ':g' : '')]);
        if (now() - start >= budget) break;
      }
    } catch (e) {
      fail(e);
      queue = [];
    }
    if (queue.length) {
      schedule(pump);
      return;
    }
    pumping = false;
    const then = afterQueue;
    afterQueue = null;
    then?.();
    map.triggerRepaint?.();
  }

  return {
    setScene(state, timing) {
      appearance = state;
      if (timing?.transitionMs !== undefined) duration = Math.max(0, timing.transitionMs);
      update();
    },
    setNavigation(mode) {
      const next: NavigationMode = mode === true ? 'route' : mode === false ? 'browse' : mode;
      if (next === nav) return;
      nav = next;
      update();
    },
    setOverrides(o) {
      overrides = { ...o };
      update();
    },
    setGrains(g) {
      grains = g;
      update(true);
    },
    recipe: () => current,
    stats: () => ({ ...stats, pending: queue.length + staged.length }),
    flush() {
      while (queue.length || pumping) {
        pumping = true;
        pump();
        if (!queue.length) break;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      map.off('load', onLoad);
      map.off('styledata', onStyleData);
      try {
        for (const id of SURFACE_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
        for (const { id } of ALL_SLOTS) if (map.hasImage(id)) map.removeImage(id);
      } catch (e) {
        fail(e);
      }
    },
  };
}

/** `beforeId` that places a layer directly above `anchor` (or below the first label if the anchor is missing). */
export function beforeIdAfter(map: Pick<SurfaceMap, 'getStyle'>, anchor: string): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  const i = layers.findIndex((l) => l.id === anchor);
  if (i >= 0) return layers[i + 1]?.id;
  return layers.find((l) => l.type === 'symbol')?.id;
}
