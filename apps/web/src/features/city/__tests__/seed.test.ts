import { describe, expect, it } from 'vitest';
import { createRandom, hashSeed, subSeed, toSeed, unitHash } from '../seed';

describe('seeds', () => {
  it('are stable uint32 values that differ per part', () => {
    expect(hashSeed('a', 1)).toBe(hashSeed('a', 1));
    expect(hashSeed('a', 1)).not.toBe(hashSeed('a', 2));
    expect(subSeed(7, 'buildings')).not.toBe(subSeed(7, 'streets'));
    expect(subSeed(7, 'x')).not.toBe(subSeed(8, 'x'));
    for (const s of [hashSeed('x'), subSeed(1, 'y'), toSeed(-1), toSeed('abc')]) expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
    expect(toSeed(undefined)).toBe(0);
  });

  it('createRandom is a deterministic sequence in [0, 1)', () => {
    const a = createRandom(42), b = createRandom(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
  });

  it('density thresholds are monotone: raising density only adds instances', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `way/${i}`);
    const at = (d: number) => new Set(ids.filter((id) => unitHash(99, id) < d));
    const low = at(0.2), high = at(0.5);
    expect([...low].every((id) => high.has(id))).toBe(true);
    expect(low.size / ids.length).toBeGreaterThan(0.15);
    expect(low.size / ids.length).toBeLessThan(0.25);
  });
});
