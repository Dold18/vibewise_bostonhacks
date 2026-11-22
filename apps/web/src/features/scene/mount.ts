/**
 * Live-map hookup: a Scene Session driving the map theme controller's
 * `setScene` (vibeTheme). This is the only place the scene meets the map.
 *
 * - The session is the single scene state; its updates (state + transition
 *   timing) are handed to `setScene` as they are, coalesced to one per frame so
 *   a burst of answers costs one paint pass and lands on the newest scene.
 * - Navigation flags are coalesced per tick, so switching destinations
 *   (route off → route on in the same handler) is not seen as navigation ending.
 * - Account taste and `prefers-reduced-motion` feed the session's inputs.
 */
import type { AccountState } from '../account/session';
import { themeFor, type SceneRender } from '../vibeTheme/controller';
import type { AssetRegistry } from './assets';
import type { SceneContext } from './state';
import { detectQuality, readDevice } from '../atmosphere/quality';
import { MAP_RENDERER_V1, type CapabilityProfile } from './capabilities';
import { connectProfiles, type OutingProfileLike, type ProfileSource } from './profiles';
import { PRESET_IDS, type ScenePresetId } from './presets';
import { createSceneSession, type SceneSession, type SceneUpdate, type SubmitResult } from './session';

export interface SceneThemeTarget {
  setScene(state: SceneRender | null, timing?: { transitionMs?: number }): void;
  /** Optional: the same navigation context the session compiles with, for renderers that need it directly. */
  setNavigation?(mode: 'browse' | 'route' | 'focus'): void;
}

export interface AccountSource {
  getState(): AccountState;
  subscribe(listener: (state: AccountState) => void): () => void;
}

export interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void;
}

export interface SceneMountOptions {
  readonly theme: SceneThemeTarget;
  readonly account?: AccountSource | null;
  /**
   * Defaults to MAP_RENDERER_V1 (what the theme controller's `setScene` draws by itself).
   * The live app passes the city engine's composed profile (`city.capabilities()`), which adds
   * exactly the values its mounted renderers draw; `MAP_RENDERER_V2` is the static V1 + atmosphere profile.
   */
  readonly capabilities?: CapabilityProfile;
  /** Compiler effect budget; overrides `context.performance`. Defaults to the device tier the atmosphere module detects. */
  readonly performance?: 'low' | 'medium' | 'high';
  readonly assets?: AssetRegistry | null;
  readonly context?: Partial<SceneContext>;
  /** `matchMedia('(prefers-reduced-motion: reduce)')`. */
  readonly reducedMotion?: MediaQueryLike | null;
  /** Frame scheduler (default requestAnimationFrame); injected in tests. */
  readonly schedule?: (fn: () => void) => void;
  /** Tick scheduler for navigation coalescing (default queueMicrotask). */
  readonly defer?: (fn: () => void) => void;
  readonly onError?: (error: unknown) => void;
}

export interface SceneMount {
  readonly session: SceneSession;
  /** A route or focused destination is (or is no longer) on screen. */
  setNavigation(mode: boolean | 'route' | 'focus'): void;
  /** Follow the adaptive vibe engine's profile publisher. */
  connectProfiles<P extends OutingProfileLike>(source: ProfileSource<P>): () => void;
  /** Apply any pending update now (tests, teardown). */
  flush(): void;
  destroy(): void;
}

const frame = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16));

export function mountScene(options: SceneMountOptions): SceneMount {
  const schedule = options.schedule ?? frame;
  const defer = options.defer ?? queueMicrotask;
  const session = createSceneSession({
    capabilities: options.capabilities ?? MAP_RENDERER_V1,
    assets: options.assets ?? null,
    account: options.account ? themeFor(options.account.getState()) : null,
    context: {
      performance: detectQuality(readDevice()).quality,
      ...options.context,
      ...(options.performance ? { performance: options.performance } : {}),
      reducedMotion: options.reducedMotion?.matches ?? false,
    },
    onError: options.onError,
  });

  let destroyed = false;
  let pending: SceneUpdate | null = null;
  let scheduled = false;
  const cleanups: Array<() => void> = [];

  const flush = () => {
    scheduled = false;
    if (destroyed || !pending) return;
    const update = pending;
    pending = null;
    try {
      options.theme.setScene(update.state, { transitionMs: update.transitionMs });
    } catch (error) {
      options.onError?.(error);
    }
  };

  // Take over the look right away with the current (neutral or account) scene.
  options.theme.setScene(session.getState());

  cleanups.push(
    session.subscribe((update) => {
      pending = update; // newest wins; its own transition timing travels with it
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    }),
  );

  if (options.account) {
    const account = options.account;
    cleanups.push(account.subscribe((state) => session.setAccount(themeFor(state))));
  }

  if (options.reducedMotion) {
    const query = options.reducedMotion;
    const onChange = (e: { matches: boolean }) => session.setContext({ reducedMotion: e.matches });
    query.addEventListener('change', onChange);
    cleanups.push(() => query.removeEventListener('change', onChange));
  }

  let wantedNav: 'browse' | 'route' | 'focus' = 'browse';
  let navQueued = false;

  return {
    session,
    setNavigation(mode) {
      wantedNav = mode === true ? 'route' : mode === false ? 'browse' : mode;
      if (navQueued || destroyed) return;
      navQueued = true;
      defer(() => {
        navQueued = false;
        if (destroyed) return;
        session.setContext({ navigation: wantedNav });
        options.theme.setNavigation?.(wantedNav);
      });
    },
    connectProfiles(source) {
      const off = connectProfiles(session, source);
      cleanups.push(off);
      return off;
    },
    flush,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const fn of cleanups.splice(0)) fn();
      session.destroy();
      options.theme.setScene(null);
    },
  };
}

/**
 * Dev-only console hook (like `vibentaAccount`): drive the live map through
 * the real session before the adaptive quiz is merged. Never shipped in production.
 */
export function sceneDevHook(scene: SceneMount, map?: unknown) {
  let version = 0;
  let outing = 0;
  // Like the real quiz, each outing gets its own session ID: a cleared session is
  // retired by the Scene Session, so later answers must start a new one.
  let id = `dev-${Date.now().toString(36)}-0`;
  const submit = (intent: Record<string, unknown>): SubmitResult => {
    version++;
    return scene.session.submit(id, version, { schemaVersion: '1.0.0', presets: [], descriptors: [], overrides: [], ...intent, sessionVersion: version });
  };
  return {
    session: scene.session,
    layout(layoutId: string | null, explicit = false) { scene.session.setContext({ previewLayout: layoutId, explicitSelection: explicit }); },
    progress(value: number) { scene.session.setContext({ discoveryProgress: Math.max(0, Math.min(1, value)) }); },
    atmosphere(enabled: boolean) { scene.session.setContext({ atmosphereEnabled: enabled }); },
    installations(enabled: boolean) { scene.session.setContext({ installationsEnabled: enabled }); },
    materials(enabled: boolean) { scene.session.setContext({ materialsEnabled: enabled }); },
    observance(enabled: boolean) { scene.session.setContext({ observanceOptIn: enabled }); },
    presets: PRESET_IDS,
    /** e.g. `preset('neon_city', 0.6)` or `preset([['noir_nocturne', 0.5], ['neon_city', 0.3]])` */
    preset(idOrMix: ScenePresetId | Array<[ScenePresetId, number]>, weight = 1) {
      const mix = typeof idOrMix === 'string' ? [[idOrMix, weight] as [ScenePresetId, number]] : idOrMix;
      return submit({ presets: mix.map(([p, w]) => ({ id: p, weight: w })) });
    },
    /** Free words through the deterministic lexicon, e.g. `describe('rainy neon night')`. */
    describe(...descriptors: string[]) {
      return submit({ descriptors });
    },
    submit,
    clear() {
      scene.session.clear();
      outing++;
      id = `dev-${Date.now().toString(36)}-${outing}`;
      version = 0;
    },
    navigation: (mode: boolean | 'route' | 'focus') => scene.setNavigation(mode),
    state: () => scene.session.getState(),
    /** The live MapLibre map, for visual QA and debugging (dev builds only). */
    map,
  };
}
