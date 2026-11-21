/**
 * Saved destinations, kept in this browser only (localStorage). There are no
 * accounts and no sync; the UI says so.
 *
 * Only fields that came from the place record itself are stored (OSM id,
 * name, coordinates, category label and a few OSM tags shown in the popup),
 * so a saved place re-opens with the same verified details it was saved with.
 */
import type { Place } from '../osm';
import { isValidGeoPoint } from './preferences';

export const SAVED_STORAGE_KEY = 'vibenta.saved.v1';
export const SAVED_LIMIT = 100;

/** OSM tags worth keeping for the popup. Nothing derived or estimated. */
const KEPT_TAGS = [
  'addr:housenumber',
  'addr:street',
  'addr:city',
  'display_name',
  'opening_hours',
  'phone',
  'contact:phone',
  'website',
  'contact:website',
  'cuisine',
  'amenity',
  'tourism',
  'leisure',
] as const;

export interface SavedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  tags: Record<string, string>;
  /** The map category it was shown under, if any (for pin colour). */
  categoryId?: string;
  savedAt: string;
}

export interface SavedStore {
  list(): readonly SavedPlace[];
  has(id: string): boolean;
  /** Save if not saved, otherwise remove. Returns the new saved state. */
  toggle(place: Place, meta?: { categoryId?: string }): boolean;
  remove(id: string): void;
  subscribe(listener: (list: readonly SavedPlace[]) => void): () => void;
  /** False when storage isn't available (e.g. blocked); saves then last only for this visit. */
  readonly persistent: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function toSavedPlace(place: Place, meta: { categoryId?: string } = {}, now = new Date()): SavedPlace {
  const tags: Record<string, string> = {};
  for (const key of KEPT_TAGS) if (place.tags[key]) tags[key] = place.tags[key];
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    category: place.category,
    tags,
    ...(meta.categoryId ? { categoryId: meta.categoryId } : {}),
    savedAt: now.toISOString(),
  };
}

/** Back to the map's place shape, for pins and popups. */
export const savedToPlace = (s: SavedPlace): Place => ({
  id: s.id,
  name: s.name,
  lat: s.lat,
  lon: s.lon,
  category: s.category,
  tags: { ...s.tags },
});

function isSavedPlace(v: unknown): v is SavedPlace {
  const s = v as SavedPlace;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.category === 'string' &&
    typeof s.savedAt === 'string' &&
    !!s.tags &&
    typeof s.tags === 'object' &&
    Object.values(s.tags).every((t) => typeof t === 'string') &&
    isValidGeoPoint({ lat: s.lat, lng: s.lon })
  );
}

/** Read and validate stored entries; anything malformed is dropped, never "repaired". */
export function parseSaved(raw: string | null): SavedPlace[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter((v): v is SavedPlace => isSavedPlace(v) && !seen.has(v.id) && !!seen.add(v.id));
  } catch {
    return [];
  }
}

function defaultStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__vibenta_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function createSavedStore(storage: StorageLike | null = defaultStorage(), now: () => Date = () => new Date()): SavedStore {
  let items: SavedPlace[] = storage ? parseSaved(storage.getItem(SAVED_STORAGE_KEY)) : [];
  let persistent = !!storage;
  const listeners = new Set<(list: readonly SavedPlace[]) => void>();

  const commit = (next: SavedPlace[]) => {
    items = next;
    if (storage) {
      try {
        storage.setItem(SAVED_STORAGE_KEY, JSON.stringify(items));
      } catch {
        persistent = false; // quota or blocked: keep working in memory
      }
    }
    for (const l of [...listeners]) l(items);
  };

  return {
    list: () => items,
    has: (id) => items.some((s) => s.id === id),
    toggle(place, meta) {
      if (items.some((s) => s.id === place.id)) {
        commit(items.filter((s) => s.id !== place.id));
        return false;
      }
      // Newest first; the oldest drop off past the limit.
      commit([toSavedPlace(place, meta, now()), ...items].slice(0, SAVED_LIMIT));
      return true;
    },
    remove(id) {
      if (items.some((s) => s.id === id)) commit(items.filter((s) => s.id !== id));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get persistent() {
      return persistent;
    },
  };
}
