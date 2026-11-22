import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UPSERT_BATCH_SIZE } from './config.ts';
import type { OtherPlace } from './crossType.ts';
import { parseEwkbPoint } from './geo.ts';
import type { PlaceType } from './placeTypes.ts';
import { PRICE_BANDS, candidateFilter, type PriceCandidate, type WritePlan } from './price.ts';
import type { ExistingRow, PlaceRow, RekeyAction } from './types.ts';

const PAGE_SIZE = 1000; // PostgREST max_rows
const ID_CHUNK = 200; // ids per filter, keeps the request URL short

export function connect(url: string, secretKey: string): SupabaseClient {
  // Accept the REST URL the dashboard also shows (…/rest/v1/); supabase-js adds that path itself.
  const projectUrl = url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  return createClient(projectUrl, secretKey, { auth: { persistSession: false } });
}

export async function fetchExisting(client: SupabaseClient, table: PlaceType): Promise<ExistingRow[]> {
  const out: ExistingRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select('id, source, source_id, fsq_place_id')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchExisting failed at offset ${from}: ${error.message}`);
    out.push(...(data as ExistingRow[]));
    if (data.length < PAGE_SIZE) return out;
  }
}

/**
 * clear_fsq and promote update the type row (a place_id change is copied to the registry by trigger).
 * collapse deletes the registry row, which cascades to the type row and the shared rows hanging off it.
 */
export async function applyRekey(client: SupabaseClient, table: PlaceType, actions: RekeyAction[]): Promise<void> {
  for (const a of actions) {
    const { error } =
      a.kind === 'clear_fsq'
        ? await client.from(table).update({ fsq_place_id: null }).eq('id', a.id)
        : a.kind === 'promote'
          ? await client.from(table).update({ source: 'osm', source_id: a.sourceId, place_id: a.placeId }).eq('id', a.id)
          : await client.from('places').delete().eq('id', a.id);
    if (error) throw new Error(`rekey ${a.kind} failed for id ${a.id}: ${error.message}`);
  }
}

/** Every place of the other types with a usable location (for the cross-type duplicate check). */
export async function fetchOtherTypePlaces(client: SupabaseClient, type: PlaceType): Promise<OtherPlace[]> {
  const out: OtherPlace[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('catalog_places')
      .select('place_id, place_type, name, location')
      .neq('place_type', type)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchOtherTypePlaces failed at offset ${from}: ${error.message}`);
    const page = data as Array<{ place_id: string; place_type: PlaceType; name: string; location: string | null }>;
    for (const r of page) {
      const point = typeof r.location === 'string' ? parseEwkbPoint(r.location) : null;
      if (point !== null) out.push({ placeId: r.place_id, placeType: r.place_type, name: r.name, ...point });
    }
    if (page.length < PAGE_SIZE) return out;
  }
}

export interface RegistryEntry { id: number; placeType: PlaceType }

/** The registry row (id and type) of each given place_id that is in the registry. */
export async function fetchRegistry(client: SupabaseClient, placeIds: string[]): Promise<Map<string, RegistryEntry>> {
  const out = new Map<string, RegistryEntry>();
  for (let i = 0; i < placeIds.length; i += ID_CHUNK) {
    const chunk = placeIds.slice(i, i + ID_CHUNK);
    const { data, error } = await client.from('places').select('id, place_id, place_type').in('place_id', chunk);
    if (error) throw new Error(`fetchRegistry failed: ${error.message}`);
    for (const r of data as Array<{ id: number; place_id: string; place_type: PlaceType }>) {
      out.set(r.place_id, { id: r.id, placeType: r.place_type });
    }
  }
  return out;
}

/**
 * Deletes registry rows of `type` by id. Only for orphans (registry rows with no type row, left by a run that
 * stopped between registering and upserting): with no type row, nothing in the catalog points at them.
 */
export async function deleteRegistryRows(client: SupabaseClient, type: PlaceType, ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { error } = await client.from('places').delete().in('id', ids.slice(i, i + ID_CHUNK)).eq('place_type', type);
    if (error) throw new Error(`deleteRegistryRows failed: ${error.message}`);
  }
}

/** Creates registry rows for new places of `type`; returns place_id -> registry id. */
export async function registerPlaces(
  client: SupabaseClient, type: PlaceType, placeIds: string[], batchSize = UPSERT_BATCH_SIZE,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0, batch = 0; i < placeIds.length; i += batchSize, batch++) {
    const { data, error } = await client
      .from('places')
      .insert(placeIds.slice(i, i + batchSize).map((placeId) => ({ place_id: placeId, place_type: type })))
      .select('id, place_id');
    if (error) throw new Error(`registerPlaces failed for batch ${batch}: ${error.message}`);
    for (const r of data as Array<{ id: number; place_id: string }>) out.set(r.place_id, r.id);
  }
  const missing = placeIds.filter((p) => !out.has(p));
  if (missing.length > 0) throw new Error(`registerPlaces returned no id for ${missing.slice(0, 5).join(', ')}`);
  return out;
}

/** Every row carries its registry id: a missing id would null the type row's id on conflict, or fail the insert. */
export async function upsertRows(
  client: SupabaseClient,
  table: PlaceType,
  rows: Array<PlaceRow & { id: number }>,
  batchSize = UPSERT_BATCH_SIZE,
): Promise<void> {
  for (let i = 0, batch = 0; i < rows.length; i += batchSize, batch++) {
    const { error } = await client
      .from(table)
      .upsert(rows.slice(i, i + batchSize), { onConflict: 'source,source_id' });
    if (error) throw new Error(`upsert failed for batch ${batch}: ${error.message}`);
  }
}

/** place_ids of rows not refreshed by this run (spec 6.7): counted and listed, never deleted. */
export async function listNotSeen(client: SupabaseClient, table: PlaceType, runStart: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select('place_id')
      .or(`last_seen_at.lt.${runStart},last_seen_at.is.null`)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`listNotSeen failed at offset ${from}: ${error.message}`);
    out.push(...(data as Array<{ place_id: string }>).map((r) => r.place_id));
    if (data.length < PAGE_SIZE) return out;
  }
}

/** Rows the price step may estimate (spec §5.4), in id order. Never `price_source = 'menu'`. */
export async function fetchPriceCandidates(
  client: SupabaseClient, force: boolean, limit: number | null,
): Promise<PriceCandidate[]> {
  const out: PriceCandidate[] = [];
  for (let from = 0; limit === null || out.length < limit; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('restaurants')
      .select('id, name, category, cuisines, osm_tags, price_source')
      .or(candidateFilter(force))
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchPriceCandidates failed at offset ${from}: ${error.message}`);
    out.push(...(data as PriceCandidate[]));
    if (data.length < PAGE_SIZE) break;
  }
  return limit === null ? out : out.slice(0, limit);
}

/** Write one batch's bands. Only price columns; a row that gained a menu price meanwhile is never touched. */
export async function writePriceBands(client: SupabaseClient, plan: WritePlan): Promise<number> {
  let sent = 0;
  for (const band of PRICE_BANDS) {
    const ids = plan.bands[band];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const { error } = await client
        .from('restaurants')
        .update({ price_band: band, price_source: 'estimate', median_entree_price_cents: null })
        .in('id', chunk)
        .or('price_source.is.null,price_source.neq.menu');
      if (error) throw new Error(`writePriceBands ${band} failed: ${error.message}`);
      sent += chunk.length;
    }
  }
  for (let i = 0; i < plan.reset.length; i += ID_CHUNK) {
    const chunk = plan.reset.slice(i, i + ID_CHUNK);
    const { error } = await client
      .from('restaurants')
      .update({ price_band: 'unknown', price_source: null, median_entree_price_cents: null })
      .in('id', chunk)
      .eq('price_source', 'estimate');
    if (error) throw new Error(`writePriceBands reset failed: ${error.message}`);
    sent += chunk.length;
  }
  return sent;
}
