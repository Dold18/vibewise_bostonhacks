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
  reason: "no_shared_pattern" | "no_pattern_in_travel_direction" | "same_stop";
  originStop: Stop;
  destinationStop: Stop;
}
