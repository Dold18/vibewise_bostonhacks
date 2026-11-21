import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverpass, parseFsqRows, osmRow, fsqRow } from '../src/sources.ts';

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
  ]);
  assert.deepEqual(places.map((p) => p.osmId), ['node/1', 'way/2']);
  assert.deepEqual([places[1].lat, places[1].lng], [42.36, -71.07]);
});
test('parseFsqRows skips rows with no name, coordinates or labels', () => {
  const base = { fsq_place_id: 'f1', name: 'X', latitude: 42.35, longitude: -71.06, fsq_category_labels: ['Dining and Drinking > Bakery'], date_refreshed: '2026-01-01' };
  const out = parseFsqRows([base, { ...base, fsq_place_id: 'f2', name: null }, { ...base, fsq_place_id: 'f3', latitude: null }, { ...base, fsq_place_id: 'f4', fsq_category_labels: [] }]);
  assert.deepEqual(out.map((p) => p.fsqId), ['f1']);
});
test('parseFsqRows accepts numeric strings and skips non-finite or non-dining rows', () => {
  const base = { fsq_place_id: 'f1', name: 'X', latitude: '42.35', longitude: '-71.06', fsq_category_labels: ['Dining and Drinking > Bakery'], date_refreshed: null };
  const out = parseFsqRows([
    base,
    { ...base, fsq_place_id: 'f2', latitude: 'abc' },
    { ...base, fsq_place_id: 'f3', fsq_category_labels: ['Retail > Shoe Store'] },
  ]);
  assert.deepEqual(out.map((p) => p.fsqId), ['f1']);
  assert.deepEqual([out[0].lat, out[0].lng], [42.35, -71.06]);
});
test('osmRow builds the ingest-owned columns', () => {
  const row = osmRow({ osmId: 'node/1', name: ' Tatte ', lat: 42.35, lng: -71.06,
    tags: { amenity: 'cafe', cuisine: 'coffee_shop', 'contact:website': 'https://x', opening_hours: 'Mo-Su 07:00-19:00' } }, runStart);
  assert.deepEqual(row, {
    place_id: 'osm:node/1', source: 'osm', source_id: 'node/1', name: 'Tatte',
    location: 'SRID=4326;POINT(-71.06 42.35)', address: null, website: 'https://x', phone: null,
    category: 'cafe', source_cuisines: ['coffee_shop'], hours_raw: 'Mo-Su 07:00-19:00',
    osm_tags: { amenity: 'cafe', cuisine: 'coffee_shop', opening_hours: 'Mo-Su 07:00-19:00' },
    fsq_place_id: null, attribution: '© OpenStreetMap contributors (ODbL)', last_seen_at: runStart,
  });
});
test('osmRow throws for an amenity outside the category map', () => {
  assert.throws(() => osmRow({ osmId: 'node/9', name: 'Bank', lat: 1, lng: 2, tags: { amenity: 'bank' } }, runStart));
});
test('fsqRow uses fsq identity, primary label category and Apache attribution', () => {
  const row = fsqRow({ fsqId: 'abc', name: 'Sushi Bar X', lat: 42.35, lng: -71.06, address: null, locality: null, postcode: null,
    tel: '617', website: null, dateRefreshed: '2026-01-01',
    categoryLabels: ['Dining and Drinking > Restaurant > Japanese Restaurant > Sushi Restaurant'] }, runStart);
  assert.equal(row.place_id, 'fsq:abc');
  assert.equal(row.fsq_place_id, 'abc');
  assert.equal(row.category, 'restaurant');
  assert.deepEqual(row.source_cuisines, ['sushi']);
  assert.equal(row.attribution, 'Foursquare OS Places (Apache 2.0)');
});
test('fsqRow throws when the primary label is not dining', () => {
  assert.throws(() => fsqRow({ fsqId: 'z', name: 'Shoes', lat: 1, lng: 2, address: null, locality: null, postcode: null,
    tel: null, website: null, dateRefreshed: null, categoryLabels: ['Retail > Shoe Store'] }, runStart));
});
