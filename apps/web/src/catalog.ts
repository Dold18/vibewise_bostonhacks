/**
 * Read-only access to our own place catalog: the Supabase `restaurants` table
 * filled offline by `pipeline/` (OpenStreetMap + Foursquare OS Places).
 *
 * The browser uses the publishable key only; Row Level Security allows reads
 * and nothing else. The catalog holds food and drink places, so it backs the
 * Restaurants / Coffee / Bars map categories. Everything else stays on tiles/Overpass.
 *
 * Two steps, so the page never downloads details it won't show:
 *  1. The pin index: every place's id, name, category and location, fetched
 *     once per page load (a few thousand small rows).
 *  2. Details (address, website, phone, hours, cuisines) for just the pins in
 *     range, fetched by place id and cached, so panning back costs nothing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { metersBetween, type CategorizedPlace, type Category, type Place } from './osm';

/** Map category id → catalog `category` value. */
const CATALOG_CATEGORY: Record<string, string> = {
  restaurants: 'restaurant',
  coffee: 'cafe',
  bars: 'nightlife',
};

const INDEX_COLUMNS = 'place_id, source, source_id, name, category, location';
const DETAIL_COLUMNS = 'place_id, address, website, phone, cuisines, hours_raw, osm_tags, attribution, price_band, price_source';
const PAGE_SIZE = 1000; // PostgREST max_rows
const DETAIL_CHUNK = 100; // place ids per request, keeps the URL short

/** One place in the pin index. `placeId` is the catalog's stable id, e.g. "osm:node/1" or "fsq:abc". */
export interface CatalogPin {
  placeId: string;
  source: 'osm' | 'foursquare';
  sourceId: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
}

export interface CatalogDetails {
  address: string | null;
  website: string | null;
  phone: string | null;
  cuisines: string[] | null;
  hours_raw: string | null;
  osm_tags: Record<string, string> | null;
  attribution: string;
  /** '$'..'$$$$' or 'unknown'; never null. */
  price_band: string;
  /** 'menu' (read from a menu) or 'estimate' (LLM guess, labeled "(est.)"); null when unknown. */
  price_source: string | null;
}

interface IndexRow {
  place_id: string;
  source: 'osm' | 'foursquare';
  source_id: string;
  name: string;
  category: string;
  /** geography(Point): PostgREST returns hex EWKB; GeoJSON is accepted too. */
  location: unknown;
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

/** An index row as a pin; null when it has no usable location. */
export function toPin(row: IndexRow): CatalogPin | null {
  const point = parsePoint(row.location);
  if (!point) return null;
  return { placeId: row.place_id, source: row.source, sourceId: row.source_id, name: row.name, category: row.category, ...point };
}

/**
 * A pin as a map `Place`. Card fields go in `tags` the way the card already
 * reads them; without details the card shows name and type only.
 */
export function pinToPlace(pin: CatalogPin, details?: CatalogDetails): Place {
  const tags: Record<string, string> = { 'catalog:place_id': pin.placeId, 'catalog:source': pin.source };
  if (details?.address) tags.display_name = details.address;
  if (details?.website) tags.website = details.website;
  if (details?.phone) tags.phone = details.phone;
  if (details?.hours_raw) tags.opening_hours = details.hours_raw;
  if (details?.attribution) tags['catalog:attribution'] = details.attribution;
  if (details?.price_band) tags['catalog:price_band'] = details.price_band;
  if (details?.price_source) tags['catalog:price_source'] = details.price_source;
  const kind = details?.osm_tags?.amenity ?? pin.category;
  const cuisine = details?.cuisines?.[0];
  return {
    // OSM ids stay bare ("node/1") so "View on OpenStreetMap" links to the feature.
    id: pin.source === 'osm' ? pin.sourceId : pin.placeId,
    name: pin.name,
    lat: pin.lat,
    lon: pin.lon,
    category: humanize(cuisine ? `${cuisine} ${kind}` : kind),
    tags,
  };
}

const PRICE_BANDS = new Set(['$', '$$', '$$$', '$$$$']);

/**
 * Card text for a price: "$$" from a menu, "$$ (est.)" for an estimate, otherwise
 * "Price unknown". A band without a known source is not shown as known.
 */
export function priceLabel(band: string | undefined, source: string | undefined): string {
  if (!band || !PRICE_BANDS.has(band)) return 'Price unknown';
  if (source === 'menu') return band;
  if (source === 'estimate') return `${band} (est.)`;
  return 'Price unknown';
}

/** Per map category: pins within `radiusMeters` of `center`, nearest first, at most `limit` each. */
export function nearestByCategory(
  pins: CatalogPin[],
  categories: Category[],
  center: { lat: number; lon: number },
  radiusMeters: number,
  limit: number,
): { categoryId: string; pin: CatalogPin }[] {
  const out: { categoryId: string; pin: CatalogPin }[] = [];
  for (const category of categories) {
    const wanted = CATALOG_CATEGORY[category.id];
    if (!wanted) continue;
    const near = pins
      .filter((p) => p.category === wanted)
      .map((pin) => ({ pin, distance: metersBetween(center, pin) }))
      .filter((x) => x.distance <= radiusMeters)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
    for (const { pin } of near) out.push({ categoryId: category.id, pin });
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

let indexPromise: Promise<CatalogPin[]> | undefined;
async function fetchIndex(supabase: SupabaseClient): Promise<CatalogPin[]> {
  const pins: CatalogPin[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('restaurants')
      .select(INDEX_COLUMNS)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as IndexRow[]) {
      const pin = toPin(row);
      if (pin) pins.push(pin);
    }
    if (!data || data.length === 0) return pins;
  }
}

const detailsCache = new Map<string, CatalogDetails>();
async function fetchDetails(supabase: SupabaseClient, placeIds: string[]): Promise<void> {
  const missing = placeIds.filter((id) => !detailsCache.has(id));
  for (let i = 0; i < missing.length; i += DETAIL_CHUNK) {
    const ids = missing.slice(i, i + DETAIL_CHUNK);
    const { data, error } = await supabase.from('restaurants').select(DETAIL_COLUMNS).in('place_id', ids);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as (CatalogDetails & { place_id: string })[]) {
      const { place_id, ...details } = row;
      detailsCache.set(place_id, details);
    }
  }
}

/**
 * Catalog places for the catalog-backed categories in `categories`, with
 * details for each. Returns null when the catalog can't answer (not
 * configured, unreachable or still empty), so the caller can fall back.
 * If only the details request fails, places come back with name and type.
 */
export async function catalogPlacesNear(
  categories: Category[],
  center: { lat: number; lon: number },
  radiusMeters: number,
  limit: number,
): Promise<CategorizedPlace[] | null> {
  const supabase = getClient();
  if (!supabase) return null;
  let pins: CatalogPin[];
  try {
    indexPromise ??= fetchIndex(supabase);
    pins = await indexPromise;
  } catch (err) {
    indexPromise = undefined;
    console.warn('[catalog] falling back:', (err as Error).message);
    return null;
  }
  if (pins.length === 0) {
    indexPromise = undefined; // maybe loaded later; ask again next time
    return null;
  }
  const near = nearestByCategory(pins, categories, center, radiusMeters, limit);
  try {
    await fetchDetails(supabase, near.map((n) => n.pin.placeId));
  } catch (err) {
    console.warn('[catalog] details unavailable:', (err as Error).message);
  }
  return near.map(({ categoryId, pin }) => ({ categoryId, place: pinToPlace(pin, detailsCache.get(pin.placeId)) }));
}

function humanize(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
