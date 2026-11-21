// Acceptance test for the Tier 0/1 engine, using hardcoded coordinates (no restaurants).
//   node apps/web/scripts/transit/test-engine.ts
import assert from "node:assert/strict";
import {
  buildLeg, direction, nearestStop, planTier1, planTripSkeleton, sharedPatterns,
} from "../../src/features/transit/engine.ts";

const pt = (lat: number, lng: number) => ({ lat, lng });
const cases: { name: string; from: ReturnType<typeof pt>; to: ReturnType<typeof pt>; expect: "route" | "none"; line?: string }[] = [
  { name: "BU (Comm Ave) → Park St area (Green, Government Ctr-bound)", from: pt(42.3505, -71.1054), to: pt(42.3564, -71.0624), expect: "route" },
  { name: "Harvard Sq → Kendall/MIT (Red, same pattern)", from: pt(42.3736, -71.1190), to: pt(42.3625, -71.0862), expect: "route" },
  { name: "Harvard Sq → Alewife (Red, opposite direction)", from: pt(42.3736, -71.1190), to: pt(42.3954, -71.1425), expect: "route" },
  { name: "Harvard Sq → Ashmont (Red Ashmont pattern)", from: pt(42.3736, -71.1190), to: pt(42.2845, -71.0638), expect: "route" },
  { name: "Ashmont → Braintree (different Red branches)", from: pt(42.2845, -71.0638), to: pt(42.2078, -71.0011), expect: "none" },
  { name: "Harvard Sq (Red) → Aquarium (Blue) — cross-line", from: pt(42.3736, -71.1190), to: pt(42.3592, -71.0516), expect: "none" },
  { name: "Boston College (Green-B) → Cleveland Circle (Green-C)", from: pt(42.3399, -71.1664), to: pt(42.3365, -71.1491), expect: "none" },
];

let failed = 0;
for (const c of cases) {
  console.log(`\n== ${c.name}`);
  const o = nearestStop(c.from), d = nearestStop(c.to);
  console.log(`  origin stop: ${o.stop.name} (${o.walkMeters} m, ~${Math.round(o.walkSeconds / 60)} min, ${o.source})`);
  console.log(`  dest stop:   ${d.stop.name} (${d.walkMeters} m, ~${Math.round(d.walkSeconds / 60)} min, ${d.source})`);
  const shared = sharedPatterns(o.stop, d.stop);
  console.log(`  shared patterns: ${shared.length ? shared.map((p) => `${p.route_pattern_id}[${direction(p, o.stop, d.stop)}]`).join(", ") : "none"}`);
  const plan = planTier1(c.from, c.to);
  if ("status" in plan) {
    console.log(`  result: ${plan.status} (${plan.reason}) → Tier 0 fallback, nothing drawn`);
    if (c.expect !== "none") { failed++; console.log("  ✗ expected a route"); }
  } else {
    const ride = plan.option.legs[1];
    console.log(`  chosen: ${plan.pattern.route_pattern_id} "${plan.pattern.name}" ${plan.direction}${plan.branchAgnostic ? `  [branch-agnostic: ${plan.equivalentPatterns.map((p) => p.route_pattern_id).join(", ")}]` : ""}`);
    console.log(`  option id: ${plan.option.id}`);
    console.log(`  legs: ${plan.option.legs.map((l) => `${l.mode}${l.routeShortName ? ":" + l.routeShortName : ""}(${l.geometry.length}pts)`).join(" → ")}  transfers=${plan.option.transfers}`);
    console.log(`  ride: ${ride.fromStopName} → ${ride.toStopName}, durationSec=${ride.durationSec}, option durationSec=${plan.option.durationSec}`);
    if (c.expect !== "route") { failed++; console.log("  ✗ expected no route"); }
    // Invariants that must hold on every drawn option.
    assert.equal(plan.option.legs.length, 3);
    assert.equal(plan.option.transfers, 0);
    assert.equal(planTripSkeleton(c.from, c.to) && "status" in (planTripSkeleton(c.from, c.to) as object), false);
    for (const l of plan.option.legs) assert.ok(l.geometry.length >= 2);
    assert.equal(direction(plan.pattern, o.stop, d.stop), "forward");
    // Sliced geometry must start near the origin stop and end near the destination stop.
    const g = ride.geometry;
    const near = (p: [number, number], s: { lat: number; lng: number }) => Math.hypot((p[1] - s.lat) * 111000, (p[0] - s.lng) * 82000) < 150;
    assert.ok(near(g[0], o.stop) && near(g.at(-1)!, d.stop), "slice endpoints not at stops");
  }
}

// Branch-agnostic stretch: must not be labeled with an Ashmont- or Braintree-specific id.
const hk = planTier1(pt(42.3736, -71.1190), pt(42.3625, -71.0862));
assert.ok(!("status" in hk) && hk.branchAgnostic && hk.equivalentPatterns.length >= 2);
assert.ok(!hk.option.id.includes("Red-1-0") && !hk.option.id.includes("Red-3-0"));
assert.ok(hk.equivalentPatterns.every((p) => p.route_id === "Red" && p.direction_id === 0));
// Branch-specific trip (past JFK/UMass) stays pinned to its pattern.
const ha = planTier1(pt(42.3736, -71.1190), pt(42.2845, -71.0638));
assert.ok(!("status" in ha) && !ha.branchAgnostic && ha.pattern.route_pattern_id === "Red-1-0");
// Targeted unit checks on the correctness rules.
const [r1, r2] = [planTier1(pt(42.3736, -71.1190), pt(42.3954, -71.1425)), planTier1(pt(42.3954, -71.1425), pt(42.3736, -71.1190))];
assert.ok(!("status" in r1) && !("status" in r2));
assert.notEqual(r1.pattern.route_pattern_id, r2.pattern.route_pattern_id); // opposite directions use opposite patterns
const harv = nearestStop(pt(42.3736, -71.1190)).stop, alew = nearestStop(pt(42.3954, -71.1425)).stop;
const redBackward = sharedPatterns(harv, alew).find((p) => direction(p, harv, alew) === "backward")!;
assert.equal(direction(redBackward, harv, harv), null); // equal index → null
assert.throws(() => buildLeg(redBackward, harv, alew, "forward")); // buildLeg refuses mismatched direction
assert.equal(direction(redBackward, harv, nearestStop(pt(42.3592, -71.0516)).stop), null); // stop not on pattern → null
console.log(`\n${failed ? "FAILED" : "All checks passed"} (${cases.length} coordinate cases + unit assertions)`);
process.exit(failed ? 1 : 0);
