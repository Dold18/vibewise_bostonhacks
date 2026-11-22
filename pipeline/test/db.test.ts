import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyRekey, deleteRegistryRows, fetchExisting, fetchOtherTypePlaces, fetchRegisteredTypes, fetchRegistry, listNotSeen,
  registerPlaces, upsertRows,
} from '../src/db.ts';
import type { KindRow, PlaceRow } from '../src/types.ts';

type Call = { table: string; op: string; args: unknown[] };
type Result = { data?: unknown; error: null | { message: string } };

/** A chainable fake of the supabase-js query builder that records every call (same pattern as test/media/db.test.ts). */
function fakeClient(resultFor: (table: string, calls: Call[], ops: string[]) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: string[] = [];
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'delete', 'insert', 'upsert', 'update', 'eq', 'neq', 'is', 'or', 'order', 'range', 'in']) {
        builder[op] = (...args: unknown[]) => { calls.push({ table, op, args }); ops.push(op); return builder; };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve(resultFor(table, calls, ops));
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function row(n: number): KindRow & { id: number } {
  return {
    id: n, place_id: `osm:node/${n}`, source: 'osm', source_id: `node/${n}`, name: `Place ${n}`,
    location: 'SRID=4326;POINT(-71.06 42.35)', address: null, website: null, phone: null, hours_raw: null,
    osm_tags: {}, fsq_place_id: null, attribution: 'x', last_seen_at: 'now', kind: 'museum',
  };
}

test('applyRekey collapse deletes the registry row by id', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await applyRekey(client, 'parks', [{ kind: 'collapse', id: 7, fsqId: 'f' }]);
  assert.deepEqual(calls, [
    { table: 'places', op: 'delete', args: [] },
    { table: 'places', op: 'eq', args: ['id', 7] },
  ]);
});

test('applyRekey clear_fsq and promote update the type table', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await applyRekey(client, 'parks', [
    { kind: 'clear_fsq', id: 3 },
    { kind: 'promote', id: 4, sourceId: 'way/1', placeId: 'osm:way/1' },
  ]);
  const updates = calls.filter((c) => c.op === 'update');
  assert.deepEqual(updates.map((c) => c.table), ['parks', 'parks']);
  assert.deepEqual(updates[1]!.args[0], { source: 'osm', source_id: 'way/1', place_id: 'osm:way/1' });
});

test('registerPlaces inserts registry rows of the type and returns their ids', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ id: 42, place_id: 'osm:way/1' }], error: null }));
  const ids = await registerPlaces(client, 'parks', ['osm:way/1']);
  const ins = calls.find((c) => c.op === 'insert')!;
  assert.equal(ins.table, 'places');
  assert.deepEqual(ins.args[0], [{ place_id: 'osm:way/1', place_type: 'parks' }]);
  assert.ok(calls.some((c) => c.op === 'select' && c.args[0] === 'id, place_id'));
  assert.deepEqual([...ids], [['osm:way/1', 42]]);
});

test('registerPlaces makes no call for an empty list and fails when an id is missing', async () => {
  const empty = fakeClient(() => ({ data: [], error: null }));
  assert.equal((await registerPlaces(empty.client, 'parks', [])).size, 0);
  assert.equal(empty.calls.length, 0);
  const { client } = fakeClient(() => ({ data: [], error: null }));
  await assert.rejects(registerPlaces(client, 'parks', ['osm:way/1']), /osm:way\/1/);
});

test('upsertRows targets the type table on (source, source_id) in batches', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await upsertRows(client, 'museums', [row(1), row(2), row(3)], 2);
  const ups = calls.filter((c) => c.op === 'upsert');
  assert.deepEqual(ups.map((c) => c.table), ['museums', 'museums']);
  assert.deepEqual(ups[0]!.args[1], { onConflict: 'source,source_id' });
  assert.deepEqual((ups[0]!.args[0] as PlaceRow[]).map((r) => r.id), [1, 2]);
});

test('upsertRows surfaces a database error', async () => {
  const { client } = fakeClient(() => ({ error: { message: 'boom' } }));
  await assert.rejects(upsertRows(client, 'museums', [row(1)]), /boom/);
});

test('fetchExisting and listNotSeen read the given type table', async () => {
  const { client, calls } = fakeClient(() => ({ data: [], error: null }));
  await fetchExisting(client, 'landmarks');
  await listNotSeen(client, 'landmarks', '2026-11-21T00:00:00Z');
  assert.deepEqual([...new Set(calls.map((c) => c.table))], ['landmarks']);
});

test('fetchOtherTypePlaces reads catalog_places of other types and decodes the location', async () => {
  // SRID=4326;POINT(-71.06 42.35) as little-endian EWKB
  const buf = new DataView(new ArrayBuffer(25));
  buf.setUint8(0, 1); buf.setUint32(1, 0x20000001, true); buf.setUint32(5, 4326, true);
  buf.setFloat64(9, -71.06, true); buf.setFloat64(17, 42.35, true);
  const hex = [...new Uint8Array(buf.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { client, calls } = fakeClient(() => ({
    data: [
      { place_id: 'osm:way/9', place_type: 'landmarks', name: 'Old State House', location: hex },
      { place_id: 'osm:way/10', place_type: 'parks', name: 'Nowhere', location: null },
    ],
    error: null,
  }));
  const out = await fetchOtherTypePlaces(client, 'museums');
  assert.equal(calls[0]!.table, 'catalog_places');
  assert.ok(calls.some((c) => c.op === 'neq' && c.args[0] === 'place_type' && c.args[1] === 'museums'));
  assert.deepEqual(out, [{ placeId: 'osm:way/9', placeType: 'landmarks', name: 'Old State House', lat: 42.35, lng: -71.06 }]);
});

test('fetchRegisteredTypes looks up place_ids in chunks of 200', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `osm:node/${i}`);
  const { client, calls } = fakeClient((_t, _c, ops) => (ops.includes('in')
    ? { data: [{ place_id: 'osm:node/1', place_type: 'landmarks' }], error: null }
    : { data: [], error: null }));
  const out = await fetchRegisteredTypes(client, ids);
  const ins = calls.filter((c) => c.op === 'in');
  assert.deepEqual(ins.map((c) => (c.args[1] as string[]).length), [200, 50]);
  assert.ok(calls.every((c) => c.table === 'places'));
  assert.equal(out.get('osm:node/1'), 'landmarks');
});

test('fetchRegistry returns the registry id and type of each found place_id', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ id: 9, place_id: 'osm:way/1', place_type: 'parks' }], error: null }));
  const out = await fetchRegistry(client, ['osm:way/1', 'osm:way/2']);
  assert.ok(calls.some((c) => c.table === 'places' && c.op === 'select' && c.args[0] === 'id, place_id, place_type'));
  assert.deepEqual([...out], [['osm:way/1', { id: 9, placeType: 'parks' }]]);
});

test('deleteRegistryRows deletes only registry rows of the type by id', async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await deleteRegistryRows(client, 'parks', [11, 12]);
  assert.deepEqual(calls, [
    { table: 'places', op: 'delete', args: [] },
    { table: 'places', op: 'in', args: ['id', [11, 12]] },
    { table: 'places', op: 'eq', args: ['place_type', 'parks'] },
  ]);
  const none = fakeClient(() => ({ error: null }));
  await deleteRegistryRows(none.client, 'parks', []);
  assert.equal(none.calls.length, 0);
});
