import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTypeOption, classifyOsm, classifyFsq, boundsAreaHa, PLACE_TYPE_CONFIG } from '../src/placeTypes.ts';
import { metersBetween } from '../src/geo.ts';

const LIST = 'restaurants, museums, entertainment, parks, landmarks';
const BOX_06 = { minlat: 42.35, maxlat: 42.3506, minlon: -71.06, maxlon: -71.0588 };
const BOX_01 = { minlat: 42.35, maxlat: 42.35025, minlon: -71.06, maxlon: -71.0596 };

test('parseTypeOption validates the --type value', () => {
  assert.equal(parseTypeOption('parks'), 'parks');
  assert.throws(() => parseTypeOption(undefined), { message: `missing --type (expected one of ${LIST})` });
  assert.throws(() => parseTypeOption('zoo'), { message: `invalid --type 'zoo' (expected one of ${LIST})` });
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
  assert.deepEqual(classifyFsq('Arts and Entertainment > Night Club'), { type: 'entertainment', kind: 'night_club' });
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
  assert.equal(PLACE_TYPE_CONFIG.parks.keepFsq, false);
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
