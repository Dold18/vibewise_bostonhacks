/**
 * Pin size for the quiz's final recommendations, from each result's actual match score (not its rank).
 *
 * The best score gets MAX_SCALE and the worst MIN_SCALE, linearly in between, when the list spans at
 * least MIN_SPREAD of similarity. A tighter list is compressed around the middle size in proportion, so
 * near-equal scores never look like big differences; equal scores all get the middle size.
 */
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.6;
/** Real final lists span about 0.05–0.07 cosine; below this the spread is treated as not meaningful. */
export const MIN_SPREAD = 0.04;

export function finalPinScales(scores: readonly number[]): number[] {
  const finite = scores.filter(Number.isFinite);
  if (!finite.length) return scores.map(() => 1);
  const best = Math.max(...finite), worst = Math.min(...finite);
  const center = (best + worst) / 2, span = Math.max(best - worst, MIN_SPREAD);
  const mid = (MIN_SCALE + MAX_SCALE) / 2;
  return scores.map((s) => (Number.isFinite(s) ? mid + ((MAX_SCALE - MIN_SCALE) * (s - center)) / span : 1));
}

/** Stacking for a flat map: a higher score paints over a lower one. A tilted map keeps its depth order. */
export function finalPinRanks(scores: readonly number[]): number[] {
  const order = scores.map((s, i) => ({ s: Number.isFinite(s) ? s : -Infinity, i })).sort((a, b) => a.s - b.s || b.i - a.i);
  const ranks = Array<number>(scores.length);
  order.forEach(({ i }, k) => { ranks[i] = k + 1; });
  return ranks;
}
