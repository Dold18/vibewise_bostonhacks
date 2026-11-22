/**
 * Database access for `enrich:vibe`. Reads one type table (restaurants, museums, entertainment, parks
 * or landmarks) plus the shared place_vibe_inputs / place_photos (keyed by `place_ref`, which equals the
 * type row's id). Writes only description and embedding, plus profile for restaurants.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlaceType } from './placeTypes.ts';
import type { VibeInputRow, VibePlace, VibeProfile, VibeRestaurant } from './vibe.ts';

const PAGE_SIZE = 1000;

/**
 * Retry a database call on transient network failures ("fetch failed", timeouts, 5xx). The two
 * per-row calls below are safe to repeat: the check is read-only and the write is null-guarded.
 */
export async function withRetry<T>(fn: () => Promise<T>, delaysMs: number[] = [1_000, 4_000, 15_000], sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const transient = /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|timeout|5\d\d|gateway|temporarily/i.test(msg);
      const wait = delaysMs[attempt];
      if (!transient || wait === undefined) throw err;
      await sleep(wait);
    }
  }
}
const ID_CHUNK = 100;

/** Ids of rows with neither a description nor an embedding yet (the only rows this step may touch), in id order. */
export async function fetchUnenrichedIds(client: SupabaseClient, table: PlaceType): Promise<number[]> {
  const out: number[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table).select('id')
      .is('description', null).is('embedding', null)
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchUnenrichedIds failed at offset ${from}: ${error.message}`);
    out.push(...(data as Array<{ id: number }>).map((r) => r.id));
    if (data.length < PAGE_SIZE) return out;
  }
}

async function countWhere(client: SupabaseClient, table: PlaceType, column: 'description' | 'embedding' | 'profile'): Promise<number> {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true }).not(column, 'is', null);
  if (error) throw new Error(`count ${table}.${column} failed: ${error.message}`);
  return count ?? 0;
}

/** Populated-row counts in the chosen table; `profile` is null for non-food tables (they have no profile column). */
export async function enrichmentCounts(
  client: SupabaseClient, table: PlaceType,
): Promise<{ description: number; embedding: number; profile: number | null }> {
  return {
    description: await countWhere(client, table, 'description'),
    embedding: await countWhere(client, table, 'embedding'),
    profile: table === 'restaurants' ? await countWhere(client, table, 'profile') : null,
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

/** Rows of a non-food type table (no cuisine, price or category columns there). */
export async function fetchPlaces(client: SupabaseClient, table: Exclude<PlaceType, 'restaurants'>, ids: number[]): Promise<VibePlace[]> {
  const out: VibePlace[] = [];
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await client
      .from(table).select('id, name, kind, osm_tags, context_features').in('id', chunk);
    if (error) throw new Error(`fetchPlaces(${table}) failed: ${error.message}`);
    out.push(...(data as VibePlace[]));
  }
  return out;
}

export async function fetchInputs(client: SupabaseClient, ids: number[]): Promise<Map<number, VibeInputRow[]>> {
  const map = new Map<number, VibeInputRow[]>();
  for (const chunk of chunks(ids, ID_CHUNK)) {
    // Paged in a total order (place_ref, source is unique), so a chunk with more rows than the PostgREST cap is not cut short.
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('place_vibe_inputs').select('place_ref, source, content').in('place_ref', chunk)
        .order('place_ref', { ascending: true }).order('source', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`fetchInputs failed: ${error.message}`);
      for (const row of data as VibeInputRow[]) map.set(row.place_ref, [...(map.get(row.place_ref) ?? []), row]);
      if (data.length < PAGE_SIZE) break;
    }
  }
  return map;
}

/** The first visible photo with a URL per place, in display order (rank, then id). */
export async function fetchPhotoUrls(client: SupabaseClient, ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const chunk of chunks(ids, ID_CHUNK)) {
    // Paged in a total order (rank, then the unique id); the first row seen per place is its first photo.
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('place_photos').select('place_ref, url')
        .in('place_ref', chunk).eq('hidden', false).not('url', 'is', null)
        .order('rank', { ascending: true }).order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`fetchPhotoUrls failed: ${error.message}`);
      for (const row of data as Array<{ place_ref: number; url: string }>) {
        if (!map.has(row.place_ref)) map.set(row.place_ref, row.url);
      }
      if (data.length < PAGE_SIZE) break;
    }
  }
  return map;
}

/** Re-checked immediately before each Gemini call, so a re-run or resume never double-processes a row. */
export async function isStillUnenriched(client: SupabaseClient, table: PlaceType, id: number): Promise<boolean> {
  return withRetry(async () => {
    const { data, error } = await client
      .from(table).select('id').eq('id', id).is('description', null).is('embedding', null).maybeSingle();
    if (error) throw new Error(`isStillUnenriched failed for ${table} ${id}: ${error.message}`);
    return data !== null;
  });
}

/**
 * Writes description and embedding (and, for restaurants, profile) for one row and nothing else. The
 * null guards in the update make it a no-op (returns false) if another run enriched the row in the meantime.
 */
export async function writeEnrichment(
  client: SupabaseClient, table: PlaceType, id: number,
  v: { description: string; embedding: number[]; profile: VibeProfile | null },
): Promise<boolean> {
  const row: Record<string, unknown> = { description: v.description, embedding: v.embedding as unknown as string };
  if (table === 'restaurants') row['profile'] = v.profile;
  return withRetry(async () => {
    const { data, error } = await client
      .from(table)
      .update(row)
      .eq('id', id).is('description', null).is('embedding', null)
      .select('id');
    if (error) throw new Error(`writeEnrichment failed for ${table} ${id}: ${error.message}`);
    return (data?.length ?? 0) === 1;
  });
}
