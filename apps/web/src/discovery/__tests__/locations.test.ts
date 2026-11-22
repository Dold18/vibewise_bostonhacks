import { describe, expect, it } from 'vitest';
import { BOSTON_LOCATIONS } from '../data/bostonLocations.generated';
import {
  combineProviders,
  createLocalSuggestionProvider,
  createPlaceListProvider,
  isInGreaterBoston,
  matchScore,
  normalizeForSearch,
  requestCurrentLocation,
  suggestionToOrigin,
  type GeolocationEnvironment,
} from '../locations';
import { initialPreferences, preferencesReducer } from '../preferences';

const provider = createLocalSuggestionProvider(BOSTON_LOCATIONS);
const labels = async (q: string, limit?: number) => (await provider.search(q, { limit })).map((s) => s.label);

describe('bundled Boston location data', () => {
  it('has stations, universities and landmarks', () => {
    const kinds = new Set(BOSTON_LOCATIONS.map((l) => l.kind));
    expect(kinds).toEqual(new Set(['station', 'university', 'landmark']));
    expect(BOSTON_LOCATIONS.filter((l) => l.kind === 'station').length).toBeGreaterThan(100);
  });

  it('every entry has a unique id, a recorded source, and coordinates inside Greater Boston', () => {
    expect(new Set(BOSTON_LOCATIONS.map((l) => l.id)).size).toBe(BOSTON_LOCATIONS.length);
    for (const l of BOSTON_LOCATIONS) {
      expect(l.source.ref, l.label).toMatch(/\S/);
      expect(['mbta-v3', 'openstreetmap']).toContain(l.source.provider);
      expect(isInGreaterBoston(l.location), `${l.label} ${JSON.stringify(l.location)}`).toBe(true);
    }
  });

  it('MBTA ids match the source references', () => {
    for (const l of BOSTON_LOCATIONS.filter((x) => x.source.provider === 'mbta-v3')) {
      expect(l.id).toBe(`mbta:${l.source.ref}`);
      expect(l.source.ref).toMatch(/^place-/);
    }
  });
});

describe('search normalisation', () => {
  it('ignores case, accents, apostrophes and ampersands', () => {
    expect(normalizeForSearch("Boston Children's Museum")).toBe('boston childrens museum');
    expect(normalizeForSearch('Café & Bar')).toBe('cafe and bar');
  });

  it('ranks full-name prefixes above word prefixes above substrings', () => {
    expect(matchScore('park', 'Park Street station')).toBeGreaterThan(matchScore('park', 'Fenway Park'));
    expect(matchScore('park', 'Fenway Park')).toBeGreaterThan(matchScore('ark', 'Fenway Park'));
    expect(matchScore('zzz', 'Fenway Park')).toBe(0);
  });
});

describe('local suggestion provider', () => {
  it('is labelled as an offline list, not live search', () => {
    expect(provider.live).toBe(false);
    expect(provider.description).toMatch(/offline/i);
  });

  it('updates suggestions as the query grows', async () => {
    expect(await labels('')).toEqual([]);
    const k = await labels('k');
    const ken = await labels('kenm');
    expect(k.length).toBeGreaterThan(ken.length);
    expect(ken[0]).toBe('Kenmore station');
  });

  it('finds universities, landmarks and stations', async () => {
    expect((await labels('northeastern'))[0]).toBe('Northeastern University');
    expect(await labels('fenway park')).toContain('Fenway Park');
    expect((await labels('park st'))[0]).toBe('Park Street station');
  });

  it('matches aliases', async () => {
    expect(await labels('Massachusetts Institute')).toContain('MIT');
    expect(await labels('MFA')).toContain('Museum of Fine Arts');
  });

  it('respects the limit and returns real coordinates with their source', async () => {
    const results = await provider.search('station', { limit: 3 });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.source).toBe('local_suggestion');
      expect(r.sourceRef).toMatch(/^(mbta|osm):/);
      expect(isInGreaterBoston(r.location)).toBe(true);
    }
  });

  it('rejects when the search is aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(provider.search('park', { signal: abort.signal })).rejects.toThrow();
  });
});

describe('selecting a suggestion', () => {
  it('stores the label and the exact coordinates from the dataset', async () => {
    const [park] = await provider.search('Park Street');
    const source = BOSTON_LOCATIONS.find((l) => l.id === park.id)!;
    const state = preferencesReducer(initialPreferences(), { type: 'setOrigin', origin: suggestionToOrigin(park) });
    expect(state.origin).toEqual({
      label: 'Park Street station',
      secondaryLabel: source.secondary,
      location: source.location,
      source: 'local_suggestion',
      sourceRef: 'mbta:place-pktrm',
    });
  });
});

describe('current location', () => {
  const position = (lat: number, lng: number, accuracy = 25) =>
    ({ coords: { latitude: lat, longitude: lng, accuracy } }) as GeolocationPosition;
  const env = (outcome: { pos?: GeolocationPosition; code?: number }): GeolocationEnvironment => ({
    isSecureContext: true,
    geolocation: {
      getCurrentPosition(success, failure) {
        if (outcome.pos) success(outcome.pos);
        else failure?.({ code: outcome.code } as GeolocationPositionError);
      },
    },
  });

  it('returns the device coordinates on success', async () => {
    const result = await requestCurrentLocation(env({ pos: position(42.3505, -71.1054, 30) }));
    expect(result).toEqual({
      ok: true,
      outsideBoston: false,
      origin: {
        label: 'Current location',
        secondaryLabel: 'Within about 30 m',
        accuracyMeters: 30,
        location: { lat: 42.3505, lng: -71.1054 },
        source: 'device_geolocation',
      },
    });
  });

  it('flags, but keeps, a location outside Greater Boston', async () => {
    const result = await requestCurrentLocation(env({ pos: position(40.7128, -74.006) }));
    expect(result).toMatchObject({ ok: true, outsideBoston: true, origin: { location: { lat: 40.7128, lng: -74.006 } } });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps error code %i to %s without inventing a location', async (code, reason) => {
    expect(await requestCurrentLocation(env({ code }))).toEqual({ ok: false, reason });
  });

  it('reports unsupported browsers and insecure pages', async () => {
    expect(await requestCurrentLocation({ isSecureContext: true })).toEqual({ ok: false, reason: 'unsupported' });
    expect(await requestCurrentLocation({ ...env({ pos: position(42.35, -71.06) }), isSecureContext: false })).toEqual({
      ok: false,
      reason: 'insecure',
    });
  });
});

describe('place-list and combined providers (trip planner suggestions)', () => {
  /** Development fixtures shaped like map pins. */
  const pins = [
    { id: 'node/1', name: 'Fixture Kenmore Cafe', lat: 42.349, lon: -71.095, category: 'Cafe' },
    { id: 'tile/42.3,-71.0', name: 'Fixture Park', lat: 42.3, lon: -71.0, category: 'Park' },
    { id: 'node/9', name: 'Broken Pin', lat: Number.NaN, lon: -71.0, category: 'Cafe' },
  ];

  it('suggests current map places with their real coordinates and ids', async () => {
    let current = pins;
    const mapPlaces = createPlaceListProvider(() => current, { description: 'On the map', source: 'map_place', kind: 'place', secondary: 'On the map' });
    const [first] = await mapPlaces.search('kenmore');
    expect(first).toEqual({
      id: 'map_place:node/1',
      label: 'Fixture Kenmore Cafe',
      secondary: 'On the map · Cafe',
      kind: 'place',
      location: { lat: 42.349, lng: -71.095 },
      source: 'map_place',
      sourceRef: 'node/1',
    });
    expect(await mapPlaces.search('broken')).toEqual([]); // no valid coordinates, never suggested
    current = []; // reads the live list each time
    expect(await mapPlaces.search('kenmore')).toEqual([]);
  });

  it('combines providers in order and dedupes the same place', async () => {
    const mapPlaces = createPlaceListProvider(() => pins, { description: 'map', source: 'map_place', kind: 'place' });
    const dup = createPlaceListProvider(() => [pins[0]], { description: 'saved', source: 'saved_place', kind: 'saved' });
    const both = combineProviders([mapPlaces, dup, provider], 'all');
    const results = await both.search('kenmore');
    expect(results[0].source).toBe('map_place');
    expect(results.filter((r) => r.label === 'Fixture Kenmore Cafe')).toHaveLength(1);
    expect(results.some((r) => r.label === 'Kenmore station')).toBe(true);
  });

  it('a failing provider does not break the others', async () => {
    const failing = { description: 'x', live: false, search: async () => Promise.reject(new Error('boom')) };
    expect((await combineProviders([failing, provider], 'all').search('kenm'))[0].label).toBe('Kenmore station');
  });
});
