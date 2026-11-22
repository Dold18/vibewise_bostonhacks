import { describe, expect, it } from 'vitest';
import { normalizeScores, VIBE_KEYS, VIBE_LABELS, VIBE_SOURCES } from '../vibes';

describe('VIBE_KEYS', () => {
  it('is the DATA_MODEL.md §3 vocabulary in order', () => {
    expect(VIBE_KEYS).toEqual([
      'cozy',
      'lively',
      'upscale',
      'divey',
      'aesthetic',
      'quiet',
      'date_night',
      'group_friendly',
      'late_night',
      'outdoor',
    ]);
  });

  it('has a label for every key', () => {
    for (const key of VIBE_KEYS) expect(VIBE_LABELS[key]).toBeTruthy();
    expect(VIBE_LABELS.date_night).toBe('Date night');
  });

  it('lists the sources the database accepts', () => {
    expect(VIBE_SOURCES).toEqual(['quiz', 'text', 'image', 'song', 'place', 'dev']);
  });
});

describe('normalizeScores', () => {
  it('keeps valid scores', () => {
    expect(normalizeScores({ cozy: 0.8, lively: 0.2 })).toEqual({ cozy: 0.8, lively: 0.2 });
  });

  it('drops unknown keys', () => {
    expect(normalizeScores({ cozy: 0.5, electric: 0.9 })).toEqual({ cozy: 0.5 });
  });

  it('clamps values into [0, 1]', () => {
    expect(normalizeScores({ cozy: 1.2, quiet: -0.1 })).toEqual({ cozy: 1, quiet: 0 });
  });

  it('drops non-finite and non-number values', () => {
    expect(normalizeScores({ cozy: NaN, quiet: '0.4', outdoor: Infinity, upscale: { a: 1 } })).toBeNull();
    expect(normalizeScores({ cozy: NaN, lively: 0.3 })).toEqual({ lively: 0.3 });
  });

  it('returns null for empty or non-object input', () => {
    for (const input of [{}, null, undefined, [], [0.5], 'cozy', 3, { electric: 1 }]) {
      expect(normalizeScores(input)).toBeNull();
    }
  });
});
