export interface EnrichPlace {
  id: number; placeId: string; name: string; lat: number; lng: number;
  website: string | null; address: string | null; osmTags: Record<string, string> | null;
}

export type PhotoKind = 'student' | 'licensed' | 'website';
export type PhotoSource = 'upload' | 'osm' | 'wikidata' | 'commons' | 'mapillary' | 'website';
export type MatchMethod = 'upload' | 'osm_tag' | 'wikidata' | 'name_match' | 'nearest_facing' | 'website';

export interface PhotoCandidate {
  kind: PhotoKind; source: PhotoSource; matchMethod: MatchMethod;
  url: string | null; mapillaryId: string | null; pageUrl: string | null;
  license: string | null; credit: string;
}

export type VibeSource = 'website' | 'wiki' | 'osm_tags' | 'city_licenses' | 'student_reviews';
export interface VibeInput { source: VibeSource; content: string; sourceUrl: string | null }

export interface FetchDeps { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }
