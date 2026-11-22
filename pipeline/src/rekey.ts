import type { ExistingRow, RekeyAction, PlaceRow } from './types.ts';

/**
 * Decides which existing rows must be re-keyed before the upsert (spec 6.7).
 * Pure: inputs are not mutated. Actions are ordered clear_fsq, promote, collapse,
 * each group by existing row id ascending.
 */
export function planRekey(existing: ExistingRow[], rows: PlaceRow[]): RekeyAction[] {
  const newBySourceId = new Map<string, PlaceRow>();
  const newOsmByFsq = new Map<string, PlaceRow>();
  const newHolderByFsq = new Map<string, PlaceRow>(); // any new row (OSM or FSQ-only) carrying the id
  for (const row of rows) {
    if (row.fsq_place_id !== null) newHolderByFsq.set(row.fsq_place_id, row);
    if (row.source !== 'osm') continue;
    newBySourceId.set(row.source_id, row);
    if (row.fsq_place_id !== null) newOsmByFsq.set(row.fsq_place_id, row);
  }
  const existingOsmIds = new Set(existing.filter((e) => e.source === 'osm').map((e) => e.source_id));

  const clears: RekeyAction[] = [];
  const promotes: RekeyAction[] = [];
  const collapses: RekeyAction[] = [];

  for (const e of existing) {
    const fsqId = e.fsq_place_id;
    if (fsqId === null) continue; // a foursquare row always has fsq_place_id, so null can only be an OSM row with nothing to clear
    if (e.source === 'osm') {
      const next = newBySourceId.get(e.source_id);
      const holder = newHolderByFsq.get(fsqId);
      const changed = next !== undefined && next.fsq_place_id !== fsqId;
      const movedAway = holder !== undefined && (holder.source !== 'osm' || holder.source_id !== e.source_id);
      if (changed || movedAway) clears.push({ kind: 'clear_fsq', id: e.id });
    } else {
      const target = newOsmByFsq.get(fsqId);
      if (target === undefined) continue;
      if (existingOsmIds.has(target.source_id)) {
        collapses.push({ kind: 'collapse', id: e.id, fsqId });
      } else {
        promotes.push({ kind: 'promote', id: e.id, sourceId: target.source_id, placeId: target.place_id });
      }
    }
  }

  const byId = (a: RekeyAction, b: RekeyAction) => a.id - b.id;
  return [...clears.sort(byId), ...promotes.sort(byId), ...collapses.sort(byId)];
}
