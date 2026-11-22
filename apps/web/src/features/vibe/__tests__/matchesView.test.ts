import { describe, expect, it, vi } from 'vitest';
import { createMatchesView } from '../matchesView';

const results = (sessionId = 's1') => ({ sessionId, phase: 'results' });

describe('matchesView', () => {
  it('starts idle: nothing requested, nothing to rank', () => {
    const v = createMatchesView();
    expect(v.getState()).toEqual({ sessionId: null, stage: 'idle', ranked: false, count: 0, message: null });
    expect(v.isRequested('s1')).toBe(false);
    v.setRanked(true);
    expect(v.getState().ranked).toBe(false);
  });

  it('Show My Matches → loading → shown → Rank My Matches ⇄ Show Unranked Matches', () => {
    const v = createMatchesView();
    const onRequest = vi.fn();
    v.onRequest(onRequest);
    v.request('s1');
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(v.isRequested('s1')).toBe(true);
    expect(v.getState().stage).toBe('loading');
    v.setRanked(true); // nothing on the map yet: ranking is not available
    expect(v.getState().ranked).toBe(false);
    v.shown(12);
    expect(v.getState()).toMatchObject({ stage: 'shown', count: 12, ranked: false });
    v.toggleRanked();
    expect(v.getState().ranked).toBe(true);
    v.toggleRanked();
    expect(v.getState().ranked).toBe(false);
    v.setRanked(true);
    expect(v.getState()).toMatchObject({ stage: 'shown', count: 12, ranked: true });
  });

  it('ignores search progress nobody asked for', () => {
    const v = createMatchesView();
    v.loading(); v.failed('x'); v.shown(3);
    expect(v.getState().stage).toBe('idle');
  });

  it('cannot rank an empty result set', () => {
    const v = createMatchesView();
    v.request('s1'); v.shown(0); v.setRanked(true);
    expect(v.getState()).toMatchObject({ stage: 'shown', count: 0, ranked: false });
  });

  it('an error clears ranking and offers a retry through request()', () => {
    const v = createMatchesView();
    v.request('s1'); v.shown(5); v.setRanked(true);
    v.loading();
    expect(v.getState()).toMatchObject({ stage: 'loading', ranked: false, count: 0 });
    v.failed('The search service took too long to answer.');
    expect(v.getState()).toMatchObject({ stage: 'error', ranked: false, message: 'The search service took too long to answer.' });
    v.request('s1');
    expect(v.getState()).toMatchObject({ stage: 'loading', message: null });
  });

  it('a new result set for the same request comes back unranked', () => {
    const v = createMatchesView();
    v.request('s1'); v.shown(5); v.setRanked(true);
    v.shown(4);
    expect(v.getState()).toMatchObject({ stage: 'shown', count: 4, ranked: false });
  });

  it('leaving results, a new session or a cleared quiz forgets the request and its ranking', () => {
    for (const next of [{ sessionId: 's1', phase: 'generating' }, { sessionId: 's1', phase: 'question' }, results('s2'), null]) {
      const v = createMatchesView();
      v.request('s1'); v.shown(5); v.setRanked(true);
      v.syncProfile(next);
      expect(v.getState()).toEqual({ sessionId: null, stage: 'idle', ranked: false, count: 0, message: null });
    }
  });

  it('staying in the same results keeps the view (embedding or filter updates)', () => {
    const v = createMatchesView();
    v.request('s1'); v.shown(5); v.setRanked(true);
    v.syncProfile(results('s1'));
    expect(v.getState()).toMatchObject({ stage: 'shown', ranked: true });
  });

  it('notifies only on real changes', () => {
    const v = createMatchesView();
    const f = vi.fn();
    v.subscribe(f);
    v.syncProfile(null); v.reset(); v.setRanked(true);
    expect(f).not.toHaveBeenCalled();
    v.request('s1'); v.shown(2); v.shown(2);
    expect(f).toHaveBeenCalledTimes(2);
    v.reset();
    expect(f).toHaveBeenCalledTimes(3);
    expect(v.getState().stage).toBe('idle');
  });
});
