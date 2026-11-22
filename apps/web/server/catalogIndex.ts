/**
 * Server-side catalog for POST /api/vibe/search: every restaurant that has an embedding AND a known price
 * band, held in memory and ranked by cosine similarity. Unknown-price restaurants are excluded here, at the
 * index, unconditionally: they are disproportionately non-food businesses and generic-description rows
 * that otherwise dominate vague queries, and no request parameter can bring them back. No schema change and no database function. About 8k rows of 384
 * floats is roughly 12 MB, loaded in pages with the publishable key (Row Level Security allows reads)
 * and refreshed on a TTL so the index grows as pipeline enrichment completes.
 */
import { createClient } from '@supabase/supabase-js';
import { MODEL } from '../src/features/vibe/profile.ts';
import {
  PRICE_BANDS, normalizeCuisine, type GeoPoint, type PriceBand, type SearchFilters, type SearchResult,
} from '../src/features/vibe/searchContract.ts';

export interface CatalogRestaurant {
  placeId: string;
  name: string;
  category: string | null;
  cuisines: string[];
  priceBand: PriceBand;
  priceSource: 'menu' | 'estimate' | null;
  description: string;
  address: string | null;
  website: string | null;
  hoursRaw: string | null;
  lat: number;
  lng: number;
  /** L2-normalized, so a dot product is the cosine similarity. */
  embedding: Float32Array;
}

export interface CatalogProvider {
  restaurants(signal: AbortSignal): Promise<readonly CatalogRestaurant[]>;
}

/** A point from hex EWKB or GeoJSON (what PostgREST returns for geography); null for anything else. */
export function parsePoint(value: unknown): GeoPoint | null {
  let lng: number | undefined;
  let lat: number | undefined;
  if (typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && value.length >= 42) {
    const bytes = new Uint8Array(value.match(/../g)!.map((h) => parseInt(h, 16)));
    const view = new DataView(bytes.buffer);
    const little = view.getUint8(0) === 1;
    const type = view.getUint32(1, little);
    if ((type & 0xff) !== 1) return null;
    const offset = type & 0x20000000 ? 9 : 5; // skip the SRID when present
    if (bytes.length < offset + 16) return null;
    lng = view.getFloat64(offset, little);
    lat = view.getFloat64(offset + 8, little);
  } else if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'Point') {
    const coords = (value as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coords)) [lng, lat] = coords as number[];
  }
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

/** Database row as PostgREST returns it. `embedding` is a JSON-array string; `location` is hex EWKB. */
export interface RestaurantRow {
  place_id: unknown; name: unknown; category: unknown; cuisines: unknown; price_band: unknown;
  price_source: unknown; description: unknown; address: unknown; website: unknown; hours_raw: unknown;
  location: unknown; embedding: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * A usable index entry, or null when the row can't be searched honestly: no vector, a bad vector, no
 * location, or no known price band ('unknown', null or anything else outside $..$$$$).
 */
export function rowToRestaurant(row: RestaurantRow): CatalogRestaurant | null {
  const placeId = str(row.place_id);
  const name = str(row.name);
  const description = str(row.description);
  const point = parsePoint(row.location);
  if (!placeId || !name || !description || !point || !row.embedding) return null;

  let raw: unknown;
  try { raw = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding; } catch { return null; }
  if (!Array.isArray(raw) || raw.length !== MODEL.dimensions || !raw.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const norm = Math.hypot(...(raw as number[]));
  // Catalog vectors are written L2-normalized; anything else is a different or damaged vector.
  if (Math.abs(norm - 1) > 0.01) return null;

  if (typeof row.price_band !== 'string' || !(PRICE_BANDS as readonly string[]).includes(row.price_band)) return null;
  const band = row.price_band as PriceBand;
  const source = row.price_source === 'menu' || row.price_source === 'estimate' ? row.price_source : null;
  return {
    placeId, name, description,
    category: str(row.category),
    cuisines: Array.isArray(row.cuisines) ? row.cuisines.filter((c): c is string => typeof c === 'string') : [],
    priceBand: band,
    priceSource: source,
    address: str(row.address),
    website: str(row.website),
    hoursRaw: str(row.hours_raw),
    lat: point.lat,
    lng: point.lng,
    embedding: Float32Array.from(raw as number[]),
  };
}

const COLUMNS = 'place_id,name,category,cuisines,price_band,price_source,description,address,website,hours_raw,location,embedding';

/**
 * Reads embedded restaurants through Supabase and caches them for `ttlMs`. Concurrent callers share one
 * load. If a refresh fails, the previous index keeps serving; with no previous index the error is thrown.
 */
export function createSupabaseCatalog(options: {
  url: string; key: string; ttlMs?: number; pageSize?: number; now?: () => number;
}): CatalogProvider {
  const url = options.url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const client = createClient(url, options.key, { auth: { persistSession: false } });
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const pageSize = options.pageSize ?? 500;
  const now = options.now ?? Date.now;
  let cached: { at: number; rows: readonly CatalogRestaurant[] } | null = null;
  let loading: Promise<readonly CatalogRestaurant[]> | null = null;

  async function load(signal: AbortSignal): Promise<readonly CatalogRestaurant[]> {
    const rows: CatalogRestaurant[] = [];
    for (let from = 0; ; from += pageSize) {
      signal.throwIfAborted();
      const { data, error } = await client
        .from('restaurants').select(COLUMNS).not('embedding', 'is', null)
        .order('id', { ascending: true }).range(from, from + pageSize - 1).abortSignal(signal);
      if (error) throw new Error('Catalog unavailable');
      for (const row of (data ?? []) as RestaurantRow[]) {
        const r = rowToRestaurant(row);
        if (r) rows.push(r);
      }
      if ((data?.length ?? 0) < pageSize) return rows;
    }
  }

  return {
    async restaurants(signal) {
      if (cached && now() - cached.at < ttlMs) return cached.rows;
      // The shared load must not be cancelled by one caller's abort, so it gets its own controller.
      loading ??= load(new AbortController().signal)
        .then((rows) => { cached = { at: now(), rows }; return rows; })
        .catch((err) => { if (cached) return cached.rows; throw err; })
        .finally(() => { loading = null; });
      signal.throwIfAborted();
      return loading;
    },
  };
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in meters. */
export function straightLineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Ranked { candidates: number; filtersApplied: Array<'price' | 'distance' | 'cuisine'>; results: SearchResult[] }

/**
 * Hard filters first (never touch the embedding), then cosine similarity over the survivors.
 * `query` must already be L2-normalized (`validateVector` does that).
 */
export function rankRestaurants(
  rows: readonly CatalogRestaurant[], query: readonly number[], filters: SearchFilters, limit: number,
): Ranked {
  const ceiling = filters.maxPriceBand ? PRICE_BANDS.indexOf(filters.maxPriceBand) : null; // every indexed row has a known band
  const applied: Ranked['filtersApplied'] = [];
  if (ceiling !== null) applied.push('price');
  if (filters.origin && filters.maxDistanceMeters !== undefined) applied.push('distance');
  const wanted = filters.cuisines?.length ? new Set(filters.cuisines.map(normalizeCuisine)) : null;
  if (wanted) applied.push('cuisine');

  const scored: Array<{ r: CatalogRestaurant; score: number; distance?: number }> = [];
  for (const r of rows) {
    if (ceiling !== null && PRICE_BANDS.indexOf(r.priceBand) > ceiling) continue;
    if (wanted && !r.cuisines.some((c) => wanted.has(normalizeCuisine(c)))) continue;
    let distance: number | undefined;
    if (filters.origin) {
      distance = straightLineMeters(filters.origin, { lat: r.lat, lng: r.lng });
      if (filters.maxDistanceMeters !== undefined && distance > filters.maxDistanceMeters) continue;
    }
    let dot = 0;
    for (let i = 0; i < query.length; i++) dot += query[i]! * r.embedding[i]!;
    scored.push({ r, score: dot, ...(distance === undefined ? {} : { distance }) });
  }
  scored.sort((a, b) => b.score - a.score || a.r.placeId.localeCompare(b.r.placeId));

  return {
    candidates: scored.length,
    filtersApplied: applied,
    results: scored.slice(0, limit).map(({ r, score, distance }) => ({
      placeId: r.placeId, name: r.name, score: Math.round(score * 10_000) / 10_000,
      category: r.category, cuisines: r.cuisines, priceBand: r.priceBand, priceSource: r.priceSource,
      description: r.description, address: r.address, website: r.website, hoursRaw: r.hoursRaw,
      location: { lat: r.lat, lng: r.lng },
      ...(distance === undefined ? {} : { distanceMeters: Math.round(distance) }),
    })),
  };
}
