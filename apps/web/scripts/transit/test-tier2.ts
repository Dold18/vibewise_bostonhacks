// Tier 2 acceptance test. Part 1-3 are offline (committed data); part 4 calls the live MBTA API.
//   node apps/web/scripts/transit/test-tier2.ts
import assert from "node:assert/strict";
import { getStop, lineOf, nearestStop, patternsServing } from "../../src/features/transit/engine.ts";
import { HUB_TABLE } from "../../src/features/transit/hubs.ts";
import { fmtBoston } from "../../src/features/transit/mbta.ts";
import { planTripLive, TRANSFER_BUFFER_SEC, type LivePlanResult } from "../../src/features/transit/ride.ts";
import { planTier2, validateHub } from "../../src/features/transit/tier2.ts";
import stopsJson from "../../src/features/transit/data/stops.json" with { type: "json" };

try { process.loadEnvFile(new URL("../../../../.env", import.meta.url)); } catch { /* keyless */ }
const pt = (lat: number, lng: number) => ({ lat, lng });

// ---------- 1. Hub table as encoded + audit against the GTFS-derived data ----------
console.log("#### 1. hub table (as encoded) and audit");
for (const e of HUB_TABLE) {
  console.log(`  ${e.lines[0]}↔${e.lines[1]}: ${e.hubs.length ? e.hubs.map((h) => `${h.name} (${h.stop_id})`).join(", ") : "NO CANDIDATE → Tier 0"}`);
  for (const h of e.hubs) {
    const stop = getStop(h.stop_id);
    assert.ok(stop, `${h.stop_id} missing from stops.json`);
    assert.equal(stop.name, h.name, `name mismatch for ${h.stop_id}`);
    for (const line of e.lines) {
      const ps = patternsServing(stop).filter((p) => lineOf(p.route_id) === line);
      assert.ok(ps.length > 0, `${h.name} is not served by ${line}`);
      const byRoute = new Map<string, string[]>();
      for (const p of ps) byRoute.set(p.route_id, [...(byRoute.get(p.route_id) ?? []), `${p.route_pattern_id}${p.typicality === 1 ? "" : "*"}`]);
      const routes = [...byRoute.entries()].map(([r, ids]) => `${r}:${ids.filter((_, i) => i < 2).join("/")}${ids.length > 2 ? "…" : ""}`).join(" ");
      const canonicalRoutes = new Set(ps.filter((p) => p.typicality === 1).map((p) => p.route_id));
      const onlyVariant = [...byRoute.keys()].filter((r) => !canonicalRoutes.has(r));
      console.log(`      ${h.name} serves ${line}: ${routes}${onlyVariant.length ? `   ⚠ ${onlyVariant.join(",")} only via time-limited (*) patterns` : ""}`);
    }
  }
}

// ---------- 2. Validation is by pattern, not by color (offline) ----------
console.log("\n#### 2. pattern-level validation proofs (hub is on the right COLOR but wrong BRANCH)");
const byName = (n: string) => (stopsJson as { stop_id: string; name: string }[]).find((s) => s.name === n)!;
const S = (n: string) => getStop(byName(n).stop_id)!;
// Green: Cleveland Circle (C) → Coolidge Corner (C only) → Boston College (B). Every stop is "Green".
const g = validateHub(S("Cleveland Circle"), S("Coolidge Corner"), S("Boston College"), "Green", "Green");
console.log(`  Green C → Coolidge Corner → Green B (Boston College): ${JSON.stringify(g)}`);
assert.deepEqual(g, { ok: false, failedLeg: "B", reason: "no_shared_pattern" });
// Red: Alewife → Shawmut (Ashmont branch only) → Quincy Center (Braintree branch only).
const r = validateHub(S("Alewife"), S("Shawmut"), S("Quincy Center"), "Red", "Red");
console.log(`  Red Alewife → Shawmut (Ashmont) → Quincy Center (Braintree): ${JSON.stringify(r)}`);
assert.deepEqual(r, { ok: false, failedLeg: "B", reason: "no_shared_pattern" });
// Same pair through a hub both branches share is fine, so the failure above is the branch, not the line.
const r2 = validateHub(S("Alewife"), S("JFK/UMass"), S("Quincy Center"), "Red", "Red");
assert.equal(r2.ok, true);
// Wrong direction on every pattern of the line also fails (hub before origin on the only pattern running that way).
console.log("  control: Alewife → JFK/UMass → Quincy Center validates (both Red branches share the trunk): ok");

// ---------- 3. Geometry-level planning (offline), nearest stops from raw coordinates ----------
console.log("\n#### 3. planTier2 geometry");
const HARVARD = pt(42.3736, -71.1190), RUGGLES = pt(42.3366, -71.0894), FENWAY = pt(42.3453, -71.1043);
const NEU = pt(42.34011, -71.08892), OAKGROVE = pt(42.4367, -71.0711), AIRPORT = pt(42.3742, -71.0304);
const PRUDENTIAL = pt(42.34557, -71.08246), WOODISLAND = pt(42.3796, -71.0229);
const BU = pt(42.3505, -71.1054), CLEVE = pt(42.3365, -71.1491), CHINATOWN = pt(42.3523, -71.0627);
const geo: [string, ReturnType<typeof pt>, ReturnType<typeof pt>, string][] = [
  ["Harvard (Red) → Ruggles (Orange)", HARVARD, RUGGLES, "Downtown Crossing"],
  ["Harvard (Red) → Fenway (Green-D)", HARVARD, FENWAY, "Park Street"],
  ["Northeastern (Green-E) → Oak Grove (Orange)", NEU, OAKGROVE, "Haymarket"],
  ["Ruggles (Orange) → Airport (Blue)", RUGGLES, AIRPORT, "State"],
  ["Prudential (Green-E) → Wood Island (Blue)", PRUDENTIAL, WOODISLAND, "Government Center"],
];
for (const [label, o, d, hub] of geo) {
  const p = planTier2(o, d);
  assert.ok(!("status" in p), `${label}: expected a transfer plan`);
  console.log(`  ${label}: ${p.originStop.stop.name} →[${p.legA.pattern.route_pattern_id}${p.legA.branchAgnostic ? " agnostic" : ""}]→ ${p.hub.name} →[${p.legB.pattern.route_pattern_id}${p.legB.branchAgnostic ? " agnostic" : ""}]→ ${p.destinationStop.stop.name}  (rejected before winner: ${p.rejected.length})`);
  assert.equal(p.hub.name, hub); assert.equal(p.option.transfers, 1); assert.equal(p.option.legs.length, 4);
  assert.ok(p.option.legs.every((l) => l.geometry.length >= 2));
  assert.equal(p.option.legs[1].toStopName, p.option.legs[2].fromStopName);
}
for (const [label, o, d, why] of [
  ["Harvard (Red) → Airport (Blue)", HARVARD, AIRPORT, "no_candidate_hub"],
  ["BU (Green-B) → Cleveland Circle (Green-C)", BU, CLEVE, "no_candidate_hub"],
] as const) {
  const p = planTier2(o, d);
  console.log(`  ${label}: ${"status" in p ? `${p.status} (${p.reason})` : "ROUTE?!"}`);
  assert.ok("status" in p && p.status === "no_tier1_route" && p.reason === why);
}
// Greedy is "first valid", not "best": Haymarket is listed before North Station and wins.
const gp = planTier2(NEU, OAKGROVE); assert.ok(!("status" in gp) && gp.hub.stop_id === "place-haecl");

// ---------- 4. Live: timing, per-leg service gate, last train back ----------
console.log("\n#### 4. live (real MBTA API)");
const MIDDAY = new Date("2026-11-23T12:30:00-05:00");
const EARLY = new Date("2026-11-23T05:20:00-05:00"); // Green-B-816 'early mornings only' still runs here
const LATE = new Date("2026-11-23T02:30:00-05:00");
function show(label: string, r: LivePlanResult, at: Date) {
  console.log(`\n== ${label} @ ${fmtBoston(at)}`);
  if (r.status === "ok" && r.tier === 2) {
    const [a, b] = r.timings;
    console.log(`  status: ok, TIER 2 via ${r.plan.hub.name}, transfers=${r.option.transfers}`);
    console.log(`  leg A ${a.routeId} (${a.method}${r.plan.legA.branchAgnostic ? "" : ", " + a.patternId}): ${r.plan.legA.from.name} → ${r.plan.legA.to.name}, ${a.rideSeconds}s, ${fmtBoston(a.departsAt)} → ${fmtBoston(a.arrivesAt)} [schedule-derived]`);
    console.log(`  hub wait: ${r.transferWaitSeconds}s [schedule-derived]`);
    console.log(`  leg B ${b.routeId} (${b.method}${r.plan.legB.branchAgnostic ? "" : ", " + b.patternId}): ${r.plan.legB.from.name} → ${r.plan.legB.to.name}, ${b.rideSeconds}s, ${fmtBoston(b.departsAt)} → ${fmtBoston(b.arrivesAt)} [schedule-derived]`);
    console.log(`  legs: ${r.option.legs.map((l) => `${l.mode}${l.routeShortName ? ":" + l.routeShortName : ""}:${l.durationSec}s`).join(" → ")}; option total ${r.option.durationSec}s (excludes wait for train A)`);
    console.log(`  last train back (final leg): ${r.lastTrainBack ? `${r.lastTrainBack.routeId} ${r.lastTrainBack.fromStopName} → ${r.lastTrainBack.toStopName} departs ${fmtBoston(r.lastTrainBack.departsAt)} [scheduled]${r.lastTrainBack.catchable ? "" : " (already gone when you arrive)"}` : `none (${r.lastTrainBackNote})`}`);
  } else if (r.status === "ok") {
    console.log(`  status: ok, TIER 1 ${r.plan.pattern.route_pattern_id}, ${r.timing.rideSeconds}s`);
  } else if (r.status === "no_service") {
    console.log(`  status: no_service${r.failedLeg ? ` (failed leg ${r.failedLeg})` : ""} — nothing drawn\n  ${r.message}`);
  } else if (r.status === "no_tier1_route") {
    console.log(`  status: no_tier1_route (${r.reason}) → Tier 0, nothing drawn`);
  } else console.log(`  status: ${r.status}: ${r.message}`);
}
const live = async (label: string, o: ReturnType<typeof pt>, d: ReturnType<typeof pt>, at: Date) => {
  const r = await planTripLive(o, d, { now: at }); show(label, r, at); return r;
};
function assertOk2(r: LivePlanResult, hub: string) {
  assert.ok(r.status === "ok" && r.tier === 2 && r.plan.hub.name === hub, `expected tier-2 ok via ${hub}`);
  assert.equal(r.option.transfers, 1); assert.equal(r.option.legs.length, 4);
  assert.ok(r.option.legs.every((l) => Number.isInteger(l.durationSec)));
  assert.ok(Date.parse(r.timings[1].departsAt) >= Date.parse(r.timings[0].arrivesAt), "leg B must depart after leg A arrives");
  assert.ok(r.transferWaitSeconds >= TRANSFER_BUFFER_SEC, `hub wait ${r.transferWaitSeconds}s is under the ${TRANSFER_BUFFER_SEC}s buffer`);
  assert.equal(r.transferWaitSeconds, Math.round((Date.parse(r.timings[1].departsAt) - Date.parse(r.timings[0].arrivesAt)) / 1000));
}

assertOk2(await live("Harvard (Red) → Ruggles (Orange)", HARVARD, RUGGLES, MIDDAY), "Downtown Crossing");
assertOk2(await live("Harvard (Red) → Fenway (Green-D)", HARVARD, FENWAY, MIDDAY), "Park Street");
assertOk2(await live("Northeastern (Green-E) → Oak Grove (Orange)", NEU, OAKGROVE, MIDDAY), "Haymarket");
assertOk2(await live("Ruggles (Orange) → Airport (Blue)", RUGGLES, AIRPORT, MIDDAY), "State");
assertOk2(await live("Prudential (Green-E) → Wood Island (Blue)", PRUDENTIAL, WOODISLAND, MIDDAY), "Government Center");

// Deliberate failures
const rb = await live("Harvard (Red) → Airport (Blue)  [Red↔Blue: no hub]", HARVARD, AIRPORT, MIDDAY);
assert.ok(rb.status === "no_tier1_route" && rb.reason === "no_candidate_hub");
const bc = await live("BU (Green-B) → Cleveland Circle (Green-C)  [same line, different branch: not in table]", BU, CLEVE, MIDDAY);
assert.ok(bc.status === "no_tier1_route" && bc.reason === "no_candidate_hub");

// Per-leg service gate. Orange → Green-B via Haymarket validates by pattern only through the
// time-limited Green-B-816 ('early mornings only').
const OG = await live("Oak Grove (Orange) → BU (Green-B) via Haymarket: A running, B only on a mornings-only pattern", OAKGROVE, BU, MIDDAY);
assert.ok(OG.status === "no_service" && OG.failedLeg === "B", "leg A running but leg B not → must not be drawn");
// Green-B-816-0 has exactly one weekday departure from Haymarket (06:39). Leaving Oak Grove at 06:15 reaches it.
const OGearly = await live("Oak Grove (Orange) → BU (Green-B): same pair when Green-B-816-0's one trip is catchable", OAKGROVE, BU, new Date("2026-11-23T06:15:00-05:00"));
assertOk2(OGearly, "Haymarket");
assert.equal(OGearly.status === "ok" && OGearly.tier === 2 && OGearly.timings[1].patternId, "Green-B-816-0");
const BC = await live("BU (Green-B) → Chinatown (Orange) via Haymarket: leg A only on a mornings-only pattern", BU, CHINATOWN, MIDDAY);
assert.ok(BC.status === "no_service" && BC.failedLeg === "A");
await live("BU (Green-B) → Chinatown (Orange): same pair while Green-B-816 runs", BU, CHINATOWN, EARLY);
const late = await live("Harvard (Red) → Ruggles (Orange) after service ends", HARVARD, RUGGLES, LATE);
assert.ok(late.status === "no_service" && late.failedLeg === "A");
console.log("\nAll Tier 2 checks passed");
