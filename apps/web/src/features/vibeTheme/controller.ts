/**
 * Keeps the map's look in step with its inputs:
 *
 * - **Scene mode** (`setScene(state)`): the Scene Composer owns the look. Its
 *   compiled, contrast-guarded palette, light, sky/fog and transition timing are
 *   applied in place: only changed paint values, never `map.setStyle`, so
 *   markers, the selected place, routes, handlers and the camera are untouched.
 * - **Account mode** (no scene): a signed-in user with map effects on and some
 *   vibe history gets the blended palette and effects; everyone else gets the
 *   plain map. This is the original behavior and the fallback.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { basePalette, DEFAULT_SCENE_STYLE, lightShadowAngle, THEME_TRANSITION_MS, type Palette, type SceneStyle } from '../../mapStyle';
import type { AccountState, AccountStore } from '../account/session';
import { normalizeScores, VIBE_KEYS, type VibeKey, type VibeScores } from '../account/vibes';
import { applyStyle, setColorTransition, type StyleInputs } from './apply';
import { blendPalette } from './blend';
import { effectLayers, mountEffects, type EffectsHandle } from './effects';
import type { AtmosphereSceneInput } from '../atmosphere/fromScene';

export interface ThemeTarget {
  tags: Record<VibeKey, number>;
  strength: number;
}

/**
 * What `setScene` reads from a Scene Composer SceneState (structural, so the
 * map does not depend on scene internals). The scene has already applied
 * capability clipping, navigation safety and the contrast guard.
 */
export interface SceneRender {
  readonly hash: string;
  readonly palette: Palette;
  /** White-edged pins (`vibe-dark`). False whenever the two-tone pin ring is in use. */
  readonly darkMode: boolean;
  readonly lighting: { readonly color: string; readonly intensity: number; readonly position: readonly [number, number, number] };
  readonly sky: {
    readonly fogColor: string;
    readonly skyHorizonBlend: number;
    readonly horizonFogBlend: number;
    readonly fogGroundBlend: number;
  };
  readonly motion: { readonly transitionMs: number };
  /** Dominant catalog value and effective strength per key: what the atmosphere renderer reads. */
  readonly resolved?: Readonly<Record<string, string>>;
  readonly strengths?: Readonly<Record<string, number>>;
}

/** The slice of the atmosphere renderer the controller drives. */
export interface AtmosphereTarget {
  setScene(scene: AtmosphereSceneInput | null, timing?: { transitionMs?: number }): void;
  setNavigation?(mode: 'browse' | 'route' | 'focus'): void;
  destroy(): void;
}

/** What the map should look like for this account state; null = the plain map. */
export function themeFor(state: AccountState): ThemeTarget | null {
  if (state.status !== 'signed_in' || !state.profile.effectsEnabled || state.events.length === 0) return null;
  if (state.taste.strength <= 0) return null;
  return { tags: state.taste.profile.tags, strength: state.taste.strength };
}

export interface ThemeController {
  /** Theme the map from sample scores without saving anything (dev tool, account mode only). */
  preview(scores: VibeScores, strength: number): void;
  /**
   * Hand the look to the Scene Composer (`state`), or back to account mode (`null`).
   * `transitionMs` (from the session update) overrides the state's own timing.
   */
  setScene(state: SceneRender | null, timing?: { transitionMs?: number }): void;
  /** Navigation context for the atmosphere (a second guard beside the compiler's navigation rule). */
  setNavigation(mode: 'browse' | 'route' | 'focus'): void;
  destroy(): void;
}

/** The slice of MapLibre's Map the controller uses (easy to fake in tests). */
export type ThemeMap = Pick<MapLibreMap, 'isStyleLoaded' | 'once' | 'off' | 'getCanvasContainer' | 'setPaintProperty' | 'setSky' | 'setLight' | 'getLayer'> &
  Partial<Pick<MapLibreMap, 'getContainer'>>;

export interface ThemeControllerOptions {
  /** Injected for tests; defaults to the CSS effects layer in the canvas container. */
  effects?: EffectsHandle;
  /**
   * Scene atmosphere (fog, weather, particles, grade, bloom) as MapLibre custom
   * layers below routes and labels. Optional: in the live app the city engine owns
   * the atmosphere renderer, so this defaults to none (never drawn twice).
   */
  atmosphere?: AtmosphereTarget | null;
}

const PLAIN: StyleInputs = { palette: basePalette };

export function sceneStyleOf(scene: SceneRender): SceneStyle {
  return {
    lightIntensity: scene.lighting.intensity,
    lightPosition: [...scene.lighting.position] as [number, number, number],
    fogColor: scene.sky.fogColor,
    skyHorizonBlend: scene.sky.skyHorizonBlend,
    horizonFogBlend: scene.sky.horizonFogBlend,
    fogGroundBlend: scene.sky.fogGroundBlend,
    transitionMs: DEFAULT_SCENE_STYLE.transitionMs,
  };
}

export function startThemeController(map: ThemeMap, store: AccountStore, options: ThemeControllerOptions = {}): ThemeController {
  const effects = options.effects ?? mountEffects(map.getCanvasContainer());
  // Integrated runtime: the city engine mounts the atmosphere renderer (features/city/atmosphere),
  // so the controller drives one only when a caller injects it (standalone mounts, tests).
  const atmosphere = options.atmosphere ?? null;
  let current: StyleInputs = PLAIN;
  let target: ThemeTarget | null = themeFor(store.getState());
  let scene: SceneRender | null = null;
  let sceneTransition: number | undefined;
  let transitionMs = THEME_TRANSITION_MS;
  let shadowAngle = lightShadowAngle(DEFAULT_SCENE_STYLE.lightPosition[1]);
  let ready = false;
  const setTransition = (ms: number) => {
    if (ms === transitionMs) return;
    setColorTransition(map, ms);
    transitionMs = ms;
  };
  // Pin shadows (style.css) fall opposite the light; keep them consistent when it moves.
  const setShadow = (azimuth: number) => {
    const angle = lightShadowAngle(azimuth);
    if (angle === shadowAngle) return;
    shadowAngle = angle;
    map.getContainer?.().style.setProperty('--pin-shadow-angle', `${angle}deg`);
  };

  function render() {
    if (!ready) return;
    if (scene) {
      const ms = sceneTransition ?? scene.motion.transitionMs;
      setTransition(ms);
      const next: StyleInputs = { palette: scene.palette, scene: sceneStyleOf(scene) };
      applyStyle(map, current, next, { transitionMs: ms });
      current = next;
      setShadow(scene.lighting.position[1]);
      effects.render([], scene.darkMode); // scene overlays are drawn by the city engine's atmosphere renderer
      atmosphere?.setScene(scene, { transitionMs: ms });
      return;
    }
    setTransition(THEME_TRANSITION_MS);
    setShadow(DEFAULT_SCENE_STYLE.lightPosition[1]);
    atmosphere?.setScene(null, { transitionMs: THEME_TRANSITION_MS });
    const blend = target ? blendPalette(basePalette, target.tags, target.strength) : null;
    const next: StyleInputs = { palette: blend?.palette ?? basePalette };
    applyStyle(map, current, next, { transitionMs: THEME_TRANSITION_MS });
    current = next;
    // Effects follow the taste itself, not the contrast-limited palette
    // strength, so a vibe can show before it's strong enough to recolor.
    effects.render(target ? effectLayers(target.tags, target.strength) : [], blend?.darkMode ?? false);
  }

  const onLoad = () => {
    ready = true;
    render();
  };
  if (map.isStyleLoaded()) onLoad();
  else map.once('load', onLoad);

  const unsubscribe = store.subscribe((state) => {
    target = themeFor(state);
    if (!scene) render();
  });

  return {
    preview(scores, strength) {
      const clean = normalizeScores(scores);
      target =
        clean && strength > 0
          ? { tags: Object.fromEntries(VIBE_KEYS.map((k) => [k, clean[k] ?? 0])) as Record<VibeKey, number>, strength: Math.min(1, strength) }
          : null;
      if (!scene) render();
    },
    setNavigation(mode) {
      atmosphere?.setNavigation?.(mode);
    },
    setScene(state, timing) {
      if (state && scene && state.hash === scene.hash && timing?.transitionMs === sceneTransition) return;
      scene = state;
      sceneTransition = timing?.transitionMs;
      render();
    },
    destroy() {
      unsubscribe();
      map.off('load', onLoad);
      if (ready) {
        applyStyle(map, current, PLAIN);
        setTransition(THEME_TRANSITION_MS);
        setShadow(DEFAULT_SCENE_STYLE.lightPosition[1]);
      }
      effects.destroy();
      atmosphere?.destroy();
    },
  };
}

/** Legacy target adapter retained for engine consumers; live scenes use setScene. */
export function resolveThemeTarget(saved: ThemeTarget | null, outing: ThemeTarget | null, navigating: boolean): ThemeTarget | null {
  return navigating ? null : outing ?? saved;
}
