import { getStop, haversineMeters } from "./engine.ts";

// Tier 2 candidate transfer hubs. DATA ONLY: no validation lives here (see tier2.ts), so this file
// can be audited or corrected on its own. Source: PROJECT_BRIEF §9 ("candidate list, not a guarantee").
//
// Keys are rider-facing lines (Red, Orange, Green, Blue; Green = B/C/D/E together). Hubs are GTFS
// parent-station ids, tried in the order listed. A hub's presence here means NOTHING about whether
// a given trip can use it: every leg is validated per route pattern at request time.
//
// Verified against the 2026-11 GTFS feed (see test-tier2.ts audit): every hub below is served by
// BOTH of its lines. Caveat found in the data: Haymarket and North Station are served by Green-D
// and Green-E canonical patterns, but by Green-B/Green-C ONLY through the time-limited
// Medford/Tufts patterns (Green-B-816, Green-C-836), so Orange↔Green-B/C via these hubs is only
// ever as available as those patterns.
//
// Park Street and Government Center carry Green-B/C canonical patterns (Green-B-812, Green-C-832),
// but neither serves Orange. P-012 (Proposed) adds exactly ONE walk transfer for that gap:
// Orange@Haymarket ↔ Green@Government Center. Downtown Crossing↔Park St and State↔Government
// Center are deliberately NOT added (out of P-012's scope). Walk hubs are tried after in-station
// hubs and only when walk <= MAX_TRANSFER_WALK_METERS.

export interface HubEntry {
  lines: readonly [string, string];
  hubs: readonly { stop_id: string; name: string }[]; // name is for auditing only; stop_id is authoritative
  /**
   * P-012 (Proposed): short surface walks between two DIFFERENT stations, tried only after every
   * in-station hub. `at` maps each line of the pair to the station that line's rider uses; the walk
   * is directional (exit = station of the line you leave, entry = station of the line you board).
   */
  walks?: readonly { at: Readonly<Record<string, { stop_id: string; name: string }>> }[];
}

/** Longest straight-line transfer walk Tier 2 will offer (P-012). Entries over this are skipped. */
export const MAX_TRANSFER_WALK_METERS = 400;

export const HUB_TABLE: readonly HubEntry[] = [
  { lines: ["Red", "Orange"], hubs: [{ stop_id: "place-dwnxg", name: "Downtown Crossing" }] },
  { lines: ["Red", "Green"], hubs: [{ stop_id: "place-pktrm", name: "Park Street" }] },
  {
    lines: ["Orange", "Green"],
    hubs: [{ stop_id: "place-haecl", name: "Haymarket" }, { stop_id: "place-north", name: "North Station" }],
    // P-012: the ONLY walk transfer (~376 m straight-line). Orange rider uses Haymarket, Green rider Government Center.
    walks: [{ at: { Orange: { stop_id: "place-haecl", name: "Haymarket" }, Green: { stop_id: "place-gover", name: "Government Center" } } }],
  },
  { lines: ["Orange", "Blue"], hubs: [{ stop_id: "place-state", name: "State" }] },
  { lines: ["Green", "Blue"], hubs: [{ stop_id: "place-gover", name: "Government Center" }] },
  { lines: ["Red", "Blue"], hubs: [] }, // no single-transfer hub: two hops, out of scope, falls to Tier 0
];

/** Candidate hub stop ids for an unordered line pair, in trial order. [] if none (or pair unknown). */
export function candidateHubs(lineA: string, lineB: string): string[] {
  const e = HUB_TABLE.find((x) => (x.lines[0] === lineA && x.lines[1] === lineB) || (x.lines[0] === lineB && x.lines[1] === lineA));
  return e ? e.hubs.map((h) => h.stop_id) : [];
}

/** One way to change from line A to line B: leave at `exit`, board at `entry`. exit === entry for in-station hubs. */
export interface TransferPoint { exit: { stop_id: string; name: string }; entry: { stop_id: string; name: string }; walkMeters: number }

/**
 * Transfer points for a line pair as an ordered rider (A first, then B): in-station hubs first,
 * then walk transfers within the cap. Walk distance is computed from stops.json, never hand-typed.
 */
export function candidateTransfers(lineA: string, lineB: string): TransferPoint[] {
  const e = HUB_TABLE.find((x) => (x.lines[0] === lineA && x.lines[1] === lineB) || (x.lines[0] === lineB && x.lines[1] === lineA));
  if (!e) return [];
  const out: TransferPoint[] = e.hubs.map((h) => ({ exit: h, entry: h, walkMeters: 0 }));
  for (const w of e.walks ?? []) {
    const exit = w.at[lineA], entry = w.at[lineB];
    const a = exit && getStop(exit.stop_id), b = entry && getStop(entry.stop_id);
    if (!a || !b || a.stop_id === b.stop_id) continue;
    const walkMeters = Math.round(haversineMeters(a, b));
    if (walkMeters <= MAX_TRANSFER_WALK_METERS) out.push({ exit, entry, walkMeters });
  }
  return out;
}
