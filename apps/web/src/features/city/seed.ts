/**
 * Deterministic randomness for the city engine. Planners and renderers use only
 * these (never an unseeded random source), so the same SceneState + seed always draws the same city.
 *
 * Rule for spatial placement (keeps the city stable while a vibe evolves):
 * an instance with stable identity `id` (OSM feature ID, grid cell, …) exists iff
 * `unitHash(seed, id) < density`. Raising density only ever ADDS instances, and
 * lowering it only removes them; nothing jumps when another answer arrives.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** uint32 from any parts (FNV-1a over their string form, then avalanche). */
export function hashSeed(...parts: ReadonlyArray<string | number>): number {
  let h = FNV_OFFSET;
  const text = parts.join('␟');
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), FNV_PRIME);
  return avalanche(h);
}

/** Finalizer from murmur3: small input changes flip about half of the bits. */
function avalanche(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A child seed: independent streams for sections, treatments, cells. */
export const subSeed = (seed: number, label: string | number): number => hashSeed(seed >>> 0, label);

/** Stable value in [0, 1) for an identity under a seed. */
export const unitHash = (seed: number, id: string | number): number => subSeed(seed, id) / 0x1_0000_0000;

/** Normalize anything to a uint32 seed (non-numbers hash; numbers truncate). */
export function toSeed(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value) >>> 0;
  return value === undefined || value === null ? 0 : hashSeed(String(value));
}

/** Seeded PRNG (mulberry32): a deterministic sequence in [0, 1). */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
