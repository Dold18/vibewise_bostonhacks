/**
 * Navigation's routing boundary.
 *
 * The trip router talks only to a `RouteProvider`. Endpoints are resolved
 * coordinates (`RouteEndpoint`); a catalog/OSM place id is carried when the
 * endpoint really is a place, and never invented otherwise.
 *
 * This is a navigation-specific request shape, not the shared `TransitRequest`
 * in docs/CONTRACTS.md: that contract requires `destinationPlaceId`, which
 * stations, landmarks and chosen locations don't have. If the shared contract
 * should change instead, that needs team approval (flagged, not done here).
 *
 * The live provider calls the transit server (`POST /api/transit/route` via
 * transitRoute.ts). The browser never imports the transit engine.
 */
import { fetchRoute, NO_ROUTE_TEXT, type FetchRouteResult, type LatLng, type RouteOk } from '../../transitRoute';

export type GeoPoint = { lat: number; lng: number };

export interface RouteEndpoint {
  label: string;
  location: GeoPoint;
  /** e.g. 'discovery_origin', 'map_place', 'saved_place', 'local_suggestion', 'device_geolocation', 'search_result'. */
  source: string;
  /** Real OSM/catalog id, only when the endpoint is a known place. */
  placeId?: string;
  /** Only for a real browser geolocation fix. */
  accuracyMeters?: number;
}

export interface RouteRequest {
  origin: RouteEndpoint;
  destination: RouteEndpoint;
}

export type RouteResult =
  | { status: 'ok'; route: RouteOk; provider: string; retrievedAt: string }
  | { status: 'no_route'; message: string; provider: string; retrievedAt: string }
  | { status: 'no_service'; message: string; nextScheduledDepartureAt?: string; provider: string; retrievedAt: string }
  | { status: 'error'; reason: 'unreachable' | 'invalid_response' | 'server'; message: string; provider: string; retrievedAt: string };

export interface RouteProvider {
  /** Shown with results. */
  readonly name: string;
  /** Rejects with an AbortError when `signal` aborts; callers drop those. */
  plan(request: RouteRequest, signal: AbortSignal): Promise<RouteResult>;
}

export function isValidEndpoint(e: RouteEndpoint | null | undefined): e is RouteEndpoint {
  return (
    !!e &&
    typeof e.label === 'string' &&
    e.label.trim().length > 0 &&
    !!e.location &&
    Number.isFinite(e.location.lat) &&
    Number.isFinite(e.location.lng) &&
    Math.abs(e.location.lat) <= 90 &&
    Math.abs(e.location.lng) <= 180
  );
}

/** Real OSM element ids only ("node/123"); synthetic ids such as map-tile ones are not place ids. */
export const realPlaceId = (id: string | undefined): string | undefined =>
  id && /^(node|way|relation)\/\d+$/.test(id) ? id : undefined;

/** The place id worth carrying: an OSM element id, or our Supabase catalog's own id. Never synthetic. */
export function placeIdFor(place: { id: string; tags?: Record<string, string | undefined> }): string | undefined {
  return realPlaceId(place.id) ?? (place.tags?.['catalog:place_id'] === place.id ? place.id : undefined);
}

export const sameLocation = (a: GeoPoint | null | undefined, b: GeoPoint | null | undefined) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

// ---------------------------------------------------------------------------
// Live provider: the transit API server
// ---------------------------------------------------------------------------

export function toRouteResult(r: FetchRouteResult, provider: string, retrievedAt: string): RouteResult {
  if (r.kind === 'error') return { status: 'error', reason: r.reason, message: r.message, provider, retrievedAt };
  const res = r.result;
  switch (res.status) {
    case 'ok':
      return { status: 'ok', route: res, provider, retrievedAt };
    case 'no_tier1_route':
      return {
        status: 'no_route',
        message: (res.reason && NO_ROUTE_TEXT[res.reason]) || 'No MBTA subway route connects these places.',
        provider,
        retrievedAt,
      };
    case 'no_service':
      return {
        status: 'no_service',
        message: res.message,
        ...(res.nextScheduledDepartureAt ? { nextScheduledDepartureAt: res.nextScheduledDepartureAt } : {}),
        provider,
        retrievedAt,
      };
    case 'error':
      return { status: 'error', reason: 'server', message: res.message, provider, retrievedAt };
  }
}

export function createApiRouteProvider(fetchImpl?: typeof fetch, now: () => Date = () => new Date()): RouteProvider {
  const name = 'MBTA V3 via the Vibewise transit API';
  const point = (e: RouteEndpoint): LatLng => ({ lat: e.location.lat, lng: e.location.lng });
  return {
    name,
    async plan({ origin, destination }, signal) {
      const r = await fetchRoute(point(origin), point(destination), signal, fetchImpl);
      return toRouteResult(r, name, now().toISOString());
    },
  };
}
