import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOverrides, validateOverrides } from '../src/overrides.ts';
import type { KindRow } from '../src/types.ts';

function park(placeId: string, address: string | null): KindRow {
  return {
    place_id: placeId, source: 'osm', source_id: placeId.slice(4), name: 'Franklin Park',
    location: 'SRID=4326;POINT(-71.09 42.30)', address, website: null, phone: null, hours_raw: null,
    osm_tags: {}, fsq_place_id: null, attribution: 'x', last_seen_at: '2026-11-22T12:00:00.000Z', kind: 'park',
  };
}

const GOOD = {
  place_id: 'osm:relation/65053',
  set: { address: '1 Franklin Park Road, Boston 02121' },
  reason: 'Foursquare street was wrong',
  source_url: 'https://www.boston.gov/parks/franklin-park',
  checked_on: '2026-11-22',
};

test('validateOverrides accepts a well-formed entry', () => {
  const { overrides, errors } = validateOverrides([GOOD]);
  assert.deepEqual(errors, []);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0]!.set.address, '1 Franklin Park Road, Boston 02121');
});

test('validateOverrides rejects bad entries with a reason and keeps the good ones', () => {
  const { overrides, errors } = validateOverrides([
    GOOD,
    { ...GOOD, place_id: '' },
    { ...GOOD, set: { name: 'x' } },
    { ...GOOD, set: {} },
    { ...GOOD, source_url: 'not a url' },
    { ...GOOD, checked_on: '2026-13-40' },
    { ...GOOD, reason: '' },
    { ...GOOD, set: { address: 3 } },
  ]);
  assert.equal(overrides.length, 1);
  assert.equal(errors.length, 7);
  assert.match(errors[0]!, /entry 1: place_id/);
  assert.match(errors[1]!, /entry 2: .*name/);
});

test('validateOverrides rejects a non-array file and duplicate place_ids', () => {
  assert.deepEqual(validateOverrides({}).errors, ['overrides file must be a JSON array']);
  const { overrides, errors } = validateOverrides([GOOD, GOOD]);
  assert.equal(overrides.length, 1);
  assert.match(errors[0]!, /duplicate place_id/);
});

test('validateOverrides allows null to clear a field', () => {
  const { overrides, errors } = validateOverrides([{ ...GOOD, set: { phone: null } }]);
  assert.deepEqual(errors, []);
  assert.equal(overrides[0]!.set.phone, null);
});

test('applyOverrides sets only the listed fields on matching rows', () => {
  const rows = [park('osm:relation/65053', 'Pier Point Rd, Boston 02130'), park('osm:way/1', 'Somewhere')];
  const { overrides } = validateOverrides([GOOD]);
  const applied = applyOverrides(rows, overrides);
  assert.deepEqual(applied, ['osm:relation/65053']);
  assert.equal(rows[0]!.address, '1 Franklin Park Road, Boston 02121');
  assert.equal(rows[0]!.website, null);
  assert.equal(rows[1]!.address, 'Somewhere');
});

test('applyOverrides ignores overrides for places not in this run', () => {
  const rows = [park('osm:way/1', 'Somewhere')];
  const { overrides } = validateOverrides([GOOD]);
  assert.deepEqual(applyOverrides(rows, overrides), []);
  assert.equal(rows[0]!.address, 'Somewhere');
});
