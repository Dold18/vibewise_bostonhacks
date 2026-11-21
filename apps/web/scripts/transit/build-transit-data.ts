// Precompute subway-only lookup tables from the raw MBTA GTFS feed.
//
//   node apps/web/scripts/transit/build-transit-data.ts [gtfsDir] [outDir]
//
// Reads  data/gtfs/{routes,route_patterns,trips,stop_times,stops,shapes}.txt   (gitignored)
// Writes apps/web/src/features/transit/data/{stops,patterns,shapes}.json       (committed)
// Re-download the raw feed first with fetch-gtfs.sh. Runs on plain Node >= 22 (no dependencies).

import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gtfsDir = resolve(process.argv[2] ?? join(here, "../../../../data/gtfs"));
const outDir = resolve(process.argv[3] ?? join(here, "../../src/features/transit/data"));

// Subway scope: heavy rail + Green branches. Mattapan and Silver Line are intentionally excluded.
const SUBWAY_ROUTES = new Set(["Red", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E"]);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function readRows(file: string, onRow: (r: Record<string, string>) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(join(gtfsDir, file), "utf8"), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const raw of rl) {
    const line = raw.replace(/^﻿/, "");
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (!header) { header = cells; continue; }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? "";
    onRow(row);
  }
}

const round = (n: number, d: number) => Number(n.toFixed(d));

// ---- routes ---------------------------------------------------------------
const routeColor = new Map<string, string>();
await readRows("routes.txt", (r) => {
  if (SUBWAY_ROUTES.has(r.route_id)) routeColor.set(r.route_id, `#${r.route_color.toUpperCase()}`);
});

// ---- route patterns (each carries a representative trip that defines its stop order + shape) ----
interface PatternMeta { id: string; route_id: string; direction_id: number; typicality: number; name: string; tripId: string }
const patternMeta: PatternMeta[] = [];
await readRows("route_patterns.txt", (r) => {
  if (!SUBWAY_ROUTES.has(r.route_id)) return;
  patternMeta.push({
    id: r.route_pattern_id,
    route_id: r.route_id,
    direction_id: Number(r.direction_id),
    typicality: Number(r.route_pattern_typicality),
    name: r.route_pattern_name,
    tripId: r.representative_trip_id,
  });
});
const repTrips = new Map(patternMeta.map((p) => [p.tripId, p]));

// ---- trips -> shape of each representative trip ----
const shapeOfPattern = new Map<string, string>();
await readRows("trips.txt", (r) => {
  const p = repTrips.get(r.trip_id);
  if (p) shapeOfPattern.set(p.id, r.shape_id);
});

// ---- stops: platform -> parent station; station records ----
const parentOf = new Map<string, string>(); // any stop_id -> station id
const stationRows = new Map<string, { name: string; lat: number; lng: number }>();
await readRows("stops.txt", (r) => {
  parentOf.set(r.stop_id, r.parent_station || r.stop_id);
  if (r.location_type === "1") {
    stationRows.set(r.stop_id, { name: r.stop_name, lat: Number(r.stop_lat), lng: Number(r.stop_lon) });
  } else if (!r.parent_station && r.location_type === "0") {
    stationRows.set(r.stop_id, { name: r.stop_name, lat: Number(r.stop_lat), lng: Number(r.stop_lon) });
  }
});

// ---- stop_times (113 MB): stream, keep only representative subway trips ----
const tripStops = new Map<string, { stop_id: string; sequence: number }[]>();
await readRows("stop_times.txt", (r) => {
  if (!repTrips.has(r.trip_id)) return;
  const list = tripStops.get(r.trip_id) ?? [];
  list.push({ stop_id: parentOf.get(r.stop_id) ?? r.stop_id, sequence: Number(r.stop_sequence) });
  tripStops.set(r.trip_id, list);
});

const warnings: string[] = [];
const patterns: unknown[] = [];
const usedStops = new Set<string>();
const neededShapes = new Set<string>();
for (const p of patternMeta) {
  const raw = tripStops.get(p.tripId);
  if (!raw?.length) { warnings.push(`pattern ${p.id}: representative trip ${p.tripId} has no stop_times; dropped`); continue; }
  raw.sort((a, b) => a.sequence - b.sequence);
  // Dense 0-based seq by order; collapse consecutive duplicate parents (multi-platform stations).
  const stops: { stop_id: string; seq: number }[] = [];
  for (const s of raw) if (stops.at(-1)?.stop_id !== s.stop_id) stops.push({ stop_id: s.stop_id, seq: stops.length });
  const dup = new Set<string>();
  for (const s of stops) { if (dup.has(s.stop_id)) warnings.push(`pattern ${p.id}: stop ${s.stop_id} visited twice`); dup.add(s.stop_id); usedStops.add(s.stop_id); }
  const shape_id = shapeOfPattern.get(p.id);
  if (!shape_id) warnings.push(`pattern ${p.id}: no shape_id`); else neededShapes.add(shape_id);
  patterns.push({
    route_pattern_id: p.id, route_id: p.route_id, direction_id: p.direction_id,
    // Extras beyond the requested fields, needed to prefer typical patterns and to join shapes:
    typicality: p.typicality, shape_id: shape_id ?? null, name: p.name,
    stops,
  });
}

// ---- shapes: only those referenced by subway patterns ----
const shapePts = new Map<string, { seq: number; lng: number; lat: number }[]>();
await readRows("shapes.txt", (r) => {
  if (!neededShapes.has(r.shape_id)) return;
  const list = shapePts.get(r.shape_id) ?? [];
  list.push({ seq: Number(r.shape_pt_sequence), lng: Number(r.shape_pt_lon), lat: Number(r.shape_pt_lat) });
  shapePts.set(r.shape_id, list);
});
const shapes: unknown[] = [];
const shapeRoute = new Map<string, string>();
for (const p of patternMeta) { const s = shapeOfPattern.get(p.id); if (s) shapeRoute.set(s, p.route_id); }
for (const id of neededShapes) {
  const pts = shapePts.get(id);
  if (!pts?.length) { warnings.push(`shape ${id}: no points in shapes.txt`); continue; }
  pts.sort((a, b) => a.seq - b.seq);
  shapes.push({
    shape_id: id,
    route_color: routeColor.get(shapeRoute.get(id)!) ?? null,
    geometry: pts.map((q) => [round(q.lng, 6), round(q.lat, 6)]), // [lng, lat]
  });
}

// ---- stops.json ----
const stops = [...usedStops].sort().map((id) => {
  const s = stationRows.get(id);
  if (!s) { warnings.push(`stop ${id}: no station record`); return null; }
  return { stop_id: id, name: s.name, lat: round(s.lat, 6), lng: round(s.lng, 6) };
}).filter(Boolean);

mkdirSync(outDir, { recursive: true });
for (const [name, data] of [["stops", stops], ["patterns", patterns], ["shapes", shapes]] as const) {
  const body = JSON.stringify(data);
  writeFileSync(join(outDir, `${name}.json`), body + "\n");
  console.log(`${name}.json: ${data.length} records, ${(body.length / 1024).toFixed(1)} KB`);
}
console.log(warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : "\nNo warnings.");
