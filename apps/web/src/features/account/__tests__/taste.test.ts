import { describe, expect, it } from 'vitest';
import { computeTaste, topVibesOf, type VibeEvent } from '../taste';
import { VIBE_KEYS, type VibeKey, type VibeScores, type VibeSource } from '../vibes';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY = 86_400_000;
let nextId = 1;

function event(scores: VibeScores, ageDays = 0, source: VibeSource = 'quiz'): VibeEvent {
  return {
    id: nextId++,
    createdAt: new Date(NOW.getTime() - ageDays * DAY).toISOString(),
    source,
    scores,
    placeId: null,
  };
}

const zeros = () => Object.fromEntries(VIBE_KEYS.map((k) => [k, 0])) as Record<VibeKey, number>;

describe('computeTaste', () => {
  it('empty history has no taste', () => {
    const taste = computeTaste('u1', [], NOW, { includeDev: true });
    expect(taste.profile).toEqual({ userId: 'u1', tags: zeros() });
    expect(taste.strength).toBe(0);
    expect(taste.topVibes).toEqual([]);
    expect(taste.hasSample).toBe(false);
  });

  it('missing keys count as 0, so frequent beats rare-strong', () => {
    const events = [event({ cozy: 1 }), ...Array.from({ length: 20 }, () => event({ lively: 0.6 }))];
    const taste = computeTaste('u1', events, NOW, { includeDev: true });
    expect(taste.profile.tags.lively).toBeCloseTo(12 / 21, 3);
    expect(taste.profile.tags.cozy).toBeCloseTo(1 / 21, 3);
    expect(taste.topVibes[0].key).toBe('lively');
  });

  it('halves an event weight every 14 days', () => {
    const taste = computeTaste('u1', [event({ cozy: 1 }, 14)], NOW, { includeDev: true });
    expect(taste.strength).toBeCloseTo(0.1, 6);
    expect(taste.profile.tags.cozy).toBeCloseTo(1, 6);
  });

  it('weights recent events above old ones', () => {
    const taste = computeTaste('u1', [event({ cozy: 1 }, 28), event({ quiet: 1 }, 0)], NOW, { includeDev: true });
    expect(taste.profile.tags.quiet).toBeCloseTo(1 / 1.25, 6);
    expect(taste.profile.tags.cozy).toBeCloseTo(0.25 / 1.25, 6);
  });

  it('strength saturates at 1', () => {
    const events = Array.from({ length: 6 }, () => event({ cozy: 0.5 }));
    expect(computeTaste('u1', events, NOW, { includeDev: true }).strength).toBe(1);
  });

  it('dev rows are excluded when includeDev is false and flagged when true', () => {
    const events = [event({ cozy: 1 }, 0, 'dev'), event({ quiet: 1 })];
    const prod = computeTaste('u1', events, NOW, { includeDev: false });
    expect(prod.profile.tags.cozy).toBe(0);
    expect(prod.hasSample).toBe(false);
    const dev = computeTaste('u1', events, NOW, { includeDev: true });
    expect(dev.profile.tags.cozy).toBeCloseTo(0.5, 6);
    expect(dev.hasSample).toBe(true);
    expect(computeTaste('u1', [event({ quiet: 1 })], NOW, { includeDev: true }).hasSample).toBe(false);
  });

  it('future timestamps count as age 0', () => {
    const taste = computeTaste('u1', [event({ cozy: 1 }, -3)], NOW, { includeDev: true });
    expect(taste.strength).toBeCloseTo(0.2, 6);
  });
});

describe('topVibesOf', () => {
  it('keeps keys at or above 0.35, highest first, at most 3, ties in vocabulary order', () => {
    const tags = { ...zeros(), outdoor: 0.5, cozy: 0.5, quiet: 0.9, lively: 0.35, divey: 0.34 };
    expect(topVibesOf(tags)).toEqual([
      { key: 'quiet', score: 0.9 },
      { key: 'cozy', score: 0.5 },
      { key: 'outdoor', score: 0.5 },
    ]);
    expect(topVibesOf({ ...zeros(), lively: 0.35, divey: 0.34 })).toEqual([{ key: 'lively', score: 0.35 }]);
  });
});
