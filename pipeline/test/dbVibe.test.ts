import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  enrichmentCounts, fetchInputs, fetchPhotoUrls, fetchPlaces, fetchUnenrichedIds, isStillUnenriched, writeEnrichment,
} from '../src/dbVibe.ts';

type Call = { table: string; op: string; args: unknown[] };
type Result = { data?: unknown; error: null | { message: string }; count?: number };

/** Chainable fake of the supabase-js query builder that records every call (same pattern as test/media/db.test.ts). */
function fakeClient(resultFor: (table: string, ops: string[]) => Result = () => ({ data: [], error: null })) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: string[] = [];
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'update', 'eq', 'is', 'order', 'range', 'in', 'not', 'maybeSingle']) {
        builder[op] = (...args: unknown[]) => { calls.push({ table, op, args }); ops.push(op); return builder; };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve(resultFor(table, ops));
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const PROFILE = { cuisines: [], signature_dishes: [], dietary_options: [], price_feel: null, median_entree_price: null };

test('fetchInputs filters and groups by place_ref, never restaurant_id', async () => {
  const { client, calls } = fakeClient(() => ({
    data: [{ place_ref: 7, source: 'website', content: 'a' }, { place_ref: 7, source: 'wiki', content: 'b' }, { place_ref: 9, source: 'osm_tags', content: 'c' }],
    error: null,
  }));
  const map = await fetchInputs(client, [7, 9]);
  const sel = calls.find((c) => c.table === 'place_vibe_inputs' && c.op === 'select')!;
  assert.equal(sel.args[0], 'place_ref, source, content');
  const inn = calls.find((c) => c.table === 'place_vibe_inputs' && c.op === 'in')!;
  assert.deepEqual(inn.args, ['place_ref', [7, 9]]);
  assert.equal(map.get(7)!.length, 2);
  assert.equal(map.get(9)![0]!.source, 'osm_tags');
  assert.ok(!calls.some((c) => JSON.stringify(c.args).includes('restaurant_id')));
});

test('fetchPhotoUrls filters by place_ref and keeps the first visible photo per place', async () => {
  const { client, calls } = fakeClient(() => ({
    data: [{ place_ref: 7, url: 'https://a/1.jpg' }, { place_ref: 7, url: 'https://a/2.jpg' }, { place_ref: 9, url: 'https://b/1.jpg' }],
    error: null,
  }));
  const map = await fetchPhotoUrls(client, [7, 9]);
  const sel = calls.find((c) => c.table === 'place_photos' && c.op === 'select')!;
  assert.equal(sel.args[0], 'place_ref, url');
  assert.deepEqual(calls.find((c) => c.table === 'place_photos' && c.op === 'in')!.args, ['place_ref', [7, 9]]);
  assert.ok(calls.some((c) => c.op === 'eq' && c.args[0] === 'hidden' && c.args[1] === false));
  assert.equal(map.get(7), 'https://a/1.jpg');
  assert.equal(map.get(9), 'https://b/1.jpg');
  assert.ok(!calls.some((c) => JSON.stringify(c.args).includes('restaurant_id')));
});

test('fetchUnenrichedIds reads the chosen table, null description and embedding, in id order', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ id: 3 }, { id: 5 }], error: null }));
  assert.deepEqual(await fetchUnenrichedIds(client, 'parks'), [3, 5]);
  assert.ok(calls.every((c) => c.table === 'parks'));
  const nulls = calls.filter((c) => c.op === 'is').map((c) => c.args);
  assert.deepEqual(nulls, [['description', null], ['embedding', null]]);
  assert.deepEqual(calls.find((c) => c.op === 'order')!.args, ['id', { ascending: true }]);
});

test('enrichmentCounts reads the chosen table; profile only for restaurants', async () => {
  const { client, calls } = fakeClient(() => ({ error: null, count: 4 }));
  assert.deepEqual(await enrichmentCounts(client, 'museums'), { description: 4, embedding: 4, profile: null });
  assert.ok(calls.every((c) => c.table === 'museums'));
  assert.ok(!calls.some((c) => c.op === 'not' && c.args[0] === 'profile'));
  const r = fakeClient(() => ({ error: null, count: 2 }));
  assert.deepEqual(await enrichmentCounts(r.client, 'restaurants'), { description: 2, embedding: 2, profile: 2 });
  assert.ok(r.calls.some((c) => c.table === 'restaurants' && c.op === 'not' && c.args[0] === 'profile'));
});

test('isStillUnenriched checks the chosen table', async () => {
  const { client, calls } = fakeClient(() => ({ data: { id: 7 }, error: null }));
  assert.equal(await isStillUnenriched(client, 'landmarks', 7), true);
  assert.ok(calls.every((c) => c.table === 'landmarks'));
  assert.deepEqual(calls.filter((c) => c.op === 'is').map((c) => c.args), [['description', null], ['embedding', null]]);
});

test('fetchPlaces reads name, kind, tags and context from a non-food table', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ id: 7, name: 'MFA', kind: 'art_museum', osm_tags: null, context_features: null }], error: null }));
  const rows = await fetchPlaces(client, 'museums', [7]);
  assert.equal(rows[0]!.kind, 'art_museum');
  const sel = calls.find((c) => c.op === 'select')!;
  assert.equal(sel.table, 'museums');
  assert.equal(sel.args[0], 'id, name, kind, osm_tags, context_features');
});

test('writeEnrichment for a non-food table updates description and embedding only, guarded by nulls', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ id: 7 }], error: null }));
  assert.equal(await writeEnrichment(client, 'entertainment', 7, { description: 'd', embedding: [0.1, 0.2], profile: null }), true);
  const upd = calls.find((c) => c.op === 'update')!;
  assert.equal(upd.table, 'entertainment');
  assert.deepEqual(upd.args[0], { description: 'd', embedding: [0.1, 0.2] });
  assert.ok(!('profile' in (upd.args[0] as object)));
  assert.deepEqual(calls.find((c) => c.op === 'eq')!.args, ['id', 7]);
  assert.deepEqual(calls.filter((c) => c.op === 'is').map((c) => c.args), [['description', null], ['embedding', null]]);
});

test('writeEnrichment for restaurants still writes the profile, and reports a lost race as false', async () => {
  const { client, calls } = fakeClient(() => ({ data: [], error: null }));
  assert.equal(await writeEnrichment(client, 'restaurants', 7, { description: 'd', embedding: [0.1], profile: PROFILE }), false);
  const upd = calls.find((c) => c.op === 'update')!;
  assert.equal(upd.table, 'restaurants');
  assert.deepEqual(upd.args[0], { description: 'd', embedding: [0.1], profile: PROFILE });
  assert.deepEqual(calls.filter((c) => c.op === 'is').map((c) => c.args), [['description', null], ['embedding', null]]);
});

test('writeEnrichment surfaces a database error', async () => {
  const { client } = fakeClient(() => ({ error: { message: 'boom' } }));
  await assert.rejects(writeEnrichment(client, 'parks', 7, { description: 'd', embedding: [0.1], profile: null }), /boom/);
});
