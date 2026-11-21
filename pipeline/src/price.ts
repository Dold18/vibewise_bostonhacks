/**
 * Price estimates (spec docs/superpowers/specs/2026-11-21-price-estimates-design.md):
 * the rubric, what the model sees per place, validation of its answers and the
 * write plan. Pure: no network, no database.
 */

export type PriceBand = '$' | '$$' | '$$$' | '$$$$';
export type PriceAnswer = PriceBand | 'unknown';

export const PRICE_BANDS: readonly PriceBand[] = ['$', '$$', '$$$', '$$$$'];
const ANSWERS: ReadonlySet<string> = new Set<string>([...PRICE_BANDS, 'unknown']);

/** Upper bounds of `$`, `$$`, `$$$`: typical spend per person before tip, USD cents. Matches BUDGET_OPTIONS in the web app. */
export const PRICE_CUTOFFS_CENTS = [1500, 2500, 4000] as const;

/** A catalog row the price step may estimate. Never a `price_source = 'menu'` row. */
export interface PriceCandidate {
  id: number;
  name: string;
  category: string;
  cuisines: string[] | null;
  osm_tags: Record<string, string> | null;
  price_source: 'estimate' | null;
}

/** Exactly what the model sees for one place. */
export interface PromptPlace { id: string; name: string; category: string; cuisines: string[]; amenity?: string }

export function toPromptPlace(c: PriceCandidate): PromptPlace {
  const amenity = c.osm_tags?.amenity;
  return { id: String(c.id), name: c.name, category: c.category, cuisines: c.cuisines ?? [], ...(amenity ? { amenity } : {}) };
}

const dollars = (cents: number) => `$${cents / 100}`;
const [CUT1, CUT2, CUT3] = PRICE_CUTOFFS_CENTS.map(dollars);

export const PRICE_SYSTEM_PROMPT = `You estimate how expensive food and drink places in Boston, Massachusetts are, in 2026 US dollars.

For each place you get its id, name, category (restaurant, cafe or nightlife), cuisines (may be empty) and sometimes its OpenStreetMap amenity type (for example fast_food, pub, ice_cream).

Answer with the typical spend per person for a normal meal or visit there, before tip:
- "$": under ${CUT1} per person (slice shops, food trucks, fast food, bakeries, most coffee shops, bubble tea)
- "$$": ${CUT1}-${CUT2} per person (casual sit-down, ramen, pho, pub food)
- "$$$": ${CUT2}-${CUT3} per person (upscale casual, nicer bistros, cocktail bars with food)
- "$$$$": over ${CUT3} per person (fine dining, steakhouses, tasting menus)
For a cafe, a visit is a drink plus a pastry. For a bar or pub, it is a couple of drinks plus a snack.

Use what you know about the place or chain by name, plus its cuisine and type.
If you have no real signal (for example a generic name with no cuisine), answer "unknown". "unknown" is a correct, useful answer: do not guess just to fill a band, and do not spread guesses evenly across bands.

Return one entry for every place, with its id exactly as given.`;

/** PostgREST `or` filter selecting rows to estimate. Menu prices are never selected. */
export function candidateFilter(force: boolean): string {
  return force ? 'price_source.is.null,price_source.eq.estimate' : 'price_source.is.null';
}

export interface ParsedEstimates { ok: boolean; answers: Map<string, PriceAnswer> }

/** Validate a model response against the batch: unknown ids, bad bands and duplicates (after the first) are dropped. */
export function parseEstimates(raw: string, batchIds: string[]): ParsedEstimates {
  const answers = new Map<string, PriceAnswer>();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, answers };
  }
  if (!Array.isArray(data)) return { ok: false, answers };
  const wanted = new Set(batchIds);
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, band } = entry as { id?: unknown; band?: unknown };
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    const key = String(id).trim();
    if (!wanted.has(key) || answers.has(key)) continue;
    if (typeof band !== 'string' || !ANSWERS.has(band)) continue;
    answers.set(key, band as PriceAnswer);
  }
  return { ok: true, answers };
}

/** Retry a batch whose response didn't parse or left more than half its places without an answer. */
export function needsRetry(result: ParsedEstimates, batchSize: number): boolean {
  return !result.ok || batchSize - result.answers.size > batchSize / 2;
}

export interface WritePlan { bands: Record<PriceBand, number[]>; reset: number[] }

/**
 * Ids to write per band. `unknown` writes nothing, except that a row which had an
 * estimate is reset to unknown so a stale guess isn't kept. Rows without an answer are left alone.
 */
export function planWrites(batch: PriceCandidate[], answers: Map<string, PriceAnswer>): WritePlan {
  const plan: WritePlan = { bands: { '$': [], '$$': [], '$$$': [], '$$$$': [] }, reset: [] };
  for (const row of batch) {
    const answer = answers.get(String(row.id));
    if (!answer) continue;
    if (answer === 'unknown') {
      if (row.price_source === 'estimate') plan.reset.push(row.id);
    } else {
      plan.bands[answer].push(row.id);
    }
  }
  return plan;
}
