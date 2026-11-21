import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEnrichPlaces, fetchHiddenUrls, writePlaceMedia } from '../../src/media/db.ts';
import type { PhotoCandidate } from '../../src/media/types.ts';

type Call = { table: string; op: string; args: unknown[] };

/** A chainable fake of the supabase-js query builder that records every call and resolves to `result`. */
function fakeClient(resultFor: (table: string, calls: Call[]) => { data?: unknown; error: null | { message: string } }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'delete', 'insert', 'upsert', 'update', 'eq', 'neq', 'is', 'order', 'range', 'in', 'not']) {
        builder[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return builder; };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve(resultFor(table, calls));
      return builder;
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
  await writePlaceMedia(client, 7, [PHOTO], [{ source: 'website', content: 'hi', sourceUrl: 'https://a/' }], '2026-11-21T00:00:00Z');
  const del = calls.findIndex((c) => c.table === 'place_photos' && c.op === 'delete');
  assert.ok(del >= 0);
  const filters = calls.slice(del + 1).filter((c) => c.table === 'place_photos' && ['eq', 'neq'].includes(c.op)).map((c) => [c.op, ...c.args]);
  assert.deepEqual(filters.slice(0, 3).sort(), [['eq', 'hidden', false], ['eq', 'restaurant_id', 7], ['neq', 'kind', 'student']].sort());
});

test('writePlaceMedia inserts snake_case photo rows and upserts inputs on (restaurant_id, source)', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 7, [PHOTO], [{ source: 'website', content: 'hi', sourceUrl: 'https://a/' }], '2026-11-21T00:00:00Z');
  const ins = calls.find((c) => c.table === 'place_photos' && c.op === 'insert')!;
  assert.deepEqual(ins.args[0], [{
    restaurant_id: 7, kind: 'website', source: 'website', match_method: 'website', url: 'https://a/1.jpg', mapillary_id: null,
    page_url: 'https://a/', license: null, credit: 'a', rank: 3, checked_at: '2026-11-21T00:00:00Z',
  }]);
  const ups = calls.find((c) => c.table === 'place_vibe_inputs' && c.op === 'upsert')!;
  assert.deepEqual(ups.args[0], [{ restaurant_id: 7, source: 'website', content: 'hi', source_url: 'https://a/', fetched_at: '2026-11-21T00:00:00Z' }]);
  assert.deepEqual(ups.args[1], { onConflict: 'restaurant_id,source' });
  const upd = calls.find((c) => c.table === 'restaurants' && c.op === 'update')!;
  assert.deepEqual(upd.args[0], { media_checked_at: '2026-11-21T00:00:00Z' });
});

test('writePlaceMedia skips empty insert and upsert calls', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await writePlaceMedia(client, 7, [], [], '2026-11-21T00:00:00Z');
  assert.equal(calls.some((c) => c.op === 'insert' || c.op === 'upsert'), false);
  assert.ok(calls.some((c) => c.table === 'restaurants' && c.op === 'update'));
});

test('writePlaceMedia surfaces a database error', async () => {
  const { client } = fakeClient((table) => (table === 'place_photos' ? { error: { message: 'boom' } } : { error: null }));
  await assert.rejects(writePlaceMedia(client, 7, [PHOTO], [], 'now'), /boom/);
});

test('fetchEnrichPlaces maps view rows to EnrichPlace and filters unchecked rows unless refresh', async () => {
  const row = { id: 1, place_id: 'osm:node/1', name: 'A', lat: 42.3, lng: -71.1, website: null, address: 'x', osm_tags: { a: 'b' }, media_checked_at: null };
  const { client, calls } = fakeClient(() => ({ data: [row], error: null }));
  const out = await fetchEnrichPlaces(client, { refresh: false });
  assert.deepEqual(out, [{ id: 1, placeId: 'osm:node/1', name: 'A', lat: 42.3, lng: -71.1, website: null, address: 'x', osmTags: { a: 'b' } }]);
  assert.equal(calls[0]!.table, 'restaurant_points');
  assert.ok(calls.some((c) => c.op === 'is' && c.args[0] === 'media_checked_at' && c.args[1] === null));
  const again = fakeClient(() => ({ data: [row], error: null }));
  await fetchEnrichPlaces(again.client, { refresh: true });
  assert.equal(again.calls.some((c) => c.op === 'is'), false);
});

test('fetchHiddenUrls returns hidden photo URLs for the place', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ url: 'https://a/h.jpg' }, { url: null }], error: null }));
  assert.deepEqual([...await fetchHiddenUrls(client, 7)], ['https://a/h.jpg']);
  assert.ok(calls.some((c) => c.op === 'eq' && c.args[0] === 'hidden' && c.args[1] === true));
});
