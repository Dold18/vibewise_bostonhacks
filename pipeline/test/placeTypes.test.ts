import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTypeOption, classifyOsm, classifyFsq, boundsAreaHa, isOsmRoute, normalizeKind, PLACE_TYPE_CONFIG, PLACE_TYPES,
} from '../src/placeTypes.ts';
import { metersBetween } from '../src/geo.ts';

const LIST = 'restaurants, museums, entertainment, parks, landmarks';
const BOX_06 = { minlat: 42.35, maxlat: 42.3506, minlon: -71.06, maxlon: -71.0588 };
const BOX_01 = { minlat: 42.35, maxlat: 42.35025, minlon: -71.06, maxlon: -71.0596 };

test('parseTypeOption validates the --type value', () => {
  assert.equal(parseTypeOption('parks'), 'parks');
  assert.throws(() => parseTypeOption(undefined), { message: `missing --type (expected one of ${LIST})` });
  assert.throws(() => parseTypeOption('zoo'), { message: `invalid --type 'zoo' (expected one of ${LIST})` });
});

test('a stadium that is also tagged as a music venue is a stadium', () => {
  const fenway = { name: 'Fenway Park', amenity: 'music_venue', leisure: 'stadium', sport: 'baseball' };
  assert.deepEqual(classifyOsm(fenway), { type: 'entertainment', kind: 'stadium' });
  assert.deepEqual(classifyOsm({ name: 'Paradise', amenity: 'music_venue' }), { type: 'entertainment', kind: 'music_venue' });
  assert.equal(PLACE_TYPE_CONFIG.entertainment.keepOsm(fenway, null), true);
});

test('classifyOsm maps tags and applies precedence in PLACE_TYPES order', () => {
  assert.deepEqual(classifyOsm({ amenity: 'cafe', name: 'X' }), { type: 'restaurants', kind: 'cafe' });
  assert.equal(classifyOsm({ tourism: 'museum', historic: 'building', wikidata: 'Q1' })?.type, 'museums');
  assert.equal(classifyOsm({ leisure: 'park', tourism: 'attraction' })?.type, 'parks');
  assert.equal(classifyOsm({ amenity: 'restaurant', tourism: 'attraction' })?.type, 'restaurants');
  assert.equal(classifyOsm({ historic: 'memorial' }), null);
  assert.deepEqual(classifyOsm({ historic: 'memorial', wikidata: 'Q2' }), { type: 'landmarks', kind: 'memorial' });
  assert.equal(classifyOsm({ leisure: 'playground' }), null);
});

test('classifyFsq matches exact segments', () => {
  assert.deepEqual(classifyFsq('Arts and Entertainment > Museum > Art Museum'), { type: 'museums', kind: 'art_museum' });
  assert.equal(classifyFsq('Landmarks and Outdoors > Park > Playground'), null);
  assert.equal(classifyFsq('Arts and Entertainment > Zoo > Zoo Exhibit'), null);
  assert.deepEqual(classifyFsq('Dining and Drinking > Bar'), { type: 'restaurants', kind: 'nightlife' });
  assert.deepEqual(classifyFsq('Arts and Entertainment > Night Club'), { type: 'entertainment', kind: 'nightclub' });
  assert.deepEqual(classifyFsq('Landmarks and Outdoors > Park > National Park'), { type: 'parks', kind: 'national_park' });
  assert.deepEqual(classifyFsq('Landmarks and Outdoors > Lighthouse'), { type: 'landmarks', kind: 'lighthouse' });
  assert.deepEqual(classifyFsq('Sports and Recreation > Skating > Skating Rink'), { type: 'entertainment', kind: 'skating_rink' });
});

test('parks keepOsm needs size or Wikidata, and no private access', () => {
  const keep = PLACE_TYPE_CONFIG.parks.keepOsm;
  assert.equal(keep({ leisure: 'park' }, null), false);
  assert.equal(keep({ leisure: 'park', wikidata: 'Q3' }, null), true);
  assert.equal(keep({ leisure: 'park' }, BOX_06), true);
  assert.equal(keep({ leisure: 'park' }, BOX_01), false);
  assert.equal(keep({ leisure: 'garden', access: 'private', wikidata: 'Q4' }, null), false);
});

test('restaurants keepOsm rejects disused/was amenity', () => {
  const keep = PLACE_TYPE_CONFIG.restaurants.keepOsm;
  assert.equal(keep({ amenity: 'cafe' }, null), true);
  assert.equal(keep({ amenity: 'cafe', 'disused:amenity': 'cafe' }, null), false);
  assert.equal(keep({ amenity: 'cafe', 'was:amenity': 'cafe' }, null), false);
});

test('boundsAreaHa matches metersBetween', () => {
  const w = metersBetween({ lat: 42.3503, lng: -71.06 }, { lat: 42.3503, lng: -71.0588 });
  const h = metersBetween({ lat: 42.35, lng: -71.0594 }, { lat: 42.3506, lng: -71.0594 });
  assert.ok(Math.abs(boundsAreaHa(BOX_06) - (w * h) / 10000) < 0.05);
  assert.ok(boundsAreaHa(BOX_06) > 0.5 && boundsAreaHa(BOX_01) < 0.5);
});

test('OSM route relations are never non-food places; restaurants classification is unchanged', () => {
  const freedomTrail = { type: 'route', route: 'foot', tourism: 'attraction', name: 'Freedom Trail', wikidata: 'Q1' };
  assert.equal(classifyOsm(freedomTrail), null);
  assert.equal(classifyOsm({ type: 'route', tourism: 'attraction', name: 'B.A.A. 5K' }), null);
  assert.equal(classifyOsm({ route: 'running', tourism: 'attraction' }), null);
  assert.equal(classifyOsm({ route: 'hiking', leisure: 'park' }), null);
  assert.equal(classifyOsm({ type: 'route', tourism: 'museum' }), null);
  assert.equal(classifyOsm({ type: 'route', amenity: 'theatre' }), null);
  assert.equal(classifyOsm({ route: 'foot', historic: 'yes', wikidata: 'Q2' }), null);
  for (const t of ['museums', 'entertainment', 'parks', 'landmarks'] as const) {
    assert.equal(PLACE_TYPE_CONFIG[t].osmKind(freedomTrail), null, t);
    assert.equal(PLACE_TYPE_CONFIG[t].keepOsm(freedomTrail, null), false, t);
  }
  assert.deepEqual(classifyOsm({ amenity: 'cafe', route: 'bus' }), { type: 'restaurants', kind: 'cafe' });
  assert.deepEqual(classifyOsm({ amenity: 'restaurant', type: 'route' }), { type: 'restaurants', kind: 'restaurant' });
  assert.equal(PLACE_TYPE_CONFIG.restaurants.keepOsm({ amenity: 'cafe', route: 'bus' }, null), true);
  assert.equal(isOsmRoute({ type: 'route' }), true);
  assert.equal(isOsmRoute({ route: 'bicycle' }), true);
  assert.equal(isOsmRoute({ type: 'multipolygon', tourism: 'attraction' }), false);
});

test('normalizeKind maps every source spelling to one label set', () => {
  const cases: Array<[string, string]> = [
    ['theater', 'theatre'], ['night_club', 'nightclub'], ['movie_theater', 'cinema'], ['indie_movie_theater', 'cinema'],
    ['indie_theater', 'theatre'], ['art_gallery', 'gallery'],
    ['historic_and_protected_site', 'historic_site'],
  ];
  for (const [from, to] of cases) assert.equal(normalizeKind(from), to, from);
  for (const same of ['theatre', 'nightclub', 'cinema', 'gallery', 'museum', 'park', 'memorial', 'yes']) assert.equal(normalizeKind(same), same);
});

test('non-food kinds are normalized for both OSM and Foursquare', () => {
  const AE = 'Arts and Entertainment';
  assert.deepEqual(classifyFsq(`${AE} > Performing Arts Venue > Theater`), { type: 'entertainment', kind: 'theatre' });
  assert.deepEqual(classifyFsq(`${AE} > Performing Arts Venue > Indie Theater`), { type: 'entertainment', kind: 'theatre' });
  assert.deepEqual(classifyFsq(`${AE} > Movie Theater`), { type: 'entertainment', kind: 'cinema' });
  assert.deepEqual(classifyFsq(`${AE} > Movie Theater > Indie Movie Theater`), { type: 'entertainment', kind: 'cinema' });
  assert.deepEqual(classifyFsq(`${AE} > Night Club`), { type: 'entertainment', kind: 'nightclub' });
  assert.deepEqual(classifyFsq(`${AE} > Art Gallery`), { type: 'museums', kind: 'gallery' });
  assert.deepEqual(classifyOsm({ amenity: 'theatre' }), { type: 'entertainment', kind: 'theatre' });
  assert.deepEqual(classifyOsm({ amenity: 'nightclub' }), { type: 'entertainment', kind: 'nightclub' });
  assert.deepEqual(classifyOsm({ amenity: 'cinema' }), { type: 'entertainment', kind: 'cinema' });
  assert.deepEqual(classifyOsm({ tourism: 'gallery' }), { type: 'museums', kind: 'gallery' });
  assert.deepEqual(classifyOsm({ historic: 'yes', wikidata: 'Q5' }), { type: 'landmarks', kind: 'historic_site' });
  assert.equal(PLACE_TYPE_CONFIG.landmarks.osmKind({ historic: 'yes', wikidata: 'Q5' }), 'historic_site');
  assert.deepEqual(classifyFsq('Landmarks and Outdoors > Historic and Protected Site'), { type: 'landmarks', kind: 'historic_site' });
  // Restaurant categories are untouched.
  assert.deepEqual(classifyFsq('Dining and Drinking > Bar'), { type: 'restaurants', kind: 'nightlife' });
  assert.deepEqual(classifyOsm({ amenity: 'pub' }), { type: 'restaurants', kind: 'nightlife' });
});

test('only parks drop unmatched Foursquare places', () => {
  for (const t of PLACE_TYPES) assert.equal(PLACE_TYPE_CONFIG[t].keepUnmatchedFsq, t !== 'parks', t);
});

test('historic=yes becomes historic_site only through the landmarks historic match', () => {
  assert.equal(normalizeKind('yes'), 'yes');
  assert.equal(PLACE_TYPE_CONFIG.landmarks.osmKind({ historic: 'yes', wikidata: 'Q5' }), 'historic_site');
  assert.equal(PLACE_TYPE_CONFIG.landmarks.osmKind({ historic: 'memorial', wikidata: 'Q5' }), 'memorial');
  // A tourism match keeps its own value even when historic=yes is also set.
  assert.equal(PLACE_TYPE_CONFIG.landmarks.osmKind({ tourism: 'attraction', historic: 'yes', wikidata: 'Q5' }), 'attraction');
});
