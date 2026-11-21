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
// Audited alternative (2026-11-21), NOT added: Park Street and Government Center carry Green-B/C
// canonical patterns (Green-B-812, Green-C-832), but neither station serves Orange (Park St =
// Red+Green, Government Center = Green+Blue), and a hub must be one station served by both lines.
// Orange↔Green via those needs a walk between two stations (Downtown Crossing↔Park St, State↔
// Government Center), which Tier 2 does not model. Orange↔Green-B/C therefore stays on
// Haymarket/North Station, i.e. effectively Tier 0 outside early mornings.

export interface HubEntry {
  lines: readonly [string, string];
  hubs: readonly { stop_id: string; name: string }[]; // name is for auditing only; stop_id is authoritative
}

export const HUB_TABLE: readonly HubEntry[] = [
  { lines: ["Red", "Orange"], hubs: [{ stop_id: "place-dwnxg", name: "Downtown Crossing" }] },
  { lines: ["Red", "Green"], hubs: [{ stop_id: "place-pktrm", name: "Park Street" }] },
  { lines: ["Orange", "Green"], hubs: [{ stop_id: "place-haecl", name: "Haymarket" }, { stop_id: "place-north", name: "North Station" }] },
  { lines: ["Orange", "Blue"], hubs: [{ stop_id: "place-state", name: "State" }] },
  { lines: ["Green", "Blue"], hubs: [{ stop_id: "place-gover", name: "Government Center" }] },
  { lines: ["Red", "Blue"], hubs: [] }, // no single-transfer hub: two hops, out of scope, falls to Tier 0
];

/** Candidate hub stop ids for an unordered line pair, in trial order. [] if none (or pair unknown). */
export function candidateHubs(lineA: string, lineB: string): string[] {
  const e = HUB_TABLE.find((x) => (x.lines[0] === lineA && x.lines[1] === lineB) || (x.lines[0] === lineB && x.lines[1] === lineA));
  return e ? e.hubs.map((h) => h.stop_id) : [];
}
