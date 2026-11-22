import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parsePhotoArgs, runPool, storeOne, summarizePhotos, type StoreContext } from '../../src/enrichPhotos.ts';
import type { BytesResult } from '../../src/media/http.ts';
import { storagePathFor } from '../../src/media/photoStore.ts';
import type { PhotoToStore } from '../../src/media/db.ts';

const PHOTO: PhotoToStore = { id: 5, placeRef: 7, url: 'https://img.test/a.jpg' };

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#c86428' } }).jpeg().toBuffer());
}

function ctx(download: (url: string) => Promise<BytesResult>, over: Partial<StoreContext> = {}) {
  const log: Array<[string, ...unknown[]]> = [];
  const c: StoreContext = {
    download,
    upload: async (path, webp) => { log.push(['upload', path, webp.byteLength]); },
    recordStored: async (id, path, bytes) => { log.push(['recordStored', id, path, bytes]); },
    recordError: async (id, error) => { log.push(['recordError', id, error]); },
    deleteRow: async (id) => { log.push(['deleteRow', id]); },
    dryRun: false,
    now: () => '2026-11-21T00:00:00Z',
    ...over,
  };
  return { c, log };
}
const okBytes = async (b: Uint8Array): Promise<BytesResult> => ({ ok: true, bytes: b, contentType: 'image/jpeg' });

test('parsePhotoArgs requires --type', () => {
  assert.equal(parsePhotoArgs(['--type', 'parks']).type, 'parks');
  assert.throws(() => parsePhotoArgs([]), /missing --type/);
});

test('parsePhotoArgs defaults and flags', () => {
  assert.deepEqual(parsePhotoArgs(['--type', 'restaurants']), { type: 'restaurants', dryRun: false, limit: null, concurrency: 8, maxMb: 800 });
  assert.deepEqual(parsePhotoArgs(['--type', 'restaurants', '--dry-run', '--limit', '30', '--concurrency', '4', '--max-mb', '100']), { type: 'restaurants', dryRun: true, limit: 30, concurrency: 4, maxMb: 100 });
  assert.throws(() => parsePhotoArgs(['--type', 'restaurants', '--max-mb', '0']), /max-mb/);
});

test('a good image is uploaded at its storage path and then recorded', async () => {
  const big = await jpeg(1600, 1200);
  const { c, log } = ctx(() => okBytes(big));
  const out = await storeOne(PHOTO, c);
  assert.equal(out.kind, 'stored');
  const path = storagePathFor(7, PHOTO.url);
  assert.deepEqual(log.map((l) => l[0]), ['upload', 'recordStored']);
  assert.equal(log[0]![1], path);
  assert.deepEqual(log[1]!.slice(1, 3), [5, path]);
  assert.equal(out.kind === 'stored' && out.bytes, log[0]![2]);
});

test('a too-small image deletes the row without uploading', async () => {
  const small = await jpeg(900, 300);
  const { c, log } = ctx(() => okBytes(small));
  assert.deepEqual(await storeOne(PHOTO, c), { kind: 'rejected', reason: 'too_small' });
  assert.deepEqual(log, [['deleteRow', 5]]);
});

test('a download failure is recorded on the row', async () => {
  const { c, log } = ctx(async () => ({ ok: false, reason: 'http', detail: 'HTTP 404 from x' }));
  assert.deepEqual(await storeOne(PHOTO, c), { kind: 'failed', reason: 'http' });
  assert.deepEqual(log, [['recordError', 5, 'http: HTTP 404 from x']]);
});

test('an upload error is recorded on the row, not thrown', async () => {
  const big = await jpeg(1000, 800);
  const { c, log } = ctx(() => okBytes(big), { upload: async () => { throw new Error('storage full'); } });
  assert.deepEqual(await storeOne(PHOTO, c), { kind: 'failed', reason: 'upload' });
  assert.deepEqual(log, [['recordError', 5, 'upload: storage full']]);
});

test('a dry run writes nothing', async () => {
  const big = await jpeg(1000, 800);
  const { c, log } = ctx(() => okBytes(big), { dryRun: true });
  assert.equal((await storeOne(PHOTO, c)).kind, 'stored');
  const small = await jpeg(900, 300);
  const d2 = ctx(() => okBytes(small), { dryRun: true });
  await storeOne(PHOTO, d2.c);
  assert.deepEqual([...log, ...d2.log], []);
});

test('runPool stops starting downloads once the budget is reached', async () => {
  const img = await jpeg(1600, 1200);
  let downloads = 0;
  const { c } = ctx(async () => { downloads++; return okBytes(img); });
  const one = await storeOne(PHOTO, ctx(() => okBytes(img)).c);
  const size = one.kind === 'stored' ? one.bytes : 0;
  const photos = Array.from({ length: 10 }, (_, i) => ({ ...PHOTO, id: i, url: `https://img.test/${i}.jpg` }));
  const r = await runPool(photos, c, { concurrency: 1, budgetBytes: Math.floor(size * 2.5), usedBytes: 0 });
  assert.equal(r.stoppedForBudget, true);
  assert.equal(r.outcomes.filter((o) => o.kind === 'stored').length, 3);
  assert.equal(downloads, 3);
});

test('runPool with usedBytes already over budget starts nothing', async () => {
  let downloads = 0;
  const { c } = ctx(async () => { downloads++; return { ok: false, reason: 'http', detail: 'x' }; });
  const r = await runPool([PHOTO], c, { concurrency: 2, budgetBytes: 100, usedBytes: 100 });
  assert.equal(r.stoppedForBudget, true);
  assert.equal(downloads, 0);
});

test('summarizePhotos counts outcomes and MB', () => {
  const s = summarizePhotos({
    outcomes: [
      { kind: 'stored', bytes: 1_500_000 }, { kind: 'stored', bytes: 500_000 },
      { kind: 'rejected', reason: 'too_small' }, { kind: 'rejected', reason: 'not_image' },
      { kind: 'failed', reason: 'http' }, { kind: 'failed', reason: 'http' },
    ],
    stoppedForBudget: false,
  }, 10_000_000);
  assert.equal(s, [
    'Photos processed: 6',
    'Stored: 2 (2.0 MB this run, 12.0 MB total)',
    'Rejected: too_small 1, not_image 1',
    'Failed: http 2',
    'Stopped for budget: no',
  ].join('\n'));
});
