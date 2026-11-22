import test from 'node:test';
import assert from 'node:assert/strict';
import { findCrossTypeDuplicates, splitTypeConflicts, type OtherPlace } from '../src/crossType.ts';
import type { KindRow } from '../src/types.ts';

const LAT = 42.35;
const LNG = -71.06;
const M_PER_DEG_LAT = 111_194.9; // metersBetween's earth radius, along a meridian

function museum(name: string, northMeters: number, id = 'node/1'): KindRow {
  const lat = LAT + northMeters / M_PER_DEG_LAT;
  return {
    place_id: `osm:${id}`, source: 'osm', source_id: id, name, location: `SRID=4326;POINT(${LNG} ${lat})`,
    address: null, website: null, phone: null, hours_raw: null, osm_tags: {}, fsq_place_id: null,
    attribution: 'x', last_seen_at: '2026-11-21T12:00:00.000Z', kind: 'museum',
  };
}

function landmark(name: string): OtherPlace {
  return { placeId: 'osm:way/9', placeType: 'landmarks', name, lat: LAT, lng: LNG };
}

test('a new row 30 m from another type with the same name is a cross-type duplicate', () => {
  const row = museum('Old State House', 30);
  const { kept, duplicates } = findCrossTypeDuplicates([row], [landmark('The Old State House')]);
  assert.deepEqual(kept, []);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0]!.placeId, 'osm:node/1');
  assert.equal(duplicates[0]!.otherPlaceId, 'osm:way/9');
  assert.equal(duplicates[0]!.otherType, 'landmarks');
  assert.ok(Math.abs(duplicates[0]!.meters - 30) < 0.5);
});

test('a similar name (Jaccard 0.67) at 20 m is a duplicate, at 40 m it is kept', () => {
  const near = findCrossTypeDuplicates([museum('Old North Church', 20)], [landmark('Old North')]);
  assert.equal(near.duplicates.length, 1);
  assert.deepEqual(near.kept, []);
  const far = findCrossTypeDuplicates([museum('Old North Church', 40)], [landmark('Old North')]);
  assert.equal(far.duplicates.length, 0);
  assert.equal(far.kept.length, 1);
});

test('a row with an empty name key is kept', () => {
  const { kept, duplicates } = findCrossTypeDuplicates([museum('The', 0)], [landmark('The')]);
  assert.equal(kept.length, 1);
  assert.deepEqual(duplicates, []);
});

test('the same name far away is kept', () => {
  const { kept } = findCrossTypeDuplicates([museum('Old State House', 60)], [landmark('Old State House')]);
  assert.equal(kept.length, 1);
});

test('splitTypeConflicts skips a place_id registered under another type', () => {
  const row = { ...museum('Common', 0, 'way/5'), kind: 'park' };
  const conflict = splitTypeConflicts([row], new Map([['osm:way/5', 'landmarks']]), 'parks');
  assert.deepEqual(conflict.kept, []);
  assert.deepEqual(conflict.conflicts, [{ placeId: 'osm:way/5', registeredAs: 'landmarks' }]);
  const same = splitTypeConflicts([row], new Map([['osm:way/5', 'parks']]), 'parks');
  assert.deepEqual(same.kept, [row]);
  assert.deepEqual(same.conflicts, []);
});
