/**
 * Where the camera goes when the quiz's final recommendations appear: around the user, never the
 * average of the results. Kept free of map and DOM code so it can be unit-tested.
 *
 * 1. The starting point chosen in the discovery panel.
 * 2. A device location the user already granted: one seen earlier this session, or a fresh fix only
 *    when the browser reports the permission as already granted (so it can never prompt).
 * 3. Otherwise the map stays where it is.
 */
import type { GeoPoint } from '../navigation/routing';

export type FocusSource = 'origin' | 'device' | 'current';
export interface RecommendationFocus { center: GeoPoint; source: FocusSource }

/** Zoom for browsing nearby recommendations around the user. */
export const NEARBY_ZOOM = 14;
/** When the map stays put, zoom in only if it is further out than this. */
export const MIN_BROWSE_ZOOM = 12.5;

export function recommendationFocus(input: {
  origin: GeoPoint | null;
  deviceFix: GeoPoint | null;
  current: GeoPoint;
}): RecommendationFocus {
  if (input.origin) return { center: input.origin, source: 'origin' };
  if (input.deviceFix) return { center: input.deviceFix, source: 'device' };
  return { center: input.current, source: 'current' };
}

export function focusZoom(source: FocusSource, currentZoom: number): number {
  return source === 'current' ? Math.max(currentZoom, MIN_BROWSE_ZOOM) : NEARBY_ZOOM;
}

export interface AuthorizedLocationEnv {
  permissions?: { query(d: { name: 'geolocation' }): Promise<{ state: string }> };
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
}

/**
 * A device position only if the user already allowed location for this site. Never calls
 * getCurrentPosition unless the Permissions API says 'granted', so it never shows a prompt.
 * Resolves null on any doubt (no API, 'prompt', 'denied', error, timeout).
 */
export async function previouslyAuthorizedLocation(env: AuthorizedLocationEnv, timeoutMs = 3000): Promise<GeoPoint | null> {
  if (!env.permissions || !env.geolocation) return null;
  try {
    if ((await env.permissions.query({ name: 'geolocation' })).state !== 'granted') return null;
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    env.geolocation!.getCurrentPosition(
      (p) => resolve(Number.isFinite(p.coords.latitude) && Number.isFinite(p.coords.longitude) ? { lat: p.coords.latitude, lng: p.coords.longitude } : null),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300_000 },
    );
  });
}
