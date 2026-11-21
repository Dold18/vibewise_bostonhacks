import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWritable, parseCliArgs, summarize } from '../src/ingest.ts';
import type { RekeyAction, RestaurantRow } from '../src/types.ts';

function row(n: number, extra: Partial<RestaurantRow> = {}): RestaurantRow {
  return {
    place_id: `osm:node/${n}`, source: 'osm', source_id: `node/${n}`, name: `Place ${n}`,
    location: 'SRID=4326;POINT(-71.06 42.35)', address: '1 Main St', website: 'https://x.test', phone: null,
    category: 'restaurant', source_cuisines: ['thai'], hours_raw: null, osm_tags: {}, fsq_place_id: null,
    attribution: 'x', last_seen_at: '2026-11-21T12:00:00.000Z', ...extra,
  };
}

const baseInput = {
  osm: 3, fsq: 2, matches: 1, dropped: 0, staleFsqDropped: 0,
  existingKeys: new Set<string>(), rows: [] as RestaurantRow[], actions: [] as RekeyAction[], notSeen: 0 as number | null,
};

test('parseCliArgs defaults and flags', () => {
  assert.deepEqual(parseCliArgs([]), { dryRun: false, sources: 'all', refresh: false });
  assert.deepEqual(parseCliArgs(['--dry-run', '--sources=osm', '--refresh']), { dryRun: true, sources: 'osm', refresh: true });
});

test('parseCliArgs rejects an unknown source', () => {
  assert.throws(() => parseCliArgs(['--sources=yelp']), /sources/);
});

test('summarize counts inserted vs updated from existing keys and lists collapsed ids', () => {
  const rows = [row(1), row(2), row(3, { address: null, website: null, source_cuisines: [] })];
  const text = summarize({
    ...baseInput,
    existingKeys: new Set(['osm:node/1']),
    rows,
    actions: [
      { kind: 'promote', id: 5, sourceId: 'node/2', placeId: 'osm:node/2' },
      { kind: 'collapse', id: 6, fsqId: 'fsq-abc' },
      { kind: 'clear_fsq', id: 7 },
    ],
    notSeen: 4,
  });
  const lines = text.split('\n');
  assert.ok(lines.includes('OSM places: 3'));
  assert.ok(lines.includes('Inserted: 2'));
  assert.ok(lines.includes('Updated: 1'));
  assert.ok(lines.includes('Promoted: 1'));
  assert.ok(lines.includes('Collapsed: 1 (lost: fsq-abc)'));
  assert.ok(lines.includes('Not seen this run: 4'));
  assert.ok(lines.includes('Rows missing cuisine: 1'));
  assert.ok(lines.includes('Rows missing address: 1'));
  assert.ok(lines.includes('Rows missing website: 1'));
});

test('summarize in dry run reports not seen as n/a', () => {
  assert.ok(summarize({ ...baseInput, notSeen: null }).split('\n').includes('Not seen this run: n/a (dry run)'));
});

test('parseCliArgs accepts --allow-partial', () => {
  assert.equal(parseCliArgs(['--allow-partial']).allowPartial, true);
  assert.equal(parseCliArgs([]).allowPartial, undefined);
});

test('assertWritable refuses single-source writes unless allowed', () => {
  assert.equal(assertWritable({ osmLoaded: true, fsqLoaded: true, allowPartial: false }), null);
  assert.throws(() => assertWritable({ osmLoaded: true, fsqLoaded: false, allowPartial: false }), /--allow-partial/);
  assert.throws(() => assertWritable({ osmLoaded: false, fsqLoaded: true, allowPartial: false }), /--allow-partial/);
  assert.throws(() => assertWritable({ osmLoaded: false, fsqLoaded: false, allowPartial: false }), /--allow-partial/);
  assert.match(assertWritable({ osmLoaded: true, fsqLoaded: false, allowPartial: true })!, /link will be cleared/);
  assert.match(assertWritable({ osmLoaded: false, fsqLoaded: true, allowPartial: true })!, /duplicate pins/);
});
