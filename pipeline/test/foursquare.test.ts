import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFsqQuery, loadFsqRows } from '../src/foursquare.ts';
import { STUDY_BBOX } from '../src/config.ts';

test('buildFsqQuery reads the release path and filters bbox, closed, primary label', () => {
  const sql = buildFsqQuery('2026-01-12', STUDY_BBOX);
  assert.ok(sql.includes('dt=2026-01-12/places/parquet'));
  assert.ok(sql.includes('date_closed is null'));
  assert.ok(sql.includes("starts_with(fsq_category_labels[1], 'Dining and Drinking')"));
  assert.ok(sql.includes('between 42.227 and 42.418'));
  assert.ok(sql.includes('between -71.191 and -70.986'));
});

test('buildFsqQuery rejects a malformed release', () => {
  assert.throws(() => buildFsqQuery("2026-01-12'; drop", STUDY_BBOX));
});

test('loadFsqRows without a token skips', async () => {
  const r = await loadFsqRows({ hfToken: undefined, release: '2026-01-12', refresh: false, cacheDir: '.cache-unused' });
  assert.deepEqual(r, { rows: [], skipped: true, fromCache: false });
});
