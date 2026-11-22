/**
 * Adapter from the adaptive vibe engine's profile stream to a Scene Session.
 *
 * Typed structurally against `OutingVibeProfile` / `ProfilePublisher`
 * (feature/vibe-engine-live: features/vibe/profile.ts, publisher.ts) so this
 * module neither imports nor depends on that branch. Nothing here calls Gemini:
 *
 * - If a profile carries a model-proposed `sceneIntent`, it is submitted as
 *   untrusted input; if the session rejects it (invalid, or produced for an
 *   older version), the deterministic fallback for this version is used.
 * - Otherwise the fallback derives descriptors from what the user wants
 *   (never from "avoid"/dealbreaker evidence), with a presence that grows as
 *   the quiz progresses, so the map responds a little after every answer.
 */
import { SCENE_SCHEMA_VERSION, MAX_DESCRIPTORS } from './intent';
import { presetsFromDescriptors, sceneWords } from './lexicon';
import type { SceneSession, SubmitResult } from './session';

/** The parts of OutingVibeProfile the scene reads. */
export interface OutingProfileLike {
  readonly sessionId: string;
  readonly version: number;
  readonly evidence?: ReadonlyArray<{ readonly text: string; readonly polarity: string }>;
  readonly qualifiers?: readonly string[];
  readonly history?: readonly unknown[];
  /** Optional model-proposed SceneIntent carried with the profile (untrusted). */
  readonly sceneIntent?: unknown;
}

export interface ProfileSource<P> {
  subscribe(listener: (profile: P | null) => void): () => void;
}

/** Scene presence by answers given: faint at first, never the full scene from guesses alone. */
export const presenceFor = (answers: number) => Math.min(0.85, 0.35 + 0.05 * Math.max(0, answers));

/** The deterministic, model-free SceneIntent for a profile. */
export function intentFromProfile(profile: OutingProfileLike) {
  const wanted = [...(profile.evidence ?? []).filter((e) => e.polarity === 'want').map((e) => e.text), ...(profile.qualifiers ?? [])];
  const descriptors: string[] = [];
  for (const text of wanted) for (const word of sceneWords(text)) if (!descriptors.includes(word)) descriptors.push(word);
  const kept = descriptors.slice(0, MAX_DESCRIPTORS);
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    sessionVersion: profile.version,
    presets: presetsFromDescriptors(kept, presenceFor(profile.history?.length ?? 0)),
    descriptors: kept,
    overrides: [],
  };
}

export interface ProfileSubmission {
  readonly sessionId: string;
  readonly version: number;
  readonly used: 'model' | 'fallback' | 'clear';
  readonly result: SubmitResult | 'cleared';
}

/** Keep a session in step with a profile source. Returns the unsubscribe function. */
export function connectProfiles<P extends OutingProfileLike>(
  session: SceneSession,
  source: ProfileSource<P>,
  onSubmit?: (s: ProfileSubmission) => void,
): () => void {
  return source.subscribe((profile) => {
    if (!profile) {
      session.clear();
      onSubmit?.({ sessionId: '', version: 0, used: 'clear', result: 'cleared' });
      return;
    }
    if (profile.sceneIntent !== undefined) {
      const result = session.submit(profile.sessionId, profile.version, profile.sceneIntent);
      if (result === 'applied' || result === 'unchanged') {
        onSubmit?.({ sessionId: profile.sessionId, version: profile.version, used: 'model', result });
        return;
      }
    }
    const result = session.submit(profile.sessionId, profile.version, intentFromProfile(profile));
    onSubmit?.({ sessionId: profile.sessionId, version: profile.version, used: 'fallback', result });
  });
}
