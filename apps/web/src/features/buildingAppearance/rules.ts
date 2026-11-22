/**
 * Deterministic procedural rules: which facade / roof treatment each real
 * building receives. Pure functions — same seed + same building = same result,
 * independent of tile load order, camera or frame.
 */
import type { BuildingAppearance } from './contract';

/** 32-bit FNV-1a. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer avalanche (lowbias32). */
export function mix32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Uniform [0, 1) from a hash and a stream index. */
export const unit = (h: number, stream: number) => mix32((h ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0) / 4294967296;

export interface BuildingFacts {
  /** Stable identity: the OSM id when present, else a rounded-geometry key. */
  key: string;
  /** Real building height in metres (render_height). */
  height: number;
  /** Footprint area in m². */
  area: number;
  /** Footprint centroid in metres on a global grid (spherical mercator metres). */
  cx: number;
  cy: number;
}

export interface Assignment {
  facade: number;
  roof: number;
  /** Per-building random in [0, 1) for shader-side variation (window lighting, jitter). */
  seed: number;
  /** Signed colour jitter in [-1, 1]. */
  jitter: number;
  /** Storey-height offset in metres. */
  floorOffset: number;
}

const inRange = (v: number, r?: [number, number]) => !r || (v >= r[0] && v < r[1]);

function weightedPick<T extends { weight: number }>(items: readonly T[], candidates: readonly number[], r: number): number {
  let total = 0;
  for (const i of candidates) total += Math.max(0, items[i]!.weight);
  if (total <= 0) return candidates[Math.floor(r * candidates.length)] ?? 0;
  let acc = r * total;
  for (const i of candidates) {
    acc -= Math.max(0, items[i]!.weight);
    if (acc < 0) return i;
  }
  return candidates[candidates.length - 1]!;
}

/** Indices of facades eligible by the building's height and footprint; all when none match. */
export function eligibleFacades(appearance: BuildingAppearance, b: Pick<BuildingFacts, 'height' | 'area'>): number[] {
  const out: number[] = [];
  appearance.facades.forEach((f, i) => {
    if (inRange(b.height, f.heightRange) && inRange(b.area, f.footprintRange)) out.push(i);
  });
  return out.length ? out : appearance.facades.map((_, i) => i);
}

export function assignBuilding(appearance: BuildingAppearance, b: BuildingFacts): Assignment {
  const v = appearance.variation;
  const seedHash = hashString(v.seed);
  const own = mix32(hashString(b.key) ^ seedHash);
  let pickHash = own;
  if (v.districtSize > 0 && unit(own, 7) < v.districtCoherence) {
    const gx = Math.floor(b.cx / v.districtSize);
    const gy = Math.floor(b.cy / v.districtSize);
    pickHash = mix32(hashString(`${gx},${gy}`) ^ seedHash);
  }
  const facades = appearance.facades;
  const facade = facades.length ? weightedPick(facades, eligibleFacades(appearance, b), unit(pickHash, 1)) : 0;
  const pinnedRoof = facades[facade]?.roof;
  const roofs = appearance.roofs;
  const roof =
    pinnedRoof !== undefined
      ? pinnedRoof
      : roofs.length
        ? weightedPick(roofs, roofs.map((_, i) => i), unit(pickHash, 2))
        : 0;
  return {
    facade,
    roof,
    seed: unit(own, 3),
    jitter: (unit(own, 4) * 2 - 1) * v.colorJitter,
    floorOffset: (unit(own, 5) * 2 - 1) * v.floorJitter,
  };
}
