import { describe, expect, it } from 'vitest';
import { MAP_RENDERER_V1, PALETTE_ADAPTER_V0, previewAllCapabilities } from '../../capabilities';
import { SCENE_CATALOG } from '../../catalog';
import { compileScene } from '../../compile';
import { createSceneSession } from '../../session';
import { connectComposer, createComposerDriver, signalsFromProfile, type ComposerProfileLike } from '../driver';
import { seedForSession } from '../random';
import { checkCoherence } from '../coherence';
import { assetIndex, registry, sweep } from './helpers';

const steps = [
  { mood: ['cozy'], progression: { answers: 1 } },
  { mood: ['cozy'], music: ['jazz'], progression: { answers: 2 } },
  { mood: ['cozy', 'rainy'], music: ['jazz'], timeOfDay: 'night' as const, progression: { answers: 3 } },
];

function setup(capabilities = MAP_RENDERER_V1) {
  const session = createSceneSession({ capabilities, assets: registry() });
  const driver = createComposerDriver({ session, sessionId: 'quiz-1', capabilities, assets: registry(), assetIndex: assetIndex() });
  return { session, driver };
}

describe('composer driver', () => {
  it('keeps the Scene Session as the source of truth', () => {
    const { session, driver } = setup();
    const u = driver.update(steps[0]);
    expect(u.result).toBe('applied');
    expect(u.plan.sceneHash).toBe(session.getState().hash);
    expect(session.getState().hash).toBe(compileScene({ outing: u.encoding.intent, outingTrust: 'composer', capabilities: MAP_RENDERER_V1, assets: registry() }).hash);
  });

  it('uses one stable seed per quiz session', () => {
    const a = setup().driver;
    const b = createComposerDriver({ session: createSceneSession(), sessionId: 'quiz-1' });
    expect(a.seed).toBe(seedForSession('quiz-1'));
    expect(b.seed).toBe(a.seed);
    expect(createComposerDriver({ session: createSceneSession(), sessionId: 'quiz-2' }).seed).not.toBe(a.seed);
  });

  it('undo restores the previous scene and plan exactly, without recomposing', () => {
    const { session, driver } = setup();
    const snapshots = steps.map((s) => {
      const u = driver.update(s);
      return { hash: session.getState().hash, plan: u.plan, compositionId: u.composition.id };
    });
    const compiles = session.stats().compiles;
    for (let i = snapshots.length - 2; i >= 0; i--) {
      const u = driver.undo()!;
      expect(u.composition.id).toBe(snapshots[i].compositionId);
      expect(session.getState().hash).toBe(snapshots[i].hash);
      expect(u.plan).toEqual(snapshots[i].plan);
    }
    expect(session.stats().compiles).toBe(compiles); // every undo was a session cache hit
    const plain = driver.undo()!;
    expect(session.getState().source).toBe('neutral');
    expect(plain.plan.presence).toBe(0);
    expect(driver.undo()).toBeNull();
  });

  it('submits under increasing versions so stale protection still holds', () => {
    const { session, driver } = setup();
    const v1 = driver.update(steps[0]).version;
    const v2 = driver.update(steps[1]).version;
    const v3 = driver.undo()!.version;
    expect([v1, v2, v3]).toEqual([1, 2, 3]);
    expect(session.submit('quiz-1', 2, null)).toBe('stale');
  });

  it('re-derives the plan on navigation without recomposing, hiding decoration', () => {
    const { driver } = setup(previewAllCapabilities(SCENE_CATALOG));
    const browse = driver.update({ aesthetic: ['storybook', 'whimsical'], mood: ['festive'], progression: { answers: 8 } });
    expect(browse.plan.decoration.visible).toBe(true);
    const seen: string[] = [];
    driver.subscribe((u) => seen.push(u.result));
    driver.setContext({ navigation: 'route' });
    const routed = driver.getPlan();
    expect(seen).toContain('context');
    expect(driver.getComposition().id).toBe(browse.composition.id);
    expect(routed.decoration.visible).toBe(false);
    expect(routed.decoration.contextual).toBeNull();
    expect(routed.atmosphere.overlays.every((o) => o.key === 'air_and_atmosphere.vignette')).toBe(true);
    expect(routed.colors).toEqual(browse.plan.colors); // the palette is kept while navigating
  });

  it('keeps the on-screen scene coherent through a long session despite hysteresis, and undo replays it exactly', () => {
    const capabilities = previewAllCapabilities(SCENE_CATALOG);
    const session = createSceneSession({ capabilities });
    const driver = createComposerDriver({ session, sessionId: 'walk', capabilities });
    const history: string[] = [];
    for (const s of sweep(40, 'walk')) {
      driver.update(s);
      const state = session.getState();
      expect(checkCoherence(state.resolved).violations.filter((v) => v.rule !== 'visual_density'), JSON.stringify(s)).toEqual([]);
      history.push(state.hash);
    }
    for (let i = history.length - 2; i >= 0; i--) {
      driver.undo();
      expect(session.getState().hash).toBe(history[i]);
    }
  });

  it('lists what a renderer cannot draw as pending instead of active', () => {
    const { driver } = setup(PALETTE_ADAPTER_V0);
    const plan = driver.update({ aesthetic: ['neon'], music: ['synthwave'], timeOfDay: 'night', progression: { answers: 6 } }).plan;
    expect(plan.capabilityProfile).toBe('palette-adapter-v0');
    expect(Object.keys(plan.architecture.active)).not.toContain('facade_look');
    expect(plan.architecture.pending.length + plan.atmosphere.pending.length).toBeGreaterThan(0);
  });
});

describe('profile adapter', () => {
  const profile = (sessionId: string, answers: number): ComposerProfileLike => ({
    sessionId,
    version: answers,
    evidence: [
      { text: 'warm lamplight and old books', polarity: 'want' },
      { text: 'loud neon clubs', polarity: 'avoid' },
    ],
    qualifiers: ['intimate'],
    history: Array.from({ length: answers }, () => ({})),
  });

  it('turns wants into style and avoid evidence into things to avoid', () => {
    const s = signalsFromProfile(profile('q', 3), { timeOfDay: 'night' });
    expect(s.text).toEqual(['warm lamplight and old books']);
    expect(s.avoid).toEqual(['loud neon clubs']);
    expect(s.progression).toEqual({ answers: 3 });
    expect(s.timeOfDay).toBe('night');
  });

  it('drives a session from a profile stream, one seed per quiz session', () => {
    const session = createSceneSession({ capabilities: MAP_RENDERER_V1 });
    let emit: (p: ComposerProfileLike | null) => void = () => {};
    const seeds: string[] = [];
    const off = connectComposer(session, { subscribe: (l) => ((emit = l), () => {}) }, { capabilities: MAP_RENDERER_V1, onUpdate: (u) => seeds.push(u.composition.seed) });
    emit(profile('outing-a', 2));
    expect(session.getState().source).toBe('outing');
    emit(profile('outing-a', 3));
    emit(profile('outing-b', 1));
    expect(seeds[0]).toBe(seeds[1]);
    expect(seeds[2]).not.toBe(seeds[0]);
    emit(null);
    expect(session.getState().source).toBe('neutral');
    off();
  });
});

describe('session listeners', () => {
  it('watches session context only while someone listens to the driver', () => {
    const { session, driver } = setup();
    const base = session.stats().listeners;
    driver.update(steps[0]);
    expect(session.stats().listeners).toBe(base); // a host that reads SceneState keeps a single subscriber

    const seen: string[] = [];
    const off = driver.subscribe((u) => seen.push(String(u.result)));
    expect(session.stats().listeners).toBe(base + 1);
    session.setContext({ navigation: 'route' });
    expect(seen).toContain('context');

    off();
    expect(session.stats().listeners).toBe(base);
    driver.destroy();
    expect(session.stats().listeners).toBe(base);
  });
});
