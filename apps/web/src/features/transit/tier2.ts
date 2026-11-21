// Tier 2: greedy single transfer (D-007, PROJECT_BRIEF §9). One transfer maximum, first valid hub wins,
// no ranking of alternatives. P-012 (Proposed): a transfer may be a short capped surface walk between
// two stations, and the live layer falls through to the next pattern-valid hub only when the
// previous one fails the service gate. Pattern-level validation on BOTH legs via the same functions
// Tier 1 uses (selectRideablePattern → sharedPatterns + direction + D-008 equivalence).

import {
  buildRideLeg, getStop, legId, lineOf, nearestStop, patternsServing, selectRideablePattern, walkLegBetween,
  type LegSelection,
} from "./engine.ts";
import { candidateTransfers } from "./hubs.ts";
import type { GeoPoint, NearestStop, NoTier1Route, Stop, TransitLegDraft, TransitOptionDraft } from "./types.ts";

const LINE_ORDER = ["Red", "Orange", "Green", "Blue"];

/** Rider-facing lines with at least one pattern through the stop, in fixed order (deterministic greedy walk). */
export function linesServing(stop: Stop): string[] {
  const lines = new Set(patternsServing(stop).map((p) => lineOf(p.route_id)));
  return LINE_ORDER.filter((l) => lines.has(l));
}

export type HubValidation =
  | { ok: true; legA: LegSelection; legB: LegSelection }
  | { ok: false; failedLeg: "A" | "B"; reason: "no_shared_pattern" | "no_pattern_in_travel_direction" };

/**
 * Both legs must be rideable on their own route patterns:
 *  - leg A: origin → hub on a shared pattern of line `lineA`, hub after origin in travel direction;
 *  - leg B: hub → destination on a shared pattern of line `lineB` that actually reaches the
 *    destination's branch, destination after hub in travel direction.
 * "The hub is served by some Green route" is NOT enough: leg B is checked against patterns that
 * contain BOTH the hub and the destination stop.
 */
export function validateHub(origin: Stop, hub: Stop, destination: Stop, lineA: string, lineB: string): HubValidation {
  const legA = selectRideablePattern(origin, hub, lineA);
  if ("reason" in legA) return { ok: false, failedLeg: "A", reason: legA.reason };
  const legB = selectRideablePattern(hub, destination, lineB);
  if ("reason" in legB) return { ok: false, failedLeg: "B", reason: legB.reason };
  return { ok: true, legA, legB };
}

export interface Tier2Plan {
  option: TransitOptionDraft; // transfers: 1; legs walk → subway → [walk] → subway → walk (middle walk only for P-012 walk transfers)
  /** Station where leg A ends (the hub, for in-station transfers). */
  hub: Stop;
  /** Station where leg B starts. Same as `hub` for in-station transfers. */
  entry: Stop;
  /** Straight-line transfer walk in meters; 0 for in-station transfers. */
  transferWalkMeters: number;
  /** Transfer walk duration (estimate), seconds; 0 for in-station transfers. */
  transferWalkSec: number;
  legA: LegSelection;
  legB: LegSelection;
  originStop: NearestStop;
  destinationStop: NearestStop;
  /** Hubs tried (in order) before the winner, with why each failed. Audit trail only; not a search. */
  rejected: { hub: string; lines: [string, string]; failedLeg: "A" | "B"; reason: string }[];
}

/**
 * Every pattern-valid transfer, in trial order (greedy order, not ranked). The first is what
 * `planTier2` returns; the live layer walks the list only to skip a hub whose trains are not
 * running (e.g. Haymarket on Green-B, which exists only on an early-morning pattern).
 */
export function tier2Candidates(origin: GeoPoint, destination: GeoPoint): Tier2Plan[] | NoTier1Route {
  const o = nearestStop(origin);
  const d = nearestStop(destination);
  const none = (reason: NoTier1Route["reason"]): NoTier1Route =>
    ({ status: "no_tier1_route", reason, originStop: o.stop, destinationStop: d.stop });
  if (o.stop.stop_id === d.stop.stop_id) return none("same_stop");

  const rejected: Tier2Plan["rejected"] = [];
  const plans: Tier2Plan[] = [];
  let sawCandidate = false;
  for (const lineA of linesServing(o.stop)) {
    for (const lineB of linesServing(d.stop)) {
      if (lineA === lineB) continue; // same-line/different-branch transfers are not in the hub table
      for (const t of candidateTransfers(lineA, lineB)) {
        const exit = getStop(t.exit.stop_id), entry = getStop(t.entry.stop_id);
        if (!exit || !entry || exit.stop_id === o.stop.stop_id || entry.stop_id === d.stop.stop_id) continue;
        sawCandidate = true;
        // Leg A: origin → exit on lineA. Leg B: entry → destination on lineB. (exit === entry in-station.)
        const legA = selectRideablePattern(o.stop, exit, lineA);
        if ("reason" in legA) { rejected.push({ hub: exit.name, lines: [lineA, lineB], failedLeg: "A", reason: legA.reason }); continue; }
        const legB = selectRideablePattern(entry, d.stop, lineB);
        if ("reason" in legB) { rejected.push({ hub: entry.name, lines: [lineA, lineB], failedLeg: "B", reason: legB.reason }); continue; }
        const transferWalk = exit.stop_id === entry.stop_id ? null
          : { ...walkLegBetween(exit, entry, `Walk from ${exit.name} to ${entry.name}`), fromStopName: exit.name, toStopName: entry.name };
        const legs: TransitLegDraft[] = [
          walkLegBetween(origin, o.stop, `Walk to ${o.stop.name}`),
          buildRideLeg(legA),
          ...(transferWalk ? [transferWalk] : []),
          buildRideLeg(legB),
          walkLegBetween(d.stop, destination, `Walk from ${d.stop.name}`),
        ];
        const walkTag = transferWalk ? `~${entry.stop_id}` : "";
        plans.push({
          option: { id: `tier2:${exit.stop_id}${walkTag}:${legId(legA)}+${legId(legB)}:${o.stop.stop_id}>${d.stop.stop_id}`, durationSec: null, transfers: 1, legs },
          hub: exit, entry, transferWalkMeters: transferWalk?.distanceMeters ?? 0, transferWalkSec: transferWalk?.durationSec ?? 0,
          legA, legB, originStop: o, destinationStop: d, rejected: [...rejected],
        });
      }
    }
  }
  return plans.length ? plans : none(sawCandidate ? "no_valid_hub" : "no_candidate_hub");
}

/** First pattern-valid transfer (greedy, no ranking). */
export function planTier2(origin: GeoPoint, destination: GeoPoint): Tier2Plan | NoTier1Route {
  const r = tier2Candidates(origin, destination);
  return Array.isArray(r) ? r[0] : r;
}
