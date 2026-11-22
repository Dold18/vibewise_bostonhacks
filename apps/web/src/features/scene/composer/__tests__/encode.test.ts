import { describe, expect, it } from 'vitest';
import { MAP_RENDERER_V1, previewAllCapabilities } from '../../capabilities';
import { SCENE_CATALOG } from '../../catalog';
import { compileScene } from '../../compile';
import { sanitizeIntent } from '../../intent';
import { PRESET_IDS } from '../../presets';
import { checkCoherence } from '../coherence';
import { composeWorld } from '../compose';
import { encodeComposition } from '../encode';
import { paletteHarmony } from '../harmony';
import { prng } from '../random';
import { sweep } from './helpers';

const preview = previewAllCapabilities(SCENE_CATALOG);

describe('encodeComposition', () => {
  it('speaks the existing SceneIntent contract within its limits', () => {
    for (const s of sweep(40)) {
      const e = encodeComposition(composeWorld(s, 'contract'), { version: 7, capabilities: MAP_RENDERER_V1 });
      // The driver submits its encodings as `source: 'composer'` (the composer override budget).
      const { intent, diagnostics } = sanitizeIntent(e.intent, SCENE_CATALOG, 'composer');
      expect(diagnostics).toEqual([]);
      expect(intent!.sessionVersion).toBe(7);
      expect(intent!.presets.length).toBeLessThanOrEqual(SCENE_CATALOG.maxWeightedPresets);
      expect(intent!.overrides.length).toBeLessThanOrEqual(SCENE_CATALOG.composerOverrideLimit);
      // Submitted as an untrusted model intent, the same object is still capped at the model limit.
      expect(sanitizeIntent(e.intent).intent!.overrides.length).toBeLessThanOrEqual(SCENE_CATALOG.aiOverrideLimit);
      expect(intent!.descriptors).toEqual([]);
    }
  });

  it('encodes the empty world as the plain map', () => {
    const e = encodeComposition(composeWorld(null, 'x'), { version: 1 });
    expect(e.intent.presets).toEqual([]);
    expect(e.intent.overrides).toEqual([]);
    expect(compileScene({ outing: e.intent }).hash).toBe(compileScene({}).hash);
  });

  it('yields coherent compiled scenes for every composed world, with everything the live map can draw realized', { timeout: 30_000 }, () => {
    let fidelity = 0;
    let n = 0;
    for (const s of sweep(100)) {
      for (const seed of ['e1', 'e2']) {
        const e = encodeComposition(composeWorld(s, seed), { version: 1, capabilities: MAP_RENDERER_V1 });
        expect(e.coherence.ok, `${JSON.stringify(s)} ${e.coherence.violations.map((v) => v.detail).join('; ')}`).toBe(true);
        // Re-check independently on a fresh compile of the emitted intent.
        expect(checkCoherence(compileScene({ outing: e.intent, outingTrust: 'composer', capabilities: preview }).resolved).violations.filter((v) => v.rule === 'exclusive_tags' || v.rule === 'single_particle_system')).toEqual([]);
        fidelity += e.renderableFidelity;
        n++;
      }
    }
    // Measured mean ≈ 0.99 on MAP_RENDERER_V1.
    expect(fidelity / n).toBeGreaterThan(0.95);
  });

  it('beats random catalog assemblies on coherence and color harmony', { timeout: 30_000 }, () => {
    const settings = SCENE_CATALOG.settings.filter((s) => s.group.aiSelectable);
    const next = prng('baseline', 'random-assembly');
    const worlds = sweep(80);
    let randomIncoherent = 0;
    let randomHarmony = 0;
    let composedHarmony = 0;
    worlds.forEach((s, i) => {
      const c = composeWorld(s, `h${i}`);
      composedHarmony += paletteHarmony(encodeComposition(c, { version: 1 }).preview.palette, c.harmony).score;
      const overrides: Array<{ key: string; value: string; intensity: number }> = [];
      while (overrides.length < SCENE_CATALOG.aiOverrideLimit) {
        const setting = settings[Math.floor(next() * settings.length)];
        if (overrides.some((o) => o.key === setting.key)) continue;
        const values = setting.values.filter((v) => v !== setting.default);
        overrides.push({ key: setting.key, value: values[Math.floor(next() * values.length)], intensity: 0.8 });
      }
      const random = compileScene({ outing: { schemaVersion: '1.0.0', sessionVersion: 1, presets: [], descriptors: [], overrides }, capabilities: preview });
      if (!checkCoherence(random.resolved).ok) randomIncoherent++;
      randomHarmony += paletteHarmony(random.palette, c.harmony).score;
    });
    // Measured: ~42% of random assemblies break a hard rule; composed worlds never do.
    expect(randomIncoherent / worlds.length).toBeGreaterThan(0.25);
    expect(composedHarmony / worlds.length).toBeGreaterThan(randomHarmony / worlds.length + 0.03);
  });

  it('every ratified preset is coherent on its own, and anchored worlds stay coherent', () => {
    // Integration reconciled woodland_story (fireflies under a dawn sky + two particle systems)
    // and amber_refuge (aged asphalt vs warm-gold casings) in presets.ts; every preset now passes.
    for (const id of PRESET_IDS) {
      const state = compileScene({ outing: { schemaVersion: '1.0.0', sessionVersion: 1, presets: [{ id, weight: 1 }], descriptors: [], overrides: [] }, capabilities: preview });
      expect(checkCoherence(state.resolved).ok, id).toBe(true);
    }
    const c = composeWorld({ mood: ['calm', 'leafy', 'storybook'], timeOfDay: 'morning', progression: { answers: 6 } }, 'woods');
    const e = encodeComposition(c, { version: 1 });
    expect(e.coherence.ok).toBe(true);
  });

  it('never lets an explicit request be repaired away', () => {
    const c = composeWorld({ mood: ['cozy'], timeOfDay: 'golden', explicit: [{ key: 'air_and_atmosphere.rain', value: 'drizzle' }] }, 'explicit');
    const e = encodeComposition(c, { version: 1 });
    expect(e.preview.resolved['air_and_atmosphere.rain']).toBe('drizzle');
    expect(e.coherence.ok).toBe(true);
  });
});
