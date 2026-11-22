/**
 * Scene Session: the stateful shell around the pure compiler.
 *
 * - Rejects stale quiz versions (older version, retired session, an intent
 *   produced for a different version).
 * - Caches compiled looks by a stable content hash (intent without its version,
 *   account taste, context), so returning to any earlier content (an undone
 *   answer, navigation ending) restores exactly the scene shown then.
 * - Feeds the scene on screen back into the compiler as `previous`, so discrete
 *   values and pin/label choices have hysteresis instead of flickering.
 * - Emits an update only when the look changes (render hash), with a diff and a
 *   transition duration. Same sequence of inputs ⇒ same sequence of updates.
 *
 * No MapLibre, DOM, Gemini or network access: renderers subscribe.
 */
import type { AssetRegistry } from './assets';
import { PALETTE_ADAPTER_V0, type CapabilityProfile } from './capabilities';
import type { SceneCatalog } from './catalog';
import { compileScene, type CompileInput } from './compile';
import { sanitizeIntent, type SceneIntent } from './intent';
import { DEFAULT_CONTEXT, diffScene, hashString, stableStringify, type SceneContext, type SceneDiff, type SceneState } from './state';
import type { Palette } from '../../mapStyle';

export type SubmitResult = 'applied' | 'unchanged' | 'stale' | 'rejected';
export type UpdateReason = 'intent' | 'restore' | 'clear' | 'account' | 'context';

export interface SceneUpdate {
  readonly state: SceneState;
  readonly previous: SceneState;
  readonly diff: SceneDiff;
  readonly reason: UpdateReason;
  /** How long the renderer should take to reach `state` (reduced motion already applied). */
  readonly transitionMs: number;
}

export interface SceneSessionOptions {
  readonly capabilities?: CapabilityProfile;
  readonly assets?: AssetRegistry | null;
  readonly catalog?: SceneCatalog;
  readonly base?: Palette;
  readonly context?: Partial<SceneContext>;
  readonly account?: CompileInput['account'];
  /** Distinct looks kept for restoration (a 10-question quiz needs far fewer). Default 48. */
  readonly cacheSize?: number;
  /** Injected for tests; defaults to compileScene. */
  readonly compile?: (input: CompileInput) => SceneState;
  readonly onError?: (error: unknown) => void;
}

export interface SceneSessionStats {
  readonly compiles: number;
  readonly cacheHits: number;
  readonly cached: number;
  readonly listeners: number;
}

export interface SceneSession {
  /** The scene on screen now. */
  getState(): SceneState;
  /** Future updates only; read getState() for the current scene. */
  subscribe(listener: (update: SceneUpdate) => void): () => void;
  /** A SceneIntent (untrusted, or null for "no scene yet") for quiz `version` of `sessionId`. */
  submit(sessionId: string, version: number, intent: unknown): SubmitResult;
  /** The outing ended or was cleared; its session ID is retired. */
  clear(): void;
  setAccount(account: CompileInput['account']): void;
  setContext(context: Partial<SceneContext>): void;
  stats(): SceneSessionStats;
  destroy(): void;
}

interface Outing {
  readonly sessionId: string;
  readonly version: number;
  readonly intent: SceneIntent | null;
}

export function createSceneSession(options: SceneSessionOptions = {}): SceneSession {
  const compile = options.compile ?? compileScene;
  const capabilities = options.capabilities ?? PALETTE_ADAPTER_V0;
  const cacheSize = Math.max(1, options.cacheSize ?? 48);
  const fixed = { capabilities, assets: options.assets ?? null, catalog: options.catalog, base: options.base };

  let context: SceneContext = { ...DEFAULT_CONTEXT, ...options.context };
  let account: CompileInput['account'] = options.account ?? null;
  let outing: Outing | null = null;
  const retired = new Set<string>();
  const cache = new Map<string, SceneState>();
  const listeners = new Set<(u: SceneUpdate) => void>();
  let compiles = 0;
  let cacheHits = 0;
  let destroyed = false;

  const report = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      /* an error reporter must not break the session */
    }
  };

  /** Everything that determines the look, except the version (and fixed options). */
  const contentKey = () =>
    hashString(
      stableStringify({
        intent: outing?.intent ? { ...outing.intent, sessionVersion: 0 } : null,
        account: account ?? null,
        context,
      }),
    );

  const stamp = (state: SceneState, version: number): SceneState =>
    state.sessionVersion === version ? state : Object.freeze({ ...state, sessionVersion: version });

  function look(previous: SceneState | null): { state: SceneState; cached: boolean } {
    const key = contentKey();
    const version = outing?.version ?? 0;
    const hit = cache.get(key);
    if (hit) {
      cacheHits++;
      cache.delete(key);
      cache.set(key, hit); // most recently used
      return { state: stamp(hit, version), cached: true };
    }
    compiles++;
    const state = compile({ ...fixed, outing: outing?.intent ?? null, account, context, previous });
    cache.set(key, state);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
    return { state: stamp(state, version), cached: false };
  }

  let current: SceneState = look(null).state;

  function render(reason: UpdateReason): SubmitResult {
    let next: { state: SceneState; cached: boolean };
    try {
      next = look(current);
    } catch (error) {
      report(error);
      return 'rejected';
    }
    const previous = current;
    current = next.state;
    if (next.state.hash === previous.hash) return 'unchanged';
    const update: SceneUpdate = Object.freeze({
      state: next.state,
      previous,
      diff: diffScene(previous, next.state),
      reason: next.cached && reason === 'intent' ? 'restore' : reason,
      transitionMs: next.state.motion.transitionMs,
    });
    for (const listener of [...listeners]) {
      try {
        listener(update);
      } catch (error) {
        report(error); // one failing renderer must not starve the others
      }
    }
    return 'applied';
  }

  return {
    getState: () => current,

    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    submit(sessionId, version, raw) {
      if (destroyed || typeof sessionId !== 'string' || !sessionId || !Number.isInteger(version) || version < 0) return 'rejected';
      if (retired.has(sessionId)) return 'stale';
      if (outing?.sessionId === sessionId && version < outing.version) return 'stale';

      const { intent } = sanitizeIntent(raw, options.catalog);
      if (raw !== null && raw !== undefined && !intent) return 'rejected';
      if (intent && intent.sessionVersion !== version) return intent.sessionVersion < version ? 'stale' : 'rejected';

      if (outing && outing.sessionId !== sessionId) retired.add(outing.sessionId);
      outing = { sessionId, version, intent };
      return render('intent');
    },

    clear() {
      if (destroyed) return;
      if (outing) retired.add(outing.sessionId);
      outing = null;
      render('clear');
    },

    setAccount(next) {
      if (destroyed) return;
      account = next ?? null;
      render('account');
    },

    setContext(next) {
      if (destroyed) return;
      context = { ...context, ...next };
      render('context');
    },

    stats: () => ({ compiles, cacheHits, cached: cache.size, listeners: listeners.size }),

    destroy() {
      destroyed = true;
      listeners.clear();
      cache.clear();
    },
  };
}
