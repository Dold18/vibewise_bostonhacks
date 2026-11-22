import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchKey, withoutHidden, websiteDecision } from '../../src/deals/plan.ts';
import type { DealRow } from '../../src/deals/types.ts';

const row = (quote: string, title = 'Happy hour'): DealRow => ({
  kind: 'special', title, quote, timing: 'unconfirmed', schedule: null, source: 'website', sourceUrl: 'https://x.test', checkedAt: '2026-11-21T12:00:00-05:00',
});

test('matchKey collapses case and punctuation', () => {
  const a = matchKey({ source: 'website', title: 't', quote: 'Happy Hour!  Mon–Fri' });
  assert.equal(a, 'happy hour mon fri');
  assert.equal(a, matchKey({ source: 'osm', title: 't', quote: 'happy hour mon fri' }));
});

test('matchKey uses title for curated, quote ?? title otherwise', () => {
  assert.equal(matchKey({ source: 'curated', title: 'A, B', quote: 'zzz' }), 'a b');
  assert.equal(matchKey({ source: 'website', title: 'T!', quote: null }), 't');
});

test('withoutHidden drops matching rows only', () => {
  const rows = [row('Happy Hour 4-6'), row('Taco Tuesday')];
  const out = withoutHidden(rows, new Set(['happy hour 4 6']));
  assert.deepEqual(out.map((r) => r.quote), ['Taco Tuesday']);
});

test('websiteDecision outcomes', () => {
  assert.deepEqual(websiteDecision({ outcome: 'transient', detail: 'x' }, new Set()), { rows: null, markChecked: false });
  assert.deepEqual(websiteDecision({ outcome: 'permanent', detail: 'x' }, new Set()), { rows: [], markChecked: true });
  const d = websiteDecision({ outcome: 'ok', deals: [row('a'), row('b')] }, new Set(['a']));
  assert.equal(d.markChecked, true);
  assert.deepEqual(d.rows!.map((r) => r.quote), ['b']);
});
