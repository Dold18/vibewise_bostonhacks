import { MATCH_SAME_NAME_METERS, MATCH_SIMILAR_NAME_METERS, MATCH_SIMILARITY_THRESHOLD } from './config.ts';
import { metersBetween, parseEwktPoint } from './geo.ts';
import { nameKey } from './normalize.ts';
import type { PlaceType } from './placeTypes.ts';
import type { PlaceRow } from './types.ts';

/** A place already in another type's table (from `catalog_places`). */
export interface OtherPlace { placeId: string; placeType: PlaceType; name: string; lat: number; lng: number }

export interface CrossTypeDuplicate { placeId: string; otherPlaceId: string; otherType: PlaceType; meters: number }
export interface TypeConflict { placeId: string; registeredAs: PlaceType }

const CELL_DEG = 0.001; // ~111 m of latitude, >= 50 m of longitude below 63 degrees (same grid as matchSources)

function tokensOf(key: string): Set<string> {
  return new Set(key.split(' '));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Splits new rows into those to write and those that are the same real place as a row of another type
 * (spec §4: the existing row wins). Same rules as `matchSources`: same name key within MATCH_SAME_NAME_METERS,
 * or name Jaccard >= MATCH_SIMILARITY_THRESHOLD within MATCH_SIMILAR_NAME_METERS. The nearest match is reported.
 */
export function findCrossTypeDuplicates(rows: PlaceRow[], others: OtherPlace[]): {
  kept: PlaceRow[]; duplicates: CrossTypeDuplicate[];
} {
  const cell = (v: number) => Math.floor(v / CELL_DEG);
  const grid = new Map<string, Array<{ o: OtherPlace; key: string; tokens: Set<string> }>>();
  for (const o of others) {
    const key = nameKey(o.name);
    if (key === '') continue; // an empty key never matches
    const id = `${cell(o.lat)},${cell(o.lng)}`;
    const entry = { o, key, tokens: tokensOf(key) };
    const list = grid.get(id);
    if (list) list.push(entry); else grid.set(id, [entry]);
  }

  const kept: PlaceRow[] = [];
  const duplicates: CrossTypeDuplicate[] = [];
  for (const row of rows) {
    const key = nameKey(row.name);
    const point = parseEwktPoint(row.location);
    if (key === '' || point === null) {
      kept.push(row);
      continue;
    }
    const tokens = tokensOf(key);
    let best: { o: OtherPlace; meters: number } | null = null;
    const cy = cell(point.lat);
    const cx = cell(point.lng);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const c of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const meters = metersBetween(point, c.o);
          if (meters > MATCH_SAME_NAME_METERS) continue;
          const sameName = c.key === key;
          if (!sameName && (meters > MATCH_SIMILAR_NAME_METERS || jaccard(tokens, c.tokens) < MATCH_SIMILARITY_THRESHOLD)) continue;
          if (best === null || meters < best.meters || (meters === best.meters && c.o.placeId < best.o.placeId)) {
            best = { o: c.o, meters };
          }
        }
      }
    }
    if (best === null) {
      kept.push(row);
    } else {
      duplicates.push({
        placeId: row.place_id, otherPlaceId: best.o.placeId, otherType: best.o.placeType,
        meters: Math.round(best.meters * 10) / 10,
      });
    }
  }
  return { kept, duplicates };
}

/** Rows whose place_id is already registered under another type are skipped (ingest never moves a place). */
export function splitTypeConflicts(rows: PlaceRow[], registered: Map<string, PlaceType>, type: PlaceType): {
  kept: PlaceRow[]; conflicts: TypeConflict[];
} {
  const kept: PlaceRow[] = [];
  const conflicts: TypeConflict[] = [];
  for (const row of rows) {
    const registeredAs = registered.get(row.place_id);
    if (registeredAs !== undefined && registeredAs !== type) conflicts.push({ placeId: row.place_id, registeredAs });
    else kept.push(row);
  }
  return { kept, conflicts };
}
