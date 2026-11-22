/** Database access for `enrich:vibe`. Reads restaurants/place_vibe_inputs/place_photos; writes only description, embedding, profile. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VibeInputRow, VibeProfile, VibeRestaurant } from './vibe.ts';

const PAGE_SIZE = 1000;
const ID_CHUNK = 100;

/** Ids of rows with neither a description nor an embedding yet (the only rows this step may touch). */
export async function fetchUnenrichedIds(client: SupabaseClient): Promise<number[]> {
  const out: number[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('restaurants').select('id')
      .is('description', null).is('embedding', null)
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchUnenrichedIds failed at offset ${from}: ${error.message}`);
    out.push(...(data as Array<{ id: number }>).map((r) => r.id));
    if (data.length < PAGE_SIZE) return out;
  }
}

async function countWhere(client: SupabaseClient, column: 'description' | 'embedding' | 'profile'): Promise<number> {
  const { count, error } = await client.from('restaurants').select('id', { count: 'exact', head: true }).not(column, 'is', null);
  if (error) throw new Error(`count ${column} failed: ${error.message}`);
  return count ?? 0;
}

export async function enrichmentCounts(client: SupabaseClient): Promise<{ description: number; embedding: number; profile: number }> {
  return {
    description: await countWhere(client, 'description'),
    embedding: await countWhere(client, 'embedding'),
    profile: await countWhere(client, 'profile'),
  };
}

function chunks<T>(items: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export async function fetchRestaurants(client: SupabaseClient, ids: number[]): Promise<VibeRestaurant[]> {
  const out: VibeRestaurant[] = [];
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await client
      .from('restaurants').select('id, name, category, cuisines, price_band, osm_tags, context_features').in('id', chunk);
    if (error) throw new Error(`fetchRestaurants failed: ${error.message}`);
    out.push(...(data as VibeRestaurant[]));
  }
  return out;
}

export async function fetchInputs(client: SupabaseClient, ids: number[]): Promise<Map<number, VibeInputRow[]>> {
  const map = new Map<number, VibeInputRow[]>();
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await client
      .from('place_vibe_inputs').select('restaurant_id, source, content').in('restaurant_id', chunk);
    if (error) throw new Error(`fetchInputs failed: ${error.message}`);
    for (const row of data as VibeInputRow[]) map.set(row.restaurant_id, [...(map.get(row.restaurant_id) ?? []), row]);
  }
  return map;
}

/** The first visible photo with a URL per restaurant, in display order (rank, then id). */
export async function fetchPhotoUrls(client: SupabaseClient, ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await client
      .from('place_photos').select('restaurant_id, url')
      .in('restaurant_id', chunk).eq('hidden', false).not('url', 'is', null)
      .order('rank', { ascending: true }).order('id', { ascending: true });
    if (error) throw new Error(`fetchPhotoUrls failed: ${error.message}`);
    for (const row of data as Array<{ restaurant_id: number; url: string }>) {
      if (!map.has(row.restaurant_id)) map.set(row.restaurant_id, row.url);
    }
  }
  return map;
}

/** Re-checked immediately before each Gemini call, so a re-run or resume never double-processes a row. */
export async function isStillUnenriched(client: SupabaseClient, id: number): Promise<boolean> {
  const { data, error } = await client
    .from('restaurants').select('id').eq('id', id).is('description', null).is('embedding', null).maybeSingle();
  if (error) throw new Error(`isStillUnenriched failed for ${id}: ${error.message}`);
  return data !== null;
}

/**
 * Writes description, embedding and profile for one row and nothing else. The null guards in the
 * update make it a no-op (returns false) if another run enriched the row in the meantime.
 */
export async function writeEnrichment(
  client: SupabaseClient, id: number, v: { description: string; embedding: number[]; profile: VibeProfile },
): Promise<boolean> {
  const { data, error } = await client
    .from('restaurants')
    .update({ description: v.description, embedding: v.embedding as unknown as string, profile: v.profile })
    .eq('id', id).is('description', null).is('embedding', null)
    .select('id');
  if (error) throw new Error(`writeEnrichment failed for ${id}: ${error.message}`);
  return (data?.length ?? 0) === 1;
}
