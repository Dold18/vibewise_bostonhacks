/**
 * The composer's continuous style space.
 *
 * Every input (mood words, music, time of day, energy...) is a pull in this
 * space, and every reusable component (a wall material, a window style, a
 * lighting rig...) has an ideal position in it. Worlds are therefore points,
 * not menu entries: any combination of inputs lands somewhere, and the
 * components nearest to that point are what get combined.
 *
 * Positive ends: warm, bright/day, lively, vivid, ornate, historic, organic,
 * soft/dreamy, raw, wet/misty, intimate. Every axis is clamped to [-1, 1].
 */
export const AXES = [
  'warmth', 'luminance', 'energy', 'chroma', 'ornament', 'era', 'nature', 'softness', 'grit', 'moisture', 'intimacy',
] as const;
export type Axis = (typeof AXES)[number];

export type StyleVector = Readonly<Record<Axis, number>>;
export type Pull = Partial<Record<Axis, number>>;

export const clamp = (n: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n));
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const ZERO: StyleVector = Object.freeze(Object.fromEntries(AXES.map((a) => [a, 0])) as Record<Axis, number>);

export function addPull(into: Record<Axis, number>, pull: Pull, scale = 1) {
  for (const a of AXES) if (pull[a] !== undefined) into[a] += pull[a]! * scale;
}

/** Saturating squash: many agreeing signals approach ±1 but never exceed it. */
export const squash = (raw: Record<Axis, number>, softness = 1.1): StyleVector =>
  Object.freeze(Object.fromEntries(AXES.map((a) => [a, round3(Math.tanh(raw[a] / softness))])) as Record<Axis, number>);

/**
 * How well a point fits an ideal that only names some axes: the mean of
 * `(1 - |distance| / 2)²` over the named axes, in [0, 1], weighted by how
 * strongly the ideal specifies each axis (luminance counts 1.5×). Squaring makes a
 * half-right component score well below a right one, so loosely related
 * treatments lose to the plain map instead of cluttering the world. Axes the
 * ideal does not name are "don't care", which is what lets components combine.
 */
export function fit(style: StyleVector, ideal: Pull): number {
  let sum = 0;
  let n = 0;
  for (const a of AXES) {
    const target = ideal[a];
    if (target === undefined) continue;
    // Strongly specified axes matter more; luminance (time of day) matters most.
    const w = (0.5 + Math.abs(target)) * (a === 'luminance' ? 1.5 : 1);
    sum += w * (1 - Math.abs(style[a] - target) / 2) ** 2;
    n += w;
  }
  return n ? sum / n : 0.25;
}

export function distance(a: StyleVector, b: StyleVector | Pull): number {
  let s = 0;
  for (const k of AXES) {
    const bk = (b as Pull)[k];
    if (bk === undefined) continue;
    s += (a[k] - bk) ** 2;
  }
  return Math.sqrt(s);
}
