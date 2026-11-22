/**
 * Surface suitability: where in the real map a decoration may stand.
 *
 * Candidates are generated from vector geometry only (never randomly
 * scattered) and each must pass conservative clearance tests:
 *
 * - sidewalk:  curb-side furniture zone beside primary…minor roads; rejected
 *              when a building leaves no walkway, near intersections, rails,
 *              water, bridges or inside any building footprint.
 * - path_edge: beside footways/paths (never on them).
 * - plaza:     inside pedestrian areas/squares and along pedestrian streets.
 * - park:      inside parks/grass/wood, clear of paths, roads and water.
 * - waterfront: a few meters inland of water edges.
 * - rooftop:   flat, inset spots on extruded roofs (≥ 8 m), at the exact rendered
 *              roof height. In a pitched downtown view these are the open,
 *              visible surfaces; street canyons are hidden by the buildings.
 *
 * Generation is deterministic and independent of the session seed: the seed
 * chooses *among* candidates, so different seeds give different worlds on the
 * same safe surfaces.
 */
import { hasSidewalks, type AreaFeature, type Rect, type TileGeometry } from './geometry';
import { ringArea } from './mvt';

/** Area (m²) of a park/plaza polygon, outer ring minus holes; cached per feature. */
const AREA_M2 = new WeakMap<AreaFeature, number>();
function areaM2(a: AreaFeature): number {
  let v = AREA_M2.get(a);
  if (v === undefined) {
    v = Math.max(0, Math.abs(ringArea(a.rings[0]!)) - a.rings.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0));
    AREA_M2.set(a, v);
  }
  return v;
}
import { unit } from './random';

export type Surface = 'sidewalk' | 'path_edge' | 'plaza' | 'park' | 'waterfront' | 'rooftop';
export const SURFACES: readonly Surface[] = ['sidewalk', 'path_edge', 'plaza', 'park', 'waterfront', 'rooftop'];

export interface Candidate {
  readonly x: number;
  readonly y: number;
  readonly surface: Surface;
  /** Park/plaza samples: area (m²) of the open space they stand in (large spaces stay mostly bare). */
  readonly open?: number;
  /** Max base radius that stays off carriageways/paths/water (m). */
  readonly free: number;
  /** Distance to the nearest building edge (m), capped. Canopies must stay inside it. */
  readonly buildingClear: number;
  /** Radians, local frame (x east, y north): direction a front-facing prop should face. */
  readonly facing: number;
  /** Linear runs (one side of one street/path) for rhythmic compositions. */
  readonly run: number;
  readonly along: number;
  /** Standing height (m): 0 on the ground, the rendered roof height on rooftops. */
  readonly z?: number;
}

export interface SurfaceOptions {
  /** Spacing between samples along streets/paths (m). */
  readonly lineStep: number;
  /** Jittered grid spacing inside parks/plazas (m). */
  readonly areaStep: number;
  /** Required walkway between a sidewalk prop and the building line (m). */
  readonly walkway: number;
}
export const DEFAULT_SURFACE_OPTIONS: SurfaceOptions = { lineStep: 7, areaStep: 7, walkway: 1.6 };

const CAP = 30;

/** Candidates whose point lies inside `rect` (a decoration cell), in the tile's local frame. */
export function surfaceCandidates(g: TileGeometry, rect: Rect, options: SurfaceOptions = DEFAULT_SURFACE_OPTIONS): Candidate[] {
  const out: Candidate[] = [];
  const [x0, y0, x1, y1] = rect;
  const inside = (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
  const tileKey = `${g.frame.tile.z}/${g.frame.tile.x}/${g.frame.tile.y}`;
  const blocked = (x: number, y: number) => !!g.areaAt('building', x, y) || !!g.areaAt('water', x, y) || g.railDistance(x, y, 8) < 6;

  // --- Linear surfaces: sidewalks, path edges, pedestrian streets ---------
  for (const line of g.lines) {
    if (line.cls.endsWith(':bridge')) continue;
    const sidewalk = hasSidewalks(line), path = line.kind === 'path', pedestrian = line.kind === 'pedestrian';
    if (!sidewalk && !path && !pedestrian) continue;
    const p = line.points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]!); maxX = Math.max(maxX, p[i]!); minY = Math.min(minY, p[i + 1]!); maxY = Math.max(maxY, p[i + 1]!); }
    if (maxX < x0 - 20 || minX > x1 + 20 || maxY < y0 - 20 || minY > y1 + 20) continue;
    // Offsets from the centerline: curb-side furniture zone (and a deeper row on wide sidewalks).
    const offsets = sidewalk ? [line.halfWidth + 1.5, line.halfWidth + 3.3] : path ? [line.halfWidth + 1.6] : [line.halfWidth - 1.2];
    const phase = unit(tileKey, 'phase', line.id) * options.lineStep;
    let travelled = 0, next = phase;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!, ay = p[i + 1]!, bx = p[i + 2]!, by = p[i + 3]!;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len, nx = -ty, ny = tx;
      while (next <= travelled + len) {
        const t = next - travelled, sx = ax + tx * t, sy = ay + ty * t;
        for (let side = -1; side <= 1; side += 2) for (let o = 0; o < offsets.length; o++) {
          const qx = sx + nx * side * offsets[o]!, qy = sy + ny * side * offsets[o]!;
          if (!inside(qx, qy) || blocked(qx, qy)) continue;
          const buildingClear = g.edgeDistance('building', qx, qy, CAP);
          const road = g.roadClearance(qx, qy, CAP, sidewalk ? line.id : -1);
          let free: number, surface: Surface;
          if (sidewalk) {
            // Intersections: another carriageway nearby means a crossing or junction.
            if (road.other < 5 || road.own < 0.8) continue;
            const walkwayLimit = buildingClear - options.walkway;
            free = Math.min(road.own - 0.25, walkwayLimit, g.pathClearance(qx, qy, CAP) + 0.4);
            surface = 'sidewalk';
          } else if (path) {
            const roadClear = Math.min(road.own, road.other);
            if (roadClear < 2.5) continue;
            // Outside parks/plazas a footway is usually a mapped sidewalk: demand room from buildings.
            if (!g.areaAt('park', qx, qy) && !g.areaAt('plaza', qx, qy) && buildingClear < 4) continue;
            free = Math.min(roadClear - 1.5, buildingClear - 0.8, g.pathClearance(qx, qy, CAP, line.id) - 0.2, offsets[o]! - line.halfWidth - 0.2);
            surface = 'path_edge';
          } else {
            // Pedestrian street: props line its sides, keeping a central walking corridor.
            const roadClear = Math.min(road.own, road.other);
            if (roadClear < 2.5) continue;
            free = Math.min(roadClear - 1.5, buildingClear - options.walkway, offsets[o]! - 1.6, g.pathClearance(qx, qy, CAP, line.id) + 0.4);
            surface = 'plaza';
          }
          free = Math.min(free, g.edgeDistance('water', qx, qy, CAP) - 0.5);
          if (free < 0.45) continue;
          // Face the street/path the prop lines.
          // Footpaths through a park or plaza belong to that open space (Boston Common's paths).
          const space = sidewalk ? undefined : g.areaAt('park', qx, qy) ?? g.areaAt('plaza', qx, qy);
          out.push({ x: qx, y: qy, surface, ...(space ? { open: areaM2(space) } : {}), free, buildingClear, facing: Math.atan2(-ny * side, -nx * side), run: line.id * 8 + (side + 1) * 2 + o, along: next });
        }
        next += options.lineStep;
      }
      travelled += len;
    }
  }

  // --- Area surfaces: parks, plazas (jittered grid, deterministic) ---------
  const step = options.areaStep;
  for (let i = Math.floor(x0 / step); i <= Math.floor(x1 / step); i++)
    for (let j = Math.floor(y0 / step); j <= Math.floor(y1 / step); j++) {
      // The jittered sample stays inside its step square: skip squares no park/plaza can reach before hashing.
      const sx0 = i * step, sy0 = j * step, sx1 = sx0 + step, sy1 = sy0 + step;
      if (!g.mayHaveArea('plaza', sx0, sy0, sx1, sy1) && !g.mayHaveArea('park', sx0, sy0, sx1, sy1)) continue;
      const qx = (i + 0.15 + 0.7 * unit(tileKey, 'jx', i, j)) * step, qy = (j + 0.15 + 0.7 * unit(tileKey, 'jy', i, j)) * step;
      if (!inside(qx, qy)) continue;
      const plaza = g.areaAt('plaza', qx, qy), park = plaza ? undefined : g.areaAt('park', qx, qy);
      if (!plaza && !park) continue;
      if (blocked(qx, qy)) continue;
      const road = g.roadClearance(qx, qy, CAP);
      const roadClear = Math.min(road.own, road.other);
      if (roadClear < 3) continue;
      const pathClear = g.pathClearance(qx, qy, CAP);
      if (pathClear < (plaza ? 0.2 : 1.2)) continue;
      const buildingClear = g.edgeDistance('building', qx, qy, CAP);
      const free = Math.min(roadClear - 1.5, buildingClear - 1, (plaza ? CAP : pathClear - 0.4), g.edgeDistance('water', qx, qy, CAP) - 0.8);
      if (free < 0.6) continue;
      out.push({ x: qx, y: qy, surface: plaza ? 'plaza' : 'park', open: areaM2((plaza ?? park)!), free, buildingClear, facing: unit(tileKey, 'face', i, j) * Math.PI * 2, run: -1, along: 0 });
    }

  // --- Waterfront: inland of water edges ----------------------------------
  for (const area of g.areas) {
    if (area.kind !== 'water') continue;
    const [bx0, by0, bx1, by1] = area.bbox;
    if (bx1 < x0 - 10 || bx0 > x1 + 10 || by1 < y0 - 10 || by0 > y1 + 10) continue;
    for (const ring of area.rings) {
      let travelled = 0, next = unit(tileKey, 'wphase', area.id) * 11;
      for (let k = 0; k + 3 < ring.length; k += 2) {
        const ax = ring[k]!, ay = ring[k + 1]!, ex = ring[k + 2]!, ey = ring[k + 3]!, len = Math.hypot(ex - ax, ey - ay);
        if (len < 1e-6) continue;
        const tx = (ex - ax) / len, ty = (ey - ay) / len;
        while (next <= travelled + len) {
          const t = next - travelled, sx = ax + tx * t, sy = ay + ty * t;
          for (const side of [-1, 1]) {
            const qx = sx - ty * side * 5, qy = sy + tx * side * 5;
            if (!inside(qx, qy) || blocked(qx, qy)) continue;
            const road = g.roadClearance(qx, qy, CAP), roadClear = Math.min(road.own, road.other);
            if (roadClear < 2.5) continue;
            const buildingClear = g.edgeDistance('building', qx, qy, CAP);
            const free = Math.min(roadClear - 1.2, buildingClear - 1.2, g.pathClearance(qx, qy, CAP) + 0.5, g.edgeDistance('water', qx, qy, CAP) + 3);
            if (free < 0.6) continue;
            // Face the water.
            out.push({ x: qx, y: qy, surface: 'waterfront', free, buildingClear, facing: Math.atan2(-tx * side, ty * side), run: 1e7 + area.id * 4 + (side + 1), along: next });
          }
          next += 11;
        }
        travelled += len;
      }
    }
  }
  // --- Rooftops: inset, flat spots on extruded roofs ----------------------
  const roofStep = 10;
  for (let i = Math.floor(x0 / roofStep); i <= Math.floor(x1 / roofStep); i++)
    for (let j = Math.floor(y0 / roofStep); j <= Math.floor(y1 / roofStep); j++) {
      if (!g.mayHaveArea('building', i * roofStep, j * roofStep, (i + 1) * roofStep, (j + 1) * roofStep)) continue;
      const qx = (i + 0.2 + 0.6 * unit(tileKey, 'rx', i, j)) * roofStep, qy = (j + 0.2 + 0.6 * unit(tileKey, 'ry', i, j)) * roofStep;
      if (!inside(qx, qy)) continue;
      const z = g.roofAt(qx, qy);
      if (z === null || z < 8) continue;
      const inset = g.edgeDistance('building', qx, qy, CAP);
      if (inset < 3) continue;
      // Flat enough: no taller/shorter building part within the footprint we may use.
      const r = Math.min(inset - 0.5, 4);
      if ([[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => Math.abs((g.roofAt(qx + dx!, qy + dy!) ?? -99) - z) > 1)) continue;
      out.push({ x: qx, y: qy, surface: 'rooftop', free: Math.min(r, inset - 1), buildingClear: inset - 0.5, facing: unit(tileKey, 'rf', i, j) * Math.PI * 2, run: -1, along: 0, z });
    }
  return out;
}
