/**
 * Trip state shared by Search and Navigation: the two endpoints and the route
 * request lifecycle.
 *
 * State ownership:
 * - `from`/`to` are temporary trip endpoints. They're seeded from the
 *   discovery panel's starting point and the open popup, but editing them
 *   never changes the discovery preferences.
 * - `fromIsUserPick` marks a starting location the user chose here (Search or
 *   Navigation). Navigate prefers it over the discovery starting point.
 *
 * Routing:
 * - Only while navigation is open, and only when both endpoints are valid.
 * - Every endpoint change bumps `generation` and resets the route to idle, so
 *   an older answer can never replace a newer one (and the controller aborts
 *   the older request).
 */
import { isValidEndpoint, type RouteEndpoint, type RouteProvider, type RouteResult } from './routing';

export type RouteStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; generation: number }
  | { kind: 'done'; generation: number; result: RouteResult };

export interface TripState {
  searchOpen: boolean;
  navigationOpen: boolean;
  directionsExpanded: boolean;
  from: RouteEndpoint | null;
  to: RouteEndpoint | null;
  fromIsUserPick: boolean;
  generation: number;
  route: RouteStatus;
}

export type TripAction =
  /** Search opened from Quick Tools. */
  | { type: 'openSearch'; discoveryOrigin: RouteEndpoint | null; selectedPlace: RouteEndpoint | null }
  | { type: 'closeSearch' }
  /** Navigate on a popup: destination = that place. */
  | { type: 'navigateTo'; destination: RouteEndpoint; discoveryOrigin: RouteEndpoint | null }
  /** "Get directions" in Search: navigate between the endpoints already chosen. */
  | { type: 'getDirections' }
  | { type: 'endNavigation' }
  | { type: 'setDirectionsExpanded'; expanded: boolean }
  | { type: 'setFrom'; endpoint: RouteEndpoint | null }
  | { type: 'setTo'; endpoint: RouteEndpoint | null }
  | { type: 'swap' }
  | { type: 'retry' }
  | { type: 'requestStarted'; generation: number }
  | { type: 'resultArrived'; generation: number; result: RouteResult };

export const initialTripState = (): TripState => ({
  searchOpen: false,
  navigationOpen: false,
  directionsExpanded: false,
  from: null,
  to: null,
  fromIsUserPick: false,
  generation: 0,
  route: { kind: 'idle' },
});

const copy = (e: RouteEndpoint | null | undefined): RouteEndpoint | null =>
  isValidEndpoint(e) ? { ...e, location: { ...e.location } } : null;

/** New endpoints: the old route (and any request for it) is obsolete. */
const withEndpoints = (s: TripState, from: RouteEndpoint | null, to: RouteEndpoint | null, fromIsUserPick: boolean): TripState => ({
  ...s,
  from,
  to,
  fromIsUserPick: fromIsUserPick && !!from,
  generation: s.generation + 1,
  route: { kind: 'idle' },
});

/** Starting location for a new search or navigation: the user's own pick, else the discovery starting point, else none. */
const startFor = (s: TripState, discoveryOrigin: RouteEndpoint | null) =>
  s.fromIsUserPick && isValidEndpoint(s.from) ? { from: s.from, userPick: true } : { from: copy(discoveryOrigin), userPick: false };

export function tripReducer(s: TripState, a: TripAction): TripState {
  switch (a.type) {
    case 'openSearch': {
      if (s.searchOpen) return s;
      // During navigation, Search shares the live endpoints; it doesn't reset the trip.
      if (s.navigationOpen) return { ...s, searchOpen: true };
      const start = startFor(s, a.discoveryOrigin);
      return { ...withEndpoints(s, start.from, copy(a.selectedPlace), start.userPick), searchOpen: true };
    }
    case 'closeSearch':
      return s.searchOpen ? { ...s, searchOpen: false } : s;
    case 'navigateTo': {
      const start = startFor(s, a.discoveryOrigin);
      return { ...withEndpoints(s, start.from, copy(a.destination), start.userPick), navigationOpen: true, directionsExpanded: true, searchOpen: false };
    }
    case 'getDirections':
      if (!canRoute(s)) return s;
      return { ...withEndpoints(s, s.from, s.to, s.fromIsUserPick), navigationOpen: true, directionsExpanded: true, searchOpen: false };
    case 'setDirectionsExpanded':
      return s.navigationOpen && s.directionsExpanded !== a.expanded ? { ...s, directionsExpanded: a.expanded } : s;
    case 'endNavigation':
      return s.navigationOpen ? { ...s, navigationOpen: false, directionsExpanded: false, generation: s.generation + 1, route: { kind: 'idle' } } : s;
    case 'setFrom':
      return withEndpoints(s, copy(a.endpoint), s.to, true);
    case 'setTo':
      return withEndpoints(s, s.from, copy(a.endpoint), s.fromIsUserPick);
    case 'swap':
      return withEndpoints(s, s.to, s.from, !!s.to);
    case 'retry':
      return s.route.kind === 'done' ? { ...s, generation: s.generation + 1, route: { kind: 'idle' } } : s;
    case 'requestStarted':
      if (a.generation !== s.generation || s.route.kind !== 'idle') return s;
      return { ...s, route: { kind: 'loading', generation: a.generation } };
    case 'resultArrived':
      // Stale: the endpoints changed, or navigation ended, since this request started.
      if (a.generation !== s.generation || s.route.kind !== 'loading' || !s.navigationOpen) return s;
      return { ...s, route: { kind: 'done', generation: a.generation, result: a.result } };
    default:
      return s;
  }
}

export const canRoute = (s: Pick<TripState, 'from' | 'to'>) => isValidEndpoint(s.from) && isValidEndpoint(s.to);

/** A request should start now: navigating, both endpoints valid, nothing requested for them yet. */
export const needsRoute = (s: TripState) => s.navigationOpen && canRoute(s) && s.route.kind === 'idle';

/** What navigation is still waiting for, if anything. */
export function missingEndpoint(s: Pick<TripState, 'from' | 'to'>): 'from' | 'to' | 'both' | null {
  const f = isValidEndpoint(s.from);
  const t = isValidEndpoint(s.to);
  return f && t ? null : !f && !t ? 'both' : !f ? 'from' : 'to';
}

/**
 * Runs route requests for a trip store: starts one when `needsRoute`, aborts
 * it as soon as the endpoints change or navigation ends.
 */
export function createTripRouter(
  store: { getState(): TripState; dispatch(a: TripAction): void; subscribe(l: (s: TripState) => void): () => void },
  provider: RouteProvider,
) {
  let inflight: { generation: number; abort: AbortController } | null = null;

  function sync(s: TripState) {
    if (inflight && (inflight.generation !== s.generation || !s.navigationOpen)) {
      inflight.abort.abort();
      inflight = null;
    }
    if (!needsRoute(s) || inflight) return;
    const generation = s.generation;
    const abort = new AbortController();
    inflight = { generation, abort };
    store.dispatch({ type: 'requestStarted', generation });
    provider
      .plan({ origin: s.from!, destination: s.to! }, abort.signal)
      .then((result) => {
        if (inflight?.abort === abort) inflight = null;
        store.dispatch({ type: 'resultArrived', generation, result });
      })
      .catch((e: Error) => {
        if (inflight?.abort === abort) inflight = null;
        if (e.name === 'AbortError') return; // superseded: a newer request (or none) owns the trip now
        store.dispatch({
          type: 'resultArrived',
          generation,
          result: { status: 'error', reason: 'server', message: e.message, provider: provider.name, retrievedAt: new Date().toISOString() },
        });
      });
  }

  const unsubscribe = store.subscribe(sync);
  sync(store.getState());
  return {
    dispose() {
      unsubscribe();
      inflight?.abort.abort();
      inflight = null;
    },
  };
}
