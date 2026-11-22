import type { Place } from '../osm';
import { normalizeCuisine, PRICE_BANDS, type SearchFilters } from '../features/vibe/searchContract';

/** Apply the same cuisine and price rules to pins using the evidence available to the browsing map. */
export function matchesBrowsingFilters(
  place: Place,
  filters: Pick<SearchFilters, 'maxPriceBand' | 'cuisines'>,
  catalogCuisines?: readonly string[] | null,
): boolean {
  if (filters.maxPriceBand) {
    const band = PRICE_BANDS.findIndex(band => band === place.tags['catalog:price_band']);
    if (band < 0 || band > PRICE_BANDS.indexOf(filters.maxPriceBand)) return false;
  }

  const cuisines = filters.cuisines;
  if (!cuisines?.length) return true;
  const placeCuisines = catalogCuisines ?? place.tags.cuisine?.split(';') ?? [];
  const wanted = cuisines.map(normalizeCuisine);
  return placeCuisines.some(cuisine => wanted.includes(normalizeCuisine(cuisine)));
}
