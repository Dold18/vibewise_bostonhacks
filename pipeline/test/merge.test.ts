import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUniqueKeys, dedupeWithin, findFsqSubVenues, freshness, matchSources, mergePlaces } from '../src/merge.ts';
import { ATTRIBUTION_FSQ, ATTRIBUTION_MERGED, ATTRIBUTION_OSM } from '../src/config.ts';
import { boundsAreaHa, PLACE_TYPE_CONFIG } from '../src/placeTypes.ts';
import { fsqRow, osmRow } from '../src/sources.ts';
import type { FsqPlace, OsmPlace } from '../src/types.ts';

const LAT = 42.35;
const LNG = -71.06;
const D30 = 0.00027; // ~30 m of latitude
const runStart = '2026-11-21T12:00:00.000Z';
const today = '2026-11-21';
const cfg = PLACE_TYPE_CONFIG.restaurants;

function osm(id: string, name: string, lat: number, lng: number, tags: Record<string, string> = {}): OsmPlace {
  return { osmId: id, name, lat, lng, tags: { amenity: 'restaurant', ...tags }, bounds: null };
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
  const { rows, matches, dropped, staleFsqDropped } = mergePlaces([o], [f], { runStart, today, cfg });
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.place_id, 'osm:node/1');
  assert.equal(r.source, 'osm');
  assert.equal(r.website, 'https://osm.example');
  assert.equal(r.phone, '+1 617 555 0100');
  assert.equal(r.address, '1 Main St, Boston 02108');
  assert.ok('source_cuisines' in r);
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
    { runStart, today, cfg },
  );
  assert.deepEqual(rows.map((r) => r.place_id).sort(), ['fsq:fresh', 'osm:node/1']);
  assert.equal(staleFsqDropped, 2);
  assert.equal(rows.find((r) => r.place_id === 'osm:node/1')!.attribution, ATTRIBUTION_OSM);
  assert.equal(rows.find((r) => r.place_id === 'fsq:fresh')!.attribution, ATTRIBUTION_FSQ);
});

test('mergePlaces: a stale FSQ record still fills gaps on its OSM match', () => {
  const o = osm('node/1', 'Pizza Place', LAT, LNG);
  const f = fsq('f1', 'Pizza Place', LAT + D30, LNG, { dateRefreshed: null, tel: '555' });
  const { rows, staleFsqDropped } = mergePlaces([o], [f], { runStart, today, cfg });
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
  const a = osmRow(osm('node/1', 'A', LAT, LNG), runStart, cfg);
  const b = osmRow(osm('node/2', 'B', LAT, LNG), runStart, cfg);
  const f = fsqRow(fsq('f1', 'C', LAT, LNG), runStart, cfg);
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
  ], { runStart, today, cfg });
  assert.equal(r.unparseableDates, 1);
  assert.equal(r.staleFsqDropped, 2);
  assert.deepEqual(r.rows.map((x) => x.source_id), ['c']);
});

test('mergePlaces: a matched museum pair fills website from Foursquare and keeps the OSM kind', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const o: OsmPlace = { osmId: 'way/5', name: 'Old State House', lat: LAT, lng: LNG, bounds: null,
    tags: { name: 'Old State House', tourism: 'museum', fee: 'yes' } };
  const f = fsq('m1', 'Old State House', LAT + D30, LNG, {
    website: 'https://museum.example', tel: '617', categoryLabels: ['Arts and Entertainment > Museum > History Museum'],
  });
  const { rows } = mergePlaces([o], [f], { runStart, today, cfg: museums });
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.place_id, 'osm:way/5');
  assert.equal(r.website, 'https://museum.example');
  assert.equal(r.phone, '617');
  assert.equal(r.fsq_place_id, 'm1');
  assert.equal(r.attribution, ATTRIBUTION_MERGED);
  assert.ok('kind' in r && r.kind === 'museum');
  assert.ok(!('category' in r) && !('source_cuisines' in r));
});

// A ~220 m x ~165 m box around (LAT, LNG): an OSM museum area.
const BOX = { minlat: LAT - 0.001, minlon: LNG - 0.001, maxlat: LAT + 0.001, maxlon: LNG + 0.001 };
function museum(id: string, name: string, bounds: OsmPlace['bounds']): OsmPlace {
  return { osmId: id, name, lat: LAT, lng: LNG, bounds, tags: { name, tourism: 'museum' } };
}
const room = (id: string, name: string, lat: number, lng: number) =>
  fsq(id, name, lat, lng, { categoryLabels: ['Arts and Entertainment > Museum > Art Museum'] });

test('findFsqSubVenues: a Foursquare place inside an OSM area is reported with the containing place_id', () => {
  const found = findFsqSubVenues([museum('way/7', 'Museum of Fine Arts', BOX)], [room('r1', 'Rotunda', LAT + 0.0005, LNG)], 'museums');
  assert.deepEqual([...found.values()], [
    { fsqId: 'r1', name: 'Rotunda', insideOf: 'osm:way/7', insideName: 'Museum of Fine Arts', outcome: 'dropped' },
  ]);
});

test('findFsqSubVenues: a Foursquare place outside every OSM area is kept', () => {
  const found = findFsqSubVenues([museum('way/7', 'Museum of Fine Arts', BOX)], [room('r2', 'Other Gallery', LAT + 0.002, LNG)], 'museums');
  assert.equal(found.size, 0);
});

test('findFsqSubVenues: a node-only OSM place (no bounds) contains nothing', () => {
  const found = findFsqSubVenues([museum('node/8', 'Small Museum', null)], [room('r3', 'Small Museum Annex', LAT, LNG)], 'museums');
  assert.equal(found.size, 0);
});

test('findFsqSubVenues: restaurants are never checked', () => {
  const o = { ...osm('way/9', 'Food Hall', LAT, LNG), bounds: BOX };
  assert.equal(findFsqSubVenues([o], [fsq('k1', 'Stall', LAT, LNG)], 'restaurants').size, 0);
});

test('findFsqSubVenues: the smallest containing area wins', () => {
  const big = museum('relation/1', 'Campus', { minlat: LAT - 0.01, minlon: LNG - 0.01, maxlat: LAT + 0.01, maxlon: LNG + 0.01 });
  const found = findFsqSubVenues([big, museum('way/2', 'Gallery Building', BOX)], [room('r4', 'Room 4', LAT, LNG)], 'museums');
  assert.equal(found.get('r4')?.insideOf, 'osm:way/2');
});

test('mergePlaces: drops unmatched Foursquare museums inside an OSM museum and reports them; matched ones stay merged', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const o = museum('way/7', 'Museum of Fine Arts', BOX);
  const merged = room('m0', 'Museum of Fine Arts', LAT, LNG);
  const inside = room('r1', 'Art of Asia Gallery', LAT + 0.0008, LNG + 0.0008);
  const outside = room('r2', 'Isabella Stewart Gardner Museum', LAT + 0.003, LNG);
  const r = mergePlaces([o], [merged, inside, outside], { runStart, today, cfg: museums });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:way/7', 'fsq:r2']);
  assert.equal(r.rows[0]!.fsq_place_id, 'm0');
  assert.deepEqual(r.subVenuesDropped.map((d) => [d.fsqId, d.insideOf]), [['r1', 'osm:way/7']]);
});

test('mergePlaces: restaurants keep Foursquare-only rows inside an OSM area', () => {
  const o = { ...osm('way/9', 'Food Hall', LAT, LNG), bounds: BOX };
  const r = mergePlaces([o], [fsq('k1', 'Noodle Stall', LAT + 0.0005, LNG)], { runStart, today, cfg });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:way/9', 'fsq:k1']);
  assert.deepEqual(r.subVenuesDropped, []);
});

// ~444 m x ~329 m (~14.6 ha) and ~666 m x ~493 m (~33 ha) boxes around (LAT, LNG).
const BOX_15HA = { minlat: LAT - 0.002, minlon: LNG - 0.002, maxlat: LAT + 0.002, maxlon: LNG + 0.002 };
const BOX_33HA = { minlat: LAT - 0.003, minlon: LNG - 0.003, maxlat: LAT + 0.003, maxlon: LNG + 0.003 };

test('findFsqSubVenues: an OSM area over 20 ha is not a container', () => {
  assert.ok(boundsAreaHa(BOX_33HA) > 20 && boundsAreaHa(BOX_15HA) <= 20);
  const found = findFsqSubVenues([museum('relation/1', 'Museum Campus', BOX_33HA)], [room('r5', 'Room 5', LAT, LNG)], 'museums');
  assert.equal(found.size, 0);
});

test('findFsqSubVenues: an OSM route is not a container', () => {
  const trail: OsmPlace = { ...museum('relation/976514', 'Freedom Trail', BOX), tags: { name: 'Freedom Trail', type: 'route', route: 'foot' } };
  const found = findFsqSubVenues([trail], [room('r6', 'Old Corner Bookstore', LAT, LNG)], 'museums');
  assert.equal(found.size, 0);
});

test('findFsqSubVenues: an area of 20 ha or less still drops a dissimilar Foursquare place', () => {
  const found = findFsqSubVenues([museum('way/3', 'Museum of Fine Arts', BOX_15HA)], [room('r7', 'Art of Asia Gallery', LAT + 0.0015, LNG)], 'museums');
  assert.equal(found.get('r7')?.outcome, 'dropped');
  assert.equal(found.get('r7')?.insideOf, 'osm:way/3');
});

const FILLED = { website: 'https://mfa.example', tel: '617-267-9300', address: '465 Huntington Ave', locality: 'Boston', postcode: '02115' };
const ART = { categoryLabels: ['Arts and Entertainment > Museum > Art Museum'] };

test('mergePlaces: a similar-named Foursquare place inside an unmatched OSM area is merged into it', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const o = museum('relation/7', 'Museum of Fine Arts', BOX);
  // ~89 m from the OSM point: too far for matchSources, but inside the OSM bounds.
  const f = fsq('mfa', 'Museum of Fine Arts Boston', LAT + 0.0008, LNG, { ...FILLED, ...ART });
  assert.equal(matchSources([o], [f]).length, 0);
  const r = mergePlaces([o], [f], { runStart, today, cfg: museums });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:relation/7']);
  const row = r.rows[0]!;
  assert.equal(row.website, 'https://mfa.example');
  assert.equal(row.phone, '617-267-9300');
  assert.equal(row.address, '465 Huntington Ave, Boston 02115');
  assert.equal(row.fsq_place_id, 'mfa');
  assert.equal(row.attribution, ATTRIBUTION_MERGED);
  assert.ok('kind' in row && row.kind === 'museum');
  assert.deepEqual(r.subVenuesMerged, [
    { fsqId: 'mfa', name: 'Museum of Fine Arts Boston', insideOf: 'osm:relation/7', insideName: 'Museum of Fine Arts', outcome: 'merged' },
  ]);
  assert.deepEqual(r.subVenuesDropped, []);
  assert.deepEqual(r.matches, []);
  assertUniqueKeys(r.rows);
});

test('mergePlaces: merge-on-contain keeps OSM values and accepts a name whose tokens are a subset', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const o: OsmPlace = { ...museum('way/8', 'Isabella Stewart Gardner Museum', BOX),
    tags: { name: 'Isabella Stewart Gardner Museum', tourism: 'museum', website: 'https://gardner.example' } };
  const f = fsq('g1', 'Gardner', LAT + 0.0008, LNG, { ...FILLED, categoryLabels: ['Arts and Entertainment > Museum'] });
  const r = mergePlaces([o], [f], { runStart, today, cfg: museums });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.website, 'https://gardner.example');
  assert.equal(r.rows[0]!.phone, '617-267-9300');
  assert.equal(r.rows[0]!.fsq_place_id, 'g1');
  assert.equal(r.subVenuesMerged.length, 1);
});

test('mergePlaces: a similar-named Foursquare place inside an already matched OSM area is dropped', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const o = museum('relation/7', 'Museum of Fine Arts', BOX);
  const matched = room('m0', 'Museum of Fine Arts', LAT, LNG);
  const twin = fsq('mfa', 'Museum of Fine Arts Boston', LAT + 0.0008, LNG, { ...FILLED, ...ART });
  const r = mergePlaces([o], [matched, twin], { runStart, today, cfg: museums });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:relation/7']);
  assert.equal(r.rows[0]!.fsq_place_id, 'm0');
  assert.equal(r.rows[0]!.website, null);
  assert.deepEqual(r.subVenuesMerged, []);
  assert.deepEqual(r.subVenuesDropped.map((d) => [d.fsqId, d.insideOf, d.outcome]), [['mfa', 'osm:relation/7', 'dropped']]);
});

test('mergePlaces: a Foursquare place inside two similar-named OSM areas merges into only one (the smallest)', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const wing = museum('way/2', 'Museum of Fine Arts', BOX);
  const campus: OsmPlace = { ...museum('relation/1', 'Museum of Fine Arts Campus', BOX_15HA), lat: LAT + 0.0015 };
  const f = fsq('mfa', 'Museum of Fine Arts Boston', LAT + 0.0008, LNG, { ...FILLED, ...ART });
  const r = mergePlaces([campus, wing], [f], { runStart, today, cfg: museums });
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.filter((x) => x.fsq_place_id !== null).map((x) => x.place_id), ['osm:way/2']);
  assert.equal(r.subVenuesMerged.length, 1);
  assertUniqueKeys(r.rows);
});

test('mergePlaces: an OSM area gains at most one Foursquare place by containment (the nearest)', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const o = museum('relation/7', 'Museum of Fine Arts', BOX);
  const far = fsq('a-far', 'Museum of Fine Arts Boston', LAT + 0.0009, LNG, { ...ART, website: 'https://far.example' });
  const near = fsq('b-near', 'MFA Museum of Fine Arts', LAT - 0.0006, LNG, { ...ART, website: 'https://near.example' });
  const r = mergePlaces([o], [far, near], { runStart, today, cfg: museums });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:relation/7']);
  assert.equal(r.rows[0]!.fsq_place_id, 'b-near');
  assert.equal(r.rows[0]!.website, 'https://near.example');
  assert.deepEqual(r.subVenuesMerged.map((d) => d.fsqId), ['b-near']);
  assert.deepEqual(r.subVenuesDropped.map((d) => [d.fsqId, d.outcome]), [['a-far', 'dropped']]);
  assertUniqueKeys(r.rows);
});

const parks = PLACE_TYPE_CONFIG.parks;
function park(id: string, name: string, lat: number, lng: number, bounds: OsmPlace['bounds'] = null): OsmPlace {
  return { osmId: id, name, lat, lng, bounds, tags: { name, leisure: 'park' } };
}
const fsqPark = (id: string, name: string, lat: number, lng: number, extra: Partial<FsqPlace> = {}) =>
  fsq(id, name, lat, lng, { categoryLabels: ['Landmarks and Outdoors > Park'], ...extra });

test('mergePlaces: a matched Foursquare park fills the OSM park address', () => {
  const r = mergePlaces([park('way/1', 'Boston Common', LAT, LNG)],
    [fsqPark('p1', 'Boston Common', LAT + D30, LNG, { address: '139 Tremont St', locality: 'Boston', website: 'https://common.example' })],
    { runStart, today, cfg: parks });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.address, '139 Tremont St, Boston');
  assert.equal(r.rows[0]!.website, 'https://common.example');
  assert.equal(r.rows[0]!.fsq_place_id, 'p1');
  assert.equal(r.rows[0]!.attribution, ATTRIBUTION_MERGED);
  assert.ok('kind' in r.rows[0]! && r.rows[0]!.kind === 'park');
  assert.equal(r.unmatchedFsqDropped, 0);
});

test('mergePlaces: an unmatched Foursquare park is dropped and counted', () => {
  const r = mergePlaces([park('way/1', 'Boston Common', LAT, LNG)],
    [fsqPark('p2', 'Pocket Park', LAT + 0.01, LNG, { address: '1 Main St' })],
    { runStart, today, cfg: parks });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:way/1']);
  assert.equal(r.unmatchedFsqDropped, 1);
  assert.equal(r.rows[0]!.fsq_place_id, null);
});

test('mergePlaces: an unmatched Foursquare park can still merge into a containing similar-named OSM park', () => {
  const r = mergePlaces([park('way/1', 'Public Garden', LAT, LNG, BOX)],
    [fsqPark('p3', 'Boston Public Garden', LAT + 0.0008, LNG, { address: '4 Charles St' })],
    { runStart, today, cfg: parks });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:way/1']);
  assert.equal(r.rows[0]!.address, '4 Charles St');
  assert.equal(r.rows[0]!.fsq_place_id, 'p3');
  assert.equal(r.unmatchedFsqDropped, 0);
  assert.equal(r.subVenuesMerged.length, 1);
});

test('mergePlaces: other non-food types and restaurants keep unmatched Foursquare places', () => {
  const r = mergePlaces([museum('node/1', 'Museum A', null)], [room('x1', 'Gallery B', LAT + 0.01, LNG)], { runStart, today, cfg: PLACE_TYPE_CONFIG.museums });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:node/1', 'fsq:x1']);
  assert.equal(r.unmatchedFsqDropped, 0);
  const food = mergePlaces([osm('node/1', 'A', LAT, LNG)], [fsq('k1', 'B', LAT + 0.01, LNG)], { runStart, today, cfg });
  assert.deepEqual(food.rows.map((x) => x.place_id), ['osm:node/1', 'fsq:k1']);
  assert.equal(food.unmatchedFsqDropped, 0);
  assert.deepEqual(food.subVenuesMerged, []);
});

test('findFsqSubVenues: a similar-named Foursquare place merges into an OSM area over 20 ha', () => {
  const zoo: OsmPlace = { ...museum('way/504956903', 'Franklin Park Zoo', BOX_33HA), tags: { name: 'Franklin Park Zoo', tourism: 'zoo' } };
  const found = findFsqSubVenues([zoo], [room('z1', 'Franklin Park Zoo', LAT + 0.0019, LNG)], 'entertainment');
  assert.deepEqual([...found.values()], [
    { fsqId: 'z1', name: 'Franklin Park Zoo', insideOf: 'osm:way/504956903', insideName: 'Franklin Park Zoo', outcome: 'merged' },
  ]);
});

test('mergePlaces: a similar-named Foursquare place inside an OSM area over 20 ha is merged, a dissimilar one is kept', () => {
  const ent = PLACE_TYPE_CONFIG.entertainment;
  const zoo: OsmPlace = { ...museum('way/504956903', 'Franklin Park Zoo', BOX_33HA), tags: { name: 'Franklin Park Zoo', tourism: 'zoo' } };
  const labels = { categoryLabels: ['Arts and Entertainment > Zoo'] };
  const same = fsq('z1', 'Franklin Park Zoo', LAT + 0.0019, LNG, { ...labels, website: 'https://zoo.example', tel: '617' });
  const other = fsq('z2', 'Frozen Zebras', LAT - 0.0019, LNG, { categoryLabels: ['Arts and Entertainment > Night Club'] });
  const r = mergePlaces([zoo], [same, other], { runStart, today, cfg: ent });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:way/504956903', 'fsq:z2']);
  assert.equal(r.rows[0]!.fsq_place_id, 'z1');
  assert.equal(r.rows[0]!.website, 'https://zoo.example');
  assert.equal(r.rows[0]!.attribution, ATTRIBUTION_MERGED);
  assert.deepEqual(r.subVenuesMerged.map((d) => d.fsqId), ['z1']);
  assert.deepEqual(r.subVenuesDropped, []);
});

test('mergePlaces: a similar-named Foursquare place inside an already matched OSM area over 20 ha is kept, not dropped', () => {
  const museums = PLACE_TYPE_CONFIG.museums;
  const estate = museum('relation/20246376', 'Eustis Estate Museum and Study Center', BOX_33HA);
  const matched = room('e0', 'Eustis Estate Museum and Study Center', LAT, LNG);
  const twin = room('e1', 'Eustis Estate', LAT + 0.0025, LNG);
  const r = mergePlaces([estate], [matched, twin], { runStart, today, cfg: museums });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:relation/20246376', 'fsq:e1']);
  assert.equal(r.rows[0]!.fsq_place_id, 'e0');
  assert.deepEqual(r.subVenuesMerged, []);
  assert.deepEqual(r.subVenuesDropped, []);
});

test('findFsqSubVenues: a large similar-named area that cannot merge falls back to dropping in a small container', () => {
  const campus = museum('relation/1', 'Museum of Fine Arts Campus', BOX_33HA);
  const wing = museum('way/2', 'Linde Wing', BOX);
  const found = findFsqSubVenues([campus, wing], [room('w1', 'Museum of Fine Arts', LAT, LNG)], 'museums', new Set(['relation/1']));
  assert.deepEqual([found.get('w1')?.outcome, found.get('w1')?.insideOf], ['dropped', 'osm:way/2']);
});

test('mergePlaces: over 20 ha a merge needs similarity >= 0.6 or a Foursquare-name subset with a non-generic word', () => {
  const harbor = park('way/830089938', 'Old Harbor Park', LAT, LNG, BOX_33HA);
  const loose = fsqPark('h1', 'Harbor Point Park', LAT + 0.0019, LNG, { address: '1 Harbor Point Blvd' });
  const r = mergePlaces([harbor], [loose], { runStart, today, cfg: parks });
  assert.deepEqual(r.rows.map((x) => x.place_id), ['osm:way/830089938']);
  assert.equal(r.rows[0]!.fsq_place_id, null);
  assert.deepEqual(r.subVenuesMerged, []);
  assert.deepEqual(r.subVenuesDropped, []);
  assert.equal(r.unmatchedFsqDropped, 1);   // parks keep no unmatched Foursquare place; it is not a sub-venue
  const exact = fsqPark('h2', 'Old Harbor Park', LAT + 0.0019, LNG, { address: '2 Old Harbor St' });
  const r2 = mergePlaces([harbor], [exact], { runStart, today, cfg: parks });
  assert.equal(r2.rows[0]!.fsq_place_id, 'h2');
  assert.equal(r2.rows[0]!.address, '2 Old Harbor St');
});

test('findFsqSubVenues: over 20 ha, Foursquare names that extend the OSM name or are only generic words do not merge', () => {
  const sw = park('way/825058449', 'Southwest Corridor Park', LAT, LNG, BOX_33HA);
  const fp = park('relation/65053', 'Franklin Park', LAT, LNG, BOX_33HA);
  const one = (o: OsmPlace, name: string) => findFsqSubVenues([o], [fsqPark('x', name, LAT + 0.0019, LNG)], 'parks').get('x');
  assert.equal(one(sw, 'Tennis courts at Southwest Corridor Park'), undefined);
  assert.equal(one(fp, 'Franklin Park - Overlook Ruins'), undefined);
  assert.equal(one(sw, 'Park'), undefined);                       // subset, but only a generic word
  assert.equal(one(sw, 'Corridor')?.outcome, 'merged');           // similarity 0.33, but a subset with a non-generic word
  assert.equal(one(fp, 'Franklin Park')?.outcome, 'merged');
  // 20 ha or less keeps the looser rule (similarity 0.5).
  assert.equal(findFsqSubVenues([park('way/1', 'Old Harbor Park', LAT, LNG, BOX)],
    [fsqPark('y', 'Harbor Point Park', LAT + 0.0008, LNG)], 'parks').get('y')?.outcome, 'merged');
});
