/**
 * Composer driver: keeps a Scene Session in step with evolving signals.
 *
 *   signals → composeWorld (seeded, sticky) → encodeComposition (verified)
 *     → SceneSession.submit (source of truth) → deriveCityPlan(session state)
 *
 * - One stable seed per quiz session (from its session ID unless given).
 * - Compositions are cached by signal content, so undo (or any return to
 *   earlier content) restores the exact same world; the session's own cache
 *   then restores the exact same SceneState. Undo submits under a *new*
 *   version, so the session's stale-version protection keeps working.
 * - After each submit the session's actual state is re-checked: its
 *   hysteresis can hold a value from the previous world, which is repaired
 *   with a targeted override and resubmitted (the repaired intent is cached).
 * - Context changes (navigation, reduced motion) go to the session; the plan
 *   is re-derived from the session's new state, never recomposed. Route them
 *   through `driver.setContext`: SceneSession does not expose its context, so
 *   a navigation change made directly on the session is invisible to the
 *   plan's decoration layer (unless SceneState carries `context`).
 */
import type { AssetRegistry } from '../assets';
import { PALETTE_ADAPTER_V0, type CapabilityProfile } from '../capabilities';
import type { SceneCatalog } from '../catalog';
import type { OutingProfileLike, ProfileSource } from '../profiles';
import type { SceneSession, SubmitResult } from '../session';
import { DEFAULT_CONTEXT, stableStringify, type SceneContext } from '../state';
import { composeWorld, type Composition } from './compose';
import type { AssetTagIndex } from './decor';
import { checkCoherence } from './coherence';
import { encodeComposition, repairIntent, type Encoding } from './encode';
import { deriveCityPlan, type CityRenderPlan } from './plan';
import { seedForSession } from './random';
import type { CompositionSignals, TimeOfDay, VenueContext } from './signals';

export interface ComposerDriverOptions {
  readonly session: SceneSession;
  readonly sessionId: string;
  readonly seed?: string;
  /** The renderer the session draws with (also used to prioritize overrides). */
  readonly capabilities?: CapabilityProfile;
  readonly assets?: AssetRegistry | null;
  readonly assetIndex?: AssetTagIndex | null;
  readonly catalog?: SceneCatalog;
  readonly context?: Partial<SceneContext>;
  /** Distinct worlds kept for undo/restoration. Default 48. */
  readonly cacheSize?: number;
}

export interface ComposerUpdate {
  readonly plan: CityRenderPlan;
  readonly composition: Composition;
  readonly encoding: Encoding;
  readonly result: SubmitResult | 'context';
  readonly version: number;
}

export interface ComposerDriver {
  readonly seed: string;
  update(signals: CompositionSignals | null): ComposerUpdate;
  /** Restore the previous signals' world exactly. Null when there is nothing to undo. */
  undo(): ComposerUpdate | null;
  setContext(context: Partial<SceneContext>): void;
  getPlan(): CityRenderPlan;
  getComposition(): Composition;
  depth(): number;
  subscribe(listener: (u: ComposerUpdate) => void): () => void;
  destroy(): void;
}

/** The driver submits its own verified encodings: the session grants the composer override budget. */
const COMPOSER_SUBMIT = { source: 'composer' } as const;

export function createComposerDriver(options: ComposerDriverOptions): ComposerDriver {
  const { session, sessionId } = options;
  const seed = options.seed ?? seedForSession(sessionId);
  const capabilities = options.capabilities ?? PALETTE_ADAPTER_V0;
  const cacheSize = Math.max(2, options.cacheSize ?? 48);
  let context: SceneContext = { ...DEFAULT_CONTEXT, ...options.context };
  let version = 0;
  let destroyed = false;
  const listeners = new Set<(u: ComposerUpdate) => void>();
  const cache = new Map<string, { composition: Composition; encoding: Encoding }>();
  const stack: Array<CompositionSignals | null> = [];

  let current: ComposerUpdate;

  /** Compositions depend on signals, seed, performance and reduced motion — never on navigation. */
  const keyFor = (signals: CompositionSignals | null) => stableStringify({ signals, p: context.performance, m: context.reducedMotion });

  function worldFor(signals: CompositionSignals | null, previous: Composition | null) {
    const key = keyFor(signals);
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const composition = composeWorld(signals, seed, { context, previous, catalog: options.catalog });
    const encoding = encodeComposition(composition, { version: 0, capabilities, catalog: options.catalog, context, assets: options.assets });
    const entry = { composition, encoding };
    cache.set(key, entry);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
    return entry;
  }

  const planFor = (composition: Composition, encoding: Encoding) =>
    deriveCityPlan(session.getState(), composition, { encoding, context, capabilities, assetIndex: options.assetIndex, catalog: options.catalog });

  const emit = (u: ComposerUpdate) => {
    current = u;
    for (const l of [...listeners]) {
      try {
        l(u);
      } catch {
        /* one failing renderer must not starve the others */
      }
    }
    return u;
  };

  function apply(signals: CompositionSignals | null, previous: Composition | null): ComposerUpdate {
    const entry = worldFor(signals, previous);
    const { composition } = entry;
    let { encoding } = entry;
    version++;
    let result = session.submit(sessionId, version, { ...encoding.intent, sessionVersion: version }, COMPOSER_SUBMIT);
    // Verify what the session really shows (its hysteresis can hold values from the previous world).
    const explicitKeys = new Set(composition.assignments.filter((a) => a.source === 'explicit').map((a) => a.key));
    for (let round = 0; round < 3; round++) {
      const state = session.getState();
      const report = checkCoherence(state.resolved, { catalog: options.catalog, densityCap: composition.density.cap, explicitKeys });
      if (report.ok) break;
      const fix = repairIntent(encoding.intent, report.violations, state.resolved, composition, options.catalog);
      if (!fix) break;
      encoding = Object.freeze({ ...encoding, intent: fix.intent, repairs: [...encoding.repairs, ...fix.repairs] });
      version++;
      const r = session.submit(sessionId, version, { ...encoding.intent, sessionVersion: version }, COMPOSER_SUBMIT);
      if (r === 'applied') result = 'applied';
    }
    // Remember the effective intent, so returning to these signals restores exactly this scene.
    if (encoding !== entry.encoding) cache.set(keyFor(signals), { composition, encoding });
    return emit({ plan: planFor(composition, encoding), composition, encoding, result, version });
  }

  // Initial world: no signals yet ⇒ the plain map.
  {
    const { composition, encoding } = worldFor(null, null);
    current = { plan: planFor(composition, encoding), composition, encoding, result: 'unchanged', version };
    stack.push(null);
  }

  // Context changes (navigation, performance) re-derive the plan for listeners. Subscribed only while
  // someone listens: a host that reads SceneState directly keeps the session's single subscriber.
  let offSession: (() => void) | null = null;
  const watchContext = () => {
    if (offSession || destroyed) return;
    offSession = session.subscribe((u) => {
      if (destroyed || u.reason !== 'context') return;
      emit({ ...current, plan: planFor(current.composition, current.encoding), result: 'context' });
    });
  };
  const unwatchContext = () => {
    offSession?.();
    offSession = null;
  };

  return {
    seed,
    update(signals) {
      if (destroyed) return current;
      stack.push(signals);
      return apply(signals, current.composition);
    },
    undo() {
      if (destroyed || stack.length <= 1) return null;
      stack.pop();
      return apply(stack[stack.length - 1], current.composition);
    },
    setContext(next) {
      if (destroyed) return;
      context = { ...context, ...next };
      session.setContext(next);
      // Navigation emits through the session listener; performance/reduced-motion may change the world itself.
      if (next.performance !== undefined || next.reducedMotion !== undefined) apply(stack[stack.length - 1], current.composition);
    },
    getPlan: () => current.plan,
    getComposition: () => current.composition,
    depth: () => stack.length - 1,
    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener);
      watchContext();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) unwatchContext();
      };
    },
    destroy() {
      destroyed = true;
      unwatchContext();
      listeners.clear();
      cache.clear();
    },
  };
}

/** Profile fields the composer reads, beyond what the preset adapter uses. */
export interface ComposerProfileLike extends OutingProfileLike {
  readonly originalInput?: { readonly text?: string };
  readonly completion?: { readonly recommended?: boolean };
}

/** Context the quiz does not carry: chosen timing, a verified selected venue, explicit style requests. */
export interface ProfileExtras {
  readonly timeOfDay?: TimeOfDay | null;
  readonly venue?: VenueContext | null;
  readonly explicit?: CompositionSignals['explicit'];
  readonly energy?: number | null;
  readonly social?: number | null;
}

/**
 * The adaptive vibe engine's profile → composition signals. Wants and
 * qualifiers drive style; avoid/dealbreaker evidence becomes things to avoid
 * (never a style), and progress grows confidence.
 */
export function signalsFromProfile(profile: ComposerProfileLike, extras: ProfileExtras = {}): CompositionSignals {
  const evidence = profile.evidence ?? [];
  return {
    text: [
      ...(profile.originalInput?.text ? [profile.originalInput.text] : []),
      ...evidence.filter((e) => e.polarity === 'want').map((e) => e.text),
    ],
    mood: [...(profile.qualifiers ?? [])],
    avoid: evidence.filter((e) => e.polarity === 'avoid' || e.polarity === 'dealbreaker').map((e) => e.text),
    progression: { answers: profile.history?.length ?? 0, ...(profile.completion?.recommended ? { confidence: 0.85 } : {}) },
    timeOfDay: extras.timeOfDay ?? null,
    venue: extras.venue ?? null,
    explicit: extras.explicit ?? [],
    energy: extras.energy ?? null,
    social: extras.social ?? null,
  };
}

/**
 * Drive a session from a profile stream through the composer (an alternative
 * to `connectProfiles`, which maps profiles to presets). One driver, and so one
 * seed, per quiz session. Returns the unsubscribe function.
 */
export function connectComposer<P extends ComposerProfileLike>(
  session: SceneSession,
  source: ProfileSource<P>,
  options: Omit<ComposerDriverOptions, 'session' | 'sessionId' | 'seed'> & { readonly extras?: () => ProfileExtras; readonly onUpdate?: (u: ComposerUpdate) => void } = {},
): () => void {
  let driver: ComposerDriver | null = null;
  let activeId = '';
  const off = source.subscribe((profile) => {
    if (!profile) {
      driver?.destroy();
      driver = null;
      activeId = '';
      session.clear();
      return;
    }
    if (!driver || profile.sessionId !== activeId) {
      driver?.destroy();
      driver = createComposerDriver({ ...options, session, sessionId: profile.sessionId });
      activeId = profile.sessionId;
    }
    const u = driver.update(signalsFromProfile(profile, options.extras?.() ?? {}));
    options.onUpdate?.(u);
  });
  return () => {
    off();
    driver?.destroy();
  };
}
