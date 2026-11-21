import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildOverpassQuery, fetchOverpass, loadOsmElements } from '../src/osm.ts';
import { OSM_AMENITIES, STUDY_BBOX, USER_AGENT } from '../src/config.ts';
import type { OverpassElement } from '../src/sources.ts';

const EL: OverpassElement = { type: 'node', id: 1, lat: 42.35, lon: -71.06, tags: { name: 'A', amenity: 'cafe' } };
const MIRRORS = ['https://m1.test/api', 'https://m2.test/api'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function harness(responses: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(i++, responses.length - 1)]!;
    return next();
  }) as typeof fetch;
  const sleep = async (ms: number) => { sleeps.push(ms); };
  return { calls, sleeps, deps: { fetchImpl, sleep, mirrors: MIRRORS } };
}

test('buildOverpassQuery pins bbox order south,west,north,east and the amenity regex', () => {
  const q = buildOverpassQuery(STUDY_BBOX, [...OSM_AMENITIES]);
  assert.ok(q.includes('(42.227,-71.191,42.418,-70.986)'));
  assert.ok(q.includes('^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court)$'));
  assert.ok(q.startsWith('[out:json][timeout:180];'));
  assert.ok(q.endsWith('out center tags;'));
});

test('sends the descriptive User-Agent as a POST data= form body', async () => {
  const h = harness([() => json({ elements: [EL] })]);
  const out = await fetchOverpass('Q', h.deps);
  assert.deepEqual(out, [EL]);
  const init = h.calls[0]!.init;
  assert.equal(init.method, 'POST');
  assert.equal((init.headers as Record<string, string>)['User-Agent'], USER_AGENT);
  assert.equal(init.body, 'data=Q');
  assert.ok(init.signal);
});

test('retries a 429 then succeeds; sleeps 5000 then 10000', async () => {
  const h = harness([() => json({}, 429), () => json({}, 429), () => json({ elements: [EL] })]);
  const out = await fetchOverpass('Q', h.deps);
  assert.equal(out.length, 1);
  assert.deepEqual(h.sleeps, [5000, 10000]);
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every((c) => c.url === MIRRORS[0]));
});

test('a 200 with a runtime-error remark is a failed attempt', async () => {
  const h = harness([
    () => json({ remark: 'runtime error: Query timed out in "query" at line 1', elements: [EL] }),
    () => json({ elements: [EL] }),
  ]);
  await fetchOverpass('Q', h.deps);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.sleeps, [5000]);
});

test('a 200 with zero elements is a failed attempt', async () => {
  const h = harness([() => json({ elements: [] }), () => json({ elements: [EL] })]);
  const out = await fetchOverpass('Q', h.deps);
  assert.equal(out.length, 1);
  assert.equal(h.calls.length, 2);
});

test('a network error (including timeout) is a failed attempt', async () => {
  const h = harness([() => { throw new TypeError('fetch failed'); }, () => json({ elements: [EL] })]);
  const out = await fetchOverpass('Q', h.deps);
  assert.equal(out.length, 1);
  assert.deepEqual(h.sleeps, [5000]);
});

test('falls back to the second mirror after 4 failures on the first', async () => {
  const h = harness([() => json({}, 503), () => json({}, 503), () => json({}, 503), () => json({}, 503), () => json({ elements: [EL] })]);
  const out = await fetchOverpass('Q', h.deps);
  assert.equal(out.length, 1);
  assert.deepEqual(h.calls.map((c) => c.url), [...Array(4).fill(MIRRORS[0]), MIRRORS[1]]);
  // sleeps only between attempts on the same mirror, none before switching mirrors
  assert.deepEqual(h.sleeps, [5000, 10000, 20000]);
});

test('throws after all mirrors fail, naming the last failure', async () => {
  const h = harness([() => json({}, 503)]);
  await assert.rejects(() => fetchOverpass('Q', h.deps), /503/);
  assert.equal(h.calls.length, 8);
  assert.deepEqual(h.sleeps, [5000, 10000, 20000, 5000, 10000, 20000]);
});

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'osm-test-'));
}

test('loadOsmElements writes the cache after a fetch, then serves it without fetching', async () => {
  const dir = await tmpDir();
  try {
    const h = harness([() => json({ elements: [EL] })]);
    const first = await loadOsmElements({ refresh: false, cacheDir: dir, today: '2026-11-21' }, h.deps);
    assert.equal(first.fromCache, false);
    assert.equal(h.calls.length, 1);
    const cached = JSON.parse(await fs.readFile(path.join(dir, 'osm-2026-11-21.json'), 'utf8'));
    assert.deepEqual(cached, [EL]);

    const second = await loadOsmElements({ refresh: false, cacheDir: dir, today: '2026-11-21' }, h.deps);
    assert.equal(second.fromCache, true);
    assert.deepEqual(second.elements, [EL]);
    assert.equal(h.calls.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('loadOsmElements refresh bypasses an existing cache and rewrites it', async () => {
  const dir = await tmpDir();
  try {
    await fs.writeFile(path.join(dir, 'osm-2026-11-21.json'), JSON.stringify([{ type: 'node', id: 99 }]));
    const h = harness([() => json({ elements: [EL] })]);
    const out = await loadOsmElements({ refresh: true, cacheDir: dir, today: '2026-11-21' }, h.deps);
    assert.equal(out.fromCache, false);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'osm-2026-11-21.json'), 'utf8')), [EL]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('loadOsmElements ignores a cache file from another day', async () => {
  const dir = await tmpDir();
  try {
    await fs.writeFile(path.join(dir, 'osm-2026-11-20.json'), JSON.stringify([{ type: 'node', id: 99 }]));
    const h = harness([() => json({ elements: [EL] })]);
    const out = await loadOsmElements({ refresh: false, cacheDir: dir, today: '2026-11-21' }, h.deps);
    assert.equal(out.fromCache, false);
    assert.equal(h.calls.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
