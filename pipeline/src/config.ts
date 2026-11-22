import type { Bbox } from './types.ts';

export const STUDY_BBOX: Bbox = { south: 42.227, west: -71.191, north: 42.418, east: -70.986 };
export const OSM_AMENITIES = ['restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'ice_cream', 'food_court'] as const;
export const USER_AGENT = 'vibenta-ingest/0.1 (+https://github.com/Dold18/vibenta_bostonhacks)';

export const MATCH_SAME_NAME_METERS = 50;
export const MATCH_SIMILAR_NAME_METERS = 25;
export const MATCH_SIMILARITY_THRESHOLD = 0.6;
export const DEDUPE_WITHIN_METERS = 50;
// Non-food Foursquare sub-venues: a Foursquare-only place inside an OSM area (never a route) with a similar name merges
// into it; other places inside are dropped only by areas up to this size (a campus, district or big park would swallow
// real places). Similar, for areas up to this size: nameSimilarity at least SUB_VENUE_MERGE_SIMILARITY, or a token
// subset either way. For larger areas: nameSimilarity at least MATCH_SIMILARITY_THRESHOLD, or the Foursquare tokens are
// a subset of the OSM tokens and include a word outside the type's genericNameWords.
export const SUB_VENUE_CONTAINER_MAX_HA = 20;
export const SUB_VENUE_MERGE_SIMILARITY = 0.5;

export const FSQ_MAX_AGE_DAYS = 730;
export const UPSERT_BATCH_SIZE = 500;
export const OVERPASS_MAX_ATTEMPTS = 4;
export const OVERPASS_BACKOFF_START_MS = 5000;
export const DEFAULT_FSQ_RELEASE = '2026-01-12';

export const ATTRIBUTION_OSM = '© OpenStreetMap contributors (ODbL)';
export const ATTRIBUTION_FSQ = 'Foursquare OS Places (Apache 2.0)';
export const ATTRIBUTION_MERGED = '© OpenStreetMap contributors (ODbL); Foursquare OS Places (Apache 2.0)';

// Verified 2026-11-21 against the Boston extract of release 2026-01-12 (second segment under
// "Dining and Drinking"). 'Lounge' / 'Night Club' don't appear there but are kept in case later releases add them.
export const FSQ_CAFE_SEGMENTS = ['Cafe, Coffee, and Tea House'] as const;
export const FSQ_NIGHTLIFE_SEGMENTS = ['Bar', 'Brewery', 'Winery', 'Distillery', 'Cidery', 'Meadery', 'Lounge', 'Night Club'] as const;

export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;
export const OVERPASS_REQUEST_TIMEOUT_MS = 200_000;

// Boston open data (data.boston.gov CKAN datastore). Resource ids verified 2026-11-21.
export const BOSTON_DATASTORE_SEARCH = 'https://data.boston.gov/api/3/action/datastore_search';
export const BOSTON_ENTERTAINMENT_RESOURCE = 'eb683641-e358-4c2c-95de-c84f32c09147'; // Annual Entertainment Licenses - With Detail
export const BOSTON_ALCOHOL_RESOURCE = 'aab353c1-c797-4053-a3fc-e893f5ccf547'; // Section 12 Licenses (Alcohol)
export const BOSTON_ENTERTAINMENT_PAGE = 'https://data.boston.gov/dataset/entertainment-licenses-legacy';
export const BOSTON_ALCOHOL_PAGE = 'https://data.boston.gov/dataset/liquor-licenses';
