/**
 * Integration: adaptive vibe engine profile stream → Scene Session.
 *
 * `fakePublisher` mirrors the semantics of createProfilePublisher in
 * feature/vibe-engine-live (features/vibe/publisher.ts): subscribe replays the
 * latest snapshot, an older version of the same session is dropped, clear
 * publishes null, and a throwing consumer is isolated.
 */
import { describe, expect, it } from 'vitest';
import { compileScene } from '../compile';
import { connectProfiles, intentFromProfile, presenceFor, type OutingProfileLike, type ProfileSubmission } from '../profiles';
import { createSceneSession } from '../session';

function fakePublisher<P extends OutingProfileLike>() {
  let latest: P | null = null;
  const subs = new Set<(p: P | null) => void>();
  return {
    subscribe(fn: (p: P | null) => void) {
      subs.add(fn);
      fn(latest);
      return () => void subs.delete(fn);
    },
    publish(p: P | null) {
      if (p && latest && p.sessionId === latest.sessionId && p.version < latest.version) return;
      latest = p;
      for (const fn of [...subs]) {
        try {
          fn(latest);
        } catch {
          /* isolated, as in the real publisher */
        }
      }
    },
    size: () => subs.size,
  };
}

type Profile = OutingProfileLike & { history: unknown[] };
const profile = (version: number, wants: string[], answers = 0, extra: Partial<Profile> = {}): Profile => ({
  sessionId: 'outing-1',
  version,
  evidence: wants.map((text) => ({ text, polarity: 'want' })),
  qualifiers: [],
  history: Array(answers).fill({}),
  ...extra,
});

describe('intentFromProfile', () => {
  it('uses what the user wants, never what they avoid, and respects local negation', () => {
    const i = intentFromProfile({
      sessionId: 's',
      version: 2,
      evidence: [
        { text: 'a cozy candlelit bookshop, not too neon', polarity: 'want' },
        { text: 'neon clubs', polarity: 'avoid' },
        { text: 'gritty dive bars', polarity: 'dealbreaker' },
      ],
    });
    expect(i.descriptors).toEqual(['cozy', 'candlelit', 'bookshop']);
    expect(i.presets).toEqual([{ id: 'amber_refuge', weight: presenceFor(0) }]);
    expect(i.sessionVersion).toBe(2);
  });

  it('grows presence with answers but never reaches a full scene from guesses alone', () => {
    expect(presenceFor(0)).toBe(0.35);
    expect(presenceFor(4)).toBeCloseTo(0.55);
    expect(presenceFor(10)).toBe(0.85);
    expect(presenceFor(50)).toBe(0.85);
  });

  it('includes Gemini qualifiers and produces a valid intent for the compiler', () => {
    const i = intentFromProfile({ sessionId: 's', version: 1, qualifiers: ['rain-lit and cinematic'] });
    const s = compileScene({ outing: i });
    expect(s.source).toBe('outing');
    expect(s.presets.map((p) => p.id)).toEqual(expect.arrayContaining(['neon_city', 'noir_nocturne']));
    expect(s.diagnostics.filter((d) => d.code.endsWith('_dropped') || d.code === 'intent_rejected')).toEqual([]);
  });
});

describe('connectProfiles: a full adaptive quiz', () => {
  function setup() {
    const publisher = fakePublisher<Profile>();
    const session = createSceneSession();
    const submissions: ProfileSubmission[] = [];
    const reasons: string[] = [];
    session.subscribe((u) => reasons.push(u.reason));
    const off = connectProfiles(session, publisher, (s) => submissions.push(s));
    return { publisher, session, submissions, reasons, off };
  }

  it('responds a little after every answer, restores on undo, ignores stale snapshots and clears', () => {
    const { publisher, session, submissions, reasons } = setup();
    const answers = [
      ['cozy bookshop'],
      ['cozy bookshop', 'warm lamplight'],
      ['cozy bookshop', 'warm lamplight', 'jazz'],
      ['cozy bookshop', 'warm lamplight', 'jazz', 'intimate'],
    ];
    const strengths: number[] = [];
    answers.forEach((wants, i) => {
      publisher.publish(profile(i + 1, wants, i));
      strengths.push(session.getState().presets.reduce((s, p) => s + p.weight, 0));
    });
    // Monotone growth in presence: each answer changes the map a little more.
    for (let i = 1; i < strengths.length; i++) expect(strengths[i]).toBeGreaterThan(strengths[i - 1]);
    const atTwo = (() => {
      const probe = createSceneSession();
      probe.submit('outing-1', 2, intentFromProfile(profile(2, answers[1], 1)));
      return probe.getState();
    })();

    // Undo back to the state after answer 2: the engine publishes a NEW version with the old content.
    publisher.publish(profile(5, answers[1], 1));
    expect(reasons.at(-1)).toBe('restore');
    expect(session.getState().palette).toEqual(atTwo.palette);
    expect(session.getState().sessionVersion).toBe(5);

    // A late snapshot for version 3 is dropped by the publisher; a late direct submit by the session.
    publisher.publish(profile(3, ['neon rave'], 2));
    expect(session.submit('outing-1', 3, intentFromProfile(profile(3, ['neon rave'], 2)))).toBe('stale');
    expect(session.getState().sessionVersion).toBe(5);

    publisher.publish(null);
    expect(session.getState().source).toBe('neutral');
    expect(submissions.at(-1)).toMatchObject({ used: 'clear' });
  });

  it('prefers a valid model SceneIntent, and falls back when it is invalid or for an older version', () => {
    const { publisher, session, submissions } = setup();
    const model = (version: number) => ({
      schemaVersion: '1.0.0', sessionVersion: version, presets: [{ id: 'noir_nocturne', weight: 0.6 }], descriptors: [], overrides: [],
    });
    publisher.publish(profile(1, ['cozy'], 0, { sceneIntent: model(1) }));
    expect(submissions.at(-1)).toMatchObject({ used: 'model', result: 'applied' });
    expect(session.getState().presets[0].id).toBe('noir_nocturne');

    publisher.publish(profile(2, ['cozy'], 1, { sceneIntent: { garbage: true } }));
    expect(submissions.at(-1)).toMatchObject({ used: 'fallback', result: 'applied' });
    expect(session.getState().presets[0].id).toBe('amber_refuge');

    publisher.publish(profile(3, ['sunny waterfront'], 2, { sceneIntent: model(2) })); // produced for version 2
    expect(submissions.at(-1)).toMatchObject({ used: 'fallback', version: 3 });
    expect(session.getState().presets[0].id).toBe('sunlit_coast');
  });

  it('subscribing replays the current profile; unsubscribing stops updates without leaks', () => {
    const publisher = fakePublisher<Profile>();
    publisher.publish(profile(1, ['retro vintage diner'], 0));
    const session = createSceneSession();
    const off = connectProfiles(session, publisher);
    expect(session.getState().presets[0].id).toBe('retro_atlas');
    off();
    expect(publisher.size()).toBe(0);
    publisher.publish(profile(2, ['neon'], 1));
    expect(session.getState().presets[0].id).toBe('retro_atlas');
  });

  it('a ten-answer quiz is deterministic end to end', () => {
    const run = () => {
      const { publisher, session } = setup();
      const hashes: string[] = [];
      session.subscribe((u) => hashes.push(u.state.hash));
      const words = ['cozy', 'jazz', 'rainy', 'neon', 'intimate', 'vintage', 'garden', 'calm', 'cinematic', 'warm'];
      words.forEach((_, i) => publisher.publish(profile(i + 1, words.slice(0, i + 1), i)));
      return { hashes, compiles: session.stats().compiles };
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.hashes.length).toBeGreaterThan(3);
    expect(a.compiles).toBeLessThanOrEqual(11);
  });
});
