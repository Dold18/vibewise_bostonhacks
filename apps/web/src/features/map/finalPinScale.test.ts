import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, MIN_SPREAD, finalPinRanks, finalPinScales, matchPositions, matchStrength } from './finalPinScale';

describe('finalPinScales', () => {
  it('maps the best score to the largest pin and the worst to the smallest, linearly by score', () => {
    const s = finalPinScales([0.5639, 0.5610, 0.5331, 0.5019]); // a real final list's shape (spread 0.062)
    expect(s[0]).toBeCloseTo(MAX_SCALE, 6);
    expect(s[3]).toBeCloseTo(MIN_SCALE, 6);
    expect(s[1]! - s[2]!).toBeGreaterThan(s[0]! - s[1]!); // a bigger score gap is a bigger size gap
    expect(s[2]).toBeCloseTo(MIN_SCALE + ((0.5331 - 0.5019) / 0.062) * (MAX_SCALE - MIN_SCALE), 3);
  });
  it('follows the scores, not the order they arrive in', () => {
    expect(finalPinScales([0.3, 0.6, 0.45])).toEqual([MIN_SCALE, MAX_SCALE, (MIN_SCALE + MAX_SCALE) / 2].map((x) => expect.closeTo(x, 6)));
  });
  it('gives equal scores the same middle size', () => {
    expect(finalPinScales([0.5, 0.5, 0.5])).toEqual([1.2, 1.2, 1.2].map((x) => expect.closeTo(x, 6)));
    expect(finalPinScales([0.42])).toEqual([expect.closeTo(1.2, 6)]);
  });
  it('compresses a tightly clustered list instead of stretching tiny differences to the full range', () => {
    const s = finalPinScales([0.5010, 0.5000]); // 0.001 apart
    expect(s[0]! - s[1]!).toBeCloseTo((0.001 / MIN_SPREAD) * (MAX_SCALE - MIN_SCALE), 6);
    expect(s[0]! - s[1]!).toBeLessThan(0.03);
    expect(s[0]).toBeGreaterThan(s[1]!);
  });
  it('stays within the restrained range and tolerates empty lists and non-finite scores', () => {
    const s = finalPinScales([0.9, 0.1, 0.4, Number.NaN]);
    expect(Math.max(...s.slice(0, 3))).toBeLessThanOrEqual(MAX_SCALE + 1e-9);
    expect(Math.min(...s.slice(0, 3))).toBeGreaterThanOrEqual(MIN_SCALE - 1e-9);
    expect(s[3]).toBe(1);
    expect(finalPinScales([])).toEqual([]);
  });
});

describe('finalPinRanks', () => {
  it('stacks a higher score above a lower one, ties broken toward the earlier result', () => {
    expect(finalPinRanks([0.6, 0.4, 0.5])).toEqual([3, 1, 2]);
    expect(finalPinRanks([0.5, 0.5])).toEqual([2, 1]);
  });
});

describe('matchPositions', () => {
  it('numbers the highest score 1, following scores rather than arrival order', () => {
    expect(matchPositions([0.5639, 0.561, 0.5331, 0.5019])).toEqual([1, 2, 3, 4]);
    expect(matchPositions([0.3, 0.6, 0.45])).toEqual([3, 1, 2]);
  });
  it('breaks ties toward the earlier server result, deterministically', () => {
    expect(matchPositions([0.5, 0.5, 0.5])).toEqual([1, 2, 3]);
    expect(matchPositions([0.4, 0.6, 0.6])).toEqual([3, 1, 2]);
  });
  it('handles fewer than three results and empty lists', () => {
    expect(matchPositions([0.42])).toEqual([1]);
    expect(matchPositions([0.42, 0.44])).toEqual([2, 1]);
    expect(matchPositions([])).toEqual([]);
  });
  it('ranks non-finite scores last', () => {
    expect(matchPositions([Number.NaN, 0.2, 0.3])).toEqual([3, 2, 1]);
  });
  it('agrees with the stacking order: position 1 paints on top', () => {
    const scores = [0.51, 0.58, 0.55, 0.58];
    const positions = matchPositions(scores), stack = finalPinRanks(scores);
    const top = positions.indexOf(1);
    expect(stack[top]).toBe(Math.max(...stack));
  });
});

describe('matchStrength', () => {
  it('maps the size range onto 0..1 and clamps outside it', () => {
    expect(matchStrength(MIN_SCALE)).toBe(0);
    expect(matchStrength(MAX_SCALE)).toBe(1);
    expect(matchStrength((MIN_SCALE + MAX_SCALE) / 2)).toBeCloseTo(0.5, 9);
    expect(matchStrength(5)).toBe(1);
    expect(matchStrength(0)).toBe(0);
  });
});
