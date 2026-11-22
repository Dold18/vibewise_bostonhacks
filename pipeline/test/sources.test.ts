import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverpass, parseFsqRows, osmRow, fsqRow } from '../src/sources.ts';
import { PLACE_TYPE_CONFIG } from '../src/placeTypes.ts';

const FOOD = PLACE_TYPE_CONFIG.restaurants;

const runStart = '2026-11-21T12:00:00.000Z';
test('parseOverpass reads nodes and ways-with-center, skips incomplete or disused', () => {
  const places = parseOverpass([
    { type: 'node', id: 1, lat: 42.35, lon: -71.06, tags: { name: 'A', amenity: 'cafe' } },
    { type: 'way', id: 2, center: { lat: 42.36, lon: -71.07 }, tags: { name: 'B', amenity: 'pub' } },
    { type: 'relation', id: 3, tags: { name: 'C', amenity: 'restaurant' } },              // no center
    { type: 'node', id: 4, lat: 42.35, lon: -71.06, tags: { amenity: 'cafe' } },          // no name
    { type: 'node', id: 5, lat: 42.35, lon: -71.06, tags: { name: 'E', amenity: 'cafe', 'disused:amenity': 'cafe' } },
    { type: 'node', id: 6, lat: 42.35, lon: -71.06, tags: { name: 'F', amenity: 'bank' } },
    { type: 'node', id: 7, lat: 42.35, lon: -71.06, tags: { name: 'G', amenity: 'cafe', 'was:amenity': 'bar' } },
  ], FOOD);
  assert.deepEqual(places.map((p) => p.osmId), ['node/1', 'way/2']);
  assert.deepEqual([places[1].lat, places[1].lng], [42.36, -71.07]);
});
test('parseFsqRows skips rows with no name, coordinates or labels', () => {
  const base = { fsq_place_id: 'f1', name: 'X', latitude: 42.35, longitude: -71.06, fsq_category_labels: ['Dining and Drinking > Bakery'], date_refreshed: '2026-01-01' };
  const out = parseFsqRows([base, { ...base, fsq_place_id: 'f2', name: null }, { ...base, fsq_place_id: 'f3', latitude: null }, { ...base, fsq_place_id: 'f4', fsq_category_labels: [] }], FOOD);
  assert.deepEqual(out.map((p) => p.fsqId), ['f1']);
});
test('parseFsqRows accepts numeric strings and skips non-finite or non-dining rows', () => {
  const base = { fsq_place_id: 'f1', name: 'X', latitude: '42.35', longitude: '-71.06', fsq_category_labels: ['Dining and Drinking > Bakery'], date_refreshed: null };
  const out = parseFsqRows([
    base,
    { ...base, fsq_place_id: 'f2', latitude: 'abc' },
    { ...base, fsq_place_id: 'f3', fsq_category_labels: ['Retail > Shoe Store'] },
  ], FOOD);
  assert.deepEqual(out.map((p) => p.fsqId), ['f1']);
  assert.deepEqual([out[0].lat, out[0].lng], [42.35, -71.06]);
});
test('osmRow builds the ingest-owned columns', () => {
  const row = osmRow({ osmId: 'node/1', name: ' Tatte ', lat: 42.35, lng: -71.06,
    tags: { amenity: 'cafe', cuisine: 'coffee_shop', 'contact:website': 'https://x', opening_hours: 'Mo-Su 07:00-19:00' }, bounds: null }, runStart, FOOD);
  assert.deepEqual(row, {
    place_id: 'osm:node/1', source: 'osm', source_id: 'node/1', name: 'Tatte',
    location: 'SRID=4326;POINT(-71.06 42.35)', address: null, website: 'https://x', phone: null,
    category: 'cafe', source_cuisines: ['coffee_shop'], hours_raw: 'Mo-Su 07:00-19:00',
    osm_tags: { amenity: 'cafe', cuisine: 'coffee_shop', opening_hours: 'Mo-Su 07:00-19:00' },
    fsq_place_id: null, attribution: '© OpenStreetMap contributors (ODbL)', last_seen_at: runStart,
  });
});
test('osmRow throws for an amenity outside the category map', () => {
  assert.throws(() => osmRow({ osmId: 'node/9', name: 'Bank', lat: 1, lng: 2, tags: { amenity: 'bank' }, bounds: null }, runStart, FOOD));
});
test('fsqRow uses fsq identity, primary label category and Apache attribution', () => {
  const row = fsqRow({ fsqId: 'abc', name: 'Sushi Bar X', lat: 42.35, lng: -71.06, address: null, locality: null, postcode: null,
    tel: '617', website: null, dateRefreshed: '2026-01-01',
    categoryLabels: ['Dining and Drinking > Restaurant > Japanese Restaurant > Sushi Restaurant'] }, runStart, FOOD);
  assert.equal(row.place_id, 'fsq:abc');
  assert.equal(row.fsq_place_id, 'abc');
  assert.ok('category' in row);
  assert.equal(row.category, 'restaurant');
  assert.deepEqual(row.source_cuisines, ['sushi']);
  assert.equal(row.attribution, 'Foursquare OS Places (Apache 2.0)');
});
test('fsqRow throws when the primary label is not dining', () => {
  assert.throws(() => fsqRow({ fsqId: 'z', name: 'Shoes', lat: 1, lng: 2, address: null, locality: null, postcode: null,
    tel: null, website: null, dateRefreshed: null, categoryLabels: ['Retail > Shoe Store'] }, runStart, FOOD));
});

test('parsers skip coordinates outside the study area, including (0,0) and blank strings', () => {
  const els = parseOverpass([
    { type: 'node', id: 1, lat: 0, lon: 0, tags: { name: 'Null Island', amenity: 'cafe' } },
    { type: 'node', id: 2, lat: 42.35, lon: -71.06, tags: { name: 'Boston', amenity: 'cafe' } },
    { type: 'node', id: 3, lat: 42.42, lon: -71.06, tags: { name: 'Edge margin', amenity: 'cafe' } },
    { type: 'node', id: 4, lat: 42.5, lon: -71.06, tags: { name: 'Too far', amenity: 'cafe' } },
  ], FOOD);
  assert.deepEqual(els.map((p) => p.osmId), ['node/2', 'node/3']);
  const base = { fsq_place_id: 'f1', name: 'X', latitude: ' 42.35 ', longitude: '-71.06', fsq_category_labels: ['Dining and Drinking > Bakery'], date_refreshed: null };
  const out = parseFsqRows([
    base,
    { ...base, fsq_place_id: 'f2', latitude: 0, longitude: 0 },
    { ...base, fsq_place_id: 'f3', latitude: '  ' },
  ], FOOD);
  assert.deepEqual(out.map((p) => p.fsqId), ['f1']);
  assert.equal(out[0]!.lat, 42.35);
});

const BOX_06 = { minlat: 42.35, maxlat: 42.3506, minlon: -71.06, maxlon: -71.0588 };
const BOX_01 = { minlat: 42.35, maxlat: 42.35025, minlon: -71.06, maxlon: -71.0596 };

test('parseOverpass for parks reads bounds, drops museum-claimed and tiny unlisted parks', () => {
  const places = parseOverpass([
    { type: 'way', id: 1, bounds: BOX_06, tags: { name: 'Big Park', leisure: 'park' } },
    { type: 'way', id: 2, bounds: BOX_06, tags: { name: 'Park Museum', leisure: 'park', tourism: 'museum' } },
    { type: 'way', id: 3, bounds: BOX_01, tags: { name: 'Pocket Park', leisure: 'park' } },
    { type: 'way', id: 4, bounds: BOX_01, tags: { name: 'Famous Pocket Park', leisure: 'park', wikidata: 'Q1' } },
    { type: 'node', id: 5, lat: 42.36, lon: -71.05, tags: { name: 'Cafe', amenity: 'cafe' } },
  ], PLACE_TYPE_CONFIG.parks);
  assert.deepEqual(places.map((p) => p.osmId), ['way/1', 'way/4']);
  assert.equal(places[0]!.lat, (BOX_06.minlat + BOX_06.maxlat) / 2);
  assert.equal(places[0]!.lng, (BOX_06.minlon + BOX_06.maxlon) / 2);
  assert.deepEqual(places[0]!.bounds, BOX_06);
});

test('parseOverpass keeps a node without bounds and records bounds as null', () => {
  const places = parseOverpass([
    { type: 'node', id: 1, lat: 42.35, lon: -71.06, tags: { name: 'MFA', tourism: 'museum' } },
  ], PLACE_TYPE_CONFIG.museums);
  assert.deepEqual(places, [{ osmId: 'node/1', name: 'MFA', lat: 42.35, lng: -71.06, tags: { name: 'MFA', tourism: 'museum' }, bounds: null }]);
});

test('parseFsqRows filters by place type', () => {
  const base = { fsq_place_id: 'f1', name: 'X', latitude: 42.35, longitude: -71.06, date_refreshed: null };
  const rows = [
    { ...base, fsq_category_labels: ['Arts and Entertainment > Museum > History Museum'] },
    { ...base, fsq_place_id: 'f2', fsq_category_labels: ['Dining and Drinking > Cafe'] },
    { ...base, fsq_place_id: 'f3', fsq_category_labels: ['Landmarks and Outdoors > Park'] },
  ];
  assert.deepEqual(parseFsqRows(rows, PLACE_TYPE_CONFIG.parks), []);
  assert.deepEqual(parseFsqRows(rows, PLACE_TYPE_CONFIG.museums).map((p) => p.fsqId), ['f1']);
  assert.deepEqual(parseFsqRows(rows, FOOD).map((p) => p.fsqId), ['f2']);
});

test('osmRow for a museum carries kind and type-specific tags, no food columns', () => {
  const row = osmRow({ osmId: 'way/7', name: 'Old State House', lat: 42.3587, lng: -71.0575, bounds: null,
    tags: { name: 'Old State House', tourism: 'museum', fee: 'yes', wikipedia: 'en:Old State House', 'addr:street': 'Washington St',
      opening_hours: 'Mo-Su 10:00-17:00', website: 'https://revolutionaryspaces.org', brand: 'B' } }, runStart, PLACE_TYPE_CONFIG.museums);
  assert.deepEqual(row, {
    place_id: 'osm:way/7', source: 'osm', source_id: 'way/7', name: 'Old State House',
    location: 'SRID=4326;POINT(-71.0575 42.3587)', address: 'Washington St', website: 'https://revolutionaryspaces.org', phone: null,
    kind: 'museum', hours_raw: 'Mo-Su 10:00-17:00',
    osm_tags: { tourism: 'museum', fee: 'yes', wikipedia: 'en:Old State House', opening_hours: 'Mo-Su 10:00-17:00' },
    fsq_place_id: null, attribution: '© OpenStreetMap contributors (ODbL)', last_seen_at: runStart,
  });
  assert.ok(!('category' in row) && !('source_cuisines' in row));
});

test('fsqRow for a museum carries the Foursquare kind', () => {
  const row = fsqRow({ fsqId: 'm1', name: 'Museum X', lat: 42.35, lng: -71.06, address: null, locality: null, postcode: null,
    tel: null, website: 'https://m.example', dateRefreshed: '2026-01-01',
    categoryLabels: ['Arts and Entertainment > Museum > History Museum'] }, runStart, PLACE_TYPE_CONFIG.museums);
  assert.equal(row.place_id, 'fsq:m1');
  assert.ok('kind' in row && row.kind === 'history_museum');
  assert.ok(!('category' in row) && !('source_cuisines' in row));
  assert.equal(row.osm_tags, null);
  assert.equal(row.hours_raw, null);
  assert.throws(() => fsqRow({ fsqId: 'z', name: 'Cafe', lat: 1, lng: 2, address: null, locality: null, postcode: null,
    tel: null, website: null, dateRefreshed: null, categoryLabels: ['Dining and Drinking > Cafe'] }, runStart, PLACE_TYPE_CONFIG.museums));
});
