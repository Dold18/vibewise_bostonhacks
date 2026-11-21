// Live acceptance test (real MBTA V3 calls, no mocks) for departures + ride timing + service gate.
//   node apps/web/scripts/transit/test-live.ts
// Reads MBTA_API_KEY from .env if present; works keyless (20 req/min, the client waits out 429s).
import assert from "node:assert/strict";
import { departuresWithStatus } from "../../src/features/transit/departures.ts";
import { nearestStop } from "../../src/features/transit/engine.ts";
import { fmtBoston } from "../../src/features/transit/mbta.ts";
import { planTripLive } from "../../src/features/transit/ride.ts";

try { process.loadEnvFile(new URL("../../../../.env", import.meta.url)); } catch { /* no .env: keyless */ }
console.log(`API key: ${process.env.MBTA_API_KEY ? "set" : "not set (keyless, rate-limited)"}`);

const pt = (lat: number, lng: number) => ({ lat, lng });
const HARVARD = pt(42.3736, -71.1190), KENDALL = pt(42.3625, -71.0862), ASHMONT = pt(42.2845, -71.0638);
const BU = pt(42.3505, -71.1054), PARK = pt(42.3564, -71.0624), AQUARIUM = pt(42.3592, -71.0516);
const UNION_SQ = pt(42.3797, -71.0953), BRIGHAM = pt(42.3342, -71.1042); // Union Sq → E branch (Heath St side)

// Monday 2026-11-23, Boston local (EST, -05:00)
const MIDDAY = new Date("2026-11-23T12:30:00-05:00");
const EARLY = new Date("2026-11-23T04:45:00-05:00"); // Green-E-885-0's only weekday trip leaves Union Sq 04:50
const LATE = new Date("2026-11-23T02:30:00-05:00"); // after the last trains

function show(label: string, r: Awaited<ReturnType<typeof planTripLive>>, at: Date) {
  console.log(`\n== ${label} @ ${fmtBoston(at)}`);
  if (r.status === "ok") {
    const ride = r.option.legs[1];
    console.log(`  status: ok, ${r.plan.pattern.route_pattern_id}${r.plan.branchAgnostic ? " (branch-agnostic, queried by route+direction)" : " (queried by pattern)"}`);
    console.log(`  ride: ${ride.fromStopName} → ${ride.toStopName}, ${ride.durationSec}s [schedule-derived], trip ${r.timing.tripId} ${fmtBoston(r.timing.departsAt)} → ${fmtBoston(r.timing.arrivesAt)}`);
    console.log(`  option total: ${r.option.durationSec}s (walk estimates + ride, excludes wait); legs: ${r.option.legs.map((l) => `${l.mode}:${l.durationSec}s`).join(" → ")}`);
    console.log(`  patterns running in window: [${r.service.runningPatternIds}]  idle: [${r.service.idlePatternIds}]`);
  } else if (r.status === "no_service") {
    console.log(`  status: no_service (nothing drawn)${r.nextScheduledDepartureAt ? `, next scheduled ${fmtBoston(r.nextScheduledDepartureAt)}` : ""}\n  ${r.message}`);
  } else if (r.status === "no_tier1_route") {
    console.log(`  status: no_tier1_route (${r.reason}) → Tier 0, nothing drawn`);
  } else console.log(`  status: ${r.status}: ${r.message}`);
}

// ---- Step 1: departures ----
console.log("\n#### departures");
const harvard = nearestStop(HARVARD).stop;
const live = await departuresWithStatus(harvard);
console.log(`Harvard, now: ${live.status}, source=${live.kind}`);
for (const d of live.departures) console.log(`  ${d.route_id} dir ${d.direction_id} → ${d.destination ?? "?"}  ${fmtBoston(d.time)}  [${d.kind}]`);
assert.ok(live.departures.every((d) => d.kind === (live.kind as string)));
const sched = await departuresWithStatus(harvard, { now: MIDDAY });
console.log(`Harvard, ${fmtBoston(MIDDAY)} (non-live moment → schedule): ${sched.status}, source=${sched.kind}`);
for (const d of sched.departures) console.log(`  ${d.route_id} dir ${d.direction_id} → ${d.destination ?? "?"}  ${fmtBoston(d.time)}  [${d.kind}]`);
assert.equal(sched.kind, "scheduled"); assert.ok(sched.departures.length > 0);
const night = await departuresWithStatus(harvard, { now: LATE });
console.log(`Harvard, ${fmtBoston(LATE)}: ${night.status}, ${night.departures.length} departures${night.message ? ` (${night.message})` : ""}`);

// ---- Steps 2-3: timing + service gate ----
console.log("\n#### planTripLive");
const run = async (label: string, o: typeof pt extends (...a: never[]) => infer R ? R : never, d: typeof o, at: Date) => {
  const r = await planTripLive(o, d, { now: at }); show(label, r, at); return r;
};
const bu = await run("BU → Park St (Green-B, branch-agnostic)", BU, PARK, MIDDAY);
assert.ok(bu.status === "ok" && bu.option.legs.every((l) => typeof l.durationSec === "number") && bu.timing.rideSeconds > 0);
const bu2 = await run("BU → Park St (Green-B, branch-agnostic)", BU, PARK, EARLY);
assert.equal(bu2.status === "ok" || bu2.status === "no_service", true);
const hk = await run("Harvard → Kendall (Red, branch-agnostic)", HARVARD, KENDALL, MIDDAY);
assert.ok(hk.status === "ok" && hk.option.durationSec! > 0);
const ha = await run("Harvard → Ashmont (Red-1-0 only)", HARVARD, ASHMONT, MIDDAY);
assert.ok(ha.status === "ok" && !ha.plan.branchAgnostic && ha.timing.patternId === "Red-1-0" && ha.timing.method === "pattern");
// The time-limited pattern: Green-E-885-0 exists in GTFS but runs once, ~04:50.
const eMid = await run("Union Sq → Brigham Cir (Green-E-885-0 'early mornings only')", UNION_SQ, BRIGHAM, MIDDAY);
assert.equal(eMid.status, "no_service", "time-limited pattern must be suppressed at midday");
const eEarly = await run("Union Sq → Brigham Cir (Green-E-885-0 'early mornings only')", UNION_SQ, BRIGHAM, EARLY);
assert.ok(eEarly.status === "ok" && eEarly.timing.patternId === "Green-E-885-0", "…and drawn when its trip is actually running");
const hkLate = await run("Harvard → Kendall (Red)", HARVARD, KENDALL, LATE);
assert.equal(hkLate.status, "no_service");
const cross = await run("Harvard → Aquarium (cross-line)", HARVARD, AQUARIUM, MIDDAY);
assert.equal(cross.status, "no_tier1_route");
console.log("\nAll live checks passed");
