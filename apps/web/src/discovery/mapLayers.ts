/**
 * Which of the map's existing place categories ("layers") to load for the
 * current preferences.
 *
 * Only categories the map already supports are used; layer ids are the map's
 * own `CATEGORIES` ids (osm.ts) and are filtered against what the map passes
 * in, so nothing is invented. Activity types without a layer are reported as
 * unsupported. They are never swapped for an unrelated category just to put
 * pins on the map.
 *
 * Cuisine and budget narrow individual pins in the map coordinator.
 * Timing, origin and vibe do not determine which layers load.
 */
import { activeSubtypes, type ActivityTypeId, type InitialPreferences } from './preferences';

/** Layers for Food & drinks, in display order. */
const FOOD_LAYERS = ['restaurants', 'coffee', 'bars'] as const;

/** Activity types that have a matching map layer today. */
const ACTIVITY_TYPE_LAYERS: Partial<Record<ActivityTypeId, readonly string[]>> = {
  museums_galleries: ['museums'],
  outdoors_parks: ['parks'],
  nightlife: ['bars'],
  sightseeing: ['landmarks'],
  games_entertainment: ['entertainment'],
  sports_recreation: ['entertainment'],
  live_music: ['entertainment'],
};

export interface MapLayer {
  id: string;
  label: string;
}

export interface MapLayerSelection {
  /** Layer ids to show, in the map's own order. */
  layerIds: string[];
  /**
   * 'tiles': nothing chosen yet; show what's already in the loaded map tiles
   * (no network request). 'full': tiles first, then detailed OSM lookups.
   */
  detail: 'tiles' | 'full';
  /** Chosen activity types that no map layer covers yet. */
  unsupportedActivityTypes: ActivityTypeId[];
}

export function mapLayersFor(prefs: InitialPreferences, available: readonly MapLayer[]): MapLayerSelection {
  const order = available.map((l) => l.id);
  const keep = (ids: Iterable<string>) => {
    const wanted = new Set(ids);
    return order.filter((id) => wanted.has(id));
  };

  switch (prefs.activity) {
    case null:
      return { layerIds: order, detail: 'tiles', unsupportedActivityTypes: [] };
    case 'anything':
      return { layerIds: order, detail: 'full', unsupportedActivityTypes: [] };
    case 'food_drinks':
      // Cuisine choices narrow pins within these layers.
      return { layerIds: keep(FOOD_LAYERS), detail: 'full', unsupportedActivityTypes: [] };
    case 'activities': {
      const types = activeSubtypes(prefs) as ActivityTypeId[];
      const layersOf = (t: ActivityTypeId) => keep(ACTIVITY_TYPE_LAYERS[t] ?? []);
      if (types.length === 0) {
        // No type chosen: every activity type we can actually show.
        return {
          layerIds: keep(Object.values(ACTIVITY_TYPE_LAYERS).flat()),
          detail: 'full',
          unsupportedActivityTypes: [],
        };
      }
      // Union: a place matching any chosen type qualifies.
      return {
        layerIds: keep(types.flatMap(layersOf)),
        detail: 'full',
        unsupportedActivityTypes: types.filter((t) => layersOf(t).length === 0),
      };
    }
  }
}

/** Stable key for change detection: equal keys mean the map needn't reload. */
export const selectionKey = (s: MapLayerSelection) => `${s.detail}:${s.layerIds.join(',')}`;

/**
 * Reports layer changes to the map: immediately on `start()`, then once
 * preference changes have settled for `debounceMs`, and only when the set of
 * layers actually differs (so e.g. ticking a cuisine never triggers a reload).
 */
export function createMapLayerNotifier(
  getPrefs: () => InitialPreferences,
  available: readonly MapLayer[],
  onChange: (selection: MapLayerSelection) => void,
  debounceMs = 500,
) {
  let lastKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = () => {
    timer = undefined;
    const selection = mapLayersFor(getPrefs(), available);
    const key = selectionKey(selection);
    if (key === lastKey) return;
    lastKey = key;
    onChange(selection);
  };
  return {
    start: emit,
    /** Call on every preference change. */
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(emit, debounceMs);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
