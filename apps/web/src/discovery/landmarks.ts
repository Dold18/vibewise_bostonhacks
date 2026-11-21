import { BOSTON_LOCATIONS } from './data/bostonLocations.generated';

/** OpenStreetMap relation for Boston Common in the bundled offline list. */
export const BOSTON_COMMON_ID = 'osm:relation/17995454';

/**
 * Boston Common, read from the bundled OpenStreetMap-derived list (not typed
 * in by hand): Recenter's target when no starting point is set. `null` only
 * if a regenerated list ever drops it; the test below guards against that.
 */
export function bostonCommon(): { label: string; location: { lat: number; lng: number } } | null {
  const found = BOSTON_LOCATIONS.find((l) => l.id === BOSTON_COMMON_ID);
  return found ? { label: found.label, location: { ...found.location } } : null;
}
