import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnrichPlace } from '../media/types.ts';
import type { PlaceType } from '../placeTypes.ts';
import { matchKey } from './plan.ts';
import type { DealRow, DealSource } from './types.ts';

const PAGE_SIZE = 1000; // PostgREST max_rows

export type DealPlace = EnrichPlace & { dealsCheckedAt: string | null; lastSeenAt: string | null };

interface PointRow {
  id: number; place_id: string; name: string; lat: number; lng: number;
  website: string | null; address: string | null; osm_tags: Record<string, string> | null;
  deals_checked_at: string | null; last_seen_at: string | null;
}

/** Catalog places of one type, or of every type when `type` is omitted (the curated step spans all types). */
export async function fetchDealPlaces(client: SupabaseClient, type?: PlaceType): Promise<DealPlace[]> {
  const out: DealPlace[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = client.from('place_points')
      .select('id, place_id, name, lat, lng, website, address, osm_tags, deals_checked_at, last_seen_at');
    if (type !== undefined) q = q.eq('place_type', type);
    const { data, error } = await q
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchDealPlaces failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as PointRow[];
    for (const r of rows) {
      out.push({
        id: r.id, placeId: r.place_id, name: r.name, lat: r.lat, lng: r.lng, website: r.website, address: r.address,
        osmTags: r.osm_tags, dealsCheckedAt: r.deals_checked_at, lastSeenAt: r.last_seen_at,
      });
    }
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** Match keys of hidden deals, keyed by `${placeRef}:${source}`. */
export async function fetchHiddenDealKeys(client: SupabaseClient): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from('place_deals').select('id, place_ref, source, title, quote')
      .eq('hidden', true).order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchHiddenDealKeys failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as Array<{ place_ref: number; source: DealSource; title: string; quote: string | null }>;
    for (const r of rows) {
      const k = `${r.place_ref}:${r.source}`;
      const set = out.get(k) ?? new Set<string>();
      set.add(matchKey(r));
      out.set(k, set);
    }
    if (rows.length < PAGE_SIZE) return out;
  }
}

export async function fetchPlaceRefsWithVisibleDeals(client: SupabaseClient, source: DealSource): Promise<Set<number>> {
  const out = new Set<number>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from('place_deals').select('id, place_ref')
      .eq('hidden', false).eq('source', source).order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchPlaceRefsWithVisibleDeals failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as Array<{ place_ref: number }>;
    for (const r of rows) out.add(r.place_ref);
    if (rows.length < PAGE_SIZE) return out;
  }
}

function toInsert(placeRef: number, r: DealRow) {
  return {
    place_ref: placeRef, kind: r.kind, title: r.title, quote: r.quote, schedule: r.schedule,
    timing: r.timing, source: r.source, source_url: r.sourceUrl, checked_at: r.checkedAt,
  };
}

/** Replace the place's visible rows for one source. Hidden rows are never deleted. */
export async function replaceDeals(client: SupabaseClient, placeRef: number, source: DealSource, rows: DealRow[]): Promise<void> {
  const del = await client.from('place_deals').delete().eq('place_ref', placeRef).eq('source', source).eq('hidden', false);
  if (del.error) throw new Error(`delete place_deals failed for ${placeRef}: ${del.error.message}`);
  if (rows.length === 0) return;
  const ins = await client.from('place_deals').insert(rows.map((r) => toInsert(placeRef, r)));
  if (ins.error) throw new Error(`insert place_deals failed for ${placeRef}: ${ins.error.message}`);
}

/** Replace every visible curated row with the file's contents. Hidden rows are never deleted. */
export async function replaceCuratedDeals(client: SupabaseClient, rows: Array<DealRow & { placeRef: number }>): Promise<void> {
  const del = await client.from('place_deals').delete().eq('source', 'curated').eq('hidden', false);
  if (del.error) throw new Error(`delete curated place_deals failed: ${del.error.message}`);
  if (rows.length === 0) return;
  const ins = await client.from('place_deals').insert(rows.map((r) => toInsert(r.placeRef, r)));
  if (ins.error) throw new Error(`insert curated place_deals failed: ${ins.error.message}`);
}

export async function markDealsChecked(client: SupabaseClient, table: PlaceType, placeRef: number, at: string): Promise<void> {
  const { error } = await client.from(table).update({ deals_checked_at: at }).eq('id', placeRef);
  if (error) throw new Error(`markDealsChecked failed for ${placeRef}: ${error.message}`);
}
