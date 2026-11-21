/**
 * Route-planner state. Deliberately separate from the discovery preferences:
 * editing the planner's "From" never changes the saved starting point.
 *
 * Routing runs only on an explicit request (never just because the planner
 * opened). Each request gets a generation number; a result is applied only if
 * its generation is still current, so a late answer for old endpoints can't
 * update the UI even though the underlying requests can't be cancelled.
 */
import { isValidEndpoint, type RouteEndpoint, type RouteProvider, type RouteResult } from './routing';

export type RouteStatus =
  | { kind: 'idle' }
  | { kind: 'not_connected' }
  | { kind: 'loading'; generation: number }
  | { kind: 'done'; generation: number; result: RouteResult };

export interface RoutePlannerState {
  open: boolean;
  from: RouteEndpoint | null;
  to: RouteEndpoint | null;
  /** Bumped whenever the endpoints change; results for older generations are discarded. */
  generation: number;
  status: RouteStatus;
}

export type RoutePlannerAction =
  | { type: 'open'; from: RouteEndpoint | null; to: RouteEndpoint | null }
  | { type: 'close' }
  | { type: 'setFrom'; endpoint: RouteEndpoint | null }
  | { type: 'setTo'; endpoint: RouteEndpoint | null }
  | { type: 'swap' }
  | { type: 'requestStarted' }
  | { type: 'notConnected' }
  | { type: 'resultArrived'; generation: number; result: RouteResult };

export const initialPlannerState = (): RoutePlannerState => ({
  open: false,
  from: null,
  to: null,
  generation: 0,
  status: { kind: 'idle' },
});

const valid = (e: RouteEndpoint | null) => (isValidEndpoint(e) ? e : null);
const copy = (e: RouteEndpoint | null): RouteEndpoint | null => (e ? { ...e, location: { ...e.location } } : null);
const endpointsChanged = (s: RoutePlannerState, from: RouteEndpoint | null, to: RouteEndpoint | null): RoutePlannerState => ({
  ...s,
  from,
  to,
  generation: s.generation + 1,
  status: { kind: 'idle' },
});

export function routePlannerReducer(s: RoutePlannerState, a: RoutePlannerAction): RoutePlannerState {
  switch (a.type) {
    case 'open':
      // Defaults are copied in, so later planner edits can't reach the source objects.
      return { ...endpointsChanged(s, copy(valid(a.from)), copy(valid(a.to))), open: true };
    case 'close':
      return { ...endpointsChanged(s, s.from, s.to), open: false };
    case 'setFrom':
      return endpointsChanged(s, copy(valid(a.endpoint)), s.to);
    case 'setTo':
      return endpointsChanged(s, s.from, copy(valid(a.endpoint)));
    case 'swap':
      return endpointsChanged(s, s.to, s.from);
    case 'requestStarted':
      return { ...s, status: { kind: 'loading', generation: s.generation } };
    case 'notConnected':
      return { ...s, status: { kind: 'not_connected' } };
    case 'resultArrived':
      // Stale: endpoints changed (or the planner closed) since this request started.
      if (a.generation !== s.generation || s.status.kind !== 'loading') return s;
      return { ...s, status: { kind: 'done', generation: a.generation, result: a.result } };
  }
}

export const canRoute = (s: RoutePlannerState) => isValidEndpoint(s.from) && isValidEndpoint(s.to);

/**
 * Ask the provider for routes for the current endpoints. With no provider,
 * records "not connected" and makes no request.
 */
export async function requestRoutes(
  getState: () => RoutePlannerState,
  dispatch: (a: RoutePlannerAction) => void,
  provider: RouteProvider | null,
): Promise<void> {
  const s = getState();
  if (!canRoute(s)) return;
  if (!provider) {
    dispatch({ type: 'notConnected' });
    return;
  }
  dispatch({ type: 'requestStarted' });
  const generation = getState().generation;
  let result: RouteResult;
  try {
    result = await provider.plan({ origin: s.from!, destination: s.to! });
  } catch (e) {
    result = { status: 'error', message: (e as Error).message, provider: provider.name, retrievedAt: new Date().toISOString() };
  }
  dispatch({ type: 'resultArrived', generation, result });
}
