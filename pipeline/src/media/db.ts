import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlaceType } from '../placeTypes.ts';
import { photoKey } from './rank.ts';
import type { EnrichPlace, PhotoCandidate, VibeInput, VibeSource } from './types.ts';

const PAGE_SIZE = 1000; // PostgREST max_rows
export const PHOTO_BUCKET = 'place-photos';

interface StoredCopy { storage_path: string; stored_at: string | null; stored_bytes: number | null }

export interface PhotoToStore { id: number; placeRef: number; url: string }

/** Visible pipeline photos with a URL and no stored copy yet (Mapillary and uploads excluded), by id. */
export async function fetchPhotosToStore(client: SupabaseClient, opts: { limit: number | null; type: PlaceType }): Promise<PhotoToStore[]> {
  const out: PhotoToStore[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from('place_photos').select('id, place_ref, url, places!inner(place_type)')
      .eq('places.place_type', opts.type).eq('hidden', false).in('kind', ['website', 'licensed']).neq('source', 'mapillary')
      .not('url', 'is', null).is('storage_path', null)
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchPhotosToStore failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: number; place_ref: number; url: string }>;
    for (const r of rows) {
      out.push({ id: r.id, placeRef: r.place_ref, url: r.url });
      if (opts.limit !== null && out.length >= opts.limit) return out;
    }
    if (rows.length < PAGE_SIZE) return out;
  }
}

export async function storedBytesTotal(client: SupabaseClient): Promise<number> {
  let total = 0;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from('place_photos').select('stored_bytes')
      .not('stored_bytes', 'is', null).order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`storedBytesTotal failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as Array<{ stored_bytes: number }>;
    for (const r of rows) total += r.stored_bytes;
    if (rows.length < PAGE_SIZE) return total;
  }
}

export async function uploadCopy(client: SupabaseClient, path: string, webp: Uint8Array): Promise<void> {
  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, webp, { contentType: 'image/webp', upsert: true });
  if (error) throw new Error(`upload ${path} failed: ${error.message}`);
}

export async function recordStored(client: SupabaseClient, id: number, path: string, bytes: number, at: string): Promise<void> {
  const { error } = await client.from('place_photos')
    .update({ storage_path: path, stored_bytes: bytes, stored_at: at, store_error: null }).eq('id', id);
  if (error) throw new Error(`recordStored failed for photo ${id}: ${error.message}`);
}

export async function recordStoreError(client: SupabaseClient, id: number, storeError: string): Promise<void> {
  const { error } = await client.from('place_photos').update({ store_error: storeError }).eq('id', id);
  if (error) throw new Error(`recordStoreError failed for photo ${id}: ${error.message}`);
}

export async function deletePhotoRow(client: SupabaseClient, id: number): Promise<void> {
  // Never a hidden row: deleting it would erase the hide, and the photo could come back visible.
  const { error } = await client.from('place_photos').delete().eq('id', id).eq('hidden', false);
  if (error) throw new Error(`deletePhotoRow failed for photo ${id}: ${error.message}`);
}

interface PointRow {
  id: number; place_id: string; name: string; lat: number; lng: number;
  website: string | null; address: string | null; osm_tags: Record<string, string> | null;
}

export async function fetchEnrichPlaces(client: SupabaseClient, opts: { refresh: boolean; type: PlaceType }): Promise<EnrichPlace[]> {
  const out: EnrichPlace[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = client.from('place_points').select('id, place_id, name, lat, lng, website, address, osm_tags')
      .eq('place_type', opts.type);
    if (!opts.refresh) q = q.is('media_checked_at', null);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchEnrichPlaces failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as PointRow[];
    for (const r of rows) {
      out.push({ id: r.id, placeId: r.place_id, name: r.name, lat: r.lat, lng: r.lng, website: r.website, address: r.address, osmTags: r.osm_tags });
    }
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** Keys (see rank.ts photoKey) of the place's hidden photos, so the pipeline never re-adds them. */
export async function fetchHiddenKeys(client: SupabaseClient, placeRef: number): Promise<Set<string>> {
  const { data, error } = await client.from('place_photos').select('url, mapillary_id').eq('place_ref', placeRef).eq('hidden', true);
  if (error) throw new Error(`fetchHiddenKeys failed for ${placeRef}: ${error.message}`);
  const rows = (data ?? []) as Array<{ url: string | null; mapillary_id?: string | null }>;
  return new Set(rows.flatMap((r) => {
    const key = photoKey({ url: r.url, mapillaryId: r.mapillary_id ?? null });
    return key ? [key] : [];
  }));
}

export async function fetchStudentReviewText(client: SupabaseClient, placeRef: number): Promise<string[]> {
  const { data, error } = await client.from('student_reviews').select('body')
    .eq('place_ref', placeRef).eq('hidden', false).order('created_at', { ascending: true });
  if (error) throw new Error(`fetchStudentReviewText failed for ${placeRef}: ${error.message}`);
  return ((data ?? []) as Array<{ body: string }>).map((r) => r.body).filter((b) => b.trim() !== '');
}

/**
 * Replace the pipeline's photos for one place (student and hidden rows survive), replace its inputs, mark it checked.
 * Inputs whose source didn't produce anything this run are removed, except `keepSources` (their producer failed
 * transiently, so the old text is kept rather than erased).
 */
export async function writePlaceMedia(
  client: SupabaseClient,
  table: PlaceType,
  placeRef: number,
  photos: Array<PhotoCandidate & { rank: number }>,
  inputs: VibeInput[],
  checkedAt: string,
  keepSources: VibeSource[] = [],
): Promise<void> {
  // Stored copies of the rows about to be replaced: carried over to a new row with the same URL, else removed.
  const prev = await client.from('place_photos').select('url, storage_path, stored_at, stored_bytes')
    .eq('place_ref', placeRef).neq('kind', 'student').eq('hidden', false);
  if (prev.error) throw new Error(`read place_photos failed for ${placeRef}: ${prev.error.message}`);
  const copies = new Map<string, StoredCopy>();
  for (const r of (prev.data ?? []) as Array<StoredCopy & { url: string | null }>) {
    if (r.url && r.storage_path) copies.set(r.url, { storage_path: r.storage_path, stored_at: r.stored_at, stored_bytes: r.stored_bytes });
  }

  const del = await client.from('place_photos').delete()
    .eq('place_ref', placeRef).neq('kind', 'student').eq('hidden', false);
  if (del.error) throw new Error(`delete place_photos failed for ${placeRef}: ${del.error.message}`);

  if (photos.length > 0) {
    const rows = photos.map((p) => ({
      place_ref: placeRef, kind: p.kind, source: p.source, match_method: p.matchMethod, url: p.url,
      mapillary_id: p.mapillaryId, page_url: p.pageUrl, license: p.license, credit: p.credit, rank: p.rank, checked_at: checkedAt,
      ...(p.url && copies.has(p.url) ? copies.get(p.url)! : {}),
    }));
    const ins = await client.from('place_photos').insert(rows);
    if (ins.error) throw new Error(`insert place_photos failed for ${placeRef}: ${ins.error.message}`);
  }

  const kept = new Set(photos.flatMap((p) => (p.url ? [p.url] : [])));
  const orphans = [...copies].filter(([url]) => !kept.has(url)).map(([, c]) => c.storage_path);
  if (orphans.length > 0) {
    const rm = await client.storage.from(PHOTO_BUCKET).remove(orphans);
    if (rm.error) throw new Error(`remove orphaned photo copies failed for ${placeRef}: ${rm.error.message}`);
  }

  if (inputs.length > 0) {
    const rows = inputs.map((i) => ({ place_ref: placeRef, source: i.source, content: i.content, source_url: i.sourceUrl, fetched_at: checkedAt }));
    const ups = await client.from('place_vibe_inputs').upsert(rows, { onConflict: 'place_ref,source' });
    if (ups.error) throw new Error(`upsert place_vibe_inputs failed for ${placeRef}: ${ups.error.message}`);
  }

  const survive = [...new Set([...inputs.map((i) => i.source), ...keepSources])].sort();
  const stale = client.from('place_vibe_inputs').delete().eq('place_ref', placeRef);
  const cleared = survive.length > 0 ? await stale.not('source', 'in', `(${survive.map((s) => `"${s}"`).join(',')})`) : await stale;
  if (cleared.error) throw new Error(`delete stale place_vibe_inputs failed for ${placeRef}: ${cleared.error.message}`);

  const upd = await client.from(table).update({ media_checked_at: checkedAt }).eq('id', placeRef);
  if (upd.error) throw new Error(`update ${table}.media_checked_at failed for ${placeRef}: ${upd.error.message}`);
}
