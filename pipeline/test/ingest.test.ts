import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignIds, assertWritable, parseCliArgs, resolvePromoteTargets, reuseOrphanIds, summarize,
} from '../src/ingest.ts';
import type { ExistingRow, KindRow, PlaceRow, RekeyAction, RestaurantRow } from '../src/types.ts';

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
  existingKeys: new Set<string>(), rows: [] as PlaceRow[], actions: [] as RekeyAction[], notSeen: 0 as number | null,
  type: 'restaurants' as const, crossTypeSkipped: 0 as number | null, conflictsSkipped: 0 as number | null,
  orphansReused: 0 as number | null, orphansCleared: 0 as number | null,
};

test('parseCliArgs defaults and flags', () => {
  assert.deepEqual(parseCliArgs(['--type', 'restaurants']), { type: 'restaurants', dryRun: false, sources: 'all', refresh: false });
  assert.deepEqual(
    parseCliArgs(['--type=parks', '--dry-run', '--sources=osm', '--refresh']),
    { type: 'parks', dryRun: true, sources: 'osm', refresh: true },
  );
});

test('parseCliArgs requires a known --type', () => {
  assert.equal(parseCliArgs(['--type', 'museums', '--dry-run']).type, 'museums');
  assert.throws(() => parseCliArgs([]), /^Error: missing --type \(expected one of restaurants, museums, entertainment, parks, landmarks\)$/);
  assert.throws(() => parseCliArgs(['--type', 'zoos']), /invalid --type 'zoos'/);
});

test('parseCliArgs rejects an unknown source', () => {
  assert.throws(() => parseCliArgs(['--type=parks', '--sources=yelp']), /sources/);
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
  assert.ok(lines.includes('Inserted: 1')); // row 2 is a promote of an existing row, so it counts as updated
  assert.ok(lines.includes('Updated: 2'));
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
  assert.equal(parseCliArgs(['--type=parks', '--allow-partial']).allowPartial, true);
  assert.equal(parseCliArgs(['--type=parks']).allowPartial, undefined);
});

test('assertWritable refuses single-source writes unless allowed', () => {
  assert.equal(assertWritable({ osmLoaded: true, fsqLoaded: true, allowPartial: false }), null);
  assert.throws(() => assertWritable({ osmLoaded: true, fsqLoaded: false, allowPartial: false }), /--allow-partial/);
  assert.throws(() => assertWritable({ osmLoaded: false, fsqLoaded: true, allowPartial: false }), /--allow-partial/);
  assert.throws(() => assertWritable({ osmLoaded: false, fsqLoaded: false, allowPartial: false }), /--allow-partial/);
  assert.match(assertWritable({ osmLoaded: true, fsqLoaded: false, allowPartial: true })!, /link will be cleared/);
  assert.match(assertWritable({ osmLoaded: false, fsqLoaded: true, allowPartial: true })!, /duplicate pins/);
});

function kindRow(n: number, extra: Partial<KindRow> = {}): KindRow {
  return {
    place_id: `osm:way/${n}`, source: 'osm', source_id: `way/${n}`, name: `Park ${n}`,
    location: 'SRID=4326;POINT(-71.06 42.35)', address: null, website: null, phone: null, hours_raw: null,
    osm_tags: {}, fsq_place_id: null, attribution: 'x', last_seen_at: '2026-11-21T12:00:00.000Z', kind: 'park', ...extra,
  };
}

test('assignIds gives existing rows their key id and new rows their registry id', () => {
  const out = assignIds([kindRow(1), kindRow(2)], new Map([['osm:way/1', 11]]), new Map([['osm:way/2', 22]]));
  assert.deepEqual(out.map((r) => r.id), [11, 22]);
  assert.ok(out.every((r) => typeof r.id === 'number'));
  assert.equal(out[1]!.name, 'Park 2');
});

test('assignIds throws naming the place_id of a row with no id', () => {
  assert.throws(() => assignIds([kindRow(1), kindRow(3)], new Map([['osm:way/1', 11]]), new Map()), /osm:way\/3/);
});

test('summarize lists skipped cross-type duplicates and type conflicts', () => {
  const lines = summarize({ ...baseInput, crossTypeSkipped: 2, conflictsSkipped: 1 }).split('\n');
  assert.ok(lines.includes('Cross-type duplicates skipped: 2'));
  assert.ok(lines.includes('Type conflicts skipped: 1'));
  const dry = summarize({ ...baseInput, notSeen: null, crossTypeSkipped: null, conflictsSkipped: null }).split('\n');
  assert.ok(dry.includes('Cross-type duplicates skipped: n/a (dry run)'));
  assert.ok(dry.includes('Type conflicts skipped: n/a (dry run)'));
});

test('summarize prints missing cuisine only for restaurants', () => {
  const parks = summarize({ ...baseInput, type: 'parks', rows: [kindRow(1)] }).split('\n');
  assert.equal(parks.some((l) => l.startsWith('Rows missing cuisine')), false);
  assert.ok(parks.includes('Rows missing address: 1'));
  const food = summarize({ ...baseInput, rows: [row(1, { source_cuisines: [] })] }).split('\n');
  assert.ok(food.includes('Rows missing cuisine: 1'));
});

test('summarize counts orphan registry ids reused and cleared', () => {
  const lines = summarize({ ...baseInput, orphansReused: 2, orphansCleared: 1 }).split('\n');
  assert.ok(lines.includes('Orphan registry ids reused: 2'));
  assert.ok(lines.includes('Orphan registry rows cleared: 1'));
  const dry = summarize({ ...baseInput, orphansReused: null, orphansCleared: null }).split('\n');
  assert.ok(dry.includes('Orphan registry ids reused: n/a (dry run)'));
});

// An existing FSQ-only park (id 4) that this run matched to the new OSM way/1: planRekey promotes it to osm:way/1.
const FSQ_ONLY: ExistingRow = { id: 4, source: 'foursquare', source_id: 'f1', fsq_place_id: 'f1' };
const promoteRows = () => [kindRow(1, { fsq_place_id: 'f1' }), kindRow(2)];

test('resolvePromoteTargets keeps a promote whose target is not in the registry', () => {
  const rows = promoteRows();
  const out = resolvePromoteTargets([FSQ_ONLY], rows, new Map(), 'parks');
  assert.deepEqual(out.actions, [{ kind: 'promote', id: 4, sourceId: 'way/1', placeId: 'osm:way/1' }]);
  assert.deepEqual(out.rows, rows);
  assert.deepEqual(out.conflicts, []);
  assert.deepEqual(out.orphanIds, []);
});

test('resolvePromoteTargets drops a promote whose target is registered under another type', () => {
  const out = resolvePromoteTargets(
    [FSQ_ONLY], promoteRows(), new Map([['osm:way/1', { id: 10, placeType: 'landmarks' as const }]]), 'parks',
  );
  assert.deepEqual(out.actions, []);
  assert.deepEqual(out.rows.map((r) => r.place_id), ['osm:way/2']);
  assert.deepEqual(out.conflicts, [{ placeId: 'osm:way/1', registeredAs: 'landmarks' }]);
  assert.deepEqual(out.orphanIds, []);
});

test('resolvePromoteTargets clears a same-type orphan target so the promote can proceed', () => {
  const out = resolvePromoteTargets(
    [FSQ_ONLY], promoteRows(), new Map([['osm:way/1', { id: 11, placeType: 'parks' as const }]]), 'parks',
  );
  assert.deepEqual(out.actions, [{ kind: 'promote', id: 4, sourceId: 'way/1', placeId: 'osm:way/1' }]);
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.conflicts, []);
  assert.deepEqual(out.orphanIds, [11]);
});

test('a same-type orphan registry id is reused by assignIds instead of registering again', () => {
  const rows = [kindRow(1), kindRow(2)];
  const { reused, toRegister } = reuseOrphanIds(rows, new Map([['osm:way/1', { id: 9, placeType: 'parks' as const }]]), 'parks');
  assert.deepEqual([...reused], [['osm:way/1', 9]]);
  assert.deepEqual(toRegister, ['osm:way/2']);
  const out = assignIds(rows, new Map(), new Map([...reused, ['osm:way/2', 20]]));
  assert.deepEqual(out.map((r) => r.id), [9, 20]);
});

test('reuseOrphanIds never reuses an id registered under another type', () => {
  const { reused, toRegister } = reuseOrphanIds([kindRow(1)], new Map([['osm:way/1', { id: 9, placeType: 'landmarks' as const }]]), 'parks');
  assert.equal(reused.size, 0);
  assert.deepEqual(toRegister, []);
});

test('summarize prints Foursquare sub-venues dropped only for non-food types', () => {
  const museums = summarize({ ...baseInput, type: 'museums', subVenuesDropped: 3 }).split('\n');
  assert.ok(museums.includes('Foursquare sub-venues dropped: 3'));
  const food = summarize({ ...baseInput, subVenuesDropped: 0 }).split('\n');
  assert.equal(food.some((l) => l.startsWith('Foursquare sub-venues')), false);
});
