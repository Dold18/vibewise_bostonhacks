/**
 * The quiz's final, authoritative result set. When the quiz reaches its results phase and its query vector
 * is ready, this sends that vector (never re-embedded) to POST /api/vibe/search together with the
 * discovery panel's origin, budget and cuisine choices, and reports one of four states: idle, loading,
 * error or ready. The live per-answer ranking (convergence.ts) stays separate and provisional.
 *
 * It never substitutes the live ranking for a failed call: the caller shows `error` as an error.
 */
import { CUISINE_SYNONYMS } from '../../discovery/filter.ts';
import type { CuisineId, InitialPreferences } from '../../discovery/preferences.ts';
import { pinToPlace, type CatalogDetails, type CatalogPin } from '../../catalog.ts';
import type { Place } from '../../osm.ts';
import type { OutingVibeProfile } from './profile.ts';
import { budgetToMaxPriceBand, type SearchFilters, type SearchResponse, type SearchResult } from './searchContract.ts';

export const FINAL_SEARCH_LIMIT = 30;
const FINAL_SEARCH_TIMEOUT_MS = 20_000;

/**
 * Panel cuisine choices → the catalog's cuisine strings (same synonym table the panel's own filter uses).
 * `undefined` (no filter) when nothing is chosen, or when "Other" is among the choices: "Other" means any
 * cuisine we don't list, which a list of strings cannot express, so narrowing would silently drop those places.
 */
export function cuisineFilterFor(ids: readonly CuisineId[]): string[] | undefined {
  if (!ids.length || ids.includes('other')) return undefined;
  const out = new Set<string>();
  for (const id of ids) for (const c of CUISINE_SYNONYMS[id as Exclude<CuisineId, 'other'>] ?? []) out.add(c);
  return out.size ? [...out] : undefined;
}

export function filtersFor(prefs: Pick<InitialPreferences, 'origin' | 'budget' | 'cuisines' | 'activity'>): SearchFilters {
  const filters: SearchFilters = {};
  if (prefs.origin) filters.origin = { lat: prefs.origin.location.lat, lng: prefs.origin.location.lng };
  const band = budgetToMaxPriceBand(prefs.budget?.maxCentsPerPerson ?? null);
  if (band) filters.maxPriceBand = band;
  // The panel only keeps cuisines while Food & drinks is the activity; guard here too.
  const cuisines = prefs.activity === 'food_drinks' ? cuisineFilterFor(prefs.cuisines) : undefined;
  if (cuisines) filters.cuisines = cuisines;
  return filters;
}

export function searchBodyFor(profile: OutingVibeProfile, filters: SearchFilters) {
  const { vector, modelKey } = profile.embedding;
  return { vector, modelKey, filters, limit: FINAL_SEARCH_LIMIT };
}

/** A search result as a map `Place`, built by the same `pinToPlace` the live pins use, so ids and tags match. */
export function resultToPlace(r: SearchResult, cached?: CatalogDetails): Place {
  const osm = r.placeId.startsWith('osm:');
  const pin: CatalogPin = {
    placeId: r.placeId, placeType: 'restaurants', source: osm ? 'osm' : 'foursquare',
    sourceId: r.placeId.slice(r.placeId.indexOf(':') + 1), name: r.name, kind: r.category ?? 'restaurant',
    lat: r.location.lat, lon: r.location.lng,
  };
  return pinToPlace(pin, {
    address: r.address, website: r.website, phone: cached?.phone ?? null, cuisines: r.cuisines,
    hours_raw: r.hoursRaw, osm_tags: cached?.osm_tags ?? null, attribution: cached?.attribution ?? '',
    price_band: r.priceBand, price_source: r.priceSource, deals: cached?.deals ?? [],
  });
}

export type FinalSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; places: Place[]; response: SearchResponse };

export interface FinalSearchDeps {
  getPrefs(): InitialPreferences;
  getDetails?(placeId: string): CatalogDetails | undefined;
  onState(state: FinalSearchState): void;
  fetchImpl?: typeof fetch;
}

export function createFinalSearch(deps: FinalSearchDeps) {
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let key: string | null = null; // set once a request is in flight or done; never after a failure, so a new publish retries
  let abort: AbortController | null = null;
  let state: FinalSearchState = { status: 'idle' };
  const emit = (s: FinalSearchState) => { state = s; deps.onState(s); };
  const idle = () => { abort?.abort(); abort = null; key = null; if (state.status !== 'idle') emit({ status: 'idle' }); };

  async function run(profile: OutingVibeProfile, filters: SearchFilters, myKey: string) {
    abort?.abort();
    const ctl = (abort = new AbortController());
    key = myKey;
    emit({ status: 'loading' });
    try {
      const res = await doFetch('/api/vibe/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchBodyFor(profile, filters)),
        signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(FINAL_SEARCH_TIMEOUT_MS)]),
      });
      if (!res.ok) {
        const detail = await res.json().then((j: { error?: unknown }) => (typeof j.error === 'string' ? j.error : ''), () => '');
        throw new Error(detail || `The search service returned ${res.status}.`);
      }
      const body = (await res.json()) as SearchResponse;
      if (!body || !Array.isArray(body.results)) throw new Error('The search service sent an unreadable response.');
      if (ctl.signal.aborted) return;
      emit({ status: 'ready', response: body, places: body.results.map((r) => resultToPlace(r, deps.getDetails?.(r.placeId))) });
    } catch (e) {
      if (ctl.signal.aborted) return; // superseded or cleared: a newer call or idle() owns the state
      key = null;
      const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
      emit({ status: 'error', message: timedOut ? 'The search service took too long to answer.' : e instanceof Error && e.message ? e.message : 'The search service is unavailable.' });
    }
  }

  /** Call on every quiz profile publish (and, with `fromPrefs`, whenever discovery preferences change). */
  function evaluate(profile: OutingVibeProfile | null, fromPrefs = false) {
    if (!profile || profile.phase !== 'results') { idle(); return; }
    const { embedding } = profile;
    if (embedding.status === 'unavailable') {
      if (fromPrefs) return;
      abort?.abort(); key = null;
      emit({ status: 'error', message: embedding.reason ?? 'Semantic matching is unavailable, so final matches could not be found.' });
      return;
    }
    if (embedding.status !== 'ready' || !embedding.vector) {
      if (state.status !== 'loading') emit({ status: 'loading' }); // the vector is still being computed
      return;
    }
    const filters = filtersFor(deps.getPrefs());
    const next = `${profile.sessionId}:${profile.version}:${JSON.stringify(filters)}`;
    if (next === key) return;
    if (fromPrefs && key === null) return; // preference edits never retry a failed or never-started search
    void run(profile, filters, next);
  }

  return { evaluate, getState: () => state, destroy: () => { abort?.abort(); abort = null; key = null; } };
}
