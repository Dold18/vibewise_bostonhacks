// Transit-workstream types.
//
// GeoPoint / TransitMode / TransitLeg / TransitOption are copied VERBATIM from docs/CONTRACTS.md §2.
// No shared executable types module exists yet; when the integration owner creates one under
// src/shared, delete the copies below and import from there (proposal only, not done here).

export type GeoPoint = { lat: number; lng: number };

export type TransitMode = "walk" | "subway" | "bus" | "commuter_rail" | "ferry" | "other";

export interface TransitLeg {
  mode: TransitMode;
  start: GeoPoint;
  end: GeoPoint;
  durationSec: number;
  distanceMeters?: number;
  geometry: [number, number][]; // [lng,lat], at least 2 points if provided
  instructions?: string;
  routeShortName?: string; // e.g., "B", "Red", "1"
  routeColor?: string; // "#RRGGBB", visual hint only
  fromStopName?: string;
  toStopName?: string;
  source?: string;
}

export interface TransitOption {
  id: string;
  durationSec: number;
  departureAt?: string;
  arrivalAt?: string;
  transfers: number;
  legs: TransitLeg[];
  fareCents?: number; // undefined if unknown
}

// ---------------------------------------------------------------------------------------------
// Skeleton variants: identical to the contract types except durationSec may be `null` because
// live /schedules timing is a later layer. Contract §1 forbids reading missing data as zero, so
// "unknown" is null rather than 0. Not a parallel model: `Omit` + one widened field, and it
// becomes a plain TransitOption once the timing layer fills the nulls.
// ---------------------------------------------------------------------------------------------
export type TransitLegDraft = Omit<TransitLeg, "durationSec"> & { durationSec: number | null };
export type TransitOptionDraft = Omit<TransitOption, "durationSec" | "legs"> & {
  durationSec: number | null;
  legs: TransitLegDraft[];
};

// ---- Precomputed data shapes (apps/web/src/features/transit/data/*.json) ----
export interface Stop {
  stop_id: string; // GTFS parent-station id, e.g. "place-harsq"
  name: string;
  lat: number;
  lng: number;
}

export interface RoutePattern {
  route_pattern_id: string; // e.g. "Red-1-0" (Alewife→Ashmont)
  route_id: string; // "Red" | "Orange" | "Blue" | "Green-B" | ...
  direction_id: number;
  stops: { stop_id: string; seq: number }[]; // ordered; seq is 0-based along direction of travel
  // Extras beyond the minimal spec (see README): used to prefer typical patterns / join shapes.
  typicality: number; // GTFS route_pattern_typicality, 1 = canonical
  shape_id: string | null;
  name: string;
}

export interface PatternShape {
  shape_id: string;
  route_color: string | null; // "#RRGGBB"
  geometry: [number, number][]; // [lng, lat]
}

export type Direction = "forward" | "backward";

export interface NearestStop {
  stop: Stop;
  walkMeters: number; // straight-line (haversine); real walking distance is longer
  walkSeconds: number;
  source: "estimate"; // always an estimate: straight-line distance at ~80 m/min
}

export interface NoTier1Route {
  status: "no_tier1_route";
  // Caller falls back to Tier 0 (nearest stop + walk estimate). Nothing is drawn.
  reason:
    | "no_shared_pattern" | "no_pattern_in_travel_direction" | "same_stop"
    // Tier 2 (transfer) outcomes: the hub table has no candidate for this line pair (Red↔Blue, or
    // same line / different branch), or every candidate failed pattern-level validation.
    | "no_candidate_hub" | "no_valid_hub";
  originStop: Stop;
  destinationStop: Stop;
}

// ---- Live layer (/predictions + /schedules). Every time carries its kind; nothing is guessed. ----
/** live_predicted = MBTA /predictions; scheduled = schedule-derived (/schedules); estimate = our own math. */
export type TimeKind = "live_predicted" | "scheduled" | "estimate";

export interface Departure {
  stop_id: string;
  route_id: string;
  direction_id: number;
  destination?: string; // route.direction_destinations[direction_id], e.g. "Alewife"
  time: string; // ISO 8601 with offset (as served by MBTA)
  kind: "live_predicted" | "scheduled";
  source: string;
}

export interface DeparturesResult {
  status: "ok" | "empty" | "error"; // empty = APIs answered with nothing; error = a request failed
  kind: "live_predicted" | "scheduled" | null; // which source the departures came from
  departures: Departure[];
  message?: string;
}

export interface RideTiming {
  kind: "scheduled"; // schedule-derived, not live
  method: "route+direction" | "pattern"; // how /schedules was keyed (see D-008)
  routeId: string;
  directionId: number;
  tripId: string;
  patternId: string; // pattern of the trip actually used
  departsAt: string; // scheduled departure from the origin stop (ISO)
  arrivesAt: string; // scheduled arrival at the destination stop (ISO)
  rideSeconds: number;
  /** Equivalent patterns that actually have a trip departing within the service window. */
  runningPatternIds: string[];
  /** Patterns considered but with no trip in the window (e.g. "mornings only" at midday). */
  idlePatternIds: string[];
}

/** Last scheduled train back from the destination stop (schedule-derived). */
export interface LastTrainBack {
  kind: "scheduled";
  routeId: string;
  directionId: number;
  patternId: string;
  tripId: string;
  fromStopName: string; // the stop you are at (the destination)
  toStopName: string; // where the train heads back to (origin for Tier 1, the hub for Tier 2's final leg)
  departsAt: string; // ISO
  catchable: boolean; // false if that train leaves before the rider arrives
}

export interface NoServiceResult {
  status: "no_service";
  failedLeg?: "A" | "B"; // Tier 2: which leg had no running service
  // Tier 0 late-night signal: nothing is drawn; show nearest stop, "no service" and the walk estimate.
  message: string;
  originStop: NearestStop;
  destinationStop: NearestStop;
  nextScheduledDepartureAt?: string; // present only if /schedules shows a later trip
  checkedAt: string;
}

export interface LiveErrorResult {
  status: "error"; // data unavailable → cannot verify service → nothing is drawn
  message: string;
  originStop: NearestStop;
  destinationStop: NearestStop;
  checkedAt: string;
}
