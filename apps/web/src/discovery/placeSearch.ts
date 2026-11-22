/**
 * Place search used by the panel's Search view.
 *
 * The provider is injected (today: osm.ts `searchPlaces`, i.e. Nominatim),
 * so it can be replaced later without touching the UI. Searches run only on
 * submit, never per keystroke: Nominatim's usage policy forbids autocomplete.
 */
import type { Place } from '../osm';

export interface PlaceSearchProvider {
  /** Shown under the search box, e.g. "OpenStreetMap Nominatim". */
  readonly name: string;
  search(query: string, signal: AbortSignal): Promise<Place[]>;
}

export type SearchState =
  | { status: 'idle'; query: '' }
  | { status: 'searching'; query: string }
  | { status: 'results'; query: string; results: Place[] }
  | { status: 'empty'; query: string }
  | { status: 'error'; query: string };

export interface SearchController {
  getState(): SearchState;
  /** Run a search for `query` (trimmed). Blank queries are ignored. */
  submit(query: string): Promise<void>;
  /** Cancel any search in flight and forget results. */
  clear(): void;
  dispose(): void;
}

export function createSearchController(
  provider: PlaceSearchProvider,
  onChange: (state: SearchState) => void,
): SearchController {
  let state: SearchState = { status: 'idle', query: '' };
  let abort: AbortController | undefined;
  let generation = 0;
  const set = (next: SearchState) => {
    state = next;
    onChange(state);
  };

  return {
    getState: () => state,
    async submit(raw) {
      const query = raw.trim();
      if (!query) return;
      abort?.abort();
      const controller = (abort = new AbortController());
      const gen = ++generation;
      set({ status: 'searching', query });
      try {
        const results = await provider.search(query, controller.signal);
        if (gen !== generation) return; // a newer search (or clear) replaced this one
        set(results.length ? { status: 'results', query, results } : { status: 'empty', query });
      } catch (err) {
        if (gen !== generation || (err as Error).name === 'AbortError') return;
        set({ status: 'error', query });
      }
    },
    clear() {
      abort?.abort();
      generation++;
      set({ status: 'idle', query: '' });
    },
    dispose() {
      abort?.abort();
      generation++;
    },
  };
}
