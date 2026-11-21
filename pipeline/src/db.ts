import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UPSERT_BATCH_SIZE } from './config.ts';
import type { ExistingRow, RekeyAction, RestaurantRow } from './types.ts';

const PAGE_SIZE = 1000; // PostgREST max_rows

export function connect(url: string, secretKey: string): SupabaseClient {
  // Accept the REST URL the dashboard also shows (…/rest/v1/); supabase-js adds that path itself.
  const projectUrl = url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  return createClient(projectUrl, secretKey, { auth: { persistSession: false } });
}

export async function fetchExisting(client: SupabaseClient): Promise<ExistingRow[]> {
  const out: ExistingRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('restaurants')
      .select('id, source, source_id, fsq_place_id')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchExisting failed at offset ${from}: ${error.message}`);
    out.push(...(data as ExistingRow[]));
    if (data.length < PAGE_SIZE) return out;
  }
}

export async function applyRekey(client: SupabaseClient, actions: RekeyAction[]): Promise<void> {
  for (const a of actions) {
    const table = client.from('restaurants');
    const { error } =
      a.kind === 'clear_fsq'
        ? await table.update({ fsq_place_id: null }).eq('id', a.id)
        : a.kind === 'promote'
          ? await table.update({ source: 'osm', source_id: a.sourceId, place_id: a.placeId }).eq('id', a.id)
          : await table.delete().eq('id', a.id);
    if (error) throw new Error(`rekey ${a.kind} failed for id ${a.id}: ${error.message}`);
  }
}

export async function upsertRows(
  client: SupabaseClient,
  rows: RestaurantRow[],
  batchSize = UPSERT_BATCH_SIZE,
): Promise<void> {
  for (let i = 0, batch = 0; i < rows.length; i += batchSize, batch++) {
    const { error } = await client
      .from('restaurants')
      .upsert(rows.slice(i, i + batchSize), { onConflict: 'source,source_id' });
    if (error) throw new Error(`upsert failed for batch ${batch}: ${error.message}`);
  }
}

/** place_ids of rows not refreshed by this run (spec 6.7): counted and listed, never deleted. */
export async function listNotSeen(client: SupabaseClient, runStart: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('restaurants')
      .select('place_id')
      .or(`last_seen_at.lt.${runStart},last_seen_at.is.null`)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`listNotSeen failed at offset ${from}: ${error.message}`);
    out.push(...(data as Array<{ place_id: string }>).map((r) => r.place_id));
    if (data.length < PAGE_SIZE) return out;
  }
}
