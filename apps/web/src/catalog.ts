/**
 * Read-only access to our own place catalog: the Supabase `restaurants` table
 * filled offline by `pipeline/` (OpenStreetMap + Foursquare OS Places).
 *
 * The browser uses the publishable key only; Row Level Security allows reads
 * and nothing else. The catalog holds food and drink places, so it backs the
 * Restaurants / Coffee / Bars map categories. Everything else stays on Overpass.
 *
 * The catalog is small (a few thousand rows), so it is fetched once per page
 * load and filtered by distance here, which needs no database function.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { metersBetween, type CategorizedPlace, type Category, type Place } from './osm';

/** Map category id → catalog `category` value. */
const CATALOG_CATEGORY: Record<string, string> = {
  restaurants: 'restaurant',
  coffee: 'cafe',
  bars: 'nightlife',
};

const COLUMNS =
  'place_id, source, source_id, name, location, address, website, phone, category, cuisines, hours_raw, osm_tags, attribution';
const PAGE_SIZE = 1000; // PostgREST max_rows

export interface CatalogRow {
  place_id: string;
  source: 'osm' | 'foursquare';
  source_id: string;
  name: string;
  /** geography(Point): PostgREST returns hex EWKB; GeoJSON is accepted too. */
  location: unknown;
  address: string | null;
  website: string | null;
  phone: string | null;
  category: string;
  cuisines: string[] | null;
  hours_raw: string | null;
  osm_tags: Record<string, string> | null;
  attribution: string;
}

/** True when the catalog can back this map category. */
export function isCatalogCategory(category: Category): boolean {
  return category.id in CATALOG_CATEGORY;
}

/** A point from hex EWKB or GeoJSON; null for anything else, including (0,0). */
export function parsePoint(value: unknown): { lat: number; lon: number } | null {
  let lon: number | undefined;
  let lat: number | undefined;
  if (typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && value.length >= 42) {
    const bytes = new Uint8Array(value.match(/../g)!.map((h) => parseInt(h, 16)));
    const view = new DataView(bytes.buffer);
    const little = view.getUint8(0) === 1;
    const type = view.getUint32(1, little);
    if ((type & 0xff) !== 1) return null; // not a Point
    const offset = type & 0x20000000 ? 9 : 5; // skip the SRID when present
    if (bytes.length < offset + 16) return null;
    lon = view.getFloat64(offset, little);
    lat = view.getFloat64(offset + 8, little);
  } else if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'Point') {
    const coords = (value as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coords)) [lon, lat] = coords as number[];
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  return { lat: lat!, lon: lon! };
}

/** A catalog row as a map `Place`; card fields go in `tags` the way the card already reads them. */
export function rowToPlace(row: CatalogRow): Place | null {
  const point = parsePoint(row.location);
  if (!point) return null;
  const tags: Record<string, string> = {};
  if (row.address) tags.display_name = row.address;
  if (row.website) tags.website = row.website;
  if (row.phone) tags.phone = row.phone;
  if (row.hours_raw) tags.opening_hours = row.hours_raw;
  tags['catalog:source'] = row.source;
  tags['catalog:attribution'] = row.attribution;
  const kind = row.osm_tags?.amenity ?? row.category;
  const cuisine = row.cuisines?.[0];
  return {
    // OSM ids stay bare ("node/1") so "View on OpenStreetMap" links to the feature.
    id: row.source === 'osm' ? row.source_id : row.place_id,
    name: row.name,
    lat: point.lat,
    lon: point.lon,
    category: humanize(cuisine ? `${cuisine} ${kind}` : kind),
    tags,
  };
}

/** Per map category: catalog places within `radiusMeters` of `center`, nearest first, at most `limit` each. */
export function nearestByCategory(
  rows: CatalogRow[],
  categories: Category[],
  center: { lat: number; lon: number },
  radiusMeters: number,
  limit: number,
): CategorizedPlace[] {
  const out: CategorizedPlace[] = [];
  for (const category of categories) {
    const wanted = CATALOG_CATEGORY[category.id];
    if (!wanted) continue;
    const near = rows
      .filter((r) => r.category === wanted)
      .flatMap((r) => {
        const place = rowToPlace(r);
        if (!place) return [];
        const distance = metersBetween(center, place);
        return distance <= radiusMeters ? [{ place, distance }] : [];
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
    for (const { place } of near) out.push({ categoryId: category.id, place });
  }
  return out;
}

let client: SupabaseClient | null | undefined;
function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  // The project URL, e.g. https://<ref>.supabase.co. Tolerate the REST URL the
  // dashboard also shows (…/rest/v1/): supabase-js adds that path itself.
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

let rowsPromise: Promise<CatalogRow[]> | undefined;
async function fetchAllRows(supabase: SupabaseClient): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('restaurants')
      .select(COLUMNS)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as CatalogRow[]));
    if (!data || data.length === 0) return rows;
  }
}

/**
 * Catalog places for the catalog-backed categories in `categories`.
 * Returns null when the catalog can't answer (not configured, unreachable or
 * still empty), so the caller can fall back to Overpass.
 */
export async function catalogPlacesNear(
  categories: Category[],
  center: { lat: number; lon: number },
  radiusMeters: number,
  limit: number,
): Promise<CategorizedPlace[] | null> {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    rowsPromise ??= fetchAllRows(supabase);
    const rows = await rowsPromise;
    if (rows.length === 0) {
      rowsPromise = undefined; // maybe loaded later; ask again next time
      return null;
    }
    return nearestByCategory(rows, categories, center, radiusMeters, limit);
  } catch (err) {
    rowsPromise = undefined;
    console.warn('[catalog] falling back to Overpass:', (err as Error).message);
    return null;
  }
}

function humanize(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
