/**
 * Deterministic, periodic procedural primitives for surface textures.
 *
 * Every function is pure and seeded: the same inputs always give the same
 * pixels, on every machine and on every frame. Lattice functions take a
 * period so a texture tiles seamlessly in MapLibre patterns (a seam would
 * repeat along every street).
 */

export const fract = (x: number) => x - Math.floor(x);
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Integer hash → [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 0x9e3779b1);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

/** String → 31-bit seed (FNV-1a). */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 1) & 0x7fffffff;
}

/** Value noise on a lattice that repeats every `px` × `py` cells. Output in [0, 1]. */
export function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = mod(ix, px);
  const x1 = mod(ix + 1, px);
  const y0 = mod(iy, py);
  const y1 = mod(iy + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise; each octave doubles the lattice and its period, so the sum stays periodic. */
export function fbm(x: number, y: number, px: number, py: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, px * f, py * f, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export interface VoronoiHit {
  /** Distance to the nearest feature point (cell units). */
  f1: number;
  /** Distance to the second nearest. `f2 - f1` approximates distance to the cell edge. */
  f2: number;
  /** Stable cell id within the period. */
  id: number;
  /** Offset from the cell's feature point (cell units). */
  dx: number;
  dy: number;
}

/** Jittered-grid Voronoi on a lattice that repeats every `cx` × `cy` cells. Writes into `out`. */
export function voronoi(x: number, y: number, cx: number, cy: number, jitter: number, seed: number, out: VoronoiHit): VoronoiHit {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  let bdx = 0;
  let bdy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = ix + i;
      const gy = iy + j;
      const wx = mod(gx, cx);
      const wy = mod(gy, cy);
      const fx = gx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
      const fy = gy + 0.5 + (hash2(wx, wy, seed + 7) - 0.5) * jitter;
      const ddx = x - fx;
      const ddy = y - fy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wy * cx + wx;
        bdx = ddx;
        bdy = ddy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  out.dx = bdx;
  out.dy = bdy;
  return out;
}

/** Whole number of cells of roughly `size` that fit exactly in `span` (≥ 1). */
export const cellsIn = (span: number, size: number) => Math.max(1, Math.round(span / Math.max(0.5, size)));

/** Signed distance to a rounded rectangle centered at the origin (half sizes hx, hy, radius r). */
export function sdRoundRect(x: number, y: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(x) - hx + r;
  const qy = Math.abs(y) - hy + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}
