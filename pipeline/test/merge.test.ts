import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUniqueKeys, dedupeWithin, freshness, matchSources, mergePlaces } from '../src/merge.ts';
import { ATTRIBUTION_FSQ, ATTRIBUTION_MERGED, ATTRIBUTION_OSM } from '../src/config.ts';
import { fsqRow, osmRow } from '../src/sources.ts';
import type { FsqPlace, OsmPlace } from '../src/types.ts';

const LAT = 42.35;
const LNG = -71.06;
const D30 = 0.00027; // ~30 m of latitude
const runStart = '2026-11-21T12:00:00.000Z';
const today = '2026-11-21';

function osm(id: string, name: string, lat: number, lng: number, tags: Record<string, string> = {}): OsmPlace {
  return { osmId: id, name, lat, lng, tags: { amenity: 'restaurant', ...tags } };
}
function fsq(id: string, name: string, lat: number, lng: number, extra: Partial<FsqPlace> = {}): FsqPlace {
  return {
    fsqId: id, name, lat, lng, address: null, locality: null, postcode: null, tel: null, website: null,
    categoryLabels: ['Dining and Drinking > Restaurant'], dateRefreshed: '2026-06-01', ...extra,
  };
}
const osmFields = (p: OsmPlace) => Object.values(p.tags).filter((v) => v !== '').length;
const fsqFields = (p: FsqPlace) => [p.address, p.website, p.tel].filter((v) => v !== null).length;

test('dedupeWithin collapses same-name records within 50 m, keeps the fullest', () => {
  const a = osm('node/1', 'Pizza Place', LAT, LNG);
  const b = osm('way/2', 'Pizza Place', LAT + D30, LNG, { website: 'https://p.example' });
  const { kept, dropped } = dedupeWithin([a, b], (p) => p.osmId, 'osm', osmFields);
  assert.deepEqual(kept.map((p) => p.osmId), ['way/2']);
  assert.deepEqual(dropped, [{ source: 'osm', keptId: 'way/2', droppedId: 'node/1' }]);
});

test('dedupeWithin never collapses empty name keys', () => {
  const a = osm('node/1', '!!!', LAT, LNG);
  const b = osm('node/2', '!!!', LAT, LNG);
  const { kept, dropped } = dedupeWithin([a, b], (p) => p.osmId, 'osm', osmFields);
  assert.deepEqual(kept.map((p) => p.osmId).sort(), ['node/1', 'node/2']);
  assert.equal(dropped.length, 0);
});

test('dedupeWithin tie prefers node over way, then smaller numeric id; fsq prefers smallest id', () => {
  const way = osm('way/1', 'X Cafe', LAT, LNG);
  const node = osm('node/9', 'X Cafe', LAT, LNG);
  const r1 = dedupeWithin([way, node], (p) => p.osmId, 'osm', osmFields);
  assert.deepEqual(r1.kept.map((p) => p.osmId), ['node/9']);
  const n10 = osm('node/10', 'Y', LAT, LNG);
  const n9 = osm('node/9', 'Y', LAT, LNG);
  const r2 = dedupeWithin([n10, n9], (p) => p.osmId, 'osm', osmFields);
  assert.deepEqual(r2.kept.map((p) => p.osmId), ['node/9']);
  const r3 = dedupeWithin([fsq('b2', 'Z', LAT, LNG), fsq('a1', 'Z', LAT, LNG)], (p) => p.fsqId, 'foursquare', fsqFields);
  assert.deepEqual(r3.kept.map((p) => p.fsqId), ['a1']);
  assert.deepEqual(r3.dropped, [{ source: 'foursquare', keptId: 'a1', droppedId: 'b2' }]);
});

test('matchSources: same name at 30 m matches, at 80 m does not', () => {
  const o = osm('node/1', 'Pizza Place', LAT, LNG);
  const near = matchSources([o], [fsq('f1', 'Pizza Place', LAT + D30, LNG)]);
  assert.equal(near.length, 1);
  assert.equal(near[0]!.osmId, 'node/1');
  assert.equal(near[0]!.fsqId, 'f1');
  assert.ok(near[0]!.meters > 29 && near[0]!.meters < 31);
  assert.equal(near[0]!.similarity, 1);
  assert.equal(matchSources([o], [fsq('f1', 'Pizza Place', LAT + D30 * 80 / 30, LNG)]).length, 0);
});

test('matchSources: similar name at 20 m matches, at 40 m does not', () => {
  const o = osm('node/1', 'Tatte Bakery', LAT, LNG);
  const m = matchSources([o], [fsq('f1', 'Tatte Bakery Cafe', LAT + D30 * 20 / 30, LNG)]);
  assert.equal(m.length, 1);
  assert.equal(m[0]!.similarity, 0.667);
  assert.equal(matchSources([o], [fsq('f1', 'Tatte Bakery Cafe', LAT + D30 * 40 / 30, LNG)]).length, 0);
});

test('matchSources: nearest candidate wins and pairing is one-to-one', () => {
  const o1 = osm('node/1', 'Pizza Place', LAT, LNG);
  const o2 = osm('node/2', 'Pizza Place', LAT + D30 * 40 / 30, LNG);
  const m = matchSources([o1, o2], [fsq('f1', 'Pizza Place', LAT + D30 * 10 / 30, LNG)]);
  assert.equal(m.length, 1);
  assert.equal(m[0]!.osmId, 'node/1');
  assert.equal(m[0]!.fsqId, 'f1');
  assert.equal(m[0]!.meters, 10);
});

test('matchSources: empty name keys never match', () => {
  assert.equal(matchSources([osm('node/1', '!!!', LAT, LNG)], [fsq('f1', '!!!', LAT, LNG)]).length, 0);
});

test('mergePlaces: OSM wins, FSQ fills gaps, cuisines union, merged attribution', () => {
  const o = osm('node/1', 'Pizza Place', LAT, LNG, { website: 'https://osm.example', cuisine: 'pizza' });
  const f = fsq('f1', 'Pizza Place', LAT + D30, LNG, {
    website: 'https://fsq.example', tel: '+1 617 555 0100', address: '1 Main St', locality: 'Boston', postcode: '02108',
    categoryLabels: ['Dining and Drinking > Restaurant > Pizzeria', 'Dining and Drinking > Restaurant > Pizza Restaurant'],
  });
  const { rows, matches, dropped, staleFsqDropped } = mergePlaces([o], [f], { runStart, today });
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.place_id, 'osm:node/1');
  assert.equal(r.source, 'osm');
  assert.equal(r.website, 'https://osm.example');
  assert.equal(r.phone, '+1 617 555 0100');
  assert.equal(r.address, '1 Main St, Boston 02108');
  assert.deepEqual(r.source_cuisines, ['pizza', 'pizzeria']);
  assert.equal(r.fsq_place_id, 'f1');
  assert.equal(r.attribution, ATTRIBUTION_MERGED);
  assert.equal(matches.length, 1);
  assert.equal(dropped.length, 0);
  assert.equal(staleFsqDropped, 0);
});

test('mergePlaces: unmatched OSM kept; unmatched FSQ refreshed 1 year ago kept, 3 years ago and null dropped', () => {
  const { rows, staleFsqDropped } = mergePlaces(
    [osm('node/1', 'Lonely OSM', 42.30, -71.10)],
    [
      fsq('fresh', 'Fresh', 42.31, -71.11, { dateRefreshed: '2025-11-21' }),
      fsq('old', 'Old', 42.32, -71.12, { dateRefreshed: '2023-11-21' }),
      fsq('none', 'None', 42.33, -71.13, { dateRefreshed: null }),
    ],
    { runStart, today },
  );
  assert.deepEqual(rows.map((r) => r.place_id).sort(), ['fsq:fresh', 'osm:node/1']);
  assert.equal(staleFsqDropped, 2);
  assert.equal(rows.find((r) => r.place_id === 'osm:node/1')!.attribution, ATTRIBUTION_OSM);
  assert.equal(rows.find((r) => r.place_id === 'fsq:fresh')!.attribution, ATTRIBUTION_FSQ);
});

test('mergePlaces: a stale FSQ record still fills gaps on its OSM match', () => {
  const o = osm('node/1', 'Pizza Place', LAT, LNG);
  const f = fsq('f1', 'Pizza Place', LAT + D30, LNG, { dateRefreshed: null, tel: '555' });
  const { rows, staleFsqDropped } = mergePlaces([o], [f], { runStart, today });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.phone, '555');
  assert.equal(rows[0]!.fsq_place_id, 'f1');
  assert.equal(staleFsqDropped, 0);
});

test('matchSources handles 3,000 x 3,000 points in under 2 s', () => {
  const n = 3000;
  const osmPts: OsmPlace[] = [];
  const fsqPts: FsqPlace[] = [];
  for (let i = 0; i < n; i++) {
    const lat = 42.25 + ((i * 7919) % n) / n * 0.15;
    const lng = -71.15 + ((i * 104729) % n) / n * 0.15;
    osmPts.push(osm(`node/${i}`, `Place ${i} Grill`, lat, lng));
    fsqPts.push(fsq(`f${i}`, `Place ${i} Grill`, lat + D30 / 3, lng));
  }
  const start = performance.now();
  const pairs = matchSources(osmPts, fsqPts);
  const elapsed = performance.now() - start;
  assert.equal(pairs.length, n);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
});

test('assertUniqueKeys passes unique rows and names duplicates otherwise', () => {
  const a = osmRow(osm('node/1', 'A', LAT, LNG), runStart);
  const b = osmRow(osm('node/2', 'B', LAT, LNG), runStart);
  const f = fsqRow(fsq('f1', 'C', LAT, LNG), runStart);
  assertUniqueKeys([a, b, f]);
  assert.throws(() => assertUniqueKeys([a, { ...a }]), /duplicate source:source_id .*osm:node.1/);
  const linkedA = { ...a, fsq_place_id: 'f1' };
  assert.throws(() => assertUniqueKeys([linkedA, f]), /duplicate fsq_place_id .*f1/);
  assertUniqueKeys([a, b]); // multiple null fsq ids are fine
});

test('freshness: 730 days is fresh, 731 is stale, date-time prefixes parse, junk is unparseable', () => {
  assert.equal(freshness('2024-11-21', '2026-11-21'), 'fresh'); // 730 days
  assert.equal(freshness('2024-11-20', '2026-11-21'), 'stale'); // 731 days
  assert.equal(freshness('2026-06-01T08:30:00Z', today), 'fresh');
  assert.equal(freshness('2023-01-01 00:00:00', today), 'stale');
  assert.equal(freshness(null, today), 'stale');
  assert.equal(freshness('last spring', today), 'unparseable');
  assert.equal(freshness('2026-13-45', today), 'unparseable');
});

test('mergePlaces counts unparseable refresh dates separately from stale ones', () => {
  const r = mergePlaces([], [
    fsq('a', 'A', 42.31, -71.11, { dateRefreshed: 'garbage' }),
    fsq('b', 'B', 42.32, -71.12, { dateRefreshed: '2020-01-01' }),
    fsq('c', 'C', 42.33, -71.13, { dateRefreshed: '2026-06-01T10:00:00' }),
  ], { runStart, today });
  assert.equal(r.unparseableDates, 1);
  assert.equal(r.staleFsqDropped, 2);
  assert.deepEqual(r.rows.map((x) => x.source_id), ['c']);
});
