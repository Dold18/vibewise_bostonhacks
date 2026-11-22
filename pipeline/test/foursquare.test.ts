import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFsqQuery, loadFsqRows } from '../src/foursquare.ts';
import { STUDY_BBOX } from '../src/config.ts';
import { PLACE_TYPE_CONFIG } from '../src/placeTypes.ts';

const FOOD = PLACE_TYPE_CONFIG.restaurants;

test('buildFsqQuery for restaurants is the exact food query', () => {
  assert.equal(buildFsqQuery('2026-01-12', STUDY_BBOX, FOOD), [
    'select fsq_place_id, name, latitude, longitude, address, locality, postcode, tel, website,',
    '  fsq_category_labels, date_refreshed',
    "from read_parquet('hf://datasets/foursquare/fsq-os-places/release/dt=2026-01-12/places/parquet/*.parquet')",
    'where latitude between 42.227 and 42.418',
    '  and longitude between -71.191 and -70.986',
    '  and date_closed is null',
    "  and starts_with(fsq_category_labels[1], 'Dining and Drinking')",
  ].join('\n'));
});

test('buildFsqQuery ors several top-level categories', () => {
  const lines = buildFsqQuery('2026-01-12', STUDY_BBOX, PLACE_TYPE_CONFIG.entertainment).split('\n');
  assert.equal(
    lines.at(-1),
    "  and (starts_with(fsq_category_labels[1], 'Arts and Entertainment') or starts_with(fsq_category_labels[1], 'Sports and Recreation'))",
  );
});

test('buildFsqQuery reads the release path and filters bbox, closed, primary label', () => {
  const sql = buildFsqQuery('2026-01-12', STUDY_BBOX, FOOD);
  assert.ok(sql.includes('dt=2026-01-12/places/parquet'));
  assert.ok(sql.includes('date_closed is null'));
  assert.ok(sql.includes("starts_with(fsq_category_labels[1], 'Dining and Drinking')"));
  assert.ok(sql.includes('between 42.227 and 42.418'));
  assert.ok(sql.includes('between -71.191 and -70.986'));
});

test('buildFsqQuery rejects a malformed release', () => {
  assert.throws(() => buildFsqQuery("2026-01-12'; drop", STUDY_BBOX, FOOD));
});

test('loadFsqRows without a token skips', async () => {
  const r = await loadFsqRows({ hfToken: undefined, release: '2026-01-12', refresh: false, cacheDir: '.cache-unused', cfg: FOOD });
  assert.deepEqual(r, { rows: [], skipped: true, fromCache: false });
});

test('loadFsqRows returns cached rows without a token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsq-cache-'));
  try {
    await fs.writeFile(path.join(dir, 'fsq-restaurants-2026-01-12.json'), JSON.stringify([{ fsq_place_id: 'a' }]));
    const r = await loadFsqRows({ hfToken: undefined, release: '2026-01-12', refresh: false, cacheDir: dir, cfg: FOOD });
    assert.deepEqual(r, { rows: [{ fsq_place_id: 'a' }], skipped: false, fromCache: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('loadFsqRows reads the per-type cache file only', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsq-cache-'));
  try {
    await fs.writeFile(path.join(dir, 'fsq-restaurants-2026-01-12.json'), JSON.stringify([{ fsq_place_id: 'food' }]));
    await fs.writeFile(path.join(dir, 'fsq-museums-2026-01-12.json'), JSON.stringify([{ fsq_place_id: 'museum' }]));
    const r = await loadFsqRows({
      hfToken: undefined, release: '2026-01-12', refresh: false, cacheDir: dir, cfg: PLACE_TYPE_CONFIG.museums,
    });
    assert.deepEqual(r.rows, [{ fsq_place_id: 'museum' }]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
