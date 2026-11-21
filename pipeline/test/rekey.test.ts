import test from 'node:test';
import assert from 'node:assert/strict';
import { planRekey } from '../src/rekey.ts';
import type { ExistingRow, RestaurantRow } from '../src/types.ts';

function osmRow(n: number, fsq: string | null = null): RestaurantRow {
  return {
    place_id: `osm:node/${n}`, source: 'osm', source_id: `node/${n}`, name: `Place ${n}`,
    location: 'SRID=4326;POINT(-71.06 42.35)', address: null, website: null, phone: null,
    category: 'restaurant', source_cuisines: [], hours_raw: null, osm_tags: {}, fsq_place_id: fsq,
    attribution: 'x', last_seen_at: '2026-11-21T12:00:00.000Z',
  };
}
function fsqRow(id: string): RestaurantRow {
  return { ...osmRow(0), place_id: `fsq:${id}`, source: 'foursquare', source_id: id, osm_tags: null, fsq_place_id: id };
}
const ex = (id: number, source: 'osm' | 'foursquare', source_id: string, fsq: string | null): ExistingRow =>
  ({ id, source, source_id, fsq_place_id: fsq });

test('no-op when nothing moved', () => {
  assert.deepEqual(planRekey([ex(3, 'osm', 'node/1', 'f1')], [osmRow(1, 'f1')]), []);
});

test('promote: fsq-only row now matches an OSM place with no row', () => {
  assert.deepEqual(planRekey([ex(7, 'foursquare', 'f1', 'f1')], [osmRow(1, 'f1')]),
    [{ kind: 'promote', id: 7, sourceId: 'node/1', placeId: 'osm:node/1' }]);
});

test('collapse: fsq-only row now matches an OSM place that has a row', () => {
  assert.deepEqual(
    planRekey([ex(7, 'foursquare', 'f1', 'f1'), ex(3, 'osm', 'node/1', null)], [osmRow(1, 'f1')]),
    [{ kind: 'collapse', id: 7, fsqId: 'f1' }]);
});

test('clear: fsq id moved to another OSM row', () => {
  assert.deepEqual(
    planRekey([ex(3, 'osm', 'node/1', 'f1')], [osmRow(1, null), osmRow(2, 'f1')]),
    [{ kind: 'clear_fsq', id: 3 }]);
});

test('clear: OSM row vanished but its fsq id is now used elsewhere', () => {
  assert.deepEqual(planRekey([ex(3, 'osm', 'node/1', 'f1')], [osmRow(2, 'f1')]),
    [{ kind: 'clear_fsq', id: 3 }]);
});

test('clear: new row carries a different fsq id; cleared only once when both conditions hold', () => {
  const actions = planRekey([ex(3, 'osm', 'node/1', 'f1')], [osmRow(1, 'f9'), osmRow(2, 'f1')]);
  assert.deepEqual(actions, [{ kind: 'clear_fsq', id: 3 }]);
});

test('fsq-only row that is still fsq-only produces no action', () => {
  assert.deepEqual(planRekey([ex(7, 'foursquare', 'f1', 'f1')], [fsqRow('f1')]), []);
});

test('actions are ordered clear, promote, collapse, each by id ascending; inputs not mutated', () => {
  const existing = [
    ex(9, 'foursquare', 'f3', 'f3'), ex(8, 'foursquare', 'f2', 'f2'), ex(7, 'foursquare', 'f1', 'f1'),
    ex(6, 'osm', 'node/2', null), ex(5, 'osm', 'node/9', 'f4'), ex(4, 'osm', 'node/8', 'f5'),
  ];
  const rows = [osmRow(1, 'f1'), osmRow(2, 'f2'), osmRow(3, 'f3'), osmRow(4, 'f4'), osmRow(5, 'f5')];
  const snapshot = JSON.stringify([existing, rows]);
  assert.deepEqual(planRekey(existing, rows), [
    { kind: 'clear_fsq', id: 4 }, { kind: 'clear_fsq', id: 5 },
    { kind: 'promote', id: 7, sourceId: 'node/1', placeId: 'osm:node/1' },
    { kind: 'promote', id: 9, sourceId: 'node/3', placeId: 'osm:node/3' },
    { kind: 'collapse', id: 8, fsqId: 'f2' },
  ]);
  assert.equal(JSON.stringify([existing, rows]), snapshot);
});

test('clear: OSM row vanished and its fsq record survives as an fsq-only row', () => {
  assert.deepEqual(planRekey([ex(3, 'osm', 'node/1', 'f1')], [fsqRow('f1')]), [{ kind: 'clear_fsq', id: 3 }]);
});

test('clear: two OSM rows swap fsq ids', () => {
  assert.deepEqual(
    planRekey([ex(3, 'osm', 'node/1', 'f1'), ex(4, 'osm', 'node/2', 'f2')], [osmRow(1, 'f2'), osmRow(2, 'f1')]),
    [{ kind: 'clear_fsq', id: 3 }, { kind: 'clear_fsq', id: 4 }]);
});
