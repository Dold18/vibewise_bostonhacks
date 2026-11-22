import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchDealPlaces, fetchHiddenDealKeys, fetchPlaceRefsWithVisibleDeals, markDealsChecked, replaceCuratedDeals, replaceDeals,
} from '../../src/deals/db.ts';
import type { DealRow } from '../../src/deals/types.ts';

type Call = { table: string; op: string; args: unknown[] };
type Result = { data?: unknown; error: null | { message: string } };

function fakeClient(resultFor: (table: string, calls: Call[], ops: string[]) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: string[] = [];
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'delete', 'insert', 'update', 'eq', 'is', 'order', 'range']) {
        builder[op] = (...args: unknown[]) => { calls.push({ table, op, args }); ops.push(op); return builder; };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve(resultFor(table, calls, ops));
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ok = (data: unknown = []): Result => ({ data, error: null });
const row = (over: Partial<DealRow> = {}): DealRow => ({
  kind: 'discount', title: 'Student 10%', quote: null, timing: 'always', schedule: null, source: 'curated',
  sourceUrl: 'https://example.com', checkedAt: '2026-11-21T00:00:00.000Z', ...over,
} as DealRow);

test('fetchDealPlaces without a type reads place_points with no place_type filter (curated spans all types)', async () => {
  const { client, calls } = fakeClient(() => ok());
  await fetchDealPlaces(client);
  assert.ok(calls.some((c) => c.table === 'place_points' && c.op === 'select'));
  assert.equal(calls.filter((c) => c.op === 'eq' && c.args[0] === 'place_type').length, 0);
});

test('fetchDealPlaces with a type filters place_type exactly once', async () => {
  const { client, calls } = fakeClient(() => ok());
  await fetchDealPlaces(client, 'museums');
  const eqs = calls.filter((c) => c.op === 'eq' && c.args[0] === 'place_type');
  assert.equal(eqs.length, 1);
  assert.equal(eqs[0]!.args[1], 'museums');
});

test('markDealsChecked updates the given type table', async () => {
  const { client, calls } = fakeClient(() => ok());
  await markDealsChecked(client, 'parks', 4, '2026-11-21T00:00:00.000Z');
  assert.ok(calls.every((c) => c.table === 'parks'));
  assert.deepEqual(calls.find((c) => c.op === 'update')!.args, [{ deals_checked_at: '2026-11-21T00:00:00.000Z' }]);
  assert.deepEqual(calls.find((c) => c.op === 'eq')!.args, ['id', 4]);
});

test('replaceDeals deletes by place_ref and inserts place_ref', async () => {
  const { client, calls } = fakeClient(() => ok());
  await replaceDeals(client, 9, 'osm', [row({ source: 'osm' })]);
  assert.deepEqual(calls.filter((c) => c.op === 'eq').map((c) => c.args), [['place_ref', 9], ['source', 'osm'], ['hidden', false]]);
  const ins = calls.find((c) => c.op === 'insert')!.args[0] as Array<Record<string, unknown>>;
  assert.equal(ins[0]!.place_ref, 9);
  assert.ok(!('restaurant_id' in ins[0]!));
});

test('replaceCuratedDeals inserts place_ref', async () => {
  const { client, calls } = fakeClient(() => ok());
  await replaceCuratedDeals(client, [{ ...row(), placeRef: 7 }]);
  const ins = calls.find((c) => c.op === 'insert')!.args[0] as Array<Record<string, unknown>>;
  assert.equal(ins[0]!.place_ref, 7);
});

test('hidden keys and visible refs read place_ref', async () => {
  const { client, calls } = fakeClient((_t, _c, ops) => ok(ops.includes('select')
    ? [{ id: 1, place_ref: 5, source: 'osm', title: 't', quote: null }] : []));
  const hidden = await fetchHiddenDealKeys(client);
  assert.ok(hidden.has('5:osm'));
  const refs = await fetchPlaceRefsWithVisibleDeals(client, 'osm');
  assert.ok(refs.has(5));
  assert.ok(calls.filter((c) => c.op === 'select').every((c) => String(c.args[0]).includes('place_ref')));
});
