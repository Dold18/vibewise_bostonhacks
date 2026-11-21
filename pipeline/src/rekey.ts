import type { ExistingRow, RekeyAction, RestaurantRow } from './types.ts';

/**
 * Decides which existing rows must be re-keyed before the upsert (spec 6.7).
 * Pure: inputs are not mutated. Actions are ordered clear_fsq, promote, collapse,
 * each group by existing row id ascending.
 */
export function planRekey(existing: ExistingRow[], rows: RestaurantRow[]): RekeyAction[] {
  const newBySourceId = new Map<string, RestaurantRow>();
  const newOsmByFsq = new Map<string, RestaurantRow>();
  for (const row of rows) {
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
    if (fsqId === null) continue;
    if (e.source === 'osm') {
      const next = newBySourceId.get(e.source_id);
      const holder = newOsmByFsq.get(fsqId);
      const changed = next !== undefined && next.fsq_place_id !== fsqId;
      const movedAway = holder !== undefined && holder.source_id !== e.source_id;
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
