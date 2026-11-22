import { MODEL_KEY, validateVector } from './features/vibe/profile';
/**
 * Read-only access to our own place catalog, filled offline by `pipeline/`
 * (OpenStreetMap + Foursquare OS Places): one table per place type
 * (`restaurants`, `museums`, `parks`, `landmarks`, `entertainment`) sharing ids
 * from the `places` registry, plus the `catalog_places` view that unions them.
 *
 * The browser uses the publishable key only; Row Level Security allows reads
 * and nothing else. CATALOG_LAYERS lists the map layers the catalog backs:
 * the food layers plus museums, parks, landmarks and entertainment. A layer
 * whose type has no catalog rows, and every other layer, uses tiles/Overpass.
 *
 * Two steps, so the page never downloads details it won't show:
 *  1. The pin index: every place's id, type, name, kind and location from
 *     `catalog_places`, fetched once per page load (a few thousand small rows).
 *  2. Details (address, website, phone, hours, and per type cuisines, price and
 *     deals) for just the pins in range, read from each pin's own type table by
 *     place id and cached, so panning back costs nothing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { activeKinds, toDeals, type Deal } from './deals';
import { metersBetween, type CategorizedPlace, type Category, type Place } from './osm';

/** Map layer id → which catalog rows back it. */
export const CATALOG_LAYERS: Record<string, { placeType: string; kind?: string }> = {
  restaurants: { placeType: 'restaurants', kind: 'restaurant' },
  coffee: { placeType: 'restaurants', kind: 'cafe' },
  bars: { placeType: 'restaurants', kind: 'nightlife' },
  museums: { placeType: 'museums' },
  parks: { placeType: 'parks' },
  landmarks: { placeType: 'landmarks' },
  entertainment: { placeType: 'entertainment' },
};

const INDEX_COLUMNS = 'place_id, place_type, source, source_id, name, kind, location';
const DETAIL_COLUMNS = 'place_id, address, website, phone, cuisines, hours_raw, osm_tags, attribution, price_band, price_source';
/** Non-food type tables have a kind but no price or cuisine columns. */
const KIND_DETAIL_COLUMNS = 'place_id, address, website, phone, kind, hours_raw, osm_tags, attribution';
/** PostgREST embed of the place's deals (restaurants.id → places.id ← place_deals.place_ref); RLS hides hidden rows. */
export const DEALS_EMBED = 'places(place_deals(kind, title, timing, schedule, source, source_url, checked_at))';
const PAGE_SIZE = 1000; // PostgREST max_rows
const DETAIL_CHUNK = 100; // place ids per request, keeps the URL short

/** One place in the pin index. `placeId` is the catalog's stable id, e.g. "osm:node/1" or "fsq:abc". */
export interface CatalogPin {
  placeId: string;
  placeType: string;
  source: 'osm' | 'foursquare';
  sourceId: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface CatalogDetails {
  address: string | null;
  website: string | null;
  phone: string | null;
  /** Restaurants only. */
  cuisines?: string[] | null;
  /** Non-food types only. */
  kind?: string;
  hours_raw: string | null;
  osm_tags: Record<string, string> | null;
  attribution: string;
  /** Restaurants only: '$'..'$$$$' or 'unknown'. */
  price_band?: string;
  /** 'menu' (read from a menu) or 'estimate' (LLM guess, labeled "(est.)"); null when unknown. */
  price_source?: string | null;
  /** Validated deals; empty when none or when the deals embed is unavailable. */
  deals: Deal[];
}

interface IndexRow {
  place_id: string;
  place_type: string;
  source: 'osm' | 'foursquare';
  source_id: string;
  name: string;
  kind: string;
  /** geography(Point): PostgREST returns hex EWKB; GeoJSON is accepted too. */
  location: unknown;
}

/** Place types with at least one pin, once the index has loaded; undefined before that. */
let loadedTypes: Set<string> | undefined;

/** Record which place types the loaded index holds. */
export function noteIndex(pins: CatalogPin[]): void {
  loadedTypes = new Set(pins.map((p) => p.placeType));
}

/** Test hook: forget the loaded index. */
export function resetIndexForTests(): void {
  loadedTypes = undefined;
}

/** Requested catalog categories whose place type has no pins in `pins`. */
export function emptyCategories(pins: CatalogPin[], categories: Category[]): Category[] {
  const types = new Set(pins.map((p) => p.placeType));
  return categories.filter((c) => !types.has(CATALOG_LAYERS[c.id]?.placeType));
}

/**
 * True when the catalog can back this map category. Once the index has loaded,
 * a layer whose place type has no rows is not catalog-backed, so callers send it
 * to map tiles / Overpass exactly as before the catalog held that type.
 */
export function isCatalogCategory(category: Category): boolean {
  const layer = CATALOG_LAYERS[category.id];
  return !!layer && (!loadedTypes || loadedTypes.has(layer.placeType));
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
  return { placeId: row.place_id, placeType: row.place_type, source: row.source, sourceId: row.source_id, name: row.name, kind: row.kind, ...point };
}

/**
 * A pin as a map `Place`. Card fields go in `tags` the way the card already
 * reads them; without details the card shows name and type only.
 */
export function pinToPlace(pin: CatalogPin, details?: CatalogDetails): Place {
  const food = pin.placeType === 'restaurants';
  const tags: Record<string, string> = { 'catalog:place_id': pin.placeId, 'catalog:source': pin.source };
  if (details?.address) tags.display_name = details.address;
  if (details?.website) tags.website = details.website;
  if (details?.phone) tags.phone = details.phone;
  if (details?.hours_raw) tags.opening_hours = details.hours_raw;
  if (details?.attribution) tags['catalog:attribution'] = details.attribution;
  if (food && details?.price_band) tags['catalog:price_band'] = details.price_band;
  if (food && details?.price_source) tags['catalog:price_source'] = details.price_source;
  const kind = food ? (details?.osm_tags?.amenity ?? pin.kind) : pin.kind;
  const cuisine = food ? details?.cuisines?.[0] : undefined;
  const place: Place = {
    // OSM ids stay bare ("node/1") so "View on OpenStreetMap" links to the feature.
    id: pin.source === 'osm' ? pin.sourceId : pin.placeId,
    name: pin.name,
    lat: pin.lat,
    lon: pin.lon,
    category: humanize(cuisine ? `${cuisine} ${kind}` : kind),
    tags,
  };
  if (details?.deals?.length) place.deals = details.deals;
  return place;
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

/**
 * Per map category: pins within `radiusMeters` of `center`, at most `limit` each,
 * listed nearest first. When the cap bites, `priority` pins (e.g. a deal on now)
 * take the slots before nearer ordinary pins; nothing outside the radius is added.
 */
export function nearestByCategory(
  pins: CatalogPin[],
  categories: Category[],
  center: { lat: number; lon: number },
  radiusMeters: number,
  limit: number,
  priority: (pin: CatalogPin) => boolean = () => false,
): { categoryId: string; pin: CatalogPin }[] {
  const out: { categoryId: string; pin: CatalogPin }[] = [];
  for (const category of categories) {
    const layer = CATALOG_LAYERS[category.id];
    if (!layer) continue;
    const near = pins
      .filter((p) => p.placeType === layer.placeType && (layer.kind === undefined || p.kind === layer.kind))
      .map((pin) => ({ pin, distance: metersBetween(center, pin), first: priority(pin) }))
      .filter((x) => x.distance <= radiusMeters)
      .sort((a, b) => Number(b.first) - Number(a.first) || a.distance - b.distance)
      .slice(0, limit)
      .sort((a, b) => a.distance - b.distance);
    for (const { pin } of near) out.push({ categoryId: category.id, pin });
  }
  return out;
}

/** Validates PostgREST `place_deals` rows embedding `places(place_id)` into catalog place id → deals. */
export function dealsByPlace(raw: unknown): Map<string, Deal[]> {
  const out = new Map<string, Deal[]>();
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    const placeId = (row as { places?: { place_id?: unknown } | null } | null)?.places?.place_id;
    if (typeof placeId !== 'string') continue;
    const [deal] = toDeals([row]);
    if (!deal) continue;
    out.set(placeId, [...(out.get(placeId) ?? []), deal]);
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
  // Once per page load (the result is cached): without this, a missing config looks like "no places here".
  if (!client) console.warn('[catalog] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set; using map-tile and Overpass places only.');
  return client;
}

let indexPromise: Promise<CatalogPin[]> | undefined;
async function fetchIndex(supabase: SupabaseClient): Promise<CatalogPin[]> {
  const pins: CatalogPin[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('catalog_places')
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

/**
 * Every visible deal, keyed by catalog place id, fetched once per page load so pin
 * selection can favour places with a deal on (a few hundred small rows). Never
 * rejects: without it, selection is simply nearest first.
 */
let dealIndexPromise: Promise<Map<string, Deal[]>> | undefined;
async function fetchDealIndex(supabase: SupabaseClient): Promise<Map<string, Deal[]>> {
  const rows: unknown[] = [];
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('place_deals')
        .select('kind, title, timing, schedule, source, source_url, checked_at, places(place_id)')
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      rows.push(...data);
    }
  } catch (err) {
    console.warn('[catalog] deal priority unavailable:', (err as Error).message);
    dealIndexPromise = undefined; // try again on the next load
    return new Map();
  }
  return dealsByPlace(rows);
}

const detailsCache = new Map<string, CatalogDetails>();
/** Once the embed fails (e.g. the place_deals migration isn't applied), skip it for the rest of the page load. */
let dealsEmbedAvailable = true;

type DetailsQuery = (columns: string, ids: string[]) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;

/** Test hook: re-enable the deals embed. */
export function resetDealsEmbedForTests(): void {
  dealsEmbedAvailable = true;
  detailsCache.clear();
}

/** Cached details for a place id, if fetched. */
export function getCachedDetails(placeId: string): CatalogDetails | undefined {
  return detailsCache.get(placeId);
}

/** Fetch and cache details for ids not yet cached, in chunks, via `query`. Throws if a request fails even without the deals embed. */
export async function fetchDetailsWith(query: DetailsQuery, placeIds: string[], detailColumns = DETAIL_COLUMNS): Promise<void> {
  const missing = placeIds.filter((id) => !detailsCache.has(id));
  for (let i = 0; i < missing.length; i += DETAIL_CHUNK) {
    const ids = missing.slice(i, i + DETAIL_CHUNK);
    let result = await query(dealsEmbedAvailable ? `${detailColumns}, ${DEALS_EMBED}` : detailColumns, ids);
    if (result.error && dealsEmbedAvailable) {
      const embedError = result.error.message;
      result = await query(detailColumns, ids);
      // Only blame the embed when the plain request works; otherwise it's a general outage.
      if (!result.error) {
        dealsEmbedAvailable = false;
        console.warn('[catalog] deals unavailable:', embedError);
      }
    }
    if (result.error) throw new Error(result.error.message);
    for (const row of (result.data ?? []) as (Omit<CatalogDetails, 'deals'> & { place_id: string; places?: { place_deals?: unknown } | null })[]) {
      const { place_id, places, ...details } = row;
      detailsCache.set(place_id, { ...details, deals: toDeals(places?.place_deals) });
    }
  }
}

/** Details per place type: each type's table is queried for just its own ids. */
export async function fetchDetailsForPins(queryFor: (table: string) => DetailsQuery, pins: CatalogPin[]): Promise<void> {
  const byType = new Map<string, string[]>();
  for (const pin of pins) byType.set(pin.placeType, [...(byType.get(pin.placeType) ?? []), pin.placeId]);
  for (const [placeType, ids] of byType) {
    await fetchDetailsWith(queryFor(placeType), ids, placeType === 'restaurants' ? DETAIL_COLUMNS : KIND_DETAIL_COLUMNS);
  }
}

async function fetchDetails(supabase: SupabaseClient, pins: CatalogPin[]): Promise<void> {
  await fetchDetailsForPins(
    (table) => async (columns, chunk) => {
      const { data, error } = await supabase.from(table).select(columns).in('place_id', chunk);
      return { data: data as unknown[] | null, error };
    },
    pins,
  );
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
  dealIndexPromise ??= fetchDealIndex(supabase); // in parallel with the pin index
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
  noteIndex(pins);
  // First call only: the caller partitioned before the index was known. If a requested
  // type has no rows, decline so every layer takes the tiles/Overpass path this once.
  if (emptyCategories(pins, categories).length) return null;
  const deals = await dealIndexPromise;
  const now = new Date();
  const dealOn = (pin: CatalogPin) => activeKinds(deals.get(pin.placeId) ?? [], now).size > 0;
  const near = nearestByCategory(pins, categories, center, radiusMeters, limit, dealOn);
  try {
    await fetchDetails(supabase, near.map((n) => n.pin));
  } catch (err) {
    console.warn('[catalog] details unavailable:', (err as Error).message);
  }
  return near.map(({ categoryId, pin }) => ({ categoryId, place: pinToPlace(pin, getCachedDetails(pin.placeId)) }));
}

function humanize(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Optional single-model vectors for currently eligible places. No schema writes or secondary catalog. */
type VectorQuery = (table: string, ids: string[]) => Promise<{ data: Array<{ place_id: string; embedding: unknown }> | null; error: unknown }>;

/**
 * Vectors for the shown catalog places, from `catalog_places`, so every place type (food, museums,
 * entertainment, parks, landmarks) can be ranked, not only restaurants. Ids are asked in chunks of 100.
 */
export async function semanticCandidatesWith(query:VectorQuery,places:readonly Place[]) {
  const indexed=new Map(places.filter(p=>p.tags['catalog:place_id']).map(p=>[p.tags['catalog:place_id'],p]));
  const ids=[...indexed.keys()];if(!ids.length)return [];
  const out:import('./features/vibe/adapters').SemanticCandidate[]=[];
  for(let i=0;i<ids.length;i+=100){
    const {data,error}=await query('catalog_places',ids.slice(i,i+100));
    if(error)throw Error('Catalog vectors unavailable');
    for(const row of data??[]){
      const p=indexed.get(row.place_id);if(!p||!row.embedding)continue;
      try{const raw=typeof row.embedding==='string'?JSON.parse(row.embedding):row.embedding;const embedding=validateVector(raw,MODEL_KEY);out.push({id:p.id,location:{lat:p.lat,lng:p.lon},embedding,modelKey:MODEL_KEY,eligible:true,provenance:'catalog'});}catch{/* Unknown vectors never become fabricated scores. */}
    }
  }
  return out;
}

export async function catalogSemanticCandidates(places:readonly Place[],signal:AbortSignal) {
  const supabase=getClient();
  if(!supabase||import.meta.env.VITE_CATALOG_EMBEDDING_MODEL_KEY!==MODEL_KEY)return [];
  return semanticCandidatesWith(async (table,ids)=>{
    const {data,error}=await supabase.from(table).select('place_id,embedding').in('place_id',ids).abortSignal(signal);
    return {data:data as Array<{place_id:string;embedding:unknown}>|null,error};
  },places);
}
