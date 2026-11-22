/**
 * The atmosphere renderer: SceneState in, two MapLibre custom layers out.
 *
 * - Lazy: no layer, buffer or texture exists until a scene asks for
 *   atmosphere; when the atmosphere fades back to nothing the layers are
 *   removed and their GPU resources freed.
 * - No constant GPU work: the map is only asked to repaint while a transition
 *   runs or animated effects are visible, capped at the quality tier's fps.
 *   Static atmospheres cost nothing between camera moves.
 * - Smooth: every SceneState change retargets a tween from what is on screen.
 * - Device-aware: an initial tier from the device, stepped down by a frame
 *   governor if animated frames miss their budget.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { FOCUS_LAYER } from '../map/focusMode';
import { composeAtmosphere, PASS_ORDER, withParams, type AtmospherePlan, type Navigation, type Quality } from './compose';
import { newStats, type FrameState } from './frame';
import { paramsFromScene, sceneDarkness, type AtmosphereSceneInput } from './fromScene';
import { createGradeLayer, GRADE_LAYER_ID } from './gradeLayer';
import { hexToRgb, NEUTRAL_PARAMS, rgbToHex, sanitizeParams, type AtmosphereParams, type RGB } from './params';
import { createGovernor, detectQuality, readDevice, type DeviceInfo } from './quality';
import { createTextureStore } from './textures';
import { createTween } from './tween';
import { createWorldLayer, WORLD_LAYER_ID } from './worldLayer';

export type AtmosphereMap = Pick<
  MapLibreMap,
  'addLayer' | 'removeLayer' | 'getLayer' | 'getStyle' | 'triggerRepaint' | 'isStyleLoaded' | 'once'
>;

export interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void;
}

export interface AtmosphereOptions {
  /** 'auto' (default) detects the device and lets the governor step down. */
  readonly quality?: Quality | 'auto';
  readonly device?: DeviceInfo;
  /** `matchMedia('(prefers-reduced-motion: reduce)')` by default. */
  readonly reducedMotion?: MediaQueryLike | null;
  readonly baseUrl?: string;
  readonly now?: () => number;
  readonly requestFrame?: (fn: (t: number) => void) => void;
  /** Expose `window.vibentaAtmosphere` (dev builds). */
  readonly devGlobal?: boolean;
}

/** Light accents for the building renderer (window glow is not drawn here). */
export interface AtmosphereAccents {
  readonly windowLight: number;
  readonly windowColor: string;
  readonly darkness: number;
}

export interface AtmosphereStats {
  readonly quality: Quality;
  readonly deviceReasons: readonly string[];
  readonly governor: readonly string[];
  readonly layers: boolean;
  readonly animating: boolean;
  readonly repaintRequests: number;
  readonly plan: { readonly load: number; readonly fps: number; readonly empty: boolean; readonly notes: readonly string[] };
  readonly worldFrames: number;
  readonly gradeFrames: number;
  readonly avgWorldCpuMs: number;
  readonly avgGradeCpuMs: number;
  readonly drawCalls: number;
  readonly gpuBytes: { readonly buffers: number; readonly textures: number; readonly framebuffers: number };
  readonly allocations: number;
  readonly texturesLoaded: readonly string[];
  readonly bloomPasses: number;
  readonly fogSigma: number;
}

export interface AtmosphereRenderer {
  setScene(scene: AtmosphereSceneInput | null, timing?: { transitionMs?: number }): void;
  /** Usually redundant (the compiler already strips overlays while navigating); a second guard for direct overrides. */
  setNavigation(mode: Navigation): void;
  /**
   * Explicit parameters layered over the scene's, e.g. `{ fogDensity: 0.6, grain: 0.4, rain: 0.3 }`.
   * Still composed (navigation, coherence, load budget, legibility). `null` returns to the scene.
   */
  setOverride(params: Partial<Record<string, unknown>> | null, timing?: { transitionMs?: number }): void;
  setQuality(quality: Quality | 'auto'): void;
  plan(): AtmospherePlan;
  stats(): AtmosphereStats;
  onAccents(listener: (accents: AtmosphereAccents) => void): () => void;
  destroy(): void;
}

const defaultReducedMotion = (): MediaQueryLike | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

const defaultFrame = (fn: (t: number) => void) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(performance.now()), 16);

/** Insert below routes, the focus mask and every symbol layer, i.e. right after the 3D buildings. */
export function anchorLayer(layers: ReadonlyArray<{ id: string; type: string }>): string | undefined {
  return layers.find((l) => l.type === 'symbol' || l.id.startsWith('transit-route') || l.id === FOCUS_LAYER)?.id;
}

export function mountAtmosphere(map: AtmosphereMap, options: AtmosphereOptions = {}): AtmosphereRenderer {
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? defaultFrame;
  const baseUrl = options.baseUrl ?? (import.meta.env?.BASE_URL || '/');
  const device = detectQuality(options.device ?? readDevice());
  let auto = options.quality === undefined || options.quality === 'auto';
  let governor = createGovernor(auto ? device.quality : (options.quality as Quality));
  let quality: Quality = governor.quality;
  const mq = options.reducedMotion === undefined ? defaultReducedMotion() : options.reducedMotion;
  let reducedMotion = mq?.matches ?? false;

  let sceneHash: string | null = null;
  let sceneParams: AtmosphereParams = NEUTRAL_PARAMS;
  let override: Partial<Record<string, unknown>> | null = null;
  let navigation: Navigation = 'browse';
  let darkness = 0;
  let light: { azimuth: number; intensity: number; color: RGB } = { azimuth: 295, intensity: 0.35, color: [1, 1, 1] };
  let lastTransitionMs = 800;

  const ctx = () => ({ navigation, reducedMotion, quality, darkness });
  let target = composeAtmosphere(NEUTRAL_PARAMS, ctx());
  const tween = createTween(target.params);
  let current = target;
  let clock = 0;
  let lastTick = now();

  const stats = newStats();
  let repaintRequests = 0;
  let running = false;
  let destroyed = false;
  let lastPaint = 0;
  let layersAdded = false;
  let pendingAdd = false;
  const accentListeners = new Set<(a: AtmosphereAccents) => void>();
  let lastAccents = '';

  const frameState = (): FrameState | null => {
    if (destroyed) return null;
    const { params } = tween.sample(now());
    current = withParams(target, params, quality);
    return { plan: current, time: clock, darkness, lightAzimuth: light.azimuth, lightIntensity: light.intensity, lightColor: light.color };
  };
  const textures = createTextureStore(baseUrl, stats, () => wake());

  function ensureLayers() {
    if (destroyed || (layersAdded && map.getLayer(WORLD_LAYER_ID))) return;
    if (!map.isStyleLoaded()) {
      if (!pendingAdd) {
        pendingAdd = true;
        map.once('idle', () => {
          pendingAdd = false;
          if (!target.empty || running) ensureLayers();
        });
      }
      return;
    }
    const before = anchorLayer(map.getStyle()?.layers ?? []);
    map.addLayer(createWorldLayer(frameState, stats), before);
    map.addLayer(createGradeLayer(frameState, stats, textures), before);
    layersAdded = true;
  }

  function removeLayers() {
    if (!layersAdded) return;
    layersAdded = false;
    for (const id of [GRADE_LAYER_ID, WORLD_LAYER_ID]) if (map.getLayer(id)) map.removeLayer(id);
  }

  function tick(t: number) {
    if (destroyed) return;
    const { params, done } = tween.sample(t);
    current = withParams(target, params, quality);
    const dt = Math.min(Math.max(t - lastTick, 0), 100) / 1000;
    lastTick = t;
    if (!reducedMotion) clock += dt * Math.max(params.motion, params.drift);
    const animating = current.fps > 0 && !current.empty;
    if (!done || animating) {
      const fps = done ? current.fps : 60;
      if (t - lastPaint >= 1000 / fps - 2) {
        if (animating && done && lastPaint > 0 && auto) {
          const next = governor.record(t - lastPaint, fps);
          if (next) {
            quality = next;
            target = withParams(target, target.params, quality);
          }
        }
        lastPaint = t;
        repaintRequests++;
        map.triggerRepaint();
      }
      requestFrame(tick);
      return;
    }
    running = false;
    lastPaint = 0;
    map.triggerRepaint();
    repaintRequests++;
    if (target.empty) removeLayers();
  }

  function wake() {
    if (destroyed) return;
    if (!target.empty || layersAdded) ensureLayers();
    if (!layersAdded) return;
    if (!running) {
      running = true;
      lastTick = now();
      requestFrame(tick);
    }
  }

  function emitAccents() {
    const p = target.params;
    const a: AtmosphereAccents = { windowLight: Math.round(p.windowLight * 1000) / 1000, windowColor: rgbToHex(p.windowColor), darkness: Math.round(darkness * 1000) / 1000 };
    const key = JSON.stringify(a);
    if (key === lastAccents) return;
    lastAccents = key;
    for (const fn of accentListeners) fn(a);
  }

  function recompose(transitionMs = lastTransitionMs) {
    const base = override ? sanitizeParams(override, sceneParams) : sceneParams;
    target = composeAtmosphere(base, ctx());
    const ms = reducedMotion ? Math.min(transitionMs, 150) : transitionMs;
    tween.retarget(target.params, ms, now());
    emitAccents();
    wake();
  }

  const onMotion = (e: { matches: boolean }) => {
    reducedMotion = e.matches;
    recompose();
  };
  mq?.addEventListener('change', onMotion);

  const api: AtmosphereRenderer = {
    setScene(scene, timing) {
      const ms = timing?.transitionMs ?? scene?.motion.transitionMs ?? 800;
      if ((scene?.hash ?? null) === sceneHash && ms === lastTransitionMs) return;
      sceneHash = scene?.hash ?? null;
      lastTransitionMs = ms;
      sceneParams = paramsFromScene(scene);
      darkness = sceneDarkness(scene);
      light = scene
        ? { azimuth: scene.lighting.position[1], intensity: scene.lighting.intensity, color: hexToRgb(scene.lighting.color) }
        : { azimuth: 295, intensity: 0.35, color: [1, 1, 1] };
      recompose(ms);
    },
    setNavigation(mode) {
      if (mode === navigation) return;
      navigation = mode;
      recompose();
    },
    setOverride(params, timing) {
      override = params ? { ...params } : null;
      recompose(timing?.transitionMs ?? 900);
    },
    setQuality(q) {
      auto = q === 'auto';
      governor = createGovernor(q === 'auto' ? device.quality : q);
      quality = governor.quality;
      recompose(0);
    },
    plan: () => withParams(target, tween.sample(now()).params, quality),
    stats() {
      return {
        quality,
        deviceReasons: device.reasons,
        governor: [...governor.history],
        layers: layersAdded,
        animating: running && current.fps > 0,
        repaintRequests,
        plan: { load: target.load, fps: target.fps, empty: target.empty, notes: target.notes },
        worldFrames: stats.worldFrames,
        gradeFrames: stats.gradeFrames,
        avgWorldCpuMs: stats.worldFrames ? stats.worldCpuMs / stats.worldFrames : 0,
        avgGradeCpuMs: stats.gradeFrames ? stats.gradeCpuMs / stats.gradeFrames : 0,
        drawCalls: stats.drawCalls,
        gpuBytes: { buffers: stats.bufferBytes, textures: stats.textureBytes, framebuffers: stats.framebufferBytes },
        allocations: stats.allocations,
        texturesLoaded: [...stats.texturesLoaded],
        bloomPasses: stats.bloomPasses,
        fogSigma: stats.fogSigma,
      };
    },
    onAccents(listener) {
      accentListeners.add(listener);
      if (lastAccents) listener(JSON.parse(lastAccents));
      return () => void accentListeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      mq?.removeEventListener('change', onMotion);
      removeLayers();
      destroyed = true;
      accentListeners.clear();
      if (options.devGlobal && typeof window !== 'undefined') delete (window as unknown as Record<string, unknown>).vibentaAtmosphere;
    },
  };

  if (options.devGlobal && typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).vibentaAtmosphere = {
      /** e.g. set({ fogDensity: .6, grain: .4, rain: .3, shafts: .5 }) — composed like any scene. */
      set: (params: Partial<Record<string, unknown>>, ms?: number) => api.setOverride(params, { transitionMs: ms }),
      clear: (ms?: number) => api.setOverride(null, { transitionMs: ms }),
      quality: (q: Quality | 'auto') => api.setQuality(q),
      navigation: (mode: Navigation) => api.setNavigation(mode),
      plan: () => api.plan(),
      stats: () => api.stats(),
      passes: PASS_ORDER,
    };
  }
  return api;
}
