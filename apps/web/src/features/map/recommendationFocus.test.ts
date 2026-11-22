import { describe, expect, it, vi } from 'vitest';
import { MIN_BROWSE_ZOOM, NEARBY_ZOOM, focusZoom, previouslyAuthorizedLocation, recommendationFocus } from './recommendationFocus';

const origin = { lat: 42.3601, lng: -71.0589 }, device = { lat: 42.3496, lng: -71.0785 }, current = { lat: 42.37, lng: -71.1 };

describe('recommendationFocus', () => {
  it('prefers the chosen starting point, then a granted device fix, then the current center', () => {
    expect(recommendationFocus({ origin, deviceFix: device, current })).toEqual({ center: origin, source: 'origin' });
    expect(recommendationFocus({ origin: null, deviceFix: device, current })).toEqual({ center: device, source: 'device' });
    expect(recommendationFocus({ origin: null, deviceFix: null, current })).toEqual({ center: current, source: 'current' });
  });
  it('never centers on the recommendations themselves (no results input exists)', () => {
    expect(recommendationFocus.length).toBe(1);
  });
  it('uses a nearby browsing zoom around the user, and only zooms in when staying put', () => {
    expect(focusZoom('origin', 10)).toBe(NEARBY_ZOOM);
    expect(focusZoom('device', 17)).toBe(NEARBY_ZOOM);
    expect(focusZoom('current', 10)).toBe(MIN_BROWSE_ZOOM);
    expect(focusZoom('current', 15.5)).toBe(15.5);
  });
});

describe('previouslyAuthorizedLocation', () => {
  const geo = (ok = true) => ({
    getCurrentPosition: vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) => {
      if (ok) success({ coords: { latitude: device.lat, longitude: device.lng } } as GeolocationPosition);
      else failure?.({ code: 2 } as GeolocationPositionError);
    }),
  });
  const perms = (state: string) => ({ query: vi.fn(async () => ({ state })) });
  it('reads the position only when the permission is already granted', async () => {
    const g = geo();
    await expect(previouslyAuthorizedLocation({ permissions: perms('granted'), geolocation: g })).resolves.toEqual(device);
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
  it('never asks the browser (no prompt) when the permission is prompt or denied, or unknown', async () => {
    for (const env of [
      { permissions: perms('prompt'), geolocation: geo() },
      { permissions: perms('denied'), geolocation: geo() },
      { permissions: { query: vi.fn(async () => { throw new Error('unsupported'); }) }, geolocation: geo() },
      { geolocation: geo() },
    ]) {
      await expect(previouslyAuthorizedLocation(env)).resolves.toBeNull();
      expect(env.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    }
  });
  it('resolves null when a granted read fails', async () => {
    await expect(previouslyAuthorizedLocation({ permissions: perms('granted'), geolocation: geo(false) })).resolves.toBeNull();
  });
});
