/**
 * Read-only OpenStreetMap lookups.
 *
 * - Nominatim: free-text search (geocoding). Its usage policy allows at most
 *   one request per second and forbids search-as-you-type, so we only search
 *   when the user submits.
 * - Overpass: querying OSM features (cafés, parks, ...) near a point.
 *
 * The editing API at api.openstreetmap.org is deliberately not used: its
 * policy reserves it for editing, not for apps reading data.
 */
import type { Deal } from './deals';

export interface Place {
  /** OSM identity, e.g. "node/123", when known; otherwise a synthetic id. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  tags: Record<string, string>;
  /** Student discounts and specials, when the catalog has any for this place. */
  deals?: Deal[];
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
/** Public Overpass instances, tried in order. They are often at capacity. */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OVERPASS_TIMEOUT_MS = 10_000;

/** Greater Boston, used to bias search results. west,north,east,south */
const BOSTON_VIEWBOX = '-71.19,42.40,-70.98,42.30';

interface NominatimResult {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  extratags?: Record<string, string> | null;
  address?: Record<string, string>;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '8',
    viewbox: BOSTON_VIEWBOX,
    bounded: '0',
    addressdetails: '1',
    extratags: '1',
  });
  const res = await fetch(`${NOMINATIM}?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const results = (await res.json()) as NominatimResult[];
  return results.map((r) => ({
    id: `${r.osm_type}/${r.osm_id}`,
    name: r.name || r.display_name.split(',')[0],
    lat: Number(r.lat),
    lon: Number(r.lon),
    category: humanize(r.type ?? r.category ?? 'place'),
    tags: { ...(r.extratags ?? {}), ...addressTags(r.address), 'display_name': r.display_name },
  }));
}

function addressTags(address: Record<string, string> | undefined): Record<string, string> {
  if (!address) return {};
  const out: Record<string, string> = {};
  if (address.house_number) out['addr:housenumber'] = address.house_number;
  if (address.road) out['addr:street'] = address.road;
  const city = address.city ?? address.town ?? address.suburb;
  if (city) out['addr:city'] = city;
  return out;
}

export interface Category {
  id: string;
  label: string;
  icon: string;
  /** Overpass tag selector(s), e.g. `["amenity"="cafe"]`. */
  selector: string;
  /** Matching OSM values in the vector tiles' `poi.subclass` field. */
  tileSubclasses: string[];
}

export const CATEGORIES: Category[] = [
  { id: 'restaurants', label: 'Restaurants', icon: '🍴', selector: '["amenity"="restaurant"]', tileSubclasses: ['restaurant'] },
  { id: 'coffee', label: 'Coffee', icon: '☕', selector: '["amenity"="cafe"]', tileSubclasses: ['cafe'] },
  { id: 'bars', label: 'Bars', icon: '🍸', selector: '["amenity"~"^(bar|pub)$"]', tileSubclasses: ['bar', 'pub'] },
  { id: 'parks', label: 'Parks', icon: '🌳', selector: '["leisure"="park"]', tileSubclasses: ['park'] },
  {
    id: 'museums',
    label: 'Museums',
    icon: '🏛️',
    selector: '["tourism"~"^(museum|gallery)$"]',
    tileSubclasses: ['museum', 'gallery'],
  },
  { id: 'landmarks', label: 'Landmarks', icon: '🗿', selector: '["tourism"~"^(attraction|viewpoint)$"]', tileSubclasses: ['attraction', 'viewpoint'] },
  {
    id: 'entertainment',
    label: 'Entertainment',
    icon: '🎭',
    selector: '["amenity"~"^(theatre|cinema|arts_centre|music_venue|nightclub)$"]',
    tileSubclasses: ['theatre', 'cinema', 'arts_centre', 'nightclub'],
  },
];

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export async function placesNear(
  category: Category,
  center: { lat: number; lon: number },
  radiusMeters: number,
  signal?: AbortSignal,
): Promise<Place[]> {
  const around = `(around:${Math.round(radiusMeters)},${center.lat},${center.lon})`;
  const query = `[out:json][timeout:25];nwr${category.selector}["name"]${around};out center tags 60;`;
  const json = await overpass(query, signal);
  return json.elements.flatMap((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined || !el.tags?.name) return [];
    return [
      {
        id: `${el.type}/${el.id}`,
        name: el.tags.name,
        lat,
        lon,
        category: describe(el.tags) ?? category.label,
        tags: el.tags,
      },
    ];
  });
}

/** A place and the requested category it belongs to. */
export interface CategorizedPlace {
  place: Place;
  categoryId: string;
}

/**
 * `placesNear` for several categories in a single Overpass request: one
 * query + `out` per category, so each category gets its own result limit.
 * Elements matching more than one category are returned once, under the
 * first requested category they match.
 */
export async function placesNearAny(
  categories: Category[],
  center: { lat: number; lon: number },
  radiusMeters: number,
  signal?: AbortSignal,
  limitPerCategory = 60,
): Promise<CategorizedPlace[]> {
  if (categories.length === 0) return [];
  const around = `(around:${Math.round(radiusMeters)},${center.lat},${center.lon})`;
  const statements = categories.map((c) => `nwr${c.selector}["name"]${around};out center tags ${limitPerCategory};`);
  const json = await overpass(`[out:json][timeout:25];${statements.join('')}`, signal);
  const seen = new Set<string>();
  return json.elements.flatMap((el) => {
    const id = `${el.type}/${el.id}`;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (seen.has(id) || lat === undefined || lon === undefined || !el.tags?.name) return [];
    const tags = el.tags;
    const category = categories.find((c) => matchesSelector(tags, c.selector));
    if (!category) return [];
    seen.add(id);
    return [{ categoryId: category.id, place: { id, name: tags.name, lat, lon, category: describe(tags) ?? category.label, tags } }];
  });
}

/**
 * Evaluate a category selector such as `["amenity"="cafe"]` or
 * `["tourism"~"^(museum|gallery)$"]` against an element's tags, to tell which
 * category a combined Overpass result came from.
 */
export function matchesSelector(tags: Record<string, string>, selector: string): boolean {
  const filters = [...selector.matchAll(/\["([^"]+)"(=|~)"([^"]*)"\]/g)];
  return (
    filters.length > 0 &&
    filters.every(([, key, op, value]) => {
      const v = tags[key];
      return v !== undefined && (op === '=' ? v === value : new RegExp(value).test(v));
    })
  );
}

async function overpass(query: string, signal?: AbortSignal): Promise<{ elements: OverpassElement[] }> {
  let lastError: unknown;
  for (const endpoint of OVERPASS_MIRRORS) {
    const timeout = AbortSignal.timeout(OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return (await res.json()) as { elements: OverpassElement[] };
    } catch (err) {
      if (signal?.aborted) throw err; // the caller cancelled; don't try other mirrors
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Place lookup failed');
}

/** Minimal shape of a vector-tile POI feature (OpenMapTiles `poi` layer). */
export interface TilePoi {
  lat: number;
  lon: number;
  properties: Record<string, unknown>;
}

/**
 * Turn POIs already present in the loaded map tiles into places. Instant and
 * offline-tolerant, but tiles carry only name and type — no hours or website.
 */
export function placesFromTiles(pois: TilePoi[], center: { lat: number; lon: number }, radiusMeters: number, limit = 60): Place[] {
  const seen = new Set<string>();
  const places: (Place & { distance: number })[] = [];
  for (const poi of pois) {
    const props = poi.properties;
    const name = String(props['name:en'] ?? props.name_en ?? props.name ?? '');
    if (!name) continue;
    const distance = metersBetween(center, poi);
    if (distance > radiusMeters) continue;
    const key = `${name}|${poi.lat.toFixed(4)}|${poi.lon.toFixed(4)}`;
    if (seen.has(key)) continue; // the same POI appears in neighbouring tiles
    seen.add(key);
    places.push({
      id: `tile/${poi.lat.toFixed(6)},${poi.lon.toFixed(6)}`,
      name,
      lat: poi.lat,
      lon: poi.lon,
      category: humanize(String(props.subclass ?? props.class ?? 'place')),
      tags: {},
      distance,
    });
  }
  return places
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ distance: _distance, ...place }) => place);
}

export function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

function describe(tags: Record<string, string>): string | undefined {
  const kind = tags.cuisine ? `${tags.cuisine.split(';')[0]} ${tags.amenity ?? ''}` : (tags.amenity ?? tags.tourism ?? tags.leisure);
  return kind ? humanize(kind.trim()) : undefined;
}

function humanize(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function formatAddress(tags: Record<string, string>): string | undefined {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [street, tags['addr:city']].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

export function osmUrl(place: Place): string {
  if (/^(node|way|relation)\/\d+$/.test(place.id)) return `https://www.openstreetmap.org/${place.id}`;
  return `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=19/${place.lat}/${place.lon}`;
}
