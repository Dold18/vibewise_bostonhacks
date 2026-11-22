import {
  ATTRIBUTION_MERGED, DEDUPE_WITHIN_METERS, FSQ_MAX_AGE_DAYS, MATCH_SAME_NAME_METERS,
  MATCH_SIMILAR_NAME_METERS, MATCH_SIMILARITY_THRESHOLD, SUB_VENUE_CONTAINER_MAX_HA, SUB_VENUE_MERGE_SIMILARITY,
} from './config.ts';
import { metersBetween } from './geo.ts';
import { nameKey, nameSimilarity } from './normalize.ts';
import { boundsAreaHa, isOsmRoute, type PlaceType, type PlaceTypeConfig } from './placeTypes.ts';
import { fsqRow, osmRow } from './sources.ts';
import type { DroppedDuplicate, FsqPlace, MatchPair, OsmPlace, PlaceRow, Source } from './types.ts';

type Located = { name: string; lat: number; lng: number };

const OSM_TYPE_RANK: Record<string, number> = { node: 0, way: 1, relation: 2 };

function osmIdOrder(a: string, b: string): number {
  const [ta, ia] = a.split('/');
  const [tb, ib] = b.split('/');
  const rank = (OSM_TYPE_RANK[ta!] ?? 3) - (OSM_TYPE_RANK[tb!] ?? 3);
  if (rank !== 0) return rank;
  return Number(ia) - Number(ib);
}

/** Negative when id `a` beats id `b` on the tie-break. */
function tieBreak(source: Source, a: string, b: string): number {
  if (source === 'osm') return osmIdOrder(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dedupeWithin<T extends Located>(
  items: T[],
  idOf: (t: T) => string,
  source: Source,
  fieldsOf: (t: T) => number,
): { kept: T[]; dropped: DroppedDuplicate[] } {
  // Single pass in id order: each item is compared only against already-kept items.
  const sorted = [...items].sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
  const kept: T[] = [];
  const keptByKey = new Map<string, number[]>(); // nameKey -> indices into kept, ascending
  const replacedBy = new Map<string, string>(); // droppedId -> id of the item that beat it
  for (const item of sorted) {
    const key = nameKey(item.name);
    const bucket = key === '' ? undefined : keptByKey.get(key);
    const j = bucket?.find((idx) => metersBetween(kept[idx]!, item) <= DEDUPE_WITHIN_METERS) ?? -1;
    if (j === -1) {
      if (key !== '') {
        if (bucket) bucket.push(kept.length); else keptByKey.set(key, [kept.length]);
      }
      kept.push(item);
      continue;
    }
    const incumbent = kept[j]!;
    const diff = fieldsOf(item) - fieldsOf(incumbent);
    const itemWins = diff !== 0 ? diff > 0 : tieBreak(source, idOf(item), idOf(incumbent)) < 0;
    const [winner, loser] = itemWins ? [item, incumbent] : [incumbent, item];
    kept[j] = winner;
    replacedBy.set(idOf(loser), idOf(winner));
  }
  const finalWinner = (id: string): string => {
    let cur = id;
    while (replacedBy.has(cur)) cur = replacedBy.get(cur)!;
    return cur;
  };
  const dropped = [...replacedBy.keys()].map((droppedId) => ({ source, keptId: finalWinner(droppedId), droppedId }));
  return { kept, dropped };
}

const CELL_DEG = 0.001; // ~111 m of latitude, >= 50 m of longitude below 63 degrees

function tokensOf(key: string): Set<string> {
  return new Set(key.split(' '));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function matchSources(osm: OsmPlace[], fsq: FsqPlace[]): MatchPair[] {
  // Index Foursquare places by grid cell so each OSM place only looks at nearby ones; name work is precomputed once.
  const grid = new Map<string, Array<{ f: FsqPlace; key: string; tokens: Set<string> }>>();
  const cell = (v: number) => Math.floor(v / CELL_DEG);
  for (const f of fsq) {
    const key = nameKey(f.name);
    if (key === '') continue; // an empty key never matches (same-name needs a non-empty key; similarity is 0)
    const id = `${cell(f.lat)},${cell(f.lng)}`;
    const entry = { f, key, tokens: tokensOf(key) };
    const list = grid.get(id);
    if (list) list.push(entry); else grid.set(id, [entry]);
  }
  const candidates: Array<{ osmId: string; fsqId: string; meters: number; similarity: number }> = [];
  for (const o of osm) {
    const ko = nameKey(o.name);
    if (ko === '') continue;
    const to = tokensOf(ko);
    const cy = cell(o.lat);
    const cx = cell(o.lng);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const { f, key, tokens } of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const meters = metersBetween(o, f);
          if (meters > MATCH_SAME_NAME_METERS) continue;
          const sameName = key === ko;
          if (!sameName && meters > MATCH_SIMILAR_NAME_METERS) continue;
          const similarity = jaccard(to, tokens);
          if (sameName || similarity >= MATCH_SIMILARITY_THRESHOLD) {
            candidates.push({ osmId: o.osmId, fsqId: f.fsqId, meters, similarity });
          }
        }
      }
    }
  }
  candidates.sort((a, b) => a.meters - b.meters || (a.osmId < b.osmId ? -1 : a.osmId > b.osmId ? 1 : 0) || (a.fsqId < b.fsqId ? -1 : 1));
  const usedOsm = new Set<string>();
  const usedFsq = new Set<string>();
  const pairs: MatchPair[] = [];
  for (const c of candidates) {
    if (usedOsm.has(c.osmId) || usedFsq.has(c.fsqId)) continue;
    usedOsm.add(c.osmId);
    usedFsq.add(c.fsqId);
    pairs.push({
      osmId: c.osmId, fsqId: c.fsqId,
      meters: Math.round(c.meters * 10) / 10,
      similarity: Math.round(c.similarity * 1000) / 1000,
    });
  }
  return pairs;
}

function osmFieldCount(p: OsmPlace): number {
  const t = p.tags;
  const keys = ['website', 'contact:website', 'phone', 'contact:phone', 'opening_hours', 'cuisine'];
  let n = Object.entries(t).filter(([k, v]) => k.startsWith('addr:') && v.trim() !== '').length;
  n += keys.filter((k) => (t[k] ?? '').trim() !== '').length;
  return n;
}

function fsqFieldCount(p: FsqPlace): number {
  const vals = [p.address, p.locality, p.postcode, p.tel, p.website];
  return vals.filter((v) => v !== null).length + (p.categoryLabels.length > 0 ? 1 : 0);
}

function utcDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** 'fresh' / 'stale' for a parseable date (or a missing one, which is stale); 'unparseable' otherwise (also stale). */
export function freshness(dateRefreshed: string | null, today: string): 'fresh' | 'stale' | 'unparseable' {
  if (dateRefreshed === null) return 'stale';
  const head = dateRefreshed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return 'unparseable';
  const day = utcDay(head);
  if (Number.isNaN(day)) return 'unparseable';
  return Math.round(utcDay(today) - day) <= FSQ_MAX_AGE_DAYS ? 'fresh' : 'stale';
}

export interface FsqSubVenue {
  fsqId: string; name: string; insideOf: string; insideName: string;
  outcome: 'merged' | 'dropped';   // merged: the container itself (fills its fields); dropped: a room or wing of it
}

/** Same place by name: similarity at least SUB_VENUE_MERGE_SIMILARITY, or one name's tokens all appear in the other. */
function sameNamedPlace(a: string, b: string): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (ka === '' || kb === '') return false;
  if (nameSimilarity(a, b) >= SUB_VENUE_MERGE_SIMILARITY) return true;
  const ta = tokensOf(ka);
  const tb = tokensOf(kb);
  const subset = (x: Set<string>, y: Set<string>) => [...x].every((t) => y.has(t));
  return subset(ta, tb) || subset(tb, ta);
}

/** An OSM area a Foursquare place can lie inside: nodes (no bounds) and routes never are one. */
function isArea(o: OsmPlace): boolean {
  return o.bounds !== null && !isOsmRoute(o.tags);
}

/**
 * Non-food only: Foursquare lists rooms and wings of a place (e.g. galleries inside a museum) as places of their own,
 * and sometimes the place itself, too far from the OSM point to match. For each given Foursquare place whose point
 * lies inside the bounds of OSM areas (see isArea):
 * - 'merged' into the smallest containing area with a similar name (any size), when that place has no Foursquare
 *   match in `matchedOsm` and gains no other Foursquare place here (the one closest to the OSM point wins, then fsqId);
 * - otherwise 'dropped' when a containing area is at most SUB_VENUE_CONTAINER_MAX_HA, reported against the
 *   similar-named area if it is that small, else the smallest containing one;
 * - otherwise not returned (a big area such as a campus or district never drops what lies inside it).
 * Restaurants are never checked.
 */
export function findFsqSubVenues(
  osm: OsmPlace[], fsq: FsqPlace[], type: PlaceType, matchedOsm: ReadonlySet<string> = new Set(),
): Map<string, FsqSubVenue> {
  const out = new Map<string, FsqSubVenue>();
  if (type === 'restaurants') return out;
  const areas = osm
    .filter(isArea)
    .map((o) => ({ o, b: o.bounds!, ha: boundsAreaHa(o.bounds!) }))
    .sort((a, b) => a.ha - b.ha || osmIdOrder(a.o.osmId, b.o.osmId));
  const entry = (f: FsqPlace, o: OsmPlace, outcome: FsqSubVenue['outcome']): FsqSubVenue =>
    ({ fsqId: f.fsqId, name: f.name, insideOf: `osm:${o.osmId}`, insideName: o.name, outcome });
  const dropInto = new Map<string, OsmPlace | null>();   // fsqId -> small container to drop into, if not merged
  const proposals: Array<{ f: FsqPlace; o: OsmPlace; meters: number }> = [];
  for (const f of fsq) {
    const hits = areas.filter(({ b }) => f.lat >= b.minlat && f.lat <= b.maxlat && f.lng >= b.minlon && f.lng <= b.maxlon);
    if (hits.length === 0) continue;
    const similar = hits.find(({ o }) => sameNamedPlace(f.name, o.name));
    const small = similar !== undefined && similar.ha <= SUB_VENUE_CONTAINER_MAX_HA
      ? similar
      : hits.find(({ ha }) => ha <= SUB_VENUE_CONTAINER_MAX_HA);
    dropInto.set(f.fsqId, small?.o ?? null);
    if (similar && !matchedOsm.has(similar.o.osmId)) proposals.push({ f, o: similar.o, meters: metersBetween(similar.o, f) });
  }
  proposals.sort((a, b) => a.meters - b.meters || (a.f.fsqId < b.f.fsqId ? -1 : a.f.fsqId > b.f.fsqId ? 1 : 0));
  const gained = new Set<string>();
  const mergeInto = new Map<string, OsmPlace>();
  for (const { f, o } of proposals) {
    if (gained.has(o.osmId)) continue;
    gained.add(o.osmId);
    mergeInto.set(f.fsqId, o);
  }
  for (const f of fsq) {
    const merged = mergeInto.get(f.fsqId);
    const dropped = dropInto.get(f.fsqId);
    if (merged) out.set(f.fsqId, entry(f, merged, 'merged'));
    else if (dropped) out.set(f.fsqId, entry(f, dropped, 'dropped'));
  }
  return out;
}

/** Fills the OSM row's missing contact fields from its Foursquare twin and links the two (a match or a merged sub-venue). */
function absorbFsq(row: PlaceRow, fsq: FsqPlace, runStart: string, cfg: PlaceTypeConfig): void {
  const fr = fsqRow(fsq, runStart, cfg);
  row.address ??= fr.address;
  row.website ??= fr.website;
  row.phone ??= fr.phone;
  // Food rows union cuisines; other rows keep the OSM kind.
  if ('source_cuisines' in row && 'source_cuisines' in fr) {
    row.source_cuisines = [...new Set([...row.source_cuisines, ...fr.source_cuisines])];
  }
  row.fsq_place_id = fsq.fsqId;
  row.attribution = ATTRIBUTION_MERGED;
}

export function mergePlaces(
  osm: OsmPlace[],
  fsq: FsqPlace[],
  opts: { runStart: string; today: string; cfg: PlaceTypeConfig },
): {
  rows: PlaceRow[]; matches: MatchPair[]; dropped: DroppedDuplicate[]; staleFsqDropped: number; unparseableDates: number;
  subVenuesMerged: FsqSubVenue[]; subVenuesDropped: FsqSubVenue[];
  unmatchedFsqDropped: number;   // fresh Foursquare places neither matched nor in an OSM area, for types that keep none
} {
  const o = dedupeWithin(osm, (p) => p.osmId, 'osm', osmFieldCount);
  const f = dedupeWithin(fsq, (p) => p.fsqId, 'foursquare', fsqFieldCount);
  const matches = matchSources(o.kept, f.kept);
  const fsqByMatchedOsm = new Map(matches.map((m) => [m.osmId, m.fsqId]));
  const matchedFsq = new Set(matches.map((m) => m.fsqId));
  const fsqById = new Map(f.kept.map((p) => [p.fsqId, p]));

  let staleFsqDropped = 0;
  let unparseableDates = 0;
  const freshFsqOnly: FsqPlace[] = [];
  for (const p of f.kept) {
    if (matchedFsq.has(p.fsqId)) continue;
    const fresh = freshness(p.dateRefreshed, opts.today);
    if (fresh !== 'fresh') {
      staleFsqDropped++;
      if (fresh === 'unparseable') unparseableDates++;
      continue;
    }
    freshFsqOnly.push(p);
  }
  const subVenues = findFsqSubVenues(o.kept, freshFsqOnly, opts.cfg.type, new Set(fsqByMatchedOsm.keys()));
  const subVenueList = [...subVenues.values()];
  const subVenuesMerged = subVenueList.filter((v) => v.outcome === 'merged');
  const fsqByContainingOsm = new Map(subVenuesMerged.map((v) => [v.insideOf, v.fsqId]));

  const rows: PlaceRow[] = [];
  for (const p of o.kept) {
    const row = osmRow(p, opts.runStart, opts.cfg);
    const fsqId = fsqByMatchedOsm.get(p.osmId) ?? fsqByContainingOsm.get(`osm:${p.osmId}`);
    if (fsqId !== undefined) absorbFsq(row, fsqById.get(fsqId)!, opts.runStart, opts.cfg);
    rows.push(row);
  }
  let unmatchedFsqDropped = 0;
  for (const p of freshFsqOnly) {
    if (subVenues.has(p.fsqId)) continue;
    if (!opts.cfg.keepUnmatchedFsq) {
      unmatchedFsqDropped++;
      continue;
    }
    rows.push(fsqRow(p, opts.runStart, opts.cfg));
  }
  return {
    rows, matches, dropped: [...o.dropped, ...f.dropped], staleFsqDropped, unparseableDates,
    subVenuesMerged, subVenuesDropped: subVenueList.filter((v) => v.outcome === 'dropped'), unmatchedFsqDropped,
  };
}

/** Throws if two rows share a `source:source_id` or a non-null fsq_place_id (the upsert/rekey would corrupt data). */
export function assertUniqueKeys(rows: PlaceRow[]): void {
  const seenKeys = new Set<string>();
  const seenFsq = new Set<string>();
  const dupKeys: string[] = [];
  const dupFsq: string[] = [];
  for (const r of rows) {
    const key = `${r.source}:${r.source_id}`;
    if (seenKeys.has(key)) dupKeys.push(key); else seenKeys.add(key);
    if (r.fsq_place_id !== null) {
      if (seenFsq.has(r.fsq_place_id)) dupFsq.push(r.fsq_place_id); else seenFsq.add(r.fsq_place_id);
    }
  }
  if (dupKeys.length === 0 && dupFsq.length === 0) return;
  const parts: string[] = [];
  if (dupKeys.length > 0) parts.push(`${dupKeys.length} duplicate source:source_id (first: ${dupKeys.slice(0, 5).join(', ')})`);
  if (dupFsq.length > 0) parts.push(`${dupFsq.length} duplicate fsq_place_id (first: ${dupFsq.slice(0, 5).join(', ')})`);
  throw new Error(`refusing to write: ${parts.join('; ')}`);
}
