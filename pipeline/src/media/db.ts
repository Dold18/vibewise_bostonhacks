import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnrichPlace, PhotoCandidate, VibeInput } from './types.ts';

const PAGE_SIZE = 1000; // PostgREST max_rows

interface PointRow {
  id: number; place_id: string; name: string; lat: number; lng: number;
  website: string | null; address: string | null; osm_tags: Record<string, string> | null;
}

export async function fetchEnrichPlaces(client: SupabaseClient, opts: { refresh: boolean }): Promise<EnrichPlace[]> {
  const out: EnrichPlace[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = client.from('restaurant_points').select('id, place_id, name, lat, lng, website, address, osm_tags');
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

export async function fetchHiddenUrls(client: SupabaseClient, restaurantId: number): Promise<Set<string>> {
  const { data, error } = await client.from('place_photos').select('url').eq('restaurant_id', restaurantId).eq('hidden', true);
  if (error) throw new Error(`fetchHiddenUrls failed for ${restaurantId}: ${error.message}`);
  return new Set(((data ?? []) as Array<{ url: string | null }>).flatMap((r) => (r.url ? [r.url] : [])));
}

export async function fetchStudentReviewText(client: SupabaseClient, restaurantId: number): Promise<string[]> {
  const { data, error } = await client.from('student_reviews').select('body')
    .eq('restaurant_id', restaurantId).eq('hidden', false).order('created_at', { ascending: true });
  if (error) throw new Error(`fetchStudentReviewText failed for ${restaurantId}: ${error.message}`);
  return ((data ?? []) as Array<{ body: string }>).map((r) => r.body).filter((b) => b.trim() !== '');
}

/** Replace the pipeline's photos for one place (student and hidden rows survive), upsert its inputs, mark it checked. */
export async function writePlaceMedia(
  client: SupabaseClient,
  restaurantId: number,
  photos: Array<PhotoCandidate & { rank: number }>,
  inputs: VibeInput[],
  checkedAt: string,
): Promise<void> {
  const del = await client.from('place_photos').delete()
    .eq('restaurant_id', restaurantId).neq('kind', 'student').eq('hidden', false);
  if (del.error) throw new Error(`delete place_photos failed for ${restaurantId}: ${del.error.message}`);

  if (photos.length > 0) {
    const rows = photos.map((p) => ({
      restaurant_id: restaurantId, kind: p.kind, source: p.source, match_method: p.matchMethod, url: p.url,
      mapillary_id: p.mapillaryId, page_url: p.pageUrl, license: p.license, credit: p.credit, rank: p.rank, checked_at: checkedAt,
    }));
    const ins = await client.from('place_photos').insert(rows);
    if (ins.error) throw new Error(`insert place_photos failed for ${restaurantId}: ${ins.error.message}`);
  }

  if (inputs.length > 0) {
    const rows = inputs.map((i) => ({ restaurant_id: restaurantId, source: i.source, content: i.content, source_url: i.sourceUrl, fetched_at: checkedAt }));
    const ups = await client.from('place_vibe_inputs').upsert(rows, { onConflict: 'restaurant_id,source' });
    if (ups.error) throw new Error(`upsert place_vibe_inputs failed for ${restaurantId}: ${ups.error.message}`);
  }

  const upd = await client.from('restaurants').update({ media_checked_at: checkedAt }).eq('id', restaurantId);
  if (upd.error) throw new Error(`update restaurants.media_checked_at failed for ${restaurantId}: ${upd.error.message}`);
}
