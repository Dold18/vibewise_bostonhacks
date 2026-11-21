import { describe, expect, it } from 'vitest';
import type { AccountState } from '../../account/session';
import { computeTaste, type VibeEvent } from '../../account/taste';
import { themeFor } from '../controller';

const NOW = new Date('2026-11-21T12:00:00Z');
const event: VibeEvent = { id: 1, createdAt: NOW.toISOString(), source: 'quiz', scores: { cozy: 0.9 }, placeId: null };

function signedIn(events: VibeEvent[], effectsEnabled = true): AccountState {
  return {
    status: 'signed_in',
    user: { id: 'u1', email: 'u1@test.local' },
    profile: { effectsEnabled },
    events,
    taste: computeTaste('u1', events, NOW, { includeDev: true }),
  };
}

describe('themeFor', () => {
  it('is null unless signed in', () => {
    expect(themeFor({ status: 'loading' })).toBeNull();
    expect(themeFor({ status: 'unavailable' })).toBeNull();
    expect(themeFor({ status: 'signed_out' })).toBeNull();
  });

  it('is null when map effects are off', () => {
    expect(themeFor(signedIn([event], false))).toBeNull();
  });

  it('is null with no history', () => {
    expect(themeFor(signedIn([]))).toBeNull();
  });

  it("follows the user's taste otherwise", () => {
    const state = signedIn([event]);
    if (state.status !== 'signed_in') throw new Error('unreachable');
    expect(themeFor(state)).toEqual({ tags: state.taste.profile.tags, strength: state.taste.strength });
  });
});
