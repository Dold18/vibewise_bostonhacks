import { describe, expect, it } from 'vitest';
import type { Place } from '../../osm';
import { cuisinesOf, evaluatePlace, qualificationsFor, rankPlaces, straightLineDistance } from '../filter';
import { initialPreferences, preferencesReducer, type InitialPreferences, type PreferencesAction } from '../preferences';

/** Development fixtures shaped like osm.ts places. Names and tags are illustrative, not real venues. */
const place = (id: string, tags: Record<string, string>, extra: Partial<Place> = {}): Place => ({
  id,
  name: id,
  lat: 42.35,
  lon: -71.06,
  category: 'Place',
  tags,
  ...extra,
});

const sushi = place('sushi', { amenity: 'restaurant', cuisine: 'sushi;ramen' });
const pizza = place('pizza', { amenity: 'restaurant', cuisine: 'pizza' });
const ethiopian = place('ethiopian', { amenity: 'restaurant', cuisine: 'ethiopian' });
const untagged = place('untagged-restaurant', { amenity: 'restaurant' });
const cafe = place('cafe', { amenity: 'cafe', cuisine: 'coffee_shop' });
const museum = place('museum', { tourism: 'museum' });
const park = place('park', { leisure: 'park' });
const bar = place('bar', { amenity: 'bar' });
const shop = place('shop', { shop: 'books' });
const tileRestaurant = place('tile-restaurant', {}, { category: 'Restaurant' });
const tileUnknown = place('tile-unknown', {}, { category: 'Townhall' });

const prefs = (...actions: PreferencesAction[]): InitialPreferences => actions.reduce(preferencesReducer, initialPreferences());
const ids = (places: { place: Place }[]) => places.map((r) => r.place.id);
const NOW = new Date('2026-11-21T17:00:00Z');

describe('cuisine tags', () => {
  it('maps OSM values and synonyms to our cuisines', () => {
    expect(cuisinesOf(sushi.tags)).toEqual(['japanese']);
    expect(cuisinesOf(pizza.tags)).toEqual(['italian']);
    expect(cuisinesOf({ cuisine: 'lebanese; falafel' })).toEqual(['middle_eastern']);
  });

  it('treats tagged-but-unlisted cuisines as "other" and missing tags as unknown', () => {
    expect(cuisinesOf(ethiopian.tags)).toEqual(['other']);
    expect(cuisinesOf(untagged.tags)).toBeNull();
  });
});

describe('activity filter', () => {
  const all = [sushi, museum, park, bar, shop, cafe, tileRestaurant, tileUnknown];

  it('applies nothing before an activity is chosen', () => {
    expect(ids(rankPlaces(all, initialPreferences()).included)).toEqual(ids(all.map((p) => ({ place: p }))));
  });

  it('Food & drinks keeps food places and excludes others', () => {
    const { included, excluded } = rankPlaces(all, prefs({ type: 'setActivity', activity: 'food_drinks' }));
    expect(ids(included)).toEqual(['sushi', 'bar', 'cafe', 'tile-restaurant', 'tile-unknown']);
    expect(ids(excluded)).toEqual(['museum', 'park', 'shop']);
  });

  it('Activities keeps museums, parks, nightlife and shops', () => {
    const { included } = rankPlaces(all, prefs({ type: 'setActivity', activity: 'activities' }));
    expect(ids(included)).toEqual(['museum', 'park', 'bar', 'shop', 'tile-unknown']);
  });

  it('Open to anything excludes nothing', () => {
    expect(rankPlaces(all, prefs({ type: 'setActivity', activity: 'anything' })).excluded).toEqual([]);
  });

  it('keeps places of unknown type but ranks them last', () => {
    const { included } = rankPlaces([tileUnknown, sushi], prefs({ type: 'setActivity', activity: 'food_drinks' }));
    expect(ids(included)).toEqual(['sushi', 'tile-unknown']);
    expect(included[1].evaluation.activity).toBe('unknown');
  });

  it('recognises tile places from their map label, but never via wildcard rules', () => {
    const r = evaluatePlace(tileRestaurant, prefs({ type: 'setActivity', activity: 'activities' }));
    // "Restaurant" isn't a shop or a historic site just because those rules accept any value.
    expect(r.evaluation.activity).toBe('mismatch');
    expect(evaluatePlace(tileRestaurant, prefs({ type: 'setActivity', activity: 'food_drinks' })).notes).toContain(
      'Type taken from the map label only',
    );
  });
});

describe('cuisine filter', () => {
  const food = (...cuisines: ('japanese' | 'italian' | 'other')[]) =>
    prefs({ type: 'setActivity', activity: 'food_drinks' }, ...cuisines.map((id) => ({ type: 'toggleSubtype', id }) as PreferencesAction));

  it('keeps matches, excludes contradicting tags, and keeps unknown cuisine after matches', () => {
    const { included, excluded } = rankPlaces([untagged, pizza, sushi], food('japanese'));
    expect(ids(included)).toEqual(['sushi', 'untagged-restaurant']);
    expect(ids(excluded)).toEqual(['pizza']);
    expect(included[1].notes).toContain('Cuisine unknown');
  });

  it('"Other" matches tagged cuisines outside the list', () => {
    expect(ids(rankPlaces([ethiopian, sushi], food('other')).included)).toEqual(['ethiopian']);
  });

  it('stale cuisine choices cannot filter after the activity changes', () => {
    const s = preferencesReducer(food('japanese'), { type: 'setActivity', activity: 'anything' });
    expect(ids(rankPlaces([pizza, sushi], s).included)).toEqual(['pizza', 'sushi']);
    // Even a hand-built state with leftover cuisines is ignored when the field isn't showing.
    const tampered = { ...s, cuisines: ['japanese' as const] };
    expect(ids(rankPlaces([pizza, sushi], tampered).included)).toEqual(['pizza', 'sushi']);
  });
});

describe('activity type filter', () => {
  const acts = (...types: ('museums_galleries' | 'student_events' | 'nightlife')[]) =>
    prefs({ type: 'setActivity', activity: 'activities' }, ...types.map((id) => ({ type: 'toggleSubtype', id }) as PreferencesAction));

  it('keeps only the chosen types', () => {
    expect(ids(rankPlaces([museum, park, bar], acts('museums_galleries')).included)).toEqual(['museum']);
    expect(ids(rankPlaces([museum, park, bar], acts('museums_galleries', 'nightlife')).included)).toEqual(['museum', 'bar']);
  });

  it('student events alone are saved but not applied (no data source)', () => {
    const { included, excluded } = rankPlaces([museum, park], acts('student_events'));
    expect(excluded).toEqual([]);
    expect(included[0].evaluation.subtype).toBe('not_applied');
  });
});

describe('budget and timing', () => {
  it('never exclude anything, because prices and hours are unknown', () => {
    const s = prefs({ type: 'setBudget', choice: 'under_15' }, { type: 'setTiming', kind: 'tonight', now: NOW });
    const { included, excluded } = rankPlaces([sushi, museum], s);
    expect(excluded).toEqual([]);
    expect(included[0].evaluation).toMatchObject({ budget: 'unknown', timing: 'not_applied' });
    expect(included[0].notes).toContain('Price unknown');
  });

  it('"No limit" is a match rather than an unknown', () => {
    expect(evaluatePlace(sushi, prefs({ type: 'setBudget', choice: 'no_limit' })).evaluation.budget).toBe('match');
  });
});

describe('ranking by distance', () => {
  const origin = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'local_suggestion' as const };
  const near = place('near', { amenity: 'cafe' }, { lat: 42.3566, lon: -71.0626 });
  const far = place('far', { amenity: 'cafe' }, { lat: 42.3496, lon: -71.1047 });

  it('orders equally certain places by straight-line distance from the origin', () => {
    const { included } = rankPlaces([far, near], prefs({ type: 'setOrigin', origin }));
    expect(ids(included)).toEqual(['near', 'far']);
    expect(included[0].straightLineMeters).toBeLessThan(50);
    expect(included[1].straightLineMeters).toBeGreaterThan(3000);
  });

  it('certainty comes before distance', () => {
    const farTagged = place('far-sushi', { amenity: 'restaurant', cuisine: 'sushi' }, { lat: 42.3496, lon: -71.1047 });
    const nearUntagged = place('near-untagged', { amenity: 'restaurant' }, { lat: 42.3566, lon: -71.0626 });
    const s = prefs(
      { type: 'setActivity', activity: 'food_drinks' },
      { type: 'toggleSubtype', id: 'japanese' },
      { type: 'setOrigin', origin },
    );
    expect(ids(rankPlaces([nearUntagged, farTagged], s).included)).toEqual(['far-sushi', 'near-untagged']);
  });

  it('computes haversine distance in meters', () => {
    // 0.00744° of latitude (~827 m) and 0.03277° of longitude at 42.35°N (~2.69 km): ~2.82 km.
    const d = straightLineDistance({ lat: 42.35639, lng: -71.0624 }, { lat: 42.348949, lng: -71.095169 });
    expect(d).toBeGreaterThan(2500);
    expect(d).toBeLessThan(3000);
  });
});

describe('vibe text is kept out of practical filtering', () => {
  it('does not change results', () => {
    const base = prefs({ type: 'setActivity', activity: 'food_drinks' });
    const withVibe = preferencesReducer(base, { type: 'setVibeText', text: 'sushi only please' });
    expect(rankPlaces([pizza, sushi], withVibe)).toEqual(rankPlaces([pizza, sushi], base));
  });
});

describe('qualifications', () => {
  it('says nothing when nothing is chosen', () => {
    expect(qualificationsFor(initialPreferences())).toEqual([]);
  });

  it('says the starting point does not rank places yet', () => {
    const origin = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'local_suggestion' as const };
    expect(qualificationsFor(prefs({ type: 'setOrigin', origin })).join(' ')).toMatch(/doesn't rank places yet/);
  });

  it('explains every saved-but-unapplied preference', () => {
    const s = prefs(
      { type: 'setActivity', activity: 'activities' },
      { type: 'toggleSubtype', id: 'student_events' },
      { type: 'setBudget', choice: 'under_25' },
      { type: 'setTiming', kind: 'now', now: NOW },
      { type: 'setVibeText', text: 'cozy' },
    );
    const text = qualificationsFor(s).join(' ');
    expect(text).toMatch(/unknown prices are excluded/);
    expect(text).toMatch(/Opening hours aren't checked/);
    expect(text).toMatch(/Vibe matching is not active/);
  });
});
