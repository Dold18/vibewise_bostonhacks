import { describe, expect, it, vi } from 'vitest';
import type { AccountStore } from '../../account/session';
import { createLiveVibeSession } from '../../vibe/liveEngine';
import { MODEL_KEY } from '../../vibe/profile';
import { createProfilePublisher } from '../../vibe/publisher';
import { sceneStyleOf, startThemeController } from '../../vibeTheme/controller';
import { fakeAtmosphere, fakeEffects, fakeMap } from '../../vibeTheme/__tests__/fakeMap';
import { mountScene } from '../mount';
import { intentFromProfile } from '../profiles';

function setup() {
  const publisher = createProfilePublisher();
  const map = fakeMap();
  const account = { getState: () => ({ status: 'signed_out' }), subscribe: () => () => {} } as unknown as AccountStore;
  const theme = startThemeController(map.map, account, { effects: fakeEffects(), atmosphere: fakeAtmosphere() });
  const scene = mountScene({ theme, account, schedule: () => {} });
  scene.connectProfiles(publisher);
  const quiz = createLiveVibeSession(
    { generate: async () => { throw Error('TEST FIXTURE Gemini unavailable'); } },
    { embed: async () => ({ modelKey: MODEL_KEY, vector: Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0) }) },
    publisher,
  );
  const settle = async () => {
    await vi.waitFor(() => expect(quiz.getSnapshot()?.embedding.status).toBe('ready'));
    scene.flush();
    const state = scene.session.getState();
    map.expectStyle(state.palette, sceneStyleOf(state));
    expect(map.unexpected).toEqual([]); // no setStyle, marker system, camera or route mutations
    expect(state.pinEdge).toBe('two_tone');
    expect(state.sessionVersion).toBe(quiz.getSnapshot()!.version);
    return state;
  };
  return { publisher, map, theme, scene, quiz, settle };
}

describe('real adaptive publisher through the existing Scene Composer', () => {
  it('renders fallback evidence and revisions through one theme, rejecting retired sessions', async () => {
    const h = setup();
    try {
      h.quiz.start('Warm cozy bookshop with lamplight, no neon', 2, 'old-outing');
      expect((await h.settle()).source).toBe('outing');
      const old = h.quiz.getSnapshot()!;
      h.quiz.answer({ kind: 'correction', text: 'Actually a moonlit waterfront with calm water' });
      await h.settle();
      const answered = h.quiz.getSnapshot()!;
      h.quiz.revise(0, { kind: 'correction', text: 'Actually bright sunshine and trees in a garden' });
      const revised = await h.settle();
      expect(h.quiz.getSnapshot()!.version).toBeGreaterThan(answered.version);
      expect(h.quiz.getSnapshot()!.evidence.some(e => e.text.includes('moonlit'))).toBe(false);
      expect(h.scene.session.submit(old.sessionId, old.version, intentFromProfile(old))).toBe('stale');
      expect(h.scene.session.getState()).toEqual(revised);

      h.quiz.clear();
      h.scene.flush();
      expect(h.scene.session.getState().source).toBe('neutral');
      h.quiz.start('Neon city after dark', 0, 'new-outing');
      await h.settle();
      expect(h.scene.session.submit(old.sessionId, old.version + 100, intentFromProfile({ ...old, version: old.version + 100 }))).toBe('stale');
      expect(h.scene.session.stats().listeners).toBe(1);
    } finally { h.quiz.destroy(); h.scene.destroy(); h.theme.destroy(); }
  });

  it('keeps navigation scene safety during answer changes and unsubscribes on teardown', async () => {
    const h = setup();
    try {
      h.quiz.start('Dreamy romantic neon rain at midnight', 0, 'outing');
      await h.settle();
      h.scene.setNavigation(true);
      await Promise.resolve();
      h.quiz.answer({ kind: 'correction', text: 'A gritty cinematic underground music scene' });
      const state = await h.settle();
      // Ratified navigation policy: every overlay is removed except a soft edge vignette (≤ 0.35).
      for (const o of state.overlays) expect(o).toMatchObject({ key: 'air_and_atmosphere.vignette', value: 'soft' });
      expect(Math.max(0, ...state.overlays.map((o) => o.opacity))).toBeLessThanOrEqual(0.35);
      expect(state.setPiece).toBeNull();
      expect(state.motion.ambient).toBe(false);
      const before = h.scene.session.getState();
      h.scene.destroy();
      h.publisher.publish({ ...h.quiz.getSnapshot()!, version: 99 });
      h.scene.flush();
      expect(h.scene.session.getState()).toBe(before);
      expect(h.scene.session.stats().listeners).toBe(0);
    } finally { h.quiz.destroy(); h.scene.destroy(); h.theme.destroy(); }
  });
});
