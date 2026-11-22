import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deletePhotoRow, fetchEnrichPlaces, fetchHiddenKeys, fetchPhotosToStore, recordStored, storedBytesTotal, uploadCopy, writePlaceMedia,
} from '../../src/media/db.ts';
import type { PhotoCandidate } from '../../src/media/types.ts';

type Call = { table: string; op: string; args: unknown[] };
type Result = { data?: unknown; error: null | { message: string } };

/**
 * A chainable fake of the supabase-js query builder that records every call. `resultFor` gets the table, all calls
 * so far and the ops of this one query (e.g. ['select', 'eq', 'eq']). Storage calls are recorded as table `storage:<bucket>`.
 */
function fakeClient(resultFor: (table: string, calls: Call[], ops: string[]) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: string[] = [];
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'delete', 'insert', 'upsert', 'update', 'eq', 'neq', 'is', 'order', 'range', 'in', 'not']) {
        builder[op] = (...args: unknown[]) => { calls.push({ table, op, args }); ops.push(op); return builder; };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve(resultFor(table, calls, ops));
      return builder;
    },
    storage: {
      from(bucket: string) {
        const table = `storage:${bucket}`;
        return {
          async upload(...args: unknown[]) { calls.push({ table, op: 'upload', args }); return resultFor(table, calls, ['upload']); },
          async remove(...args: unknown[]) { calls.push({ table, op: 'remove', args }); return resultFor(table, calls, ['remove']); },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const PHOTO: PhotoCandidate & { rank: number } = {
  kind: 'website', source: 'website', matchMethod: 'website', url: 'https://a/1.jpg', mapillaryId: null,
  pageUrl: 'https://a/', license: null, credit: 'a', rank: 3,
};

test('writePlaceMedia never deletes student or hidden photos', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 'museums', 7, [PHOTO], [{ source: 'website', content: 'hi', sourceUrl: 'https://a/' }], '2026-11-21T00:00:00Z');
  const del = calls.findIndex((c) => c.table === 'place_photos' && c.op === 'delete');
  assert.ok(del >= 0);
  const filters = calls.slice(del + 1).filter((c) => c.table === 'place_photos' && ['eq', 'neq'].includes(c.op)).map((c) => [c.op, ...c.args]);
  assert.deepEqual(filters.slice(0, 3).sort(), [['eq', 'hidden', false], ['eq', 'place_ref', 7], ['neq', 'kind', 'student']].sort());
});

test('writePlaceMedia inserts snake_case photo rows and upserts inputs on (place_ref, source)', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 'museums', 7, [PHOTO], [{ source: 'website', content: 'hi', sourceUrl: 'https://a/' }], '2026-11-21T00:00:00Z');
  const ins = calls.find((c) => c.table === 'place_photos' && c.op === 'insert')!;
  assert.deepEqual(ins.args[0], [{
    place_ref: 7, kind: 'website', source: 'website', match_method: 'website', url: 'https://a/1.jpg', mapillary_id: null,
    page_url: 'https://a/', license: null, credit: 'a', rank: 3, checked_at: '2026-11-21T00:00:00Z',
  }]);
  const ups = calls.find((c) => c.table === 'place_vibe_inputs' && c.op === 'upsert')!;
  assert.deepEqual(ups.args[0], [{ place_ref: 7, source: 'website', content: 'hi', source_url: 'https://a/', fetched_at: '2026-11-21T00:00:00Z' }]);
  assert.deepEqual(ups.args[1], { onConflict: 'place_ref,source' });
  const upd = calls.find((c) => c.table === 'museums' && c.op === 'update')!;
  assert.deepEqual(upd.args[0], { media_checked_at: '2026-11-21T00:00:00Z' });
  const next = calls[calls.indexOf(upd) + 1]!;
  assert.deepEqual([next.op, ...next.args], ['eq', 'id', 7]);
});

test('writePlaceMedia skips empty insert and upsert calls', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 'museums', 7, [], [], '2026-11-21T00:00:00Z');
  assert.equal(calls.some((c) => c.op === 'insert' || c.op === 'upsert'), false);
  assert.ok(calls.some((c) => c.table === 'museums' && c.op === 'update'));
});

test('writePlaceMedia surfaces a database error', async () => {
  const { client } = fakeClient((table) => (table === 'place_photos' ? { error: { message: 'boom' } } : { error: null }));
  await assert.rejects(writePlaceMedia(client, 'museums', 7, [PHOTO], [], 'now'), /boom/);
});

test('fetchEnrichPlaces maps view rows to EnrichPlace and filters unchecked rows unless refresh', async () => {
  const row = { id: 1, place_id: 'osm:node/1', name: 'A', lat: 42.3, lng: -71.1, website: null, address: 'x', osm_tags: { a: 'b' }, media_checked_at: null };
  const { client, calls } = fakeClient(() => ({ data: [row], error: null }));
  const out = await fetchEnrichPlaces(client, { refresh: false, type: 'parks' });
  assert.deepEqual(out, [{ id: 1, placeId: 'osm:node/1', name: 'A', lat: 42.3, lng: -71.1, website: null, address: 'x', osmTags: { a: 'b' } }]);
  assert.equal(calls[0]!.table, 'place_points');
  assert.ok(calls.some((c) => c.op === 'eq' && c.args[0] === 'place_type' && c.args[1] === 'parks'));
  assert.ok(calls.some((c) => c.op === 'is' && c.args[0] === 'media_checked_at' && c.args[1] === null));
  const again = fakeClient(() => ({ data: [row], error: null }));
  await fetchEnrichPlaces(again.client, { refresh: true, type: 'parks' });
  assert.equal(again.calls.some((c) => c.op === 'is'), false);
});

test('fetchHiddenKeys filters on hidden rows of the place', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ url: 'https://a/h.jpg' }, { url: null }], error: null }));
  assert.deepEqual([...await fetchHiddenKeys(client, 7)], ['https://a/h.jpg']);
  assert.ok(calls.some((c) => c.op === 'eq' && c.args[0] === 'hidden' && c.args[1] === true));
});

test('fetchHiddenKeys returns URL keys and mapillary: keys', async () => {
  const { client } = fakeClient(() => ({ data: [{ url: 'https://a/h.jpg', mapillary_id: null }, { url: null, mapillary_id: 'm1' }], error: null }));
  assert.deepEqual([...await fetchHiddenKeys(client, 7)].sort(), ['https://a/h.jpg', 'mapillary:m1']);
});

test('writePlaceMedia removes inputs whose source is absent this run, except kept ones', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 'museums', 7, [], [{ source: 'osm_tags', content: 'x', sourceUrl: null }], 'now', ['website']);
  const del = calls.findIndex((c) => c.table === 'place_vibe_inputs' && c.op === 'delete');
  assert.ok(del >= 0);
  const after = calls.slice(del + 1).filter((c) => c.table === 'place_vibe_inputs');
  assert.ok(after.some((c) => c.op === 'eq' && c.args[0] === 'place_ref' && c.args[1] === 7));
  assert.ok(after.some((c) => c.op === 'not' && c.args[0] === 'source' && c.args[1] === 'in' && c.args[2] === '("osm_tags","website")'));
});

test('writePlaceMedia with no inputs and nothing kept removes all of the place inputs', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 'museums', 7, [], [], 'now');
  const del = calls.findIndex((c) => c.table === 'place_vibe_inputs' && c.op === 'delete');
  assert.ok(del >= 0);
  assert.equal(calls.slice(del + 1).some((c) => c.table === 'place_vibe_inputs' && c.op === 'not'), false);
});

const OLD_ROWS = [
  { url: 'https://a/1.jpg', storage_path: 'pipeline/7/aa.webp', stored_at: 't1', stored_bytes: 50000 },
  { url: 'https://a/2.jpg', storage_path: 'pipeline/7/bb.webp', stored_at: 't2', stored_bytes: 40000 },
  { url: 'https://a/3.jpg', storage_path: null, stored_at: null, stored_bytes: null },
];
const oldRowsClient = () => fakeClient((table, _calls, ops) =>
  (table === 'place_photos' && ops[0] === 'select' ? { data: OLD_ROWS, error: null } : { error: null }));

test('writePlaceMedia keeps the stored copy of a photo whose URL survives', async () => {
  const { client, calls } = oldRowsClient();
  await writePlaceMedia(client, 'museums', 7, [PHOTO], [], 'now');
  const ins = calls.find((c) => c.table === 'place_photos' && c.op === 'insert')!;
  const row = (ins.args[0] as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual([row.storage_path, row.stored_at, row.stored_bytes], ['pipeline/7/aa.webp', 't1', 50000]);
  const sel = calls.findIndex((c) => c.table === 'place_photos' && c.op === 'select');
  const del = calls.findIndex((c) => c.table === 'place_photos' && c.op === 'delete');
  assert.ok(sel >= 0 && sel < del, 'existing rows are read before the delete');
});

test('writePlaceMedia removes stored files whose photo dropped out', async () => {
  const { client, calls } = oldRowsClient();
  await writePlaceMedia(client, 'museums', 7, [PHOTO], [], 'now');
  const rm = calls.filter((c) => c.table === 'storage:place-photos' && c.op === 'remove');
  assert.deepEqual(rm.map((c) => c.args[0]), [['pipeline/7/bb.webp']]);
});

test('writePlaceMedia makes no storage call when nothing is orphaned', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 'museums', 7, [PHOTO], [], 'now');
  assert.equal(calls.some((c) => c.table.startsWith('storage:')), false);
});

test('fetchPhotosToStore filters to visible, unstored, non-Mapillary pipeline photos with a URL', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ id: 1, place_ref: 7, url: 'https://a/1.jpg' }], error: null }));
  assert.deepEqual(await fetchPhotosToStore(client, { limit: null, type: 'parks' }), [{ id: 1, placeRef: 7, url: 'https://a/1.jpg' }]);
  const f = calls.map((c) => [c.op, ...c.args]);
  assert.ok(f.some((x) => x[0] === 'eq' && x[1] === 'places.place_type' && x[2] === 'parks'));
  assert.ok(f.some((x) => x[0] === 'eq' && x[1] === 'hidden' && x[2] === false));
  assert.ok(f.some((x) => x[0] === 'in' && x[1] === 'kind' && JSON.stringify(x[2]) === '["website","licensed"]'));
  assert.ok(f.some((x) => x[0] === 'neq' && x[1] === 'source' && x[2] === 'mapillary'));
  assert.ok(f.some((x) => x[0] === 'not' && x[1] === 'url' && x[2] === 'is' && x[3] === null));
  assert.ok(f.some((x) => x[0] === 'is' && x[1] === 'storage_path' && x[2] === null));
});

test('recordStored writes the path, size and time and clears the error', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await recordStored(client, 5, 'pipeline/7/aa.webp', 1234, 'now');
  const upd = calls.find((c) => c.op === 'update')!;
  assert.deepEqual(upd.args[0], { storage_path: 'pipeline/7/aa.webp', stored_bytes: 1234, stored_at: 'now', store_error: null });
  assert.ok(calls.some((c) => c.op === 'eq' && c.args[0] === 'id' && c.args[1] === 5));
});

test('storedBytesTotal sums stored_bytes', async () => {
  const { client } = fakeClient(() => ({ data: [{ stored_bytes: 1000 }, { stored_bytes: 2500 }], error: null }));
  assert.equal(await storedBytesTotal(client), 3500);
});

test('uploadCopy uploads WebP with upsert to the place-photos bucket', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await uploadCopy(client, 'pipeline/7/aa.webp', new Uint8Array([1]));
  const up = calls.find((c) => c.op === 'upload')!;
  assert.equal(up.table, 'storage:place-photos');
  assert.equal(up.args[0], 'pipeline/7/aa.webp');
  assert.deepEqual(up.args[2], { contentType: 'image/webp', upsert: true });
});

test('deletePhotoRow never deletes a hidden row', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await deletePhotoRow(client, 5);
  assert.ok(calls.some((c) => c.op === 'delete'));
  assert.ok(calls.some((c) => c.op === 'eq' && c.args[0] === 'id' && c.args[1] === 5));
  assert.ok(calls.some((c) => c.op === 'eq' && c.args[0] === 'hidden' && c.args[1] === false));
});
