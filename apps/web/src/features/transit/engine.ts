// Tier 0 / Tier 1 MBTA subway engine. Pure functions over the committed JSON in ./data.
// No network, no restaurant concept: coordinates in, transit answers out. See PROJECT_BRIEF §9, D-007.

import stopsJson from "./data/stops.json" with { type: "json" };
import patternsJson from "./data/patterns.json" with { type: "json" };
import shapesJson from "./data/shapes.json" with { type: "json" };
import type {
  Direction, GeoPoint, NearestStop, NoTier1Route, PatternShape, RoutePattern, Stop,
  TransitLegDraft, TransitOptionDraft,
} from "./types.ts";

const stops = stopsJson as Stop[];
const patterns = patternsJson as RoutePattern[];
const shapes = shapesJson as PatternShape[];

export const WALK_METERS_PER_MIN = 80;
/** Subway routes in scope (matches the precompute script). */
export const SUBWAY_ROUTE_IDS = ["Red", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E"];
const WALK_SOURCE = `approx: straight-line walk, ~${WALK_METERS_PER_MIN} m/min`;

const stopById = new Map(stops.map((s) => [s.stop_id, s]));
export const getStop = (id: string): Stop | undefined => stopById.get(id);
const shapeById = new Map(shapes.map((s) => [s.shape_id, s]));
const patternsByStop = new Map<string, RoutePattern[]>();
for (const p of patterns) {
  for (const s of p.stops) {
    const list = patternsByStop.get(s.stop_id) ?? [];
    list.push(p);
    patternsByStop.set(s.stop_id, list);
  }
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Closest subway station by straight-line distance. Walk time is an estimate, labeled as such. */
export function nearestStop(coord: GeoPoint): NearestStop {
  let best = stops[0];
  let bestM = Infinity;
  for (const s of stops) {
    const m = haversineMeters(coord, s);
    if (m < bestM) { best = s; bestM = m; }
  }
  const walkMeters = Math.round(bestM);
  return { stop: best, walkMeters, walkSeconds: Math.round((bestM / WALK_METERS_PER_MIN) * 60), source: "estimate" };
}

/**
 * Route patterns (branch + direction) serving BOTH stops. Matching is by pattern, never by line
 * color. Empty array = no Tier 1 route for this pair.
 */
export function sharedPatterns(stopA: Stop, stopB: Stop): RoutePattern[] {
  const atB = new Set((patternsByStop.get(stopB.stop_id) ?? []).map((p) => p.route_pattern_id));
  return (patternsByStop.get(stopA.stop_id) ?? []).filter((p) => atB.has(p.route_pattern_id));
}

const seqOf = (pattern: RoutePattern, stop: Stop): number | undefined =>
  pattern.stops.find((s) => s.stop_id === stop.stop_id)?.seq;

/**
 * Ride direction within one pattern, from its ordered stop sequence. "forward" = A comes before B
 * in the pattern's direction of travel (rideable on this pattern). "backward" = B comes first
 * (this pattern runs the opposite way). null = either stop absent or same position: never guess.
 */
export function direction(pattern: RoutePattern, stopA: Stop, stopB: Stop): Direction | null {
  const a = seqOf(pattern, stopA);
  const b = seqOf(pattern, stopB);
  if (a === undefined || b === undefined || a === b) return null;
  return a < b ? "forward" : "backward";
}

function nearestIndex(geom: [number, number][], p: GeoPoint, from: number, to: number): number {
  let best = from;
  let bestM = Infinity;
  for (let i = from; i <= to; i++) {
    const m = haversineMeters(p, { lng: geom[i][0], lat: geom[i][1] });
    if (m < bestM) { best = i; bestM = m; }
  }
  return best;
}

function walkLeg(from: GeoPoint, to: GeoPoint, instructions: string): TransitLegDraft {
  const meters = Math.round(haversineMeters(from, to));
  return {
    mode: "walk", start: from, end: to,
    durationSec: Math.round((meters / WALK_METERS_PER_MIN) * 60), // estimate, see `source`
    distanceMeters: meters,
    geometry: [[from.lng, from.lat], [to.lng, to.lat]],
    instructions,
    source: WALK_SOURCE,
  };
}

/**
 * Subway leg: the pattern's real GTFS shape sliced between the two stops. Geometry is returned in
 * direction of travel. durationSec is null (live /schedules timing is a later layer).
 * Throws if direction is not forward/backward or the pattern has no shape: callers must have
 * checked `direction()` first.
 */
export function buildLeg(pattern: RoutePattern, stopA: Stop, stopB: Stop, dir: Direction): TransitLegDraft {
  const shape = pattern.shape_id ? shapeById.get(pattern.shape_id) : undefined;
  if (!shape) throw new Error(`no shape for pattern ${pattern.route_pattern_id}`);
  if (direction(pattern, stopA, stopB) !== dir) throw new Error(`direction mismatch on ${pattern.route_pattern_id}`);
  const g = shape.geometry;
  // The shape runs in the pattern's direction of travel, so the "earlier" stop has the lower index.
  const [first, second] = dir === "forward" ? [stopA, stopB] : [stopB, stopA];
  const i = nearestIndex(g, first, 0, g.length - 1);
  const j = nearestIndex(g, second, i, g.length - 1);
  let slice = g.slice(i, j + 1);
  if (dir === "backward") slice = slice.reverse();
  if (slice.length < 2) throw new Error(`degenerate slice on ${pattern.route_pattern_id}`);
  return {
    mode: "subway",
    start: { lat: stopA.lat, lng: stopA.lng },
    end: { lat: stopB.lat, lng: stopB.lng },
    durationSec: null,
    geometry: slice,
    routeShortName: pattern.route_id.startsWith("Green-") ? pattern.route_id.slice(6) : pattern.route_id,
    routeColor: shape.route_color ?? undefined,
    fromStopName: stopA.name,
    toStopName: stopB.name,
    source: `MBTA GTFS static shape ${shape.shape_id} (pattern ${pattern.route_pattern_id})`,
  };
}

/** One validated ride between two stops on a single route pattern (or interchangeable patterns, D-008). */
export interface LegSelection {
  from: Stop;
  to: Stop;
  pattern: RoutePattern; // representative; for branchAgnostic legs key lookups on route_id + direction_id
  equivalentPatterns: RoutePattern[]; // every rideable pattern covering the identical stop stretch
  /**
   * true when more than one pattern covers the stretch (e.g. Harvard→Kendall is on both the Red
   * Ashmont and Braintree patterns). `pattern` is then just a representative; the trip belongs to
   * no branch. Key later /schedules lookups on route_id + direction_id, not on `pattern`.
   */
  branchAgnostic: boolean;
}

/** Rider-facing line a route belongs to: Green-B/C/D/E are all "Green". Only for hub-table lookup; never for matching. */
export const lineOf = (routeId: string): string => (routeId.startsWith("Green-") ? "Green" : routeId);

export const patternsServing = (stop: Stop): RoutePattern[] => patternsByStop.get(stop.stop_id) ?? [];

/**
 * The single place that decides "can you ride from `from` to `to` without transferring?" Pattern
 * level, forward direction only, with D-008 equivalence. Tier 1 uses it directly; Tier 2 uses it
 * once per leg. `onlyLine` restricts to patterns of one rider-facing line.
 */
export function selectRideablePattern(
  from: Stop, to: Stop, onlyLine?: string,
): LegSelection | { reason: "no_shared_pattern" | "no_pattern_in_travel_direction" } {
  const shared = sharedPatterns(from, to).filter((p) => !onlyLine || lineOf(p.route_id) === onlyLine);
  if (!shared.length) return { reason: "no_shared_pattern" };

  // Only patterns that actually run from→to qualify. Never guess direction.
  const rideable = shared
    .filter((p) => direction(p, from, to) === "forward" && p.shape_id && shapeById.has(p.shape_id))
    .map((p) => ({ p, hops: seqOf(p, to)! - seqOf(p, from)! }))
    // Prefer canonical patterns (typicality 1), then fewest stops; id only for determinism.
    .sort((x, y) => x.p.typicality - y.p.typicality || x.hops - y.hops || x.p.route_pattern_id.localeCompare(y.p.route_pattern_id));
  if (!rideable.length) return { reason: "no_pattern_in_travel_direction" };

  const pattern = rideable[0].p;
  // Patterns that traverse the exact same stops between the two stops (same route and direction)
  // are interchangeable for this ride; if several exist, don't claim a branch.
  const stretch = (p: RoutePattern) =>
    p.stops.slice(seqOf(p, from)!, seqOf(p, to)! + 1).map((s) => s.stop_id).join(">");
  const key = stretch(pattern);
  const equivalentPatterns = rideable
    .map((r) => r.p)
    .filter((p) => p.route_id === pattern.route_id && p.direction_id === pattern.direction_id && stretch(p) === key);
  return { from, to, pattern, equivalentPatterns, branchAgnostic: equivalentPatterns.length > 1 };
}

/** Transit leg for a validated selection (real GTFS shape, duration null until timed). */
export function buildRideLeg(sel: LegSelection): TransitLegDraft {
  const ride = buildLeg(sel.pattern, sel.from, sel.to, "forward");
  if (sel.branchAgnostic) {
    ride.source = `MBTA GTFS static shape, ${sel.pattern.route_id} direction ${sel.pattern.direction_id} ` +
      `(branch-agnostic stretch; patterns ${sel.equivalentPatterns.map((p) => p.route_pattern_id).join(", ")})`;
  }
  return ride;
}

export const legId = (sel: LegSelection): string =>
  sel.branchAgnostic ? `${sel.pattern.route_id}:dir${sel.pattern.direction_id}` : sel.pattern.route_pattern_id;

export const walkLegBetween = walkLeg;

export interface Tier1Plan {
  option: TransitOptionDraft;
  pattern: RoutePattern;
  direction: Direction;
  originStop: NearestStop;
  destinationStop: NearestStop;
  equivalentPatterns: RoutePattern[];
  branchAgnostic: boolean;
  leg: LegSelection; // the same data as a LegSelection, for the live layer
}

/** Same as planTripSkeleton, but also reports which pattern / direction / stops were chosen. */
export function planTier1(origin: GeoPoint, destination: GeoPoint): Tier1Plan | NoTier1Route {
  const o = nearestStop(origin);
  const d = nearestStop(destination);
  const none = (reason: NoTier1Route["reason"]): NoTier1Route =>
    ({ status: "no_tier1_route", reason, originStop: o.stop, destinationStop: d.stop });

  if (o.stop.stop_id === d.stop.stop_id) return none("same_stop");
  const sel = selectRideablePattern(o.stop, d.stop);
  if ("reason" in sel) return none(sel.reason);

  const legs: TransitLegDraft[] = [
    walkLeg(origin, o.stop, `Walk to ${o.stop.name}`),
    buildRideLeg(sel),
    walkLeg(d.stop, destination, `Walk from ${d.stop.name}`),
  ];
  const known = legs.every((l) => l.durationSec !== null);
  return {
    option: {
      id: `tier1:${legId(sel)}:${o.stop.stop_id}>${d.stop.stop_id}`,
      durationSec: known ? legs.reduce((s, l) => s + (l.durationSec ?? 0), 0) : null, // null until timing layer
      transfers: 0,
      legs,
    },
    pattern: sel.pattern, direction: "forward", originStop: o, destinationStop: d,
    equivalentPatterns: sel.equivalentPatterns, branchAgnostic: sel.branchAgnostic, leg: sel,
  };
}

/** Tier 1 orchestration: nearest stops → shared pattern → direction → walk+subway+walk legs. */
export function planTripSkeleton(origin: GeoPoint, destination: GeoPoint): TransitOptionDraft | NoTier1Route {
  const plan = planTier1(origin, destination);
  return "status" in plan ? plan : plan.option;
}
