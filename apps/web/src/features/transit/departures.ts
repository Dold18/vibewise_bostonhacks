// Tier 0 live departures: /predictions first, /schedules fallback, never a fabricated time.

import { SUBWAY_ROUTE_IDS } from "./engine.ts";
import { mbtaGet, scheduleWindows, type JsonApiResource, type LiveOptions } from "./mbta.ts";
import type { Departure, DeparturesResult, Stop } from "./types.ts";

const str = (v: unknown) => (typeof v === "string" ? v : null);
const ROUTES = SUBWAY_ROUTE_IDS.join(",");

function destinationOf(route: JsonApiResource | undefined, dir: number): string | undefined {
  const dd = route?.attributes.direction_destinations;
  return Array.isArray(dd) && typeof dd[dir] === "string" ? dd[dir] : undefined;
}

/** Next departures at a stop with their provenance. See `departures` for the plain-array form. */
export async function departuresWithStatus(
  stop: Stop | string,
  opts: LiveOptions & { limit?: number } = {},
): Promise<DeparturesResult> {
  const stopId = typeof stop === "string" ? stop : stop.stop_id;
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 5;
  const nowMs = now.getTime();
  const errors: string[] = [];

  // Live predictions only describe "right now"; for any other requested time, use the schedule.
  const isLiveMoment = Math.abs(nowMs - Date.now()) < 2 * 60_000;
  if (isLiveMoment) {
    try {
      const doc = await mbtaGet("/predictions", {
        "filter[stop]": stopId, "filter[route]": ROUTES, include: "route", sort: "departure_time", "page[limit]": "50",
      }, opts, 15_000);
      const routes = new Map((doc.included ?? []).filter((r) => r.type === "route").map((r) => [r.id, r]));
      const live: Departure[] = [];
      for (const p of doc.data) {
        const t = str(p.attributes.departure_time); // null at a terminal arrival: not a departure
        const rel = str(p.attributes.schedule_relationship);
        if (!t || Date.parse(t) < nowMs || rel === "CANCELLED" || rel === "SKIPPED") continue;
        const routeId = p.relationships?.route?.data?.id;
        if (!routeId) continue;
        const dir = Number(p.attributes.direction_id);
        live.push({ stop_id: stopId, route_id: routeId, direction_id: dir, destination: destinationOf(routes.get(routeId), dir), time: t, kind: "live_predicted", source: "MBTA V3 /predictions" });
      }
      live.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      if (live.length) return { status: "ok", kind: "live_predicted", departures: live.slice(0, limit) };
    } catch (e) {
      errors.push(`predictions: ${(e as Error).message}`);
    }
  }

  // Fallback: scheduled departures in the next 2 hours, labeled as scheduled (not live).
  try {
    const sched: Departure[] = [];
    for (const w of scheduleWindows(now, 120)) {
      const doc = await mbtaGet("/schedules", {
        "filter[stop]": stopId, "filter[route]": ROUTES, "filter[date]": w.date, "filter[min_time]": w.min, "filter[max_time]": w.max,
        include: "route", sort: "departure_time", "page[limit]": "50",
      }, opts, 300_000);
      const routes = new Map((doc.included ?? []).filter((r) => r.type === "route").map((r) => [r.id, r]));
      for (const s of doc.data) {
        const t = str(s.attributes.departure_time); // null at the last stop of a trip
        const routeId = s.relationships?.route?.data?.id;
        if (!t || !routeId || Date.parse(t) < nowMs) continue;
        const dir = Number(s.attributes.direction_id);
        sched.push({ stop_id: stopId, route_id: routeId, direction_id: dir, destination: destinationOf(routes.get(routeId), dir), time: t, kind: "scheduled", source: "MBTA V3 /schedules" });
      }
    }
    sched.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (sched.length) return { status: "ok", kind: "scheduled", departures: sched.slice(0, limit) };
  } catch (e) {
    errors.push(`schedules: ${(e as Error).message}`);
  }

  return errors.length
    ? { status: "error", kind: null, departures: [], message: errors.join("; ") }
    : { status: "empty", kind: null, departures: [], message: "no predictions or scheduled departures in the next 2 hours" };
}

/** Next few departures, live-predicted if available else scheduled; [] if neither (never guessed). */
export async function departures(stop: Stop | string, opts: LiveOptions & { limit?: number } = {}): Promise<Departure[]> {
  return (await departuresWithStatus(stop, opts)).departures;
}
