import { describe, expect, it, vi } from 'vitest';
import type { Place } from '../../osm';
import { createSearchController, type PlaceSearchProvider, type SearchState } from '../placeSearch';

const fixture = (name: string): Place => ({ id: `node/${name}`, name, lat: 42.35, lon: -71.06, category: 'Park', tags: {} });

function deferredProvider() {
  const calls: { query: string; signal: AbortSignal; resolve: (p: Place[]) => void; reject: (e: unknown) => void }[] = [];
  const provider: PlaceSearchProvider = {
    name: 'test',
    search: (query, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ query, signal, resolve, reject });
      }),
  };
  return { provider, calls };
}

describe('place search controller', () => {
  it('runs only on submit, trims, and ignores blank queries', async () => {
    const search = vi.fn(async () => [fixture('A')]);
    const states: SearchState[] = [];
    const c = createSearchController({ name: 't', search }, (s) => states.push(s));
    await c.submit('   ');
    expect(search).not.toHaveBeenCalled();
    await c.submit('  fenway ');
    expect(search).toHaveBeenCalledWith('fenway', expect.any(AbortSignal));
    expect(states.map((s) => s.status)).toEqual(['searching', 'results']);
  });

  it('reports empty results and errors', async () => {
    const states: SearchState[] = [];
    await createSearchController({ name: 't', search: async () => [] }, (s) => states.push(s)).submit('zzz');
    await createSearchController({ name: 't', search: async () => Promise.reject(new Error('503')) }, (s) => states.push(s)).submit('x');
    expect(states.map((s) => s.status)).toEqual(['searching', 'empty', 'searching', 'error']);
  });

  it('cancels the previous search and ignores its late answer', async () => {
    const { provider, calls } = deferredProvider();
    const states: SearchState[] = [];
    const c = createSearchController(provider, (s) => states.push(s));
    const first = c.submit('first');
    const second = c.submit('second');
    expect(calls[0].signal.aborted).toBe(true);
    calls[1].resolve([fixture('Second')]);
    calls[0].resolve([fixture('First')]); // late, for the old query
    await Promise.all([first, second]);
    const last = states.at(-1)!;
    expect(last.status === 'results' && last.results.map((p) => p.name)).toEqual(['Second']);
  });

  it('clear() drops results and a pending search', async () => {
    const { provider, calls } = deferredProvider();
    const states: SearchState[] = [];
    const c = createSearchController(provider, (s) => states.push(s));
    const pending = c.submit('fenway');
    c.clear();
    calls[0].resolve([fixture('Late')]);
    await pending;
    expect(c.getState()).toEqual({ status: 'idle', query: '' });
  });
});
