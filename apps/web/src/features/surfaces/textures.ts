/**
 * Procedural surface textures, painted per pixel into RGBA buffers that
 * MapLibre uses as `line-pattern` / `fill-pattern` / `background-pattern`.
 *
 * Coordinates are logical pixels. For line patterns `u` runs **along** the
 * street and `v` **across** it (MapLibre orients line patterns with the line),
 * so setts are laid in courses across the carriageway, tire tracks and wet
 * streaks run with traffic, and lamp pools repeat at a fixed spacing along
 * every street. Fill patterns are world-anchored by MapLibre, so ground and
 * park materials stay put while the camera moves.
 *
 * Pure: same spec (+ same grain maps) ⇒ byte-identical output.
 */
import type { GreenAccent, Reflection } from './recipe';
import { cellsIn, clamp01, fbm, fract, hash2, mod, sdRoundRect, seedOf, smoothstep, vnoise, voronoi, type VoronoiHit } from './noise';

export type SlotKind = 'road' | 'walk' | 'plaza' | 'ground' | 'green' | 'wood' | 'lamps';

export interface TextureSpec {
  readonly kind: SlotKind;
  readonly material: string;
  /** Street-to-street variation (different seed/wear), 0..2. */
  readonly variant: number;
  /** Logical size; the buffer is `width * pixelRatio` × `height * pixelRatio`. */
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly base: string;
  readonly ink: string;
  readonly light: string;
  readonly sky: string;
  readonly park: string;
  readonly accentA: string;
  readonly accentB: string;
  readonly mosaic: readonly string[];
  readonly wet: number;
  readonly wear: number;
  readonly scale: number;
  readonly reflection: Reflection;
  readonly night: boolean;
  readonly accent: GreenAccent;
}

export interface TextureImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Signed luminance detail (−1..1) extracted from a real SVG asset; `size` × `size`, tileable. */
export interface GrainMap {
  readonly size: number;
  readonly data: Float32Array;
}
export type GrainSet = ReadonlyMap<string, GrainMap>;

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: RGB, b: RGB, k: number): RGB => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Which real asset (scene-assets v1/v2) supplies micro-grain for a material. */
export const GRAIN_FOR: Readonly<Record<string, string>> = {
  asphalt: 'v1/asphalt-grit',
  aged_asphalt: 'v2/pavement.coarse_asphalt.cool',
  wet_asphalt: 'v1/asphalt-grit',
  granite_setts: 'v2/stone_concrete.pitted_concrete.cool',
  cobbles: 'v2/stone_concrete.pitted_concrete.warm',
  flagstone: 'v2/stone_concrete.limestone_slabs.warm',
  limestone: 'v2/stone_concrete.stucco_plaster.pastel',
  paper_sketch: 'v1/paper-grain',
  concrete_slabs: 'v1/concrete-pores',
  granite_flags: 'v2/stone_concrete.pitted_concrete.cool',
  concrete_grain: 'v1/concrete-pores',
  dark_grain: 'v1/asphalt-grit',
  paper_grain: 'v1/paper-grain',
  topo_lines: 'v1/paper-grain',
  sand_grain: 'v2/nature_ground.sandy_ground.warm',
  stucco: 'v2/stone_concrete.stucco_plaster.warm',
  grainy: 'v2/nature_ground.short_grass.warm',
  lush_blades: 'v2/nature_ground.dense_foliage.warm',
  watercolor: 'v1/paper-grain',
  soft_dapple: 'v2/nature_ground.moss.warm',
  canopy: 'v2/nature_ground.dense_foliage.cool',
  dense_canopy: 'v2/nature_ground.dense_foliage.warm',
  sparse_canopy: 'v2/nature_ground.moss.cool',
};

const LIGHT_DIR: [number, number] = [-0.6, -0.8];

/** Paint one texture. */
export function paintTexture(spec: TextureSpec, grains?: GrainSet): TextureImage {
  const pr = spec.pixelRatio;
  const wPx = Math.round(spec.width * pr);
  const hPx = Math.round(spec.height * pr);
  const data = new Uint8ClampedArray(wPx * hPx * 4);
  const shade = shaderFor(spec);
  const grain = grainSampler(spec, grains, wPx);
  const px: Pixel = { c: [0, 0, 0], a: 1, ix: 0, iy: 0 };
  for (let iy = 0; iy < hPx; iy++) {
    for (let ix = 0; ix < wPx; ix++) {
      px.ix = ix;
      px.iy = iy;
      px.a = 1;
      shade((ix + 0.5) / pr, (iy + 0.5) / pr, px);
      if (grain && px.a > 0.5) px.c = mul(px.c, 1 + grain(ix, iy));
      const o = (iy * wPx + ix) * 4;
      data[o] = Math.round(clamp01(px.c[0]) * 255);
      data[o + 1] = Math.round(clamp01(px.c[1]) * 255);
      data[o + 2] = Math.round(clamp01(px.c[2]) * 255);
      data[o + 3] = Math.round(clamp01(px.a) * 255);
    }
  }
  return { width: wPx, height: hPx, data };
}

interface Pixel {
  c: RGB;
  a: number;
  ix: number;
  iy: number;
}
type Shader = (u: number, v: number, px: Pixel) => void;

/** Micro-grain from a real SVG asset, sampled at an exact integer step so it tiles. */
function grainSampler(spec: TextureSpec, grains: GrainSet | undefined, wPx: number): ((ix: number, iy: number) => number) | null {
  const id = GRAIN_FOR[spec.material];
  const g = id ? grains?.get(id) : undefined;
  if (!g) return null;
  const step = g.size / wPx;
  if (!Number.isInteger(step) || step < 1) return null;
  const amp = spec.kind === 'ground' || spec.kind === 'green' || spec.kind === 'wood' ? 0.09 : 0.07;
  return (ix, iy) => g.data[mod(iy * step, g.size) * g.size + mod(ix * step, g.size)] * amp;
}

function shaderFor(spec: TextureSpec): Shader {
  switch (spec.kind) {
    case 'road':
      return withGutter(spec, withWet(spec, roadShader(spec)));
    case 'walk':
    case 'plaza':
      return walkShader(spec);
    case 'ground':
      return groundShader(spec);
    case 'green':
      return withAccent(spec, greenShader(spec));
    case 'wood':
      return woodShader(spec);
    case 'lamps':
      return lampShader(spec);
  }
}

// --- Roads -------------------------------------------------------------------

function roadShader(spec: TextureSpec): Shader {
  switch (spec.material) {
    case 'granite_setts':
      return setts(spec, 6, 32 / 3, 0.9, [0.8, 0.34]);
    case 'cobbles':
      return cobbles(spec, 8);
    case 'flagstone':
      return flagstone(spec, 13);
    case 'brick_pavers':
      return bricks(spec, 12.8, 6.4);
    case 'glazed_tiles':
      return tiles(spec, 6.4);
    case 'limestone':
      return slabs(spec, 16, 32 / 3, 0.6, 'limestone');
    case 'paper_sketch':
      return paper(spec);
    default:
      return asphalt(spec);
  }
}

function asphalt(spec: TextureSpec): Shader {
  const { width: W, height: H, scale, wear } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const aged = spec.material === 'aged_asphalt';
  let albedo = rgb(spec.base);
  if (aged) albedo = mix(albedo, [0.55, 0.55, 0.55], lum(albedo) > 0.7 ? 0.12 : 0.18);
  const nU = cellsIn(W, 5 * scale);
  const nV = cellsIn(H, 5 * scale);
  const cU = cellsIn(W, 22 * scale);
  const cV = cellsIn(H, 22 * scale);
  const pU = cellsIn(W, 26);
  const pV = cellsIn(H, 14);
  const vh: VoronoiHit = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const track = H * 0.22;
  return (u, v, px) => {
    const n = fbm((u / W) * nU, (v / H) * nV, nU, nV, seed, 3);
    let c = mul(albedo, 0.93 + 0.14 * (n - 0.5) * 2);
    const sp = hash2(px.ix, px.iy, seed + 3);
    if (sp > 0.965) c = mix(c, [1, 1, 1], 0.16);
    else if (sp < 0.035) c = mul(c, 0.82);
    if (wear > 0) {
      // Tire tracks run with traffic, both lanes.
      const d1 = v - (H / 2 - track);
      const d2 = v - (H / 2 + track);
      const band = Math.exp(-(d1 * d1) / 7) + Math.exp(-(d2 * d2) / 7);
      c = mul(c, 1 - 0.1 * wear * band * (0.6 + 0.8 * n));
      // Utility-cut patches: crisp rectangles of fresher asphalt.
      const pu = Math.floor((u / W) * pU);
      const pv = Math.floor((v / H) * pV);
      if (hash2(mod(pu, pU), pv, seed + 11) < wear * 0.28) {
        const lu = fract((u / W) * pU) - 0.5;
        const lv = fract((v / H) * pV) - 0.5;
        const d = sdRoundRect(lu, lv, 0.36, 0.33, 0.02);
        if (d < 0) c = mix(c, mul(albedo, 0.86), 0.8);
        else if (d < 0.03) c = mul(c, 0.75);
      }
      // Cracks along a coarse Voronoi net, masked so they wander.
      voronoi((u / W) * cU, (v / H) * cV, cU, cV, 0.9, seed + 21, vh);
      const edge = vh.f2 - vh.f1;
      const mask = smoothstep(0.5, 0.68, fbm((u / W) * nU * 0.5, (v / H) * nV * 0.5, Math.max(1, nU >> 1), Math.max(1, nV >> 1), seed + 31, 2));
      const crack = (1 - smoothstep(0.015, 0.05, edge)) * mask * Math.min(1, wear * 1.3);
      c = mix(c, mul(albedo, 0.35), crack);
    }
    px.c = c;
    px.a = 0.96;
  };
}

/** Granite setts: courses laid across the carriageway, stones staggered by half. */
function setts(spec: TextureSpec, course: number, length: number, mortar: number, tone: [number, number]): Shader {
  const { width: W, height: H, scale, wear } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const albedo = mix(rgb(spec.base), [0.45, 0.47, 0.5], lum(rgb(spec.base)) > 0.8 ? 0.42 : 0.28);
  const nC = cellsIn(W, course * scale);
  const nS = cellsIn(H, length * scale);
  const cw = W / nC;
  const sl = H / nS;
  const joint = mul(albedo, 0.42);
  const moss = mix(joint, rgb(spec.park), 0.35 * wear);
  const nU = cellsIn(W, 3);
  const nV = cellsIn(H, 3);
  return (u, v, px) => {
    const ci = Math.floor(u / cw);
    const vv = mod(v + (ci & 1 ? sl / 2 : 0), H);
    const si = Math.floor(vv / sl);
    const lu = u - ci * cw - cw / 2;
    const lv = vv - si * sl - sl / 2;
    const h = hash2(mod(ci, nC), mod(si, nS), seed);
    const h2 = hash2(mod(ci, nC), mod(si, nS), seed + 5);
    const r = 0.8 + wear * 1.6 * h2;
    const d = sdRoundRect(lu, lv, cw / 2 - mortar / 2, sl / 2 - mortar / 2, Math.min(r, cw / 2 - 0.6));
    let stone = mul(mix(albedo, h2 > 0.5 ? [0.62, 0.55, 0.48] : [0.45, 0.5, 0.56], 0.12), tone[0] + tone[1] * h);
    if (h < wear * 0.2) stone = mul(stone, 0.82);
    const len = Math.hypot(lu, lv) || 1;
    const facing = (lu / len) * LIGHT_DIR[0] + (lv / len) * LIGHT_DIR[1];
    const rim = smoothstep(-1.8, -0.2, d);
    stone = mul(stone, 1 + rim * (facing > 0 ? 0.18 : -0.14) * Math.abs(facing));
    stone = mul(stone, 0.95 + 0.1 * fbm((u / W) * nU, (v / H) * nV, nU, nV, seed + 9, 2));
    px.c = mix(stone, moss, smoothstep(-0.45, 0.45, d));
    px.a = 0.96;
  };
}

/** Illustrated cobbles: rounded stones with a dome highlight and an ink outline. */
function cobbles(spec: TextureSpec, size: number): Shader {
  const { width: W, height: H, scale, wear } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const base = rgb(spec.base);
  const albedo = mix(base, [0.55, 0.47, 0.4], lum(base) > 0.8 ? 0.45 : 0.3);
  const hues: RGB[] = [albedo, mix(albedo, [0.69, 0.49, 0.33], 0.25), mix(albedo, [0.49, 0.54, 0.6], 0.22)];
  const ink = rgb(spec.ink);
  const nU = cellsIn(W, size * scale);
  const nV = cellsIn(H, size * scale);
  const cell = W / nU;
  const joint = mix(mul(albedo, 0.45), rgb(spec.park), 0.2 * wear);
  const vh: VoronoiHit = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  return (u, v, px) => {
    voronoi((u / W) * nU, (v / H) * nV, nU, nV, 0.72, seed, vh);
    const e = (vh.f2 - vh.f1) * cell;
    const h = hash2(vh.id, 0, seed + 3);
    let stone = mul(hues[Math.floor(h * 3) % 3], 0.85 + 0.25 * hash2(vh.id, 1, seed));
    if (h < wear * 0.18) stone = mul(stone, 0.8);
    const dome = 1 - 0.45 * Math.min(1, (vh.f1 / 0.6) ** 2);
    stone = mul(stone, 0.8 + 0.3 * dome);
    const hl = Math.max(0, 1 - Math.hypot(vh.dx + 0.16, vh.dy + 0.2) / 0.2);
    stone = add(stone, [1, 1, 1], 0.22 * hl);
    const outline = smoothstep(0.35, 0.8, e) * (1 - smoothstep(1.1, 1.7, e));
    stone = mix(stone, ink, 0.55 * outline);
    px.c = mix(joint, stone, smoothstep(0.35, 0.8, e));
    px.a = 0.96;
  };
}

/** Irregular flagstones with mossy joints. */
function flagstone(spec: TextureSpec, size: number): Shader {
  const { width: W, height: H, scale, wear } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const albedo = mix(rgb(spec.base), [0.6, 0.55, 0.46], 0.35);
  const nU = cellsIn(W, size * scale);
  const nV = cellsIn(H, size * scale);
  const cell = W / nU;
  const joint = mix(mul(albedo, 0.5), mul(rgb(spec.park), 0.75), 0.45 + 0.45 * wear);
  const mU = cellsIn(W, 6);
  const mV = cellsIn(H, 6);
  const vh: VoronoiHit = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  return (u, v, px) => {
    voronoi((u / W) * nU, (v / H) * nV, nU, nV, 1, seed, vh);
    const e = (vh.f2 - vh.f1) * cell;
    const h = hash2(vh.id, 0, seed + 1);
    const mottle = fbm((u / W) * mU, (v / H) * mV, mU, mV, seed + 4, 3);
    let slab = mul(mix(albedo, h > 0.5 ? [0.66, 0.58, 0.45] : [0.5, 0.53, 0.5], 0.2), 0.86 + 0.22 * h);
    slab = mul(slab, 0.9 + 0.2 * mottle);
    px.c = mix(joint, slab, smoothstep(0.7, 1.5, e));
    px.a = 0.96;
  };
}

/** Running-bond brick pavers, long side along the street. */
function bricks(spec: TextureSpec, length: number, depth: number): Shader {
  const { width: W, height: H, scale, wear } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const brick = mix(rgb(spec.base), [0.64, 0.33, 0.23], 0.6);
  const mortar = mix(rgb(spec.base), [0.85, 0.81, 0.75], 0.6);
  const nL = cellsIn(W, length * scale);
  const nD = cellsIn(H, depth * scale);
  const bl = W / nL;
  const bh = H / nD;
  return (u, v, px) => {
    const row = Math.floor(v / bh);
    const uu = mod(u + (row & 1 ? bl / 2 : 0), W);
    const col = Math.floor(uu / bl);
    const lu = uu - col * bl - bl / 2;
    const lv = v - row * bh - bh / 2;
    const h = hash2(mod(col, nL), mod(row, 1 << 12), seed);
    const d = sdRoundRect(lu, lv, bl / 2 - 0.45, bh / 2 - 0.45, 0.5 + wear * 0.6);
    let c = mul(mix(brick, h > 0.6 ? [0.5, 0.25, 0.18] : [0.75, 0.45, 0.32], 0.25), 0.86 + 0.26 * h);
    if (h < wear * 0.15) c = mul(c, 0.78);
    px.c = mix(c, mortar, smoothstep(-0.35, 0.35, d));
    px.a = 0.96;
  };
}

/** Glazed tile mosaic drawn from the scene's own palette, with a glossy streak. */
function tiles(spec: TextureSpec, size: number): Shader {
  const { width: W, height: H, scale } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const base = rgb(spec.base);
  const colors = (spec.mosaic.length ? spec.mosaic : [spec.base]).map((h) => mix(rgb(h), base, 0.12));
  const grout = mix(base, [1, 1, 1], 0.55);
  const nU = cellsIn(W, size * scale);
  const nV = cellsIn(H, size * scale);
  const tu = W / nU;
  const tv = H / nV;
  return (u, v, px) => {
    const iu = Math.floor(u / tu);
    const iv = Math.floor(v / tv);
    const lu = u - iu * tu - tu / 2;
    const lv = v - iv * tv - tv / 2;
    const h = hash2(mod(iu, nU), mod(iv, nV), seed);
    let c = mul(colors[Math.floor(h * colors.length) % colors.length], 0.94 + 0.12 * hash2(mod(iu, nU), mod(iv, nV), seed + 2));
    const gloss = 1 - smoothstep(0, tu * 0.18, Math.abs(lu + lv + tu * 0.12));
    c = add(c, [1, 1, 1], 0.2 * gloss);
    const d = sdRoundRect(lu, lv, tu / 2 - 0.4, tv / 2 - 0.4, 0.7);
    px.c = mix(c, grout, smoothstep(-0.3, 0.3, d));
    px.a = 0.96;
  };
}

/** Large rectangular slabs with offset rows (limestone streets, granite flags). */
function slabs(spec: TextureSpec, length: number, depth: number, joint: number, look: 'limestone' | 'granite'): Shader {
  const { width: W, height: H, scale, wear } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const albedo = look === 'limestone' ? mix(rgb(spec.base), [0.91, 0.87, 0.79], 0.45) : mix(rgb(spec.base), [0.52, 0.54, 0.56], 0.45);
  const jointC = mul(albedo, look === 'limestone' ? 0.72 : 0.5);
  const nL = cellsIn(W, length * scale);
  const nD = cellsIn(H, depth * scale);
  const sw = W / nL;
  const sh = H / nD;
  const mU = cellsIn(W, 5);
  const mV = cellsIn(H, 5);
  return (u, v, px) => {
    const row = Math.floor(v / sh);
    const uu = mod(u + fract(row * 0.37) * sw, W);
    const col = Math.floor(uu / sw);
    const lu = uu - col * sw - sw / 2;
    const lv = v - row * sh - sh / 2;
    const h = hash2(mod(col, nL), mod(row, 4096), seed);
    let c = mul(albedo, 0.92 + 0.12 * h);
    c = mul(c, 0.95 + 0.1 * fbm((u / W) * mU, (v / H) * mV, mU, mV, seed + 3, 3));
    if (hash2(px.ix, px.iy, seed + 9) > 0.993) c = mul(c, 0.8);
    const d = sdRoundRect(lu, lv, sw / 2 - joint / 2, sh / 2 - joint / 2, 0.3 + wear);
    px.c = mix(c, jointC, smoothstep(-0.3, 0.3, d));
    px.a = 0.96;
  };
}

/** Paper atlas: grainy paper with broken pencil hatching (and cross-hatching in patches). */
function paper(spec: TextureSpec): Shader {
  const { width: W, height: H, scale } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}:${spec.variant}`);
  const paperC = mix(rgb(spec.base), [0.96, 0.93, 0.85], 0.5);
  const ink = rgb(spec.ink);
  const p = W / cellsIn(W, 4.5 * scale);
  const nU = cellsIn(W, 8);
  const nV = cellsIn(H, 8);
  const fU = cellsIn(W, 2);
  const fV = cellsIn(H, 12);
  return (u, v, px) => {
    const fibre = fbm((u / W) * fU, (v / H) * fV, fU, fV, seed + 2, 2);
    let c = mul(paperC, 0.95 + 0.08 * fibre);
    const broken = smoothstep(0.38, 0.5, fbm((u / W) * nU, (v / H) * nV, nU, nV, seed, 3));
    const l1 = 1 - smoothstep(0.05, 0.14, Math.abs(fract((u + v) / p) - 0.5));
    const cross = smoothstep(0.58, 0.66, fbm((u / W) * nU, (v / H) * nV, nU, nV, seed + 7, 2));
    const l2 = (1 - smoothstep(0.05, 0.14, Math.abs(fract((u - v) / p) - 0.5))) * cross;
    c = mix(c, ink, 0.32 * Math.max(l1 * broken, l2));
    px.c = c;
    px.a = 0.95;
  };
}

/** Wet streets: darker, with streaks running with traffic and puddles that mirror the sky/neon. */
function withWet(spec: TextureSpec, inner: Shader): Shader {
  if (spec.wet <= 0) return inner;
  const { width: W, height: H, wet } = spec;
  const seed = seedOf(`wet:${spec.variant}`);
  const sU = cellsIn(W, 20);
  const sV = cellsIn(H, 2.2);
  const pU = cellsIn(W, 14);
  const pV = cellsIn(H, 9);
  const A = rgb(spec.accentA);
  const B = rgb(spec.accentB);
  const sky = mix(rgb(spec.sky), rgb(spec.light), 0.4);
  const reflOf = (u: number): RGB =>
    spec.reflection === 'neon' ? (hash2(mod(Math.floor(u / (W / 2)), 2), 0, seed) < 0.5 ? A : B) : spec.reflection === 'warm' ? A : sky;
  return (u, v, px) => {
    inner(u, v, px);
    let c = mul(px.c, 1 - 0.45 * wet);
    const refl = reflOf(u);
    const streak = smoothstep(0.6, 0.95, vnoise((u / W) * sU, (v / H) * sV, sU, sV, seed)) * wet;
    c = mix(c, refl, 0.7 * streak);
    const puddle = smoothstep(0.64, 0.7, fbm((u / W) * pU, (v / H) * pV, pU, pV, seed + 9, 3)) * wet;
    const pc = mix(mul(c, 0.55), refl, 0.3 + 0.35 * (1 - v / H));
    c = mix(c, pc, 0.9 * puddle);
    if (hash2(px.ix, px.iy, seed + 4) > 0.994) c = mix(c, rgb(spec.light), 0.7 * wet);
    px.c = c;
  };
}

/**
 * Line patterns span curb to curb (MapLibre maps the full pattern height onto
 * the line width), so the top and bottom rows are the real road edges:
 * a dark gutter and a light curb lip, at every zoom.
 */
function withGutter(spec: TextureSpec, inner: Shader): Shader {
  const { height: H } = spec;
  const lip = rgb(spec.night ? '#9aa0a8' : '#f2efe8');
  return (u, v, px) => {
    inner(u, v, px);
    const e = Math.min(v, H - v) / H;
    if (e < 0.035) px.c = mix(px.c, lip, 0.45);
    else if (e < 0.1) px.c = mul(px.c, 0.78 + 0.22 * smoothstep(0.035, 0.1, e));
  };
}

// --- Sidewalks, footpaths and plazas ----------------------------------------

function walkShader(spec: TextureSpec): Shader {
  const { width: W, height: H } = spec;
  const seed = seedOf(`${spec.material}:${spec.kind}`);
  switch (spec.material) {
    case 'brick_bond':
      return bricks(spec, 8, 4);
    case 'granite_flags':
      return slabs(spec, 16, 8, 0.6, 'granite');
    case 'mosaic_tiles':
      return tiles(spec, 4);
    case 'boardwalk': {
      const wood = mix(rgb(spec.base), [0.6, 0.42, 0.27], 0.65);
      const nP = cellsIn(W, 5.3 * spec.scale);
      const pw = W / nP;
      const gU = cellsIn(W, 1.5);
      const gV = cellsIn(H, 10);
      return (u, v, px) => {
        const i = Math.floor(u / pw);
        const lu = u - i * pw;
        const h = hash2(mod(i, nP), 0, seed);
        let c = mul(wood, 0.85 + 0.25 * h);
        c = mul(c, 0.9 + 0.18 * fbm((u / W) * gU, (v / H) * gV, gU, gV, seed + i, 2));
        const nail = Math.min(Math.hypot(lu - pw / 2, v - H * 0.22), Math.hypot(lu - pw / 2, v - H * 0.78)) < 0.7;
        if (nail) c = mul(c, 0.55);
        px.c = lu < 0.8 ? mul(wood, 0.4) : c;
        px.a = 0.97;
      };
    }
    case 'sketch_dots': {
      const ink = rgb(spec.ink);
      const paperC = mix(rgb(spec.base), [0.96, 0.93, 0.85], 0.5);
      const step = W / cellsIn(W, 5);
      return (u, v, px) => {
        const d = Math.hypot(mod(u, step) - step / 2, v - H / 2);
        const dot = 1 - smoothstep(2, 3, d);
        px.c = mix(paperC, ink, dot);
        px.a = 0.35 + 0.6 * dot;
      };
    }
    case 'glow_dots': {
      const glow = rgb(spec.accentB);
      const step = W / cellsIn(W, 6);
      return (u, v, px) => {
        const d = Math.hypot(mod(u, step) - step / 2, v - H / 2);
        const g = Math.exp(-(d * d) / 8);
        px.c = mix([0.06, 0.05, 0.12], glow, Math.min(1, g * 1.4));
        px.a = 0.45 + 0.55 * g;
      };
    }
    case 'fine_dashes': {
      const ink = rgb(spec.ink);
      const step = W / cellsIn(W, 6);
      return (u, v, px) => {
        const on = mod(u, step) < step / 2 && Math.abs(v - H / 2) < 1.6;
        px.c = ink;
        px.a = on ? 0.8 : 0;
      };
    }
    default: {
      // Scored concrete slabs.
      const albedo = mix(rgb(spec.base), [0.8, 0.79, 0.76], 0.35);
      const n = cellsIn(W, 16 * spec.scale);
      const s = W / n;
      const nv = cellsIn(H, 16 * spec.scale);
      const sv = H / nv;
      return (u, v, px) => {
        const iu = Math.floor(u / s);
        const iv = Math.floor(v / sv);
        const lu = u - iu * s - s / 2;
        const lv = v - iv * sv - sv / 2;
        const h = hash2(mod(iu, n), mod(iv, nv), seed);
        let c = mul(albedo, 0.94 + 0.08 * h);
        if (spec.wear > 0.5 && hash2(px.ix, px.iy, seed + 2) > 0.996) c = mul(c, 0.7);
        const d = sdRoundRect(lu, lv, s / 2 - 0.35, sv / 2 - 0.35, 0.2);
        px.c = mix(c, mul(albedo, 0.62), smoothstep(-0.25, 0.25, d));
        px.a = 0.95;
      };
    }
  }
}

// --- Open ground -------------------------------------------------------------

function groundShader(spec: TextureSpec): Shader {
  const { width: W, height: H } = spec;
  const seed = seedOf(`${spec.material}:ground`);
  const land = rgb(spec.base);
  const ink = rgb(spec.ink);
  const n8 = cellsIn(W, 10);
  const n3 = cellsIn(W, 32);
  switch (spec.material) {
    case 'dark_grain':
      return (u, v, px) => {
        let c = mul(land, 0.9 + 0.2 * fbm((u / W) * n8, (v / H) * n8, n8, n8, seed, 3));
        if (hash2(px.ix, px.iy, seed + 1) > 0.996) c = mix(c, rgb(spec.light), 0.45);
        px.c = c;
      };
    case 'paper_grain':
      return (u, v, px) => {
        const fibre = fbm((u / W) * n3, (v / H) * n8 * 2, n3, n8 * 2, seed, 3);
        const mottle = fbm((u / W) * n3, (v / H) * n3, n3, n3, seed + 3, 3);
        px.c = mul(land, 0.94 + 0.06 * fibre + 0.06 * mottle);
      };
    case 'sand_grain':
      return (u, v, px) => {
        const h = hash2(px.ix, px.iy, seed);
        let c = mul(land, 0.95 + 0.08 * fbm((u / W) * n8, (v / H) * n8, n8, n8, seed + 2, 3));
        if (h > 0.9) c = mix(c, [0.72, 0.6, 0.45], 0.25);
        else if (h < 0.08) c = mix(c, [1, 0.97, 0.9], 0.3);
        px.c = c;
      };
    case 'stucco':
      return (u, v, px) => {
        const n = fbm((u / W) * n3 * 2, (v / H) * n3 * 2, n3 * 2, n3 * 2, seed, 4);
        const ridge = 1 - Math.abs(n - 0.5) * 2;
        px.c = mul(land, 0.93 + 0.1 * ridge);
      };
    case 'topo_lines':
      return (u, v, px) => {
        const t = fbm((u / W) * n3 * 0.5, (v / H) * n3 * 0.5, Math.max(1, n3 >> 1), Math.max(1, n3 >> 1), seed, 3) * 9;
        const level = Math.floor(t);
        const d = Math.abs(fract(t) - 0.5);
        const line = smoothstep(0.455, 0.49, d);
        const isIndex = mod(level, 4) === 0;
        let c = mul(land, 0.97 + 0.05 * fbm((u / W) * n8, (v / H) * n8, n8, n8, seed + 2, 2));
        c = mix(c, ink, line * (isIndex ? 0.3 : 0.16));
        px.c = c;
      };
    default:
      // Concrete grain with pores.
      return (u, v, px) => {
        let c = mul(land, 0.95 + 0.1 * fbm((u / W) * n8, (v / H) * n8, n8, n8, seed, 3));
        if (hash2(px.ix, px.iy, seed + 1) > 0.985) c = mul(c, 0.86);
        px.c = c;
      };
  }
}

// --- Parks and woods -----------------------------------------------------------

function greenShader(spec: TextureSpec): Shader {
  const { width: W, height: H } = spec;
  const seed = seedOf(`${spec.material}:green`);
  const park = rgb(spec.base);
  const nb = cellsIn(W, 1.6);
  const n4 = cellsIn(W, 30);
  const n6 = cellsIn(W, 20);
  switch (spec.material) {
    case 'lush_blades':
      return (u, v, px) => {
        const blade = vnoise((u / W) * nb, (v / H) * nb * 0.35, nb, Math.max(1, Math.round(nb * 0.35)), seed);
        const clump = fbm((u / W) * n6, (v / H) * n6, n6, n6, seed + 3, 3);
        let c = mul(park, 0.82 + 0.28 * blade);
        c = mul(c, 0.85 + 0.25 * clump);
        px.c = c;
      };
    case 'watercolor':
      return (u, v, px) => {
        const f = fbm((u / W) * n4, (v / H) * n4, n4, n4, seed, 4);
        const light = mix(park, [1, 1, 0.92], 0.18);
        const dark = mul(park, 0.82);
        let c = mix(dark, light, smoothstep(0.44, 0.56, f));
        const rim = 1 - smoothstep(0.004, 0.022, Math.abs(f - 0.5));
        c = mix(c, mul(park, 0.62), 0.6 * rim);
        if (hash2(px.ix, px.iy, seed + 1) > 0.97) c = mul(c, 0.94);
        px.c = c;
      };
    case 'soft_dapple':
      return (u, v, px) => {
        const d = fbm((u / W) * n6, (v / H) * n6, n6, n6, seed, 4);
        let c = mix(park, mix(park, rgb(spec.light), 0.45), smoothstep(0.56, 0.74, d) * 0.6);
        c = mul(c, 1 - 0.18 * smoothstep(0.42, 0.28, d));
        px.c = c;
      };
    default:
      // Grainy short grass.
      return (u, v, px) => {
        const blade = vnoise((u / W) * nb, (v / H) * nb * 0.5, nb, Math.max(1, Math.round(nb * 0.5)), seed);
        let c = mul(park, 0.9 + 0.18 * blade);
        const h = hash2(px.ix, px.iy, seed + 1);
        if (h > 0.985) c = mix(c, [1, 1, 0.85], 0.25);
        px.c = c;
      };
  }
}

const FLOWER_COLORS: RGB[] = ['#ff8fb1', '#ffffff', '#ffd166', '#c49bff'].map(rgb);
const WILD_COLORS: RGB[] = ['#e63946', '#f4a261', '#ffd166', '#9b5de5', '#4cc9f0', '#ffffff'].map(rgb);
const LEAF_COLORS: RGB[] = ['#d9822b', '#b5441b', '#e6b43c', '#8c3b1e'].map(rgb);

/** Scattered ground details: flowers, blossoms, fallen leaves, frost, fireflies. */
function withAccent(spec: TextureSpec, inner: Shader): Shader {
  if (spec.accent === 'none') return inner;
  const { width: W, height: H } = spec;
  const seed = seedOf(`accent:${spec.accent}`);
  const cs = W / cellsIn(W, spec.accent === 'fireflies' ? 18 : 9);
  const nc = Math.round(W / cs);
  const ncv = Math.max(1, Math.round(H / cs));
  const density = spec.accent === 'frost' ? 0 : spec.accent === 'fireflies' ? 0.35 : spec.accent === 'flowers' ? 0.3 : spec.accent === 'wildflowers' ? 0.7 : 0.45;
  const nF = cellsIn(W, 24);
  return (u, v, px) => {
    inner(u, v, px);
    if (spec.accent === 'frost') {
      const f = fbm((u / W) * nF, (v / H) * nF, nF, nF, seed, 3);
      px.c = mix(px.c, [0.93, 0.96, 1], 0.45 * smoothstep(0.5, 0.7, f));
      if (hash2(px.ix, px.iy, seed + 2) > 0.985) px.c = mix(px.c, [1, 1, 1], 0.8);
      return;
    }
    const iu = Math.floor(u / cs);
    const iv = Math.floor(v / cs);
    const wu = mod(iu, nc);
    const wv = mod(iv, ncv);
    if (hash2(wu, wv, seed) > density) return;
    const cx = (iu + 0.3 + 0.4 * hash2(wu, wv, seed + 1)) * cs;
    const cy = (iv + 0.3 + 0.4 * hash2(wu, wv, seed + 2)) * cs;
    const dx = u - cx;
    const dy = v - cy;
    const r = Math.hypot(dx, dy);
    const h = hash2(wu, wv, seed + 3);
    switch (spec.accent) {
      case 'flowers':
      case 'wildflowers':
      case 'blossoms': {
        const wild = spec.accent === 'wildflowers';
        const floret = spec.accent !== 'blossoms';
        const rad = wild ? 1.6 + 1.4 * hash2(wu, wv, seed + 5) : floret ? 1.6 : 1.4;
        const petal = r < rad * (0.62 + 0.38 * Math.cos((wild ? 6 : 5) * Math.atan2(dy, dx) + h * 6));
        const palette = wild ? WILD_COLORS : FLOWER_COLORS;
        const color = floret ? palette[Math.floor(h * palette.length) % palette.length] : mix(rgb('#ffc2d6'), [1, 1, 1], h * 0.4);
        if (r < rad * 0.3) px.c = floret ? rgb('#ffcf4d') : rgb('#f48fb1');
        else if (petal) px.c = color;
        break;
      }
      case 'leaves': {
        const ang = h * Math.PI;
        const lx = dx * Math.cos(ang) + dy * Math.sin(ang);
        const ly = -dx * Math.sin(ang) + dy * Math.cos(ang);
        if ((lx / 2.3) ** 2 + (ly / 1.1) ** 2 < 1) px.c = LEAF_COLORS[Math.floor(h * 4) % 4];
        break;
      }
      case 'fireflies': {
        const g = Math.exp(-(r * r) / 1.4);
        px.c = mix(px.c, rgb('#d7ff7a'), Math.min(1, g * 1.3));
        break;
      }
    }
  };
}

function woodShader(spec: TextureSpec): Shader {
  const { width: W, height: H } = spec;
  const seed = seedOf(`${spec.material}:wood`);
  const wood = rgb(spec.base);
  const n = cellsIn(W, (spec.material === 'dense_canopy' ? 6.4 : 9) * spec.scale);
  const cell = W / n;
  const sparse = spec.material === 'sparse_canopy';
  const vh: VoronoiHit = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  return (u, v, px) => {
    voronoi((u / W) * n, (v / H) * n, n, n, 0.8, seed, vh);
    const keep = !sparse || hash2(vh.id, 0, seed + 1) < 0.5;
    const rad = 0.42 + 0.12 * hash2(vh.id, 2, seed);
    const gap = mul(wood, sparse ? 0.95 : 0.62);
    if (!keep || vh.f1 > rad) {
      px.c = gap;
      return;
    }
    const lit = 0.5 - (vh.dx * LIGHT_DIR[0] + vh.dy * LIGHT_DIR[1]) / (rad * 2);
    let c = mul(mix(wood, hash2(vh.id, 3, seed) > 0.5 ? [0.3, 0.5, 0.25] : [0.45, 0.6, 0.3], 0.15), 0.78 + 0.45 * lit);
    const rim = smoothstep(rad - 1 / cell, rad, vh.f1);
    c = mix(c, mul(wood, 0.5), 0.6 * rim);
    px.c = c;
  };
}

// --- Street lamps --------------------------------------------------------------

/** Light pools repeating along every street; neon alternates two colors. */
function lampShader(spec: TextureSpec): Shader {
  const { width: W, height: H } = spec;
  const neon = spec.material === 'neon';
  const colorA = rgb(neon ? spec.accentA : spec.material === 'cold_white' ? '#e3f0ff' : '#ffb347');
  const colorB = neon ? rgb(spec.accentB) : colorA;
  // The image width is fixed (in-place updates need a constant size), so spacing comes from pools per tile.
  const pools = spec.material === 'sparse_amber' ? 1 : 2;
  const step = W / pools;
  return (u, v, px) => {
    const i = Math.floor(u / step);
    const du = u - (i + 0.5) * step;
    const dv = v - H / 2;
    const g = Math.exp(-(du * du) / (2 * (H * 0.42) ** 2) - (dv * dv) / (2 * (H * 0.3) ** 2));
    px.c = i % 2 ? colorB : colorA;
    px.a = 0.55 * g;
  };
}
