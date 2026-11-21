/**
 * Navigation's routing boundary.
 *
 * The route planner talks only to a `RouteProvider`. Endpoints are resolved
 * coordinates (`RouteEndpoint`); a catalog/OSM place id is carried when the
 * endpoint really is a place, and never invented otherwise.
 *
 * This is a navigation-specific request shape, not the shared `TransitRequest`
 * in docs/CONTRACTS.md: that contract requires `destinationPlaceId`, which
 * stations, landmarks and chosen locations don't have. Options reuse the
 * contract's `TransitOption` unchanged. If the shared contract should change
 * instead, that needs team approval (flagged, not done here).
 *
 * Live routing is OFF this milestone: the app passes no provider, so the
 * planner shows "not connected". `createTransitRouteProvider` adapts the
 * transit workstream's `planTripLive` for when it's switched on; it imports
 * transit *types* only, so no transit code or data is bundled until then.
 */
import type { LivePlanResult } from '../transit/ride';
import type { TransitOption } from '../transit/types';

export type GeoPoint = { lat: number; lng: number };

export interface RouteEndpoint {
  label: string;
  location: GeoPoint;
  /** e.g. 'discovery_origin', 'map_place', 'saved_place', 'local_suggestion', 'device_geolocation'. */
  source: string;
  /** Real OSM/catalog id, only when the endpoint is a known place. */
  placeId?: string;
}

export interface RouteRequest {
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  /** ISO 8601; defaults to now in the provider. */
  departureAt?: string;
}

export type RouteResult =
  | { status: 'ok'; options: TransitOption[]; provider: string; retrievedAt: string; notes?: string[] }
  | { status: 'no_route' | 'no_service' | 'error'; message: string; provider?: string; retrievedAt: string };

export interface RouteProvider {
  /** Shown with results, e.g. "MBTA V3 (subway, tiered)". */
  readonly name: string;
  /** Underlying requests may not be cancellable; callers must ignore stale results. */
  plan(request: RouteRequest): Promise<RouteResult>;
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

// ---------------------------------------------------------------------------
// Transit adapter (prepared; not wired into the app this milestone)
// ---------------------------------------------------------------------------

export type PlanTripLive = (
  origin: GeoPoint,
  destination: GeoPoint,
  opts?: { now?: Date },
) => Promise<LivePlanResult>;

const NO_ROUTE_MESSAGES: Record<string, string> = {
  same_stop: "Both points are nearest the same station, so there's no subway ride to plan.",
  no_shared_pattern: 'No single subway line connects the stations nearest these points.',
  no_pattern_in_travel_direction: 'No subway service runs in that direction between these stations.',
  no_candidate_hub: 'No subway trip with at most one transfer connects these stations.',
  no_valid_hub: 'No subway trip with at most one transfer connects these stations.',
};

export function createTransitRouteProvider(planTripLive: PlanTripLive, now: () => Date = () => new Date()): RouteProvider {
  const name = 'MBTA V3 (subway, tiered)';
  return {
    name,
    async plan({ origin, destination, departureAt }) {
      const when = departureAt ? new Date(departureAt) : now();
      let result: LivePlanResult;
      try {
        result = await planTripLive(origin.location, destination.location, { now: when });
      } catch (e) {
        return { status: 'error', message: `Routing failed: ${(e as Error).message}`, provider: name, retrievedAt: now().toISOString() };
      }
      const retrievedAt = now().toISOString();
      switch (result.status) {
        case 'ok': {
          const notes: string[] = [];
          if (result.lastTrainBack) notes.push(`Last scheduled train back: ${result.lastTrainBack.departsAt}`);
          if (result.lastTrainBackNote) notes.push(result.lastTrainBackNote);
          return { status: 'ok', options: [result.option], provider: name, retrievedAt, ...(notes.length ? { notes } : {}) };
        }
        case 'no_tier1_route':
          return { status: 'no_route', message: NO_ROUTE_MESSAGES[result.reason] ?? 'No subway route found.', provider: name, retrievedAt };
        case 'no_service':
          return { status: 'no_service', message: result.message, provider: name, retrievedAt };
        case 'error':
          return { status: 'error', message: result.message, provider: name, retrievedAt };
      }
    },
  };
}
