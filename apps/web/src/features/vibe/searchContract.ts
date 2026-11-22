/**
 * Contract for POST /api/vibe/search: request validation, response types and the budget → price-band
 * mapping. Pure and dependency-free so the server and (later) the browser share one definition.
 *
 * Only filters with real data behind them are offered: price band (96.7% of restaurants have one,
 * all of them estimates) and straight-line distance (every restaurant has a location).
 * Open-now, dietary and transit reachability are deliberately absent: see docs/EMBEDDING_PIPELINE.md.
 *
 * Restaurants with no price band are never searchable, on any request: they are left out of the
 * catalog index itself (server/catalogIndex.ts), and there is deliberately no parameter to bring them back.
 * Many of them are non-food businesses or thin rows whose generic descriptions crowd out real matches.
 */
import { validateVector } from './profile.ts';

export const PRICE_BANDS = ['$', '$$', '$$$', '$$$$'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export const SEARCH_TEXT_MAX = 8000;
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 50;
export const SEARCH_DISTANCE_MAX_METERS = 50_000;
export const SEARCH_CUISINES_MAX = 40;
export const SEARCH_CUISINE_MAX_LENGTH = 40;

/** One comparison form for cuisine strings ("Dim Sum", "dim_sum" and " DIM-SUM " are the same cuisine). */
export const normalizeCuisine = (c: string): string => c.trim().toLowerCase().replace(/[\s-]+/g, '_');

export interface GeoPoint { lat: number; lng: number }

export interface SearchFilters {
  /** Keep places at or below this band. */
  maxPriceBand?: PriceBand;
  /** Where the user starts. Alone it only adds `distanceMeters` to results. */
  origin?: GeoPoint;
  /** Straight-line radius from `origin`, in meters. Requires `origin`. */
  maxDistanceMeters?: number;
  /**
   * Keep only places tagged with at least one of these cuisines (matched case-insensitively against the
   * catalog's `cuisines`: OSM/Foursquare tags plus menu-read cuisines). A place with no cuisine tag never
   * matches: this is a hard filter, not a hint. Values are stored normalized (see `normalizeCuisine`).
   */
  cuisines?: string[];
}

export type SearchQuery =
  | { kind: 'text'; text: string }
  /** A vector the caller already embedded with this server's model (L2-normalized on parse). */
  | { kind: 'vector'; vector: number[] };

export interface SearchRequest { query: SearchQuery; filters: SearchFilters; limit: number }

export type ParsedSearch = { ok: true; value: SearchRequest } | { ok: false; error: string };

export interface SearchResult {
  placeId: string;
  name: string;
  /** Cosine similarity to the query, 4 decimals. */
  score: number;
  category: string | null;
  cuisines: string[];
  /** Always a real band: unknown-price restaurants are never returned. */
  priceBand: PriceBand;
  /** 'estimate' = an LLM guess, to be labeled "(est.)"; 'menu' = read from a menu; null when unknown. */
  priceSource: 'menu' | 'estimate' | null;
  description: string;
  address: string | null;
  website: string | null;
  /** The OSM `opening_hours` string as received. Unparsed: not used for any filtering. */
  hoursRaw: string | null;
  location: GeoPoint;
  /** Straight-line meters from `origin`, only when an origin was sent. Not travel time. */
  distanceMeters?: number;
}

export interface SearchResponse {
  modelKey: string;
  /** Embedded restaurants that passed the filters (before the limit). */
  candidates: number;
  /** Embedded restaurants searched in total. Grows as catalog enrichment completes. */
  indexed: number;
  filtersApplied: Array<'price' | 'distance' | 'cuisine'>;
  results: SearchResult[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parsePoint(v: unknown): GeoPoint | null {
  if (!isRecord(v)) return null;
  const { lat, lng } = v;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function parseSearchRequest(body: unknown): ParsedSearch {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object.' };

  const hasText = body['text'] !== undefined;
  const hasVector = body['vector'] !== undefined;
  if (hasText === hasVector) return { ok: false, error: 'Send exactly one of "text" or "vector".' };

  let query: SearchQuery;
  if (hasText) {
    const text = body['text'];
    if (typeof text !== 'string' || !text.trim() || text.length > SEARCH_TEXT_MAX) {
      return { ok: false, error: `"text" must be a non-empty string of at most ${SEARCH_TEXT_MAX} characters.` };
    }
    query = { kind: 'text', text: text.trim() };
  } else {
    try {
      query = { kind: 'vector', vector: validateVector(body['vector'], body['modelKey']) };
    } catch {
      return { ok: false, error: '"vector" must be a finite 384-number array sent with the server\'s exact "modelKey".' };
    }
  }

  const rawFilters = body['filters'] ?? {};
  if (!isRecord(rawFilters)) return { ok: false, error: '"filters" must be an object.' };
  const filters: SearchFilters = {};

  const band = rawFilters['maxPriceBand'];
  if (band !== undefined) {
    if (typeof band !== 'string' || !(PRICE_BANDS as readonly string[]).includes(band)) {
      return { ok: false, error: '"maxPriceBand" must be one of $, $$, $$$, $$$$.' };
    }
    filters.maxPriceBand = band as PriceBand;
  }
  if (rawFilters['origin'] !== undefined) {
    const origin = parsePoint(rawFilters['origin']);
    if (!origin) return { ok: false, error: '"origin" must be {lat, lng} within valid ranges.' };
    filters.origin = origin;
  }
  const radius = rawFilters['maxDistanceMeters'];
  if (radius !== undefined) {
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || radius > SEARCH_DISTANCE_MAX_METERS) {
      return { ok: false, error: `"maxDistanceMeters" must be a number between 1 and ${SEARCH_DISTANCE_MAX_METERS}.` };
    }
    if (!filters.origin) return { ok: false, error: '"maxDistanceMeters" needs an "origin".' };
    filters.maxDistanceMeters = radius;
  }

  const rawCuisines = rawFilters['cuisines'];
  if (rawCuisines !== undefined) {
    const bad = `"cuisines" must be a non-empty array of up to ${SEARCH_CUISINES_MAX} strings of at most ${SEARCH_CUISINE_MAX_LENGTH} characters.`;
    if (!Array.isArray(rawCuisines) || rawCuisines.length === 0 || rawCuisines.length > SEARCH_CUISINES_MAX) return { ok: false, error: bad };
    const seen = new Set<string>();
    for (const c of rawCuisines) {
      if (typeof c !== 'string' || !c.trim() || c.length > SEARCH_CUISINE_MAX_LENGTH) return { ok: false, error: bad };
      seen.add(normalizeCuisine(c));
    }
    filters.cuisines = [...seen];
  }

  const rawLimit = body['limit'];
  let limit = SEARCH_LIMIT_DEFAULT;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > SEARCH_LIMIT_MAX) {
      return { ok: false, error: `"limit" must be a whole number from 1 to ${SEARCH_LIMIT_MAX}.` };
    }
    limit = rawLimit;
  }

  return { ok: true, value: { query, filters, limit } };
}

/**
 * Discovery-panel budget (USD cents per person) → highest catalog price band to allow.
 * `null` (no limit) means no ceiling. Provisional mapping: revisit if results skew toward one band.
 * Bands are LLM estimates, so this is a soft guide, not a guarantee of cost.
 */
export function budgetToMaxPriceBand(maxCentsPerPerson: number | null): PriceBand | undefined {
  if (maxCentsPerPerson === null || !Number.isFinite(maxCentsPerPerson)) return undefined;
  if (maxCentsPerPerson <= 1500) return '$';
  if (maxCentsPerPerson <= 2500) return '$$';
  if (maxCentsPerPerson <= 4000) return '$$$';
  return '$$$$';
}
