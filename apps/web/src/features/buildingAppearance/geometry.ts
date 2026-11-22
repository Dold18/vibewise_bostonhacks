/**
 * Real-footprint extrusion into a geometry-bound mesh.
 *
 * Coordinates are local metres in the mercator frame (x east, y south, z up)
 * relative to a mesh origin. Every wall vertex carries surface coordinates in
 * metres (u along the wall edge, v above ground), so textures, storeys and
 * window bays are attached to the building itself, not to the screen.
 */
import { triangulate } from './triangulate';

/** Floats per vertex. Keep in sync with the attribute layout in layer.ts. */
export const STRIDE = 16;
export const ATTR = {
  pos: 0, // vec3 x, y, z (m)
  normal: 3, // vec2 nx, ny (walls); 0,0 for roofs
  kind: 5, // 0 wall, 1 roof
  uv: 6, // vec2 wall: (u along edge, v height) | roof: footprint-aligned metres
  edge: 8, // vec2 (edge length m, edge key) — edge key = cumulative ring distance at edge start
  slots: 10, // facade + 16 * roof
  seed: 11,
  jitter: 12,
  top: 13, // wall top height (m)
  base: 14, // wall base height (m)
  floorOffset: 15,
} as const;

export type Ring = readonly (readonly [number, number])[];

export interface BuildingInput {
  /** Outer ring first, then holes; local metres. Closing vertex optional. */
  rings: readonly Ring[];
  height: number;
  minHeight: number;
  /** Parapet height (m) — roof is lowered inside the real building height. */
  parapet: number;
  facade: number;
  roof: number;
  seed: number;
  jitter: number;
  floorOffset: number;
  alignRoof: boolean;
  /** Return true to omit the wall on edge i→i+1 of ring r (tile-clip seams). */
  skipEdge?: (ring: number, i: number) => boolean;
}

export class MeshBuffer {
  vertices: Float32Array;
  indices: Uint32Array;
  vertexCount = 0;
  indexCount = 0;
  constructor(vertexCapacity = 4096, indexCapacity = 8192) {
    this.vertices = new Float32Array(vertexCapacity * STRIDE);
    this.indices = new Uint32Array(indexCapacity);
  }
  reserve(vertices: number, indices: number) {
    if ((this.vertexCount + vertices) * STRIDE > this.vertices.length) {
      const next = new Float32Array(Math.max(this.vertices.length * 2, (this.vertexCount + vertices) * STRIDE));
      next.set(this.vertices.subarray(0, this.vertexCount * STRIDE));
      this.vertices = next;
    }
    if (this.indexCount + indices > this.indices.length) {
      const next = new Uint32Array(Math.max(this.indices.length * 2, this.indexCount + indices));
      next.set(this.indices.subarray(0, this.indexCount));
      this.indices = next;
    }
  }
  /** Append another buffer (vertex positions are not offset, indices are rebased). */
  append(other: MeshBuffer) {
    this.reserve(other.vertexCount, other.indexCount);
    this.vertices.set(other.vertices.subarray(0, other.vertexCount * STRIDE), this.vertexCount * STRIDE);
    const base = this.vertexCount;
    for (let i = 0; i < other.indexCount; i++) this.indices[this.indexCount + i] = other.indices[i]! + base;
    this.vertexCount += other.vertexCount;
    this.indexCount += other.indexCount;
  }
}

function ringArea(r: Ring): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
  return s / 2;
}

/** Drop a duplicated closing vertex and consecutive duplicates. */
export function cleanRing(r: Ring): [number, number][] {
  const out: [number, number][] = [];
  for (const p of r) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const a = out[0]!, b = out[out.length - 1]!;
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}

/** Footprint area in m² (outer minus holes). */
export function footprintArea(rings: readonly Ring[]): number {
  if (!rings.length) return 0;
  let a = Math.abs(ringArea(rings[0]!));
  for (let i = 1; i < rings.length; i++) a -= Math.abs(ringArea(rings[i]!));
  return Math.max(0, a);
}

export function centroid(r: Ring): [number, number] {
  let x = 0, y = 0;
  for (const p of r) { x += p[0]; y += p[1]; }
  return r.length ? [x / r.length, y / r.length] : [0, 0];
}

/** Direction (radians) of the longest edge of a ring. */
export function dominantAngle(r: Ring): number {
  let best = 0, angle = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    if (len > best) { best = len; angle = Math.atan2(dy, dx); }
  }
  return angle;
}

/**
 * Append one building (walls + roof cap) to the mesh. Returns false when the
 * footprint is degenerate.
 */
export function appendBuilding(mesh: MeshBuffer, b: BuildingInput): boolean {
  const rings = b.rings.map(cleanRing).filter((r) => r.length >= 3);
  if (!rings.length || b.height <= b.minHeight) return false;
  const top = b.height;
  const base = b.minHeight;
  const roofZ = b.parapet > 0 && top - b.parapet > base + 2 ? top - b.parapet : top;
  const slots = b.facade + 16 * b.roof;
  const v = mesh;

  const write = (x: number, y: number, z: number, nx: number, ny: number, kind: number, u: number, vv: number, len: number, key: number) => {
    const o = v.vertexCount * STRIDE;
    const a = v.vertices;
    a[o] = x; a[o + 1] = y; a[o + 2] = z;
    a[o + 3] = nx; a[o + 4] = ny;
    a[o + 5] = kind;
    a[o + 6] = u; a[o + 7] = vv;
    a[o + 8] = len; a[o + 9] = key;
    a[o + 10] = slots; a[o + 11] = b.seed; a[o + 12] = b.jitter;
    a[o + 13] = top; a[o + 14] = base; a[o + 15] = b.floorOffset;
    return v.vertexCount++;
  };

  // Walls
  let edges = 0;
  for (const r of rings) edges += r.length;
  v.reserve(edges * 4, edges * 6);
  rings.forEach((ring, ri) => {
    const ccw = ringArea(ring) > 0; // in (x east, y south) maths orientation
    const hole = ri > 0;
    let cumulative = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!;
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      if (b.skipEdge?.(ri, i)) { cumulative += len; continue; }
      // Outward normal of this ring, flipped for holes (courtyard walls face into the hole).
      let nx = ccw ? dy / len : -dy / len;
      let ny = ccw ? -dx / len : dx / len;
      if (hole) { nx = -nx; ny = -ny; }
      const key = cumulative + ri * 10000;
      const i0 = write(a[0], a[1], base, nx, ny, 0, 0, base, len, key);
      const i1 = write(c[0], c[1], base, nx, ny, 0, len, base, len, key);
      const i2 = write(c[0], c[1], top, nx, ny, 0, len, top, len, key);
      const i3 = write(a[0], a[1], top, nx, ny, 0, 0, top, len, key);
      const ix = v.indices;
      let k = v.indexCount;
      ix[k++] = i0; ix[k++] = i1; ix[k++] = i2;
      ix[k++] = i0; ix[k++] = i2; ix[k++] = i3;
      v.indexCount = k;
      cumulative += len;
    }
  });

  // Roof cap
  const flat: number[] = [];
  const holes: number[] = [];
  rings.forEach((r, ri) => {
    if (ri > 0) holes.push(flat.length / 2);
    for (const p of r) flat.push(p[0], p[1]);
  });
  const tris = triangulate(flat, holes);
  if (tris.length) {
    const angle = b.alignRoof ? dominantAngle(rings[0]!) : 0;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const n = flat.length / 2;
    v.reserve(n, tris.length);
    const first = v.vertexCount;
    // Roof surface coordinates are relative to the building's own first
    // vertex, so they do not shift when the mesh origin is re-centred.
    const ox = flat[0]!, oy = flat[1]!;
    for (let i = 0; i < n; i++) {
      const x = flat[i * 2]!, y = flat[i * 2 + 1]!;
      const rx = x - ox, ry = y - oy;
      write(x, y, roofZ, 0, 0, 1, rx * cos - ry * sin, rx * sin + ry * cos, 0, 0);
    }
    for (let i = 0; i < tris.length; i++) v.indices[v.indexCount++] = first + tris[i]!;
  }
  return true;
}
