import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCampuses, loadDemoIds, loadStops, tierOf } from '../../src/media/priority.ts';
import type { EnrichPlace } from '../../src/media/types.ts';

const M = 1 / 111_195; // degrees of latitude per meter
const STOP = { lat: 42.35, lng: -71.08 };
const CAMPUS = { lat: 42.35 + 1000 * M, lng: -71.08 };
const place = (o: Partial<EnrichPlace>): EnrichPlace => ({ id: 1, placeId: 'osm:node/1', name: 'X', lat: 42.35 + 300 * M, lng: -71.08, website: null, address: null, osmTags: null, ...o });
const ctx = (demo: string[] = []) => ({ demo: new Set(demo), stops: [STOP], campuses: [CAMPUS] });

test('a demo place is tier 1', () => {
  assert.equal(tierOf(place({ lat: 0, lng: 0 }), ctx(['osm:node/1'])), 1);
});

test('300 m from a stop and about 700 m from a campus is tier 2', () => {
  assert.equal(tierOf(place({}), ctx()), 2);
});

test('near a stop but 3 km from any campus is tier 3', () => {
  assert.equal(tierOf(place({}), { ...ctx(), campuses: [{ lat: 42.35 - 3000 * M, lng: -71.08 }] }), 3);
});

test('near a campus but 900 m from any stop is tier 3', () => {
  assert.equal(tierOf(place({ lat: 42.35 + 900 * M }), { ...ctx(), campuses: [{ lat: 42.35 + 900 * M, lng: -71.08 }] }), 3);
});

test('loadDemoIds ignores comments and blank lines; a missing file gives an empty set', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-'));
  const file = path.join(dir, 'demo-places.txt');
  await fs.writeFile(file, '# demo list\nosm:node/1\n\n  fsq:abc  # note\n');
  assert.deepEqual([...await loadDemoIds(file)].sort(), ['fsq:abc', 'osm:node/1']);
  assert.equal((await loadDemoIds(path.join(dir, 'missing.txt'))).size, 0);
});

test('loadCampuses returns the app universities and loadStops the rapid-transit stops', async () => {
  const campuses = await loadCampuses();
  const stops = await loadStops();
  assert.ok(campuses.length >= 10);
  assert.ok(stops.length >= 100);
  for (const p of [...campuses, ...stops]) assert.ok(p.lat > 42 && p.lat < 43 && p.lng > -72 && p.lng < -70.5);
});
