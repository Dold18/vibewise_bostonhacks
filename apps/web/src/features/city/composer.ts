/**
 * Vibe Engine → procedural Scene Composer → the one Scene Session (City Changer integration).
 *
 *   adaptive quiz (MiniLM, corrections, history) ── ProfilePublisher
 *        │ OutingVibeProfile (original input + evolving evidence)
 *        ▼
 *   signalsFromProfile ─▶ ComposerDriver (seeded, sticky, exact undo)
 *        │ SceneIntent (≤3 anchors + overrides), verified against the live capability profile
 *        ▼
 *   SceneSession.submit ─▶ SceneState ─▶ city engine ─▶ buildings │ streets │ decorations │ atmosphere
 *
 * Replaces the preset-only `connectProfiles` adapter in the live app. The
 * session stays the only scene state; this module owns no look of its own.
 *
 * - One world seed: the composer's seed is the same `variationSeed` the city
 *   renderers use, so `?seed=N` + the same answers reproduce the same city.
 *   `reseed()` rebuilds the driver under a fresh session ID (the session retires
 *   the old one) and recomposes the current signals.
 * - The original input stays the creative anchor (`signalsFromProfile` puts
 *   `originalInput.text` first); every answer refines the same seeded world,
 *   which the composer's sticky picks keep stable for small changes.
 * - Quiz progress becomes `discoveryProgress`, which gates late-stage hero
 *   installations (decorations and the compiler's set piece).
 * - If composition ever throws, the deterministic preset fallback
 *   (`intentFromProfile`) keeps the map responding.
 */
import type { AssetRegistry } from '../scene/assets';
import type { CapabilityProfile } from '../scene/capabilities';
import { buildAssetTagIndex, type AssetTagIndex } from '../scene/composer/decor';
import {
  createComposerDriver, signalsFromProfile,
  type ComposerDriver, type ComposerProfileLike, type ComposerUpdate, type ProfileExtras,
} from '../scene/composer/driver';
import type { CompositionSignals } from '../scene/composer/signals';
import { intentFromProfile, type ProfileSource } from '../scene/profiles';
import type { SceneSession } from '../scene/session';
import { encodeEvidence, themeEvidence } from '../scene/decor/evidence';

/**
 * Themes the user explicitly asked for, from their own words only: the original vibe first, then
 * accepted answers and qualifiers. Avoided words remove a theme. Never from derived visual values.
 */
export function evidenceFor(signals: CompositionSignals | null): string[] {
  if (!signals) return [];
  const term = (t: unknown) => (typeof t === 'string' ? t : t && typeof t === 'object' && 'term' in t ? String((t as { term: unknown }).term) : '');
  const inputs = [
    ...(signals.text ?? []).map((text, i) => ({ text, source: i === 0 ? ('vibe' as const) : ('answer' as const) })),
    ...[...(signals.mood ?? []), ...(signals.aesthetic ?? []), ...(signals.experience ?? []), ...(signals.music ?? [])].map((t) => ({ text: term(t), source: 'answer' as const })),
  ].filter((i) => i.text);
  return encodeEvidence(themeEvidence(inputs, signals.avoid ?? []));
}

export interface CityComposerOptions {
  readonly session: SceneSession;
  /** The live capability profile (the city engine's composed profile). */
  readonly capabilities: () => CapabilityProfile;
  readonly assets: AssetRegistry | null;
  /** Model/layout manifests for the composer's decoration tag index (scene/registry.ts `runtimeManifests`). */
  readonly manifests?: Parameters<typeof buildAssetTagIndex>[0] | null;
  /** The world seed (uint32), shared with the city renderers. */
  readonly seed: () => number;
  readonly extras?: () => ProfileExtras;
  readonly onUpdate?: (u: ComposerUpdate) => void;
  readonly onError?: (error: unknown) => void;
}

export interface CityComposer {
  /** Follow the adaptive vibe engine's profile publisher. Returns the unsubscribe function. */
  connect<P extends ComposerProfileLike>(source: ProfileSource<P>): () => void;
  /** Compose directly from signals (dev/QA, or a host without the quiz). */
  compose(signals: CompositionSignals | null, outingId?: string): ComposerUpdate | null;
  /** Restore the previous answers' world exactly. */
  undo(): ComposerUpdate | null;
  /** New world seed: recomposes the current signals under it. The caller also sets `SceneContext.variationSeed`. */
  reseed(): void;
  driver(): ComposerDriver | null;
  last(): ComposerUpdate | null;
  destroy(): void;
}

export function createCityComposer(options: CityComposerOptions): CityComposer {
  const { session } = options;
  let index: AssetTagIndex | null = null;
  let driver: ComposerDriver | null = null;
  let outingId = '';
  let generation = 0;
  let signals: CompositionSignals | null = null;
  /** Mirrors the driver's undo stack, so undo restores the evidence of the world it restores. */
  let history: Array<CompositionSignals | null> = [];
  let last: ComposerUpdate | null = null;
  let destroyed = false;

  const assetIndex = () => (index ??= options.manifests ? buildAssetTagIndex(options.manifests) : null);

  function fresh(id: string): ComposerDriver {
    driver?.destroy();
    generation++;
    outingId = id;
    history = [];
    const seed = options.seed() >>> 0;
    driver = createComposerDriver({
      session,
      // A fresh session ID per (outing, seed): the session retires the previous one.
      sessionId: `${id}~s${seed}~${generation}`,
      seed: String(seed),
      capabilities: options.capabilities(),
      assets: options.assets,
      assetIndex: assetIndex(),
    });
    return driver;
  }

  function run(update: () => ComposerUpdate | null, shown: () => CompositionSignals | null): ComposerUpdate | null {
    try {
      const u = update();
      if (!u) return null;
      last = u;
      // Quiz confidence gates late-stage installations (decor heroes, the compiler's set piece); the
      // user's explicit themes are the only thing that may authorize themed decorations.
      const progress = Math.round(Math.min(1, Math.max(0, u.plan.confidence)) * 20) / 20;
      session.setContext({ discoveryProgress: progress, themeEvidence: evidenceFor(shown()) });
      options.onUpdate?.(u);
      return u;
    } catch (error) {
      options.onError?.(error);
      return null;
    }
  }

  return {
    connect(source) {
      return source.subscribe((profile) => {
        if (destroyed) return;
        if (!profile) {
          driver?.destroy();
          driver = null;
          outingId = '';
          signals = null;
          history = [];
          last = null;
          session.setContext({ themeEvidence: [] });
          session.clear();
          return;
        }
        const next = signalsFromProfile(profile, options.extras?.() ?? {});
        const d = driver && outingId === profile.sessionId ? driver : fresh(profile.sessionId);
        signals = next;
        history.push(next);
        const u = run(() => d.update(next), () => next);
        if (!u) {
          // Composition failed: the deterministic preset adapter keeps the map responding.
          session.submit(`${profile.sessionId}~fallback`, profile.version, intentFromProfile(profile));
        }
      });
    },
    compose(next, id = 'dev-outing') {
      if (destroyed) return null;
      const d = driver && outingId === id ? driver : fresh(id);
      signals = next;
      history.push(next);
      return run(() => d.update(next), () => next);
    },
    undo() {
      if (!driver || destroyed) return null;
      return run(() => {
        const u = driver!.undo();
        if (u && history.length > 1) {
          history.pop();
          signals = history[history.length - 1] ?? null;
        }
        return u;
      }, () => signals);
    },
    reseed() {
      if (destroyed || !outingId) return;
      const current = signals;
      const d = fresh(outingId);
      history.push(current);
      run(() => d.update(current), () => current);
    },
    driver: () => driver,
    last: () => last,
    destroy() {
      destroyed = true;
      driver?.destroy();
      driver = null;
    },
  };
}
