// Tier 2: greedy single transfer (D-007, PROJECT_BRIEF §9). One hub maximum, first valid hub wins,
// no comparison of alternatives. Pattern-level validation on BOTH legs via the same functions
// Tier 1 uses (selectRideablePattern → sharedPatterns + direction + D-008 equivalence).

import {
  buildRideLeg, getStop, legId, lineOf, nearestStop, patternsServing, selectRideablePattern, walkLegBetween,
  type LegSelection,
} from "./engine.ts";
import { candidateHubs } from "./hubs.ts";
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
  option: TransitOptionDraft; // transfers: 1; legs walk → subway → subway → walk
  hub: Stop;
  legA: LegSelection;
  legB: LegSelection;
  originStop: NearestStop;
  destinationStop: NearestStop;
  /** Hubs tried (in order) before the winner, with why each failed. Audit trail only; not a search. */
  rejected: { hub: string; lines: [string, string]; failedLeg: "A" | "B"; reason: string }[];
}

export function planTier2(origin: GeoPoint, destination: GeoPoint): Tier2Plan | NoTier1Route {
  const o = nearestStop(origin);
  const d = nearestStop(destination);
  const none = (reason: NoTier1Route["reason"]): NoTier1Route =>
    ({ status: "no_tier1_route", reason, originStop: o.stop, destinationStop: d.stop });
  if (o.stop.stop_id === d.stop.stop_id) return none("same_stop");

  const rejected: Tier2Plan["rejected"] = [];
  let sawCandidate = false;
  for (const lineA of linesServing(o.stop)) {
    for (const lineB of linesServing(d.stop)) {
      if (lineA === lineB) continue; // same-line/different-branch transfers are not in the hub table
      for (const hubId of candidateHubs(lineA, lineB)) {
        const hub = getStop(hubId);
        if (!hub || hub.stop_id === o.stop.stop_id || hub.stop_id === d.stop.stop_id) continue;
        sawCandidate = true;
        const v = validateHub(o.stop, hub, d.stop, lineA, lineB);
        if (!v.ok) { rejected.push({ hub: hub.name, lines: [lineA, lineB], failedLeg: v.failedLeg, reason: v.reason }); continue; }
        // Greedy: first hub that validates both legs wins. No comparison with other hubs.
        const legs: TransitLegDraft[] = [
          walkLegBetween(origin, o.stop, `Walk to ${o.stop.name}`),
          buildRideLeg(v.legA),
          buildRideLeg(v.legB),
          walkLegBetween(d.stop, destination, `Walk from ${d.stop.name}`),
        ];
        return {
          option: { id: `tier2:${hub.stop_id}:${legId(v.legA)}+${legId(v.legB)}:${o.stop.stop_id}>${d.stop.stop_id}`, durationSec: null, transfers: 1, legs },
          hub, legA: v.legA, legB: v.legB, originStop: o, destinationStop: d, rejected,
        };
      }
    }
  }
  return none(sawCandidate ? "no_valid_hub" : "no_candidate_hub");
}
