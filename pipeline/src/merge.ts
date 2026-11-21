import {
  ATTRIBUTION_MERGED, DEDUPE_WITHIN_METERS, FSQ_MAX_AGE_DAYS, MATCH_SAME_NAME_METERS,
  MATCH_SIMILAR_NAME_METERS, MATCH_SIMILARITY_THRESHOLD,
} from './config.ts';
import { metersBetween } from './geo.ts';
import { nameKey, nameSimilarity } from './normalize.ts';
import { fsqRow, osmRow } from './sources.ts';
import type { DroppedDuplicate, FsqPlace, MatchPair, OsmPlace, RestaurantRow, Source } from './types.ts';

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
  const replacedBy = new Map<string, string>(); // droppedId -> id of the item that beat it
  for (const item of sorted) {
    const key = nameKey(item.name);
    const j = key === '' ? -1 : kept.findIndex(
      (k) => nameKey(k.name) === key && metersBetween(k, item) <= DEDUPE_WITHIN_METERS,
    );
    if (j === -1) { kept.push(item); continue; }
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

export function matchSources(osm: OsmPlace[], fsq: FsqPlace[]): MatchPair[] {
  const candidates: Array<{ osmId: string; fsqId: string; meters: number; similarity: number }> = [];
  for (const o of osm) {
    const ko = nameKey(o.name);
    if (ko === '') continue;
    for (const f of fsq) {
      const meters = metersBetween(o, f);
      const sameName = nameKey(f.name) === ko && meters <= MATCH_SAME_NAME_METERS;
      const similarity = nameSimilarity(o.name, f.name);
      if (sameName || (similarity >= MATCH_SIMILARITY_THRESHOLD && meters <= MATCH_SIMILAR_NAME_METERS)) {
        candidates.push({ osmId: o.osmId, fsqId: f.fsqId, meters, similarity });
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

function isFresh(dateRefreshed: string | null, today: string): boolean {
  if (dateRefreshed === null) return false;
  return Math.round(utcDay(today) - utcDay(dateRefreshed)) <= FSQ_MAX_AGE_DAYS;
}

export function mergePlaces(
  osm: OsmPlace[],
  fsq: FsqPlace[],
  opts: { runStart: string; today: string },
): { rows: RestaurantRow[]; matches: MatchPair[]; dropped: DroppedDuplicate[]; staleFsqDropped: number } {
  const o = dedupeWithin(osm, (p) => p.osmId, 'osm', osmFieldCount);
  const f = dedupeWithin(fsq, (p) => p.fsqId, 'foursquare', fsqFieldCount);
  const matches = matchSources(o.kept, f.kept);
  const fsqByMatchedOsm = new Map(matches.map((m) => [m.osmId, m.fsqId]));
  const matchedFsq = new Set(matches.map((m) => m.fsqId));
  const fsqById = new Map(f.kept.map((p) => [p.fsqId, p]));

  const rows: RestaurantRow[] = [];
  for (const p of o.kept) {
    const row = osmRow(p, opts.runStart);
    const fsqId = fsqByMatchedOsm.get(p.osmId);
    if (fsqId !== undefined) {
      const fr = fsqRow(fsqById.get(fsqId)!, opts.runStart);
      row.address ??= fr.address;
      row.website ??= fr.website;
      row.phone ??= fr.phone;
      row.source_cuisines = [...new Set([...row.source_cuisines, ...fr.source_cuisines])];
      row.fsq_place_id = fsqId;
      row.attribution = ATTRIBUTION_MERGED;
    }
    rows.push(row);
  }
  let staleFsqDropped = 0;
  for (const p of f.kept) {
    if (matchedFsq.has(p.fsqId)) continue;
    if (!isFresh(p.dateRefreshed, opts.today)) { staleFsqDropped++; continue; }
    rows.push(fsqRow(p, opts.runStart));
  }
  return { rows, matches, dropped: [...o.dropped, ...f.dropped], staleFsqDropped };
}
