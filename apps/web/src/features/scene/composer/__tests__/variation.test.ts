/**
 * Unique sessions and progressive evolution:
 * - different seeds ⇒ structurally different (not just recolored) worlds;
 * - minor quiz updates ⇒ the existing world evolves, it is not reshuffled;
 * - outputs are not drawn from a fixed menu.
 */
import { describe, expect, it } from 'vitest';
import { previewAllCapabilities } from '../../capabilities';
import { SCENE_CATALOG } from '../../catalog';
import { compileScene } from '../../compile';
import { PRESET_IDS } from '../../presets';
import { SLOTS } from '../components';
import { composeWorld } from '../compose';
import { encodeComposition } from '../encode';
import { fingerprint, slotDiff, sweep } from './helpers';

/** Slots whose differences are not just color. */
const STRUCTURAL = new Set(['walls', 'roofs', 'edges', 'windows', 'street_light', 'streets', 'greenery', 'air', 'particles', 'lens', 'medium', 'props', 'motion']);

describe('per-session variation', () => {
  it('gives two users with the same vibe visibly different worlds', () => {
    const inputs = sweep(20);
    let distinct = 0;
    let structural = 0;
    let pairs = 0;
    for (const s of inputs) {
      const worlds = Array.from({ length: 12 }, (_, i) => composeWorld(s, `user-${i}`));
      distinct += new Set(worlds.map(fingerprint)).size;
      for (let i = 1; i < worlds.length; i++) {
        pairs++;
        const a = worlds[0];
        const b = worlds[i];
        const differs = a.picks.some((p, k) => STRUCTURAL.has(p.slot) && p.component !== b.picks[k].component);
        const params = a.architecture.facadeVariation !== b.architecture.facadeVariation && a.architecture.districtScale !== b.architecture.districtScale;
        const emphasis = JSON.stringify(a.emphasis) !== JSON.stringify(b.emphasis);
        if (differs && params && emphasis) structural++;
      }
    }
    // Measured: ~11 of 12 seeds give a distinct component structure; nearly every pair differs in non-color slots.
    expect(distinct / inputs.length).toBeGreaterThanOrEqual(9);
    expect(structural / pairs).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps a stable world for a session: same seed, same signals ⇒ identical world', () => {
    for (const s of sweep(10)) expect(composeWorld(s, 'stable').id).toBe(composeWorld(s, 'stable').id);
  });
});

describe('progressive evolution', () => {
  it('changes few slots on a minor quiz update and many on a different vibe', () => {
    const inputs = sweep(80);
    let minor = 0;
    let major = 0;
    for (let i = 0; i < inputs.length - 1; i++) {
      const s = inputs[i];
      const before = composeWorld(s, 'evolve');
      const oneMoreAnswer = composeWorld({ ...s, progression: { answers: (s.progression?.answers ?? 0) + 1 } }, 'evolve', { previous: before });
      const faintNewWord = composeWorld({ ...s, mood: [...(s.mood ?? []), { term: 'calm', weight: 0.3 }] }, 'evolve', { previous: before });
      const otherVibe = composeWorld(inputs[i + 1], 'evolve', { previous: before });
      minor += (slotDiff(before, oneMoreAnswer) + slotDiff(before, faintNewWord)) / 2;
      major += slotDiff(before, otherVibe);
    }
    const n = inputs.length - 1;
    // Measured: ~0.3 of 17 slots change on a minor update, ~13 on a different vibe.
    expect(minor / n).toBeLessThan(1.5);
    expect(major / n).toBeGreaterThan(SLOTS.length / 2);
  });

  it('keeps a previous pick that is still within the sticky margin', () => {
    let kept = 0;
    for (const s of sweep(60)) {
      const before = composeWorld(s, 'sticky');
      const after = composeWorld({ ...s, mood: [...(s.mood ?? []), { term: 'calm', weight: 0.2 }] }, 'sticky', { previous: before });
      kept += after.picks.filter((p) => p.sticky).length;
      for (const p of after.picks.filter((x) => x.sticky)) expect(p.component).toBe(before.picks.find((b) => b.slot === p.slot)!.component);
    }
    expect(kept).toBeGreaterThan(0);
  });

  it('ignores a previous composition from another session seed', () => {
    const s = sweep(1)[0];
    const other = composeWorld(s, 'seed-A');
    expect(composeWorld(s, 'seed-B', { previous: other })).toEqual(composeWorld(s, 'seed-B'));
  });
});

describe('not a fixed menu', () => {
  it('produces scenes that are neither a single preset nor repeated across inputs', () => {
    const preview = previewAllCapabilities(SCENE_CATALOG);
    const presetHashes = new Set(
      PRESET_IDS.map((id) => compileScene({ outing: { schemaVersion: '1.0.0', sessionVersion: 1, presets: [{ id, weight: 1 }], descriptors: [], overrides: [] }, capabilities: preview }).hash),
    );
    const hashes = new Set<string>();
    const worlds = sweep(50);
    for (const s of worlds) {
      const e = encodeComposition(composeWorld(s, 'menu'), { version: 1 });
      expect(presetHashes.has(e.preview.hash)).toBe(false);
      hashes.add(e.preview.hash);
    }
    expect(hashes.size).toBe(worlds.length);
  });

  it('uses nearly the whole component library across a sweep', () => {
    const used = new Set<string>();
    for (const s of sweep(120)) for (const seed of ['a', 'b', 'c']) for (const p of composeWorld(s, seed).picks) used.add(`${p.slot}:${p.component}`);
    const total = SLOTS.reduce((n, s) => n + s.components.length + 1, 0);
    expect(used.size / total).toBeGreaterThan(0.8);
  });
});
