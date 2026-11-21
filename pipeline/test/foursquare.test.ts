import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

test('loadFsqRows returns cached rows without a token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsq-cache-'));
  try {
    await fs.writeFile(path.join(dir, 'fsq-2026-01-12.json'), JSON.stringify([{ fsq_place_id: 'a' }]));
    const r = await loadFsqRows({ hfToken: undefined, release: '2026-01-12', refresh: false, cacheDir: dir });
    assert.deepEqual(r, { rows: [{ fsq_place_id: 'a' }], skipped: false, fromCache: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
