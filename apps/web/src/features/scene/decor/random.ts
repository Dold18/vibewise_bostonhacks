/**
 * Deterministic randomness. Every procedural decision derives from
 * `hashSeed(sessionSeed, …stable keys)` so the same seed, scene and map data
 * always produce the same world, independent of camera or call order.
 */

/** 32-bit FNV-1a over the joined parts, finalized with a murmur-style avalanche. */
export function hashSeed(...parts: ReadonlyArray<string | number>): number {
  let h = 0x811c9dc5;
  const text = parts.join('␟');
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32: small, fast, good enough for layout decisions. Returns [0, 1). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable uniform in [0,1) for a key: no sequence state, so order never matters. */
export const unit = (...parts: ReadonlyArray<string | number>) => hashSeed(...parts) / 4294967296;

export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, r: number): T | undefined {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return undefined;
  let target = r * total;
  for (const item of items) {
    target -= Math.max(0, weight(item));
    if (target < 0) return item;
  }
  return items[items.length - 1];
}

/** Log-uniform sample in [min, max]: natural-looking size variety without a dominant "default" size. */
export const logUniform = (min: number, max: number, r: number) => Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * r);

/** Approximately normal (Irwin–Hall, 4 draws), mean 0, sd ≈ 1. */
export const gaussian = (next: Rng) => (next() + next() + next() + next() - 2) * Math.sqrt(3);
