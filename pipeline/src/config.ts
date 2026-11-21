import type { Bbox } from './types.ts';

export const STUDY_BBOX: Bbox = { south: 42.227, west: -71.191, north: 42.418, east: -70.986 };
export const OSM_AMENITIES = ['restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'ice_cream', 'food_court'] as const;
export const USER_AGENT = 'vibenta-ingest/0.1 (+https://github.com/Dold18/vibenta_bostonhacks)';

export const MATCH_SAME_NAME_METERS = 50;
export const MATCH_SIMILAR_NAME_METERS = 25;
export const MATCH_SIMILARITY_THRESHOLD = 0.6;
export const DEDUPE_WITHIN_METERS = 50;

export const FSQ_MAX_AGE_DAYS = 730;
export const UPSERT_BATCH_SIZE = 500;
export const OVERPASS_MAX_ATTEMPTS = 4;
export const OVERPASS_BACKOFF_START_MS = 5000;
export const DEFAULT_FSQ_RELEASE = '2026-01-12';

export const ATTRIBUTION_OSM = '© OpenStreetMap contributors (ODbL)';
export const ATTRIBUTION_FSQ = 'Foursquare OS Places (Apache 2.0)';
export const ATTRIBUTION_MERGED = '© OpenStreetMap contributors (ODbL); Foursquare OS Places (Apache 2.0)';
