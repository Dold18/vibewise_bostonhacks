/**
 * Starting-point lookup.
 *
 * `LocationSuggestionProvider` is the seam for autocomplete. v1 ships only
 * `createLocalSuggestionProvider`, which searches a bundled list of Boston
 * stations, universities and landmarks (see data/bostonLocations.generated.ts).
 * A live geocoder can replace it later by implementing the same interface.
 *
 * Do NOT back this with the public Nominatim server: its usage policy forbids
 * client-side autocomplete. A live provider needs a team decision (and, if it
 * is keyed, a server-side proxy so the key isn't shipped to browsers).
 */
import { isValidGeoPoint, type GeoPoint, type Origin } from './preferences';

export type LocalLocationKind = 'station' | 'university' | 'landmark';

/** One entry in the bundled offline list. Every coordinate carries its source. */
export interface LocalLocation {
  id: string;
  kind: LocalLocationKind;
  label: string;
  secondary: string;
  aliases: string[];
  location: GeoPoint;
  source: {
    provider: 'mbta-v3' | 'openstreetmap';
    ref: string;
    wikidata?: string;
    retrievedAt: string;
  };
}

export interface LocationSuggestion {
  id: string;
  label: string;
  secondary?: string;
  kind: LocalLocationKind | 'address' | 'business' | 'other';
  location: GeoPoint;
  source: Origin['source'];
  sourceRef?: string;
}

export interface LocationSuggestionProvider {
  /** Shown in the suggestions list so users know what they're searching. */
  readonly description: string;
  /** True only for a real-time geocoder. */
  readonly live: boolean;
  search(query: string, options?: { limit?: number; signal?: AbortSignal }): Promise<LocationSuggestion[]>;
}

/** Lowercase, strip accents and punctuation so "St. Mary's" matches "st marys". */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[''`.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const KIND_ORDER: Record<LocalLocationKind, number> = { university: 0, landmark: 1, station: 2 };

/**
 * Score how well `query` matches a name. Higher is better; 0 = no match.
 * Prefix of the full name beats a word prefix, which beats a substring.
 * Every query word must appear as a word prefix somewhere in the name.
 */
export function matchScore(query: string, name: string): number {
  const q = normalizeForSearch(query);
  const n = normalizeForSearch(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const words = n.split(' ');
  const qWords = q.split(' ');
  if (qWords.every((qw) => words.some((w) => w.startsWith(qw)))) return qWords.length > 1 ? 60 : 50;
  if (n.includes(q)) return 20;
  return 0;
}

export function createLocalSuggestionProvider(locations: readonly LocalLocation[]): LocationSuggestionProvider {
  return {
    description: 'Offline Boston list: MBTA stations, universities and landmarks',
    live: false,
    async search(query, { limit = 8, signal } = {}) {
      signal?.throwIfAborted();
      if (!normalizeForSearch(query)) return [];
      const scored: { loc: LocalLocation; score: number }[] = [];
      for (const loc of locations) {
        const score = Math.max(matchScore(query, loc.label), ...loc.aliases.map((a) => matchScore(query, a) - 1));
        if (score > 0) scored.push({ loc, score });
      }
      scored.sort(
        (a, b) =>
          b.score - a.score || KIND_ORDER[a.loc.kind] - KIND_ORDER[b.loc.kind] || a.loc.label.localeCompare(b.loc.label),
      );
      return scored.slice(0, limit).map(({ loc }) => ({
        id: loc.id,
        label: loc.label,
        secondary: loc.secondary,
        kind: loc.kind,
        location: { ...loc.location },
        source: 'local_suggestion',
        sourceRef: loc.id,
      }));
    },
  };
}

export function suggestionToOrigin(s: LocationSuggestion): Origin {
  return {
    label: s.label,
    ...(s.secondary ? { secondaryLabel: s.secondary } : {}),
    location: { ...s.location },
    source: s.source,
    ...(s.sourceRef ? { sourceRef: s.sourceRef } : {}),
  };
}

// ---------------------------------------------------------------------------
// Device geolocation
// ---------------------------------------------------------------------------

/**
 * Rough Greater Boston service area (Waltham–Lynn–Quincy). Used only to warn
 * that a device location may be too far away to be useful; never to change it.
 */
export const GREATER_BOSTON_BOUNDS = { south: 42.2, west: -71.3, north: 42.5, east: -70.9 };

export function isInGreaterBoston(p: GeoPoint): boolean {
  const b = GREATER_BOSTON_BOUNDS;
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

export type GeolocationFailure = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout';

export type GeolocationResult =
  | { ok: true; origin: Origin; outsideBoston: boolean }
  | { ok: false; reason: GeolocationFailure };

export const GEOLOCATION_MESSAGES: Record<GeolocationFailure, string> = {
  unsupported: "This browser can't share your location. Search for a starting point instead.",
  insecure: 'Current location only works on a secure (https) page. Search for a starting point instead.',
  denied: 'Location access was denied. You can allow it in your browser settings, or search for a starting point.',
  unavailable: "Your location isn't available right now. Search for a starting point instead.",
  timeout: 'Finding your location took too long. Try again, or search for a starting point.',
};

export interface GeolocationEnvironment {
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
  isSecureContext?: boolean;
}

/**
 * Ask the browser for the device's position. Resolves (never rejects) with
 * either a real origin or a typed failure; it never substitutes a default.
 */
export function requestCurrentLocation(
  env: GeolocationEnvironment = globalThis.navigator
    ? { geolocation: navigator.geolocation, isSecureContext: globalThis.isSecureContext }
    : {},
  timeoutMs = 10_000,
): Promise<GeolocationResult> {
  if (env.isSecureContext === false) return Promise.resolve({ ok: false, reason: 'insecure' });
  if (!env.geolocation) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    env.geolocation!.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lng: position.coords.longitude };
        if (!isValidGeoPoint(location)) {
          resolve({ ok: false, reason: 'unavailable' });
          return;
        }
        const accuracy = position.coords.accuracy;
        resolve({
          ok: true,
          outsideBoston: !isInGreaterBoston(location),
          origin: {
            label: 'Current location',
            ...(Number.isFinite(accuracy) ? { secondaryLabel: `Within about ${formatAccuracy(accuracy)}`, accuracyMeters: accuracy } : {}),
            location,
            source: 'device_geolocation',
          },
        });
      },
      (error) => {
        // GeolocationPositionError codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
        const reason: GeolocationFailure = error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
        resolve({ ok: false, reason });
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

function formatAccuracy(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
