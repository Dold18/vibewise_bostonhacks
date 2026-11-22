import type { OsmBounds } from './placeTypes.ts';

export type Bbox = { south: number; west: number; north: number; east: number };
export type Category = 'restaurant' | 'cafe' | 'nightlife';
export type Source = 'osm' | 'foursquare';

export interface OsmPlace {
  osmId: string; name: string; lat: number; lng: number; tags: Record<string, string>; // osmId 'node/123'
  bounds: OsmBounds | null;          // set for ways/relations fetched with `out bb`
}
export interface FsqPlace {
  fsqId: string; name: string; lat: number; lng: number;
  address: string | null; locality: string | null; postcode: string | null;
  tel: string | null; website: string | null;
  categoryLabels: string[];          // e.g. 'Dining and Drinking > Restaurant > Asian Restaurant > Japanese Restaurant'
  dateRefreshed: string | null;      // 'YYYY-MM-DD'
}
export interface BaseRow {
  id?: number;
  place_id: string; source: Source; source_id: string; name: string;
  location: string;                  // EWKT 'SRID=4326;POINT(lng lat)'
  address: string | null; website: string | null; phone: string | null;
  hours_raw: string | null;
  osm_tags: Record<string, string> | null; fsq_place_id: string | null;
  attribution: string; last_seen_at: string;   // ISO timestamp of run start
}
export interface FoodRow extends BaseRow { category: Category; source_cuisines: string[] }
export interface KindRow extends BaseRow { kind: string }
export type PlaceRow = FoodRow | KindRow;
export type RestaurantRow = FoodRow;           // kept so code that only handles food compiles unchanged
export interface MatchPair { osmId: string; fsqId: string; meters: number; similarity: number }
export interface DroppedDuplicate { source: Source; keptId: string; droppedId: string }
export interface ExistingRow { id: number; source: Source; source_id: string; fsq_place_id: string | null }
export type RekeyAction =
  | { kind: 'clear_fsq'; id: number }
  | { kind: 'promote'; id: number; sourceId: string; placeId: string }
  | { kind: 'collapse'; id: number; fsqId: string };
