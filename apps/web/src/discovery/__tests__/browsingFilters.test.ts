import { expect, it } from 'vitest';
import type { Place } from '../../osm';
import { filtersFor } from '../../features/vibe/finalSearch';
import { matchesBrowsingFilters } from '../browsingFilters';
import { initialPreferences, preferencesReducer } from '../preferences';

it('uses intake preferences to remove over-budget, wrong-cuisine and unknown pins before the quiz', () => {
  let prefs = preferencesReducer(initialPreferences(), { type: 'setActivity', activity: 'food_drinks' });
  prefs = preferencesReducer(prefs, { type: 'toggleSubtype', id: 'thai' });
  prefs = preferencesReducer(prefs, { type: 'setBudget', choice: 'under_25' });
  const filters = filtersFor(prefs);
  const place: Place = {
    id: 'venue', name: 'Test venue', lat: 42.36, lon: -71.06, category: 'Restaurant',
    tags: { 'catalog:price_band': '$$' },
  };
  expect(matchesBrowsingFilters(place, filters, ['Chinese', 'Thai'])).toBe(true);
  expect(matchesBrowsingFilters(place, filters, ['Chinese'])).toBe(false);
  expect(matchesBrowsingFilters(place, filters, [])).toBe(false);
  expect(matchesBrowsingFilters({ ...place, tags: { 'catalog:price_band': '$$$' } }, filters, ['Thai'])).toBe(false);
  expect(matchesBrowsingFilters({ ...place, tags: {} }, filters, ['Thai'])).toBe(false);
  expect(matchesBrowsingFilters({ ...place, tags: {} }, {})).toBe(true);
});
