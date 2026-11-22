import { describe, expect, it } from 'vitest';
import { SCENE_CATALOG } from '../../catalog';
import { combinationCount, SLOTS } from '../components';
import { composeWorld, isDecorative } from '../compose';
import { tagConflicts, tagsOf } from '../tags';
import { sweep } from './helpers';

const COZY_JAZZ = { mood: ['cozy', 'intimate'], music: ['jazz'], timeOfDay: 'night' as const, progression: { answers: 5 } };

describe('composeWorld', () => {
  it('is a pure function of signals and seed', () => {
    const a = composeWorld(COZY_JAZZ, 'seed-1');
    const b = composeWorld(structuredClone(COZY_JAZZ), 'seed-1');
    expect(b).toEqual(a);
    expect(b.id).toBe(a.id);
    expect(composeWorld(COZY_JAZZ, 'seed-2').id).not.toBe(a.id);
  });

  it('composes nothing without signals: the plain map', () => {
    for (const s of [null, {}, { cuisine: ['italian'] }]) {
      const c = composeWorld(s, 'any');
      expect(c.presence).toBe(0);
      expect(c.assignments).toEqual([]);
      expect(c.picks.every((p) => p.component === 'plain')).toBe(true);
      expect(c.decor.density).toBe(0);
    }
  });

  it('only ever assigns documented, model-editable catalog values with sane intensities', () => {
    for (const s of sweep(60)) {
      for (const a of composeWorld(s, 'valid').assignments) {
        const setting = SCENE_CATALOG.byKey.get(a.key);
        expect(setting, a.key).toBeDefined();
        expect(setting!.group.aiSelectable).toBe(true);
        expect(setting!.values).toContain(a.value);
        expect(a.value).not.toBe(setting!.default);
        expect(a.intensity).toBeGreaterThan(0);
        expect(a.intensity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is coherent by construction across never-authored combinations (property sweep)', () => {
    for (const s of sweep(120)) {
      for (const seed of ['p1', 'p2']) {
        const c = composeWorld(s, seed);
        const active = c.assignments.map((a) => [a.key, a.value] as const);
        expect(tagConflicts(active), JSON.stringify(s)).toEqual([]);
        expect(active.filter(([k, v]) => tagsOf(k, v).includes('particles')).length).toBeLessThanOrEqual(1);
        expect(c.assignments.filter((a) => isDecorative(a.key)).length).toBeLessThanOrEqual(c.density.cap);
      }
    }
  });

  it('builds worlds from a combinatorial design space, not a list of scenes', () => {
    expect(SLOTS.length).toBeGreaterThanOrEqual(15);
    expect(combinationCount()).toBeGreaterThan(1e15);
  });

  it('respects time of day: no daylight at night, no night cues or lit lamps at noon', () => {
    for (const s of sweep(40)) {
      const night = composeWorld({ ...s, timeOfDay: 'night' }, 'time');
      const noon = composeWorld({ ...s, timeOfDay: 'midday' }, 'time');
      const nightTags = night.assignments.flatMap((a) => tagsOf(a.key, a.value));
      const noonTags = noon.assignments.flatMap((a) => tagsOf(a.key, a.value));
      for (const t of ['day', 'sun', 'morning', 'evening', 'noon']) expect(nightTags).not.toContain(t);
      for (const t of ['night', 'nocturnal', 'lamps', 'darkground', 'evening']) expect(noonTags).not.toContain(t);
    }
  });

  it('honors explicit requests and composes the rest around them', () => {
    const c = composeWorld({ mood: ['romantic', 'sunny'], explicit: [{ key: 'air_and_atmosphere.snow', value: 'gentle' }] }, 'explicit');
    const snow = c.assignments.find((a) => a.key === 'air_and_atmosphere.snow');
    expect(snow).toMatchObject({ value: 'gentle', source: 'explicit' });
    const tags = c.assignments.flatMap((a) => tagsOf(a.key, a.value));
    for (const t of ['rain', 'summer', 'spring', 'autumn']) expect(tags).not.toContain(t);
    expect(c.assignments.filter((a) => tagsOf(a.key, a.value).includes('particles'))).toHaveLength(1);
  });

  it('keeps avoided styles out', () => {
    const c = composeWorld({ aesthetic: ['cyberpunk'], music: ['techno'], avoid: ['neon'], timeOfDay: 'night' }, 'avoid');
    expect(c.assignments.filter((a) => tagsOf(a.key, a.value).includes('neon'))).toEqual([]);
  });

  it('scales boldness, decoration and focal hierarchy with confidence', () => {
    const early = composeWorld({ ...COZY_JAZZ, progression: { answers: 1 } }, 'conf');
    const late = composeWorld({ ...COZY_JAZZ, progression: { answers: 10 } }, 'conf');
    expect(late.presence).toBeGreaterThan(early.presence);
    const mean = (c: typeof early) => c.assignments.filter((a) => a.source === 'component').reduce((s, a) => s + a.intensity, 0) / c.assignments.length;
    expect(mean(late)).toBeGreaterThan(mean(early));
    expect(late.decor.density).toBeGreaterThan(early.decor.density);
    expect(late.assignments.some((a) => a.key === 'marker_recommendations.low_match_treatment')).toBe(true);
    expect(early.assignments.some((a) => a.key === 'marker_recommendations.low_match_treatment')).toBe(false);
  });

  it('tightens density on low-performance devices and stills decoration under reduced motion', () => {
    const s = { aesthetic: ['storybook', 'whimsical'], mood: ['festive', 'ornate'], energy: 1, progression: { answers: 10 } };
    const low = composeWorld(s, 'perf', { context: { performance: 'low' } });
    const high = composeWorld(s, 'perf', { context: { performance: 'high' } });
    expect(low.density.cap).toBeLessThanOrEqual(3);
    expect(low.assignments.filter((a) => isDecorative(a.key)).length).toBeLessThanOrEqual(3);
    expect(low.decor.density).toBeLessThan(high.decor.density);
    expect(composeWorld(s, 'perf', { context: { reducedMotion: true } }).decor.motion).toBe('static');
  });

  it('gives the accent hue to focal points and keeps it apart from the dominant hue', () => {
    let separated = 0;
    let total = 0;
    for (const s of sweep(60)) {
      const c = composeWorld(s, 'accent');
      if (c.harmony.scheme === 'monochrome') continue;
      total++;
      const d = Math.abs(((c.harmony.roles.accent - c.harmony.roles.dominant + 540) % 360) - 180);
      if (d >= 30) separated++;
    }
    expect(separated).toBe(total);
  });
});
