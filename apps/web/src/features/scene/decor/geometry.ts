/**
 * World-anchored geometry for decoration placement.
 *
 * Every placement is computed from z14 OpenMapTiles vector data, which is the
 * basemap's maximum source zoom: the same geometry is used at every camera
 * zoom ≥ 14, pitch and bearing, so placements are a pure function of the map
 * data and never of the view. Each z14 tile gets a local metric frame
 * (x east, y north, meters from the tile's north-west corner).
 */
import { classifyRings, type MvtLayer } from './mvt';

export const SOURCE_ZOOM = 14;
/** Decoration cells are z17 tiles (~225 m in Boston): 8×8 per source tile. */
export const CELL_ZOOM = 17;
const EARTH_CIRCUMFERENCE = 40075016.686;

export const mercatorX = (lng: number) => (lng + 180) / 360;
export const mercatorY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
export const lngFromMercator = (x: number) => x * 360 - 180;
export const latFromMercator = (y: number) => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90;

export interface TileId { readonly z: number; readonly x: number; readonly y: number }
export const tileKey = (t: TileId) => `${t.z}/${t.x}/${t.y}`;
export function tileAt(lng: number, lat: number, z: number): TileId {
  const n = 2 ** z;
  return { z, x: Math.floor(mercatorX(lng) * n), y: Math.floor(mercatorY(lat) * n) };
}
export const parentTile = (t: TileId, z: number): TileId => ({ z, x: t.x >> (t.z - z), y: t.y >> (t.z - z) });

/** Local metric frame of one source tile. */
export interface TileFrame {
  readonly tile: TileId;
  /** Mercator [0,1] coordinates of the tile's NW corner. */
  readonly originX: number;
  readonly originY: number;
  /** Ground meters per mercator unit at the tile's center latitude. */
  readonly metersPerUnit: number;
  /** Tile edge length in meters. */
  readonly size: number;
}

export function tileFrame(tile: TileId): TileFrame {
  const n = 2 ** tile.z, originX = tile.x / n, originY = tile.y / n;
  const lat = latFromMercator((tile.y + 0.5) / n);
  const metersPerUnit = EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);
  return { tile, originX, originY, metersPerUnit, size: metersPerUnit / n };
}
export const toLocal = (f: TileFrame, lng: number, lat: number): [number, number] => [(mercatorX(lng) - f.originX) * f.metersPerUnit, -(mercatorY(lat) - f.originY) * f.metersPerUnit];
export const toLngLat = (f: TileFrame, x: number, y: number): [number, number] => [lngFromMercator(f.originX + x / f.metersPerUnit), latFromMercator(f.originY - y / f.metersPerUnit)];

/** Rectangle in local meters: [minX, minY, maxX, maxY]. */
export type Rect = readonly [number, number, number, number];

/** z17 cell rectangle inside its z14 source tile frame. */
export function cellRect(frame: TileFrame, cell: TileId): Rect {
  const scale = 2 ** (cell.z - frame.tile.z), s = frame.size / scale;
  const i = cell.x - frame.tile.x * scale, j = cell.y - frame.tile.y * scale;
  return [i * s, -(j + 1) * s, (i + 1) * s, -j * s];
}

// ---------------------------------------------------------------------------
// Spatial primitives
// ---------------------------------------------------------------------------

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointInRing(px: number, py: number, ring: Float64Array): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!, yi = ring[i + 1]!, xj = ring[j]!, yj = ring[j + 1]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Uniform grid of segments; tags identify the owning feature. */
class SegmentGrid {
  private readonly cells = new Map<number, number[]>();
  readonly coords: number[] = []; // ax, ay, bx, by per segment
  readonly tags: number[] = [];
  private readonly cell: number;
  constructor(cell = 24) { this.cell = cell; }
  private key(i: number, j: number) { return (i + 4096) * 16384 + (j + 4096); }
  add(ax: number, ay: number, bx: number, by: number, tag: number) {
    const index = this.tags.length;
    this.coords.push(ax, ay, bx, by); this.tags.push(tag);
    const c = this.cell;
    for (let i = Math.floor(Math.min(ax, bx) / c); i <= Math.floor(Math.max(ax, bx) / c); i++)
      for (let j = Math.floor(Math.min(ay, by) / c); j <= Math.floor(Math.max(ay, by) / c); j++) {
        const k = this.key(i, j); let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(index);
      }
  }
  /** Per-segment query stamps: de-duplicates visits without allocating a Set per query (hot path). */
  private stamps = new Uint32Array(0);
  private query = 0;
  /** Visit segments that may lie within `radius` of (px, py); each segment at most once. */
  near(px: number, py: number, radius: number, visit: (index: number) => void) {
    const c = this.cell;
    if (this.stamps.length < this.tags.length) this.stamps = new Uint32Array(this.tags.length);
    if (++this.query === 0xffffffff) { this.stamps.fill(0); this.query = 1; }
    const stamps = this.stamps, q = this.query;
    for (let i = Math.floor((px - radius) / c); i <= Math.floor((px + radius) / c); i++)
      for (let j = Math.floor((py - radius) / c); j <= Math.floor((py + radius) / c); j++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const index of list) if (stamps[index] !== q) { stamps[index] = q; visit(index); }
      }
  }
  distance(index: number, px: number, py: number) {
    const k = index * 4;
    return distanceToSegment(px, py, this.coords[k]!, this.coords[k + 1]!, this.coords[k + 2]!, this.coords[k + 3]!);
  }
}

// ---------------------------------------------------------------------------
// Tile geometry
// ---------------------------------------------------------------------------

export type LineKind = 'road' | 'pedestrian' | 'path' | 'rail';
export interface LineFeature { readonly id: number; readonly kind: LineKind; readonly cls: string; readonly halfWidth: number; readonly points: Float64Array }
export type AreaKind = 'building' | 'park' | 'water' | 'plaza';
export interface AreaFeature {
  readonly id: number; readonly kind: AreaKind; readonly cls: string; readonly rings: readonly Float64Array[]; readonly bbox: Rect;
  /** Buildings: extruded roof height (m) exactly as the basemap style renders it (`render_height`, absent when `hide_3d`). */
  readonly roof?: number;
}

/**
 * Conservative carriageway half-widths (m) by OpenMapTiles class. OSM rarely
 * carries reliable widths, so the values err wide: a decoration is rejected
 * rather than allowed to touch a road.
 */
export const ROAD_HALF_WIDTH: Readonly<Record<string, number>> = {
  motorway: 12, trunk: 10.5, primary: 8.5, secondary: 7.5, tertiary: 6.5, minor: 5, service: 3.5, track: 2.5, raceway: 6, busway: 4, bus_guideway: 4,
};
const SIDEWALK_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'minor']);
export const hasSidewalks = (line: LineFeature) => line.kind === 'road' && SIDEWALK_CLASSES.has(line.cls);

export class TileGeometry {
  readonly lines: LineFeature[] = [];
  readonly areas: AreaFeature[] = [];
  private readonly roads = new SegmentGrid();
  private readonly paths = new SegmentGrid();
  private readonly rails = new SegmentGrid();
  private readonly edges = new Map<AreaKind, SegmentGrid>();
  private readonly areaGrid = new Map<AreaKind, Map<number, number[]>>();
  private static readonly AREA_CELL = 48;
  readonly frame: TileFrame;

  constructor(frame: TileFrame) { this.frame = frame; }

  addLine(kind: LineKind, cls: string, points: Float64Array, halfWidth: number) {
    const id = this.lines.length;
    this.lines.push({ id, kind, cls, halfWidth, points });
    const grid = kind === 'rail' ? this.rails : kind === 'road' ? this.roads : this.paths;
    for (let i = 0; i + 3 < points.length; i += 2) grid.add(points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!, id);
    return id;
  }

  addArea(kind: AreaKind, cls: string, rings: readonly Float64Array[], roof?: number) {
    const id = this.areas.length;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const outer = rings[0]!;
    for (let i = 0; i < outer.length; i += 2) { minX = Math.min(minX, outer[i]!); maxX = Math.max(maxX, outer[i]!); minY = Math.min(minY, outer[i + 1]!); maxY = Math.max(maxY, outer[i + 1]!); }
    this.areas.push({ id, kind, cls, rings, bbox: [minX, minY, maxX, maxY], roof });
    let edges = this.edges.get(kind); if (!edges) this.edges.set(kind, (edges = new SegmentGrid()));
    for (const ring of rings) for (let i = 0; i + 3 < ring.length; i += 2) edges.add(ring[i]!, ring[i + 1]!, ring[i + 2]!, ring[i + 3]!, id);
    let grid = this.areaGrid.get(kind); if (!grid) this.areaGrid.set(kind, (grid = new Map()));
    const c = TileGeometry.AREA_CELL;
    for (let i = Math.floor(minX / c); i <= Math.floor(maxX / c); i++)
      for (let j = Math.floor(minY / c); j <= Math.floor(maxY / c); j++) {
        const k = (i + 4096) * 16384 + (j + 4096); let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(id);
      }
    return id;
  }

  /**
   * Whether any `kind` area's bbox bucket overlaps the rectangle: a cheap, exact pre-check
   * (false ⇒ `areaAt`/`roofAt` return nothing anywhere inside it).
   */
  mayHaveArea(kind: AreaKind, x0: number, y0: number, x1: number, y1: number): boolean {
    const grid = this.areaGrid.get(kind);
    if (!grid) return false;
    const c = TileGeometry.AREA_CELL;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) if (grid.has((i + 4096) * 16384 + (j + 4096))) return true;
    return false;
  }

  /** The area of `kind` containing the point, if any (holes respected). */
  areaAt(kind: AreaKind, px: number, py: number): AreaFeature | undefined {
    const c = TileGeometry.AREA_CELL;
    const list = this.areaGrid.get(kind)?.get((Math.floor(px / c) + 4096) * 16384 + (Math.floor(py / c) + 4096));
    for (const id of list ?? []) {
      const a = this.areas[id]!;
      if (px < a.bbox[0] || px > a.bbox[2] || py < a.bbox[1] || py > a.bbox[3]) continue;
      if (pointInRing(px, py, a.rings[0]!) && !a.rings.slice(1).some((hole) => pointInRing(px, py, hole))) return a;
    }
    return undefined;
  }

  /** Rendered roof height at a point: the tallest extruded building part containing it (null if none). */
  roofAt(px: number, py: number): number | null {
    const c = TileGeometry.AREA_CELL;
    const list = this.areaGrid.get('building')?.get((Math.floor(px / c) + 4096) * 16384 + (Math.floor(py / c) + 4096));
    let best: number | null = null;
    for (const id of list ?? []) {
      const a = this.areas[id]!;
      if (a.roof === undefined || px < a.bbox[0] || px > a.bbox[2] || py < a.bbox[1] || py > a.bbox[3]) continue;
      if (pointInRing(px, py, a.rings[0]!) && !a.rings.slice(1).some((hole) => pointInRing(px, py, hole))) best = Math.max(best ?? 0, a.roof);
    }
    return best;
  }

  /** Distance to the nearest edge of any `kind` area, capped at `max`. */
  edgeDistance(kind: AreaKind, px: number, py: number, max: number): number {
    const grid = this.edges.get(kind); let best = max;
    grid?.near(px, py, max, (i) => { best = Math.min(best, grid.distance(i, px, py)); });
    return best;
  }

  /**
   * Clearance from carriageway edges (distance minus half-width), capped at `max`.
   * `ownLine` is reported separately so samples offset from a road can test
   * other roads (intersections) more strictly.
   */
  roadClearance(px: number, py: number, max: number, ownLine = -1): { own: number; other: number } {
    let own = max, other = max;
    this.roads.near(px, py, max + 12, (i) => {
      const line = this.lines[this.roads.tags[i]!]!;
      const clear = this.roads.distance(i, px, py) - line.halfWidth;
      if (line.id === ownLine) own = Math.min(own, clear); else other = Math.min(other, clear);
    });
    return { own, other };
  }

  pathClearance(px: number, py: number, max: number, ownLine = -1): number {
    let best = max;
    this.paths.near(px, py, max + 6, (i) => {
      const line = this.lines[this.paths.tags[i]!]!;
      if (line.id !== ownLine) best = Math.min(best, this.paths.distance(i, px, py) - line.halfWidth);
    });
    return best;
  }

  railDistance(px: number, py: number, max: number): number {
    let best = max;
    this.rails.near(px, py, max, (i) => { best = Math.min(best, this.rails.distance(i, px, py)); });
    return best;
  }
}

/** Build tile geometry from decoded OpenMapTiles layers. */
export function buildTileGeometry(tile: TileId, layers: ReadonlyMap<string, MvtLayer>): TileGeometry {
  const frame = tileFrame(tile), g = new TileGeometry(frame);
  const convert = (coords: Float64Array, extent: number) => {
    const out = new Float64Array(coords.length), s = frame.size / extent;
    for (let i = 0; i < coords.length; i += 2) { out[i] = coords[i]! * s; out[i + 1] = -coords[i + 1]! * s; }
    return out;
  };
  const transport = layers.get('transportation');
  for (const f of transport?.features ?? []) {
    const cls = String(f.properties.class ?? ''), brunnel = f.properties.brunnel;
    if (brunnel === 'tunnel') continue;
    if (f.type === 3) {
      // Pedestrian areas (plazas) are polygons in the transportation layer.
      if (cls === 'pedestrian' || cls === 'path') for (const poly of classifyRings(f.geometry)) g.addArea('plaza', cls, poly.map((r) => convert(r, transport!.extent)));
      continue;
    }
    if (f.type !== 2) continue;
    const kind: LineKind | null = cls === 'rail' || cls === 'transit' ? 'rail' : cls === 'pedestrian' ? 'pedestrian' : cls === 'path' ? 'path' : ROAD_HALF_WIDTH[cls] ? 'road' : null;
    if (!kind) continue;
    // Bridges keep their clearance footprint but never host decorations (see hasSidewalks callers).
    const half = kind === 'road' ? ROAD_HALF_WIDTH[cls]! : kind === 'rail' ? 2.5 : kind === 'pedestrian' ? 4 : 1.2;
    for (const line of f.geometry) g.addLine(kind, brunnel === 'bridge' ? `${cls}:bridge` : cls, convert(line, transport!.extent), half);
  }
  const areaLayers: Array<[string, AreaKind, (p: Readonly<Record<string, unknown>>) => boolean]> = [
    ['building', 'building', () => true],
    ['water', 'water', (p) => p.brunnel !== 'tunnel'],
    ['park', 'park', () => true],
    ['landcover', 'park', (p) => p.class === 'grass' || p.class === 'wood'],
    ['landuse', 'plaza', (p) => p.class === 'square'],
  ];
  for (const [name, kind, accept] of areaLayers) {
    const layer = layers.get(name);
    for (const f of layer?.features ?? []) {
      if (f.type !== 3 || !accept(f.properties)) continue;
      // Same height expression as the style's extrusions: coalesce(render_height, 0), none when hide_3d.
      const roof = kind === 'building' && !('hide_3d' in f.properties) ? Number(f.properties.render_height ?? 0) : undefined;
      for (const poly of classifyRings(f.geometry)) g.addArea(kind, String(f.properties.class ?? name), poly.map((r) => convert(r, layer!.extent)), roof);
    }
  }
  return g;
}

export const DECOR_SOURCE_LAYERS = new Set(['transportation', 'building', 'water', 'park', 'landcover', 'landuse']);
