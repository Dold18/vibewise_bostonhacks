// Tier 1 live layer: real ride time from /schedules + the service-running gate that decides
// whether a route may be drawn at all (PROJECT_BRIEF §9 rule 3, D-007, D-008).

import { planTier1, selectRideablePattern, type LegSelection, type Tier1Plan } from "./engine.ts";
import { tier2Candidates, type Tier2Plan } from "./tier2.ts";
import { bostonParts, fmtBoston, mbtaGet, prevDate, scheduleWindows, type JsonApiResource, type LiveOptions } from "./mbta.ts";
import type {
  LastTrainBack, LiveErrorResult, NoServiceResult, NoTier1Route, RideTiming, TransitLeg, TransitLegDraft, TransitOption,
} from "./types.ts";

/** A pattern counts as "running" if a train that serves both stops departs within this many minutes of when you could board. */
export const SERVICE_WINDOW_MIN = 30;
/** How far ahead /schedules is read, so the destination stop's time exists for trips near the end of the window. */
const FETCH_WINDOW_MIN = SERVICE_WINDOW_MIN + 120;

export interface ServiceCheck {
  running: boolean;
  /** First catchable trip serving both stops (may be later than the service window). */
  next: RideTiming | null;
  runningPatternIds: string[];
  idlePatternIds: string[];
}

const num = (v: unknown) => (typeof v === "number" ? v : null);
const ms = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);

/**
 * Scheduled trips between the plan's two stops at/after `boardAfter`, from /schedules.
 *  - branchAgnostic legs are queried by route_id + direction_id, then limited to the equivalent
 *    patterns (D-008); the representative pattern is never used as the key.
 *  - single-pattern legs are limited to that exact pattern.
 * Service is judged from actual trips, not from the pattern existing in GTFS: a "mornings only"
 * pattern with no trip near `boardAfter` is reported idle.
 */
export async function checkService(plan: LegSelection, boardAfter: Date, opts: LiveOptions = {}): Promise<ServiceCheck> {
  const allowed = new Set<string>((plan.branchAgnostic ? plan.equivalentPatterns : [plan.pattern]).map((p) => p.route_pattern_id));
  const method: RideTiming["method"] = plan.branchAgnostic ? "route+direction" : "pattern";
  const { route_id: routeId, direction_id: directionId } = plan.pattern;
  const A = plan.from.stop_id;
  const B = plan.to.stop_id;

  const rows: JsonApiResource[] = [];
  const patternOfTrip = new Map<string, string>();
  const parentOfStop = new Map<string, string>();
  for (const w of scheduleWindows(boardAfter, FETCH_WINDOW_MIN)) {
    const doc = await mbtaGet("/schedules", {
      "filter[stop]": `${A},${B}`, "filter[route]": routeId, "filter[direction_id]": String(directionId),
      "filter[date]": w.date, "filter[min_time]": w.min, "filter[max_time]": w.max,
      include: "trip,stop", sort: "departure_time", "page[limit]": "300",
      "fields[schedule]": "arrival_time,departure_time,stop_sequence,pickup_type,drop_off_type",
    }, opts, 300_000);
    rows.push(...doc.data);
    for (const inc of doc.included ?? []) {
      if (inc.type === "trip") { const rp = inc.relationships?.route_pattern?.data?.id; if (rp) patternOfTrip.set(inc.id, rp); }
      if (inc.type === "stop") parentOfStop.set(inc.id, inc.relationships?.parent_station?.data?.id ?? inc.id);
    }
  }

  // Pair up the origin row and destination row of each trip.
  const trips = new Map<string, { a?: JsonApiResource; b?: JsonApiResource }>();
  for (const r of rows) {
    const tripId = r.relationships?.trip?.data?.id;
    const stopRaw = r.relationships?.stop?.data?.id;
    if (!tripId || !stopRaw) continue;
    const stop = parentOfStop.get(stopRaw) ?? stopRaw;
    const t = trips.get(tripId) ?? {};
    if (stop === A) t.a = r; else if (stop === B) t.b = r;
    trips.set(tripId, t);
  }

  const boardMs = boardAfter.getTime();
  const cands: (RideTiming & { aMs: number })[] = [];
  for (const [tripId, { a, b }] of trips) {
    const patternId = patternOfTrip.get(tripId);
    if (!a || !b || !patternId || !allowed.has(patternId)) continue;
    const aSeq = num(a.attributes.stop_sequence), bSeq = num(b.attributes.stop_sequence);
    if (aSeq === null || bSeq === null || aSeq >= bSeq) continue; // wrong order = not travelling A→B
    if (a.attributes.pickup_type === 1 || b.attributes.drop_off_type === 1) continue;
    const aMs = ms(a.attributes.departure_time) ?? ms(a.attributes.arrival_time);
    const bMs = ms(b.attributes.arrival_time) ?? ms(b.attributes.departure_time);
    if (aMs === null || bMs === null || aMs < boardMs || bMs <= aMs) continue;
    cands.push({
      aMs, kind: "scheduled", method, routeId, directionId, tripId, patternId,
      departsAt: new Date(aMs).toISOString(), arrivesAt: new Date(bMs).toISOString(),
      rideSeconds: Math.round((bMs - aMs) / 1000), runningPatternIds: [], idlePatternIds: [],
    });
  }
  cands.sort((x, y) => x.aMs - y.aMs);

  const inWindow = cands.filter((c) => c.aMs <= boardMs + SERVICE_WINDOW_MIN * 60_000);
  const runningPatternIds = [...new Set(inWindow.map((c) => c.patternId))].sort();
  const idlePatternIds = [...allowed].filter((id) => !runningPatternIds.includes(id)).sort();
  const first = cands[0];
  const next = first ? (({ aMs: _drop, ...t }) => ({ ...t, runningPatternIds, idlePatternIds }))(first) : null;
  return {
    running: inWindow.length > 0,
    next,
    runningPatternIds, idlePatternIds,
  };
}

/**
 * Minimum slack between leg A's scheduled arrival at the hub and leg B's departure: 2 minutes, so
 * a rider can actually walk between platforms (a 0 s connection is not makeable). A fixed
 * assumption, not measured per station; in-station walking time is still not modeled.
 */
export const TRANSFER_BUFFER_SEC = 120;

/**
 * Last scheduled train from the destination stop back toward where the rider came from, on the
 * reverse of `leg` (same line, opposite direction). Schedule-derived. Best effort: a failure here
 * never blocks a route, it just leaves the label absent with a note.
 */
export async function lastTrainBack(leg: LegSelection, arrivesAt: string, opts: LiveOptions = {}): Promise<LastTrainBack | { unavailable: string }> {
  const rev = selectRideablePattern(leg.to, leg.from, leg.pattern.route_id.startsWith("Green-") ? "Green" : leg.pattern.route_id);
  if ("reason" in rev) return { unavailable: `no reverse pattern back to ${leg.from.name} (${rev.reason})` };
  const allowed = new Set<string>(rev.equivalentPatterns.map((p) => p.route_pattern_id));
  const { date, minutes } = bostonParts(opts.now ?? new Date());
  const serviceDate = minutes < 4 * 60 ? prevDate(date) : date; // after-midnight trains belong to the previous service day
  const doc = await mbtaGet("/schedules", {
    "filter[stop]": `${leg.to.stop_id},${leg.from.stop_id}`, "filter[route]": rev.pattern.route_id,
    "filter[direction_id]": String(rev.pattern.direction_id), "filter[date]": serviceDate, "filter[min_time]": "20:00",
    include: "trip,stop", "page[limit]": "500",
    "fields[schedule]": "arrival_time,departure_time,stop_sequence",
  }, opts, 600_000);
  const patternOfTrip = new Map<string, string>();
  const parentOf = new Map<string, string>();
  for (const inc of doc.included ?? []) {
    if (inc.type === "trip") { const rp = inc.relationships?.route_pattern?.data?.id; if (rp) patternOfTrip.set(inc.id, rp); }
    if (inc.type === "stop") parentOf.set(inc.id, inc.relationships?.parent_station?.data?.id ?? inc.id);
  }
  const trips = new Map<string, { a?: JsonApiResource; b?: JsonApiResource }>();
  for (const r of doc.data) {
    const tripId = r.relationships?.trip?.data?.id, stopRaw = r.relationships?.stop?.data?.id;
    if (!tripId || !stopRaw) continue;
    const stop = parentOf.get(stopRaw) ?? stopRaw, t = trips.get(tripId) ?? {};
    if (stop === leg.to.stop_id) t.a = r; else if (stop === leg.from.stop_id) t.b = r;
    trips.set(tripId, t);
  }
  let best: { ms: number; tripId: string; patternId: string } | null = null;
  for (const [tripId, { a, b }] of trips) {
    const patternId = patternOfTrip.get(tripId);
    if (!a || !b || !patternId || !allowed.has(patternId)) continue;
    if ((num(a.attributes.stop_sequence) ?? 1e9) >= (num(b.attributes.stop_sequence) ?? -1)) continue;
    const t = ms(a.attributes.departure_time);
    if (t !== null && (!best || t > best.ms)) best = { ms: t, tripId, patternId };
  }
  if (!best) return { unavailable: "no scheduled return trips found after 20:00" };
  return {
    kind: "scheduled", routeId: rev.pattern.route_id, directionId: rev.pattern.direction_id, patternId: best.patternId, tripId: best.tripId,
    fromStopName: leg.to.name, toStopName: leg.from.name, departsAt: new Date(best.ms).toISOString(),
    catchable: best.ms >= Date.parse(arrivesAt),
  };
}

async function lastTrainLabel(leg: LegSelection, arrivesAt: string, opts: LiveOptions): Promise<{ lastTrainBack: LastTrainBack | null; lastTrainBackNote?: string }> {
  try {
    const r = await lastTrainBack(leg, arrivesAt, opts);
    return "unavailable" in r ? { lastTrainBack: null, lastTrainBackNote: r.unavailable } : { lastTrainBack: r };
  } catch (e) {
    return { lastTrainBack: null, lastTrainBackNote: `unavailable: ${(e as Error).message}` };
  }
}

interface LiveOkBase { lastTrainBack: LastTrainBack | null; lastTrainBackNote?: string }
export type LivePlanResult =
  | ({ status: "ok"; tier: 1; option: TransitOption; plan: Tier1Plan; timing: RideTiming; service: ServiceCheck } & LiveOkBase)
  | ({
      status: "ok"; tier: 2; option: TransitOption; plan: Tier2Plan; timings: [RideTiming, RideTiming]; services: [ServiceCheck, ServiceCheck];
      /** Scheduled wait at the boarding platform: leg B departure minus (leg A arrival + transfer walk). */
      transferWaitSeconds: number;
    } & LiveOkBase)
  | NoTier1Route
  | NoServiceResult
  | LiveErrorResult;

/**
 * Journey planning with real timing and the service gate.
 *   Tier 1 (same pattern) first; only if the stops share no pattern at all, Tier 2 (one transfer).
 * A route is returned for drawing only if EVERY leg passes the gate: /schedules shows a train
 * serving that leg's stops (on a matching pattern) within SERVICE_WINDOW_MIN of when the rider
 * could board it. Otherwise: no_tier1_route (no validated geometry; Tier 0 fallback), no_service
 * (Tier 0 late-night signal, with which leg failed) or error (cannot verify; nothing drawn).
 */
export async function planTripLive(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  opts: LiveOptions = {},
): Promise<LivePlanResult> {
  const t1 = planTier1(origin, destination);
  if (!("status" in t1)) return liveTier1(t1, opts);
  if (t1.reason !== "no_shared_pattern") return t1; // same stop / wrong direction: a transfer would not help
  const t2 = tier2Candidates(origin, destination);
  if (!Array.isArray(t2)) return t2;
  // Greedy order, no ranking. A hub that validates by pattern but whose trains are not running
  // (no_service) is skipped for the next pattern-valid hub (P-012); an error stops (cannot verify).
  // If none runs, report the FIRST hub's failure, as before.
  let first: LivePlanResult | undefined;
  for (const plan of t2) {
    const r = await liveTier2(plan, opts);
    if (r.status !== "no_service") return r;
    first ??= r;
  }
  return first as LivePlanResult;
}

const fill = (l: TransitLegDraft, rideSeconds: number, t: RideTiming): TransitLeg =>
  ({ ...l, durationSec: rideSeconds, source: `${l.source}; duration: schedule-derived (MBTA /schedules trip ${t.tripId}, departs ${t.departsAt})` });
const walkKnown = (l: TransitLegDraft): TransitLeg => ({ ...l, durationSec: l.durationSec as number }); // straight-line estimate

async function liveTier1(plan: Tier1Plan, opts: LiveOptions): Promise<LivePlanResult> {
  const now = opts.now ?? new Date();
  const walkIn = plan.option.legs[0].durationSec ?? 0;
  const boardAfter = new Date(now.getTime() + walkIn * 1000);
  const base = { originStop: plan.originStop, destinationStop: plan.destinationStop, checkedAt: now.toISOString() };
  let service: ServiceCheck;
  try {
    service = await checkService(plan.leg, boardAfter, opts);
  } catch (e) {
    return { status: "error", message: `Could not verify service from MBTA /schedules (${(e as Error).message}); route not drawn.`, ...base };
  }
  if (!service.running || !service.next) {
    return {
      status: "no_service",
      message: noServiceMessage(plan.pattern.route_id, plan.leg, now, plan.originStop),
      nextScheduledDepartureAt: service.next?.departsAt,
      ...base,
    };
  }
  const timing = service.next;
  const legs = plan.option.legs.map((l) => (l.mode === "subway" ? fill(l, timing.rideSeconds, timing) : walkKnown(l)));
  const option: TransitOption = {
    id: plan.option.id, transfers: plan.option.transfers, legs,
    // Walk + scheduled ride + walk. Excludes the wait for the train (see timing.departsAt).
    durationSec: legs.reduce((s, l) => s + l.durationSec, 0),
  };
  return { status: "ok", tier: 1, option, plan, timing, service, ...(await lastTrainLabel(plan.leg, timing.arrivesAt, opts)) };
}

const noServiceMessage = (route: string, leg: LegSelection, now: Date, nearest: { stop: { name: string }; walkSeconds: number }) =>
  `No train service on ${route} from ${leg.from.name} to ${leg.to.name} at ${fmtBoston(now)} ` +
  `(checked MBTA /schedules); night bus or walk. Nearest stop: ${nearest.stop.name}, ~${Math.round(nearest.walkSeconds / 60)} min walk (estimate).`;

async function liveTier2(plan: Tier2Plan, opts: LiveOptions): Promise<LivePlanResult> {
  const now = opts.now ?? new Date();
  const base = { originStop: plan.originStop, destinationStop: plan.destinationStop, checkedAt: now.toISOString() };
  const walkIn = plan.option.legs[0].durationSec ?? 0;
  const err = (e: unknown, leg: string): LiveErrorResult =>
    ({ status: "error", message: `Could not verify service for ${leg} from MBTA /schedules (${(e as Error).message}); route not drawn.`, ...base });

  // Leg A: gate independently, at the time the rider can board.
  let sA: ServiceCheck;
  try { sA = await checkService(plan.legA, new Date(now.getTime() + walkIn * 1000), opts); } catch (e) { return err(e, "leg A"); }
  if (!sA.running || !sA.next) {
    return { status: "no_service", failedLeg: "A", message: `Transfer route needs leg A, which is not running. ${noServiceMessage(plan.legA.pattern.route_id, plan.legA, now, plan.originStop)}`, nextScheduledDepartureAt: sA.next?.departsAt, ...base };
  }
  const tA = sA.next;

  // Leg B: gate independently, at the time the rider actually reaches the boarding platform
  // (request-time check: B must depart after A arrives + transfer walk + buffer; never precomputed).
  // The walk (P-012, 0 for in-station) is a straight-line estimate.
  const boardB = new Date(Date.parse(tA.arrivesAt) + (plan.transferWalkSec + TRANSFER_BUFFER_SEC) * 1000);
  let sB: ServiceCheck;
  try { sB = await checkService(plan.legB, boardB, opts); } catch (e) { return err(e, "leg B"); }
  if (!sB.running || !sB.next) {
    return {
      status: "no_service", failedLeg: "B",
      message: `Leg A (${plan.legA.pattern.route_id}) is running, but leg B (${plan.legB.pattern.route_id} from ${plan.entry.name} to ${plan.legB.to.name}) has no train serving those stops ` +
        `around ${fmtBoston(boardB)} (checked MBTA /schedules), so the transfer route is not drawn; night bus or walk. ` +
        `Nearest stop: ${plan.originStop.stop.name}, ~${Math.round(plan.originStop.walkSeconds / 60)} min walk (estimate).`,
      nextScheduledDepartureAt: sB.next?.departsAt, ...base,
    };
  }
  const tB = sB.next;
  // Scheduled wait on the platform: B departs minus when you get there (A arrives + transfer walk).
  const transferWaitSeconds = Math.round((Date.parse(tB.departsAt) - Date.parse(tA.arrivesAt)) / 1000) - plan.transferWalkSec;

  // legs: walk, rideA, [transfer walk], rideB, walk
  const draft = plan.option.legs;
  const legs: TransitLeg[] = draft.map((l, i) =>
    l.mode !== "subway" ? walkKnown(l) : fill(l, i === 1 ? tA.rideSeconds : tB.rideSeconds, i === 1 ? tA : tB));
  const option: TransitOption = {
    id: plan.option.id, transfers: 1, legs,
    // Walk + ride A + [transfer walk] + scheduled wait + ride B + walk. Excludes the initial wait for train A.
    durationSec: legs.reduce((s, l) => s + l.durationSec, 0) + transferWaitSeconds,
  };
  return {
    status: "ok", tier: 2, option, plan, timings: [tA, tB], services: [sA, sB], transferWaitSeconds,
    // Last train back for the FINAL leg only: destination → hub on leg B's line. It does not verify the connection home.
    ...(await lastTrainLabel(plan.legB, tB.arrivesAt, opts)),
  };
}
