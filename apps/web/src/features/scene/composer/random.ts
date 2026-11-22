/**
 * Deterministic randomness for composition. Nothing here reads Math.random or
 * time: every value is a pure function of the session seed and a label, so a
 * session's world is reproducible and undo restores it exactly.
 */
import { hashString } from '../state';

/** 32-bit unsigned hash of any string (first half of the scene hash). */
export const hash32 = (text: string): number => parseInt(hashString(text).slice(0, 8), 16) >>> 0;

/** Uniform [0, 1) value fixed for (seed, ...labels). Used as per-candidate noise. */
export function unit(seed: string, ...labels: readonly (string | number)[]): number {
  return hash32(`${seed}␟${labels.join('␟')}`) / 0x1_0000_0000;
}

/** Signed [-1, 1) value fixed for (seed, ...labels). */
export const signed = (seed: string, ...labels: readonly (string | number)[]) => unit(seed, ...labels) * 2 - 1;

/** mulberry32: a small seeded PRNG for sequences (e.g. shuffling verified asset IDs). */
export function prng(seed: string, label: string): () => number {
  let a = hash32(`${seed}␟${label}`) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/** Deterministic Fisher–Yates shuffle (input untouched). */
export function shuffled<T>(items: readonly T[], seed: string, label: string): T[] {
  const next = prng(seed, label);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A stable seed for a quiz session: the same session ID always gives the same world. */
export const seedForSession = (sessionId: string): string => hashString(`vibenta-world:${sessionId}`);
