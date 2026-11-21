import { describe, expect, it, vi } from 'vitest';
import {
  fetchRoute,
  isRouteResponse,
  isVerifiedWalkGeometry,
  lineColor,
  lineName,
  routeBounds,
  routeLineFeatures,
  routeStations,
  UNKNOWN_LINE_COLOR,
  type RouteLeg,
} from './transitRoute';

/*
 * TEST FIXTURES shaped like the server's legs (not real trips). Walks carry the
 * engine's real provenance string for straight-line estimates.
 */
const STRAIGHT_WALK = 'approx: straight-line walk, ~80 m/min';
const walk = (from: [number, number], to: [number, number], source = STRAIGHT_WALK): RouteLeg => ({
  mode: 'walk',
  durationSec: 300,
  distanceMeters: 400,
  geometry: [from, to],
  source,
});
const ride = (name: string, color: string | undefined, coords: [number, number][], fromStop: string, toStop: string): RouteLeg => ({
  mode: 'subway',
  durationSec: 600,
  geometry: coords,
  routeShortName: name,
  ...(color ? { routeColor: color } : {}),
  fromStopName: fromStop,
  toStopName: toStop,
  source: 'MBTA GTFS static shape TEST FIXTURE',
});

const RED = ride('Red', '#DA291C', [[-71.119, 42.373], [-71.103, 42.365], [-71.062, 42.356]], 'Harvard', 'Park Street');
const GREEN = ride('B', '#00843D', [[-71.062, 42.356], [-71.075, 42.352], [-71.095, 42.349]], 'Park Street', 'Kenmore');
const TRANSFER_TRIP: RouteLeg[] = [walk([-71.12, 42.374], [-71.119, 42.373]), RED, GREEN, walk([-71.095, 42.349], [-71.097, 42.347])];

describe('line colours', () => {
  it("uses the leg's own verified colour first", () => {
    expect(lineColor({ routeColor: '#da291c', routeShortName: 'Red' })).toEqual({ color: '#DA291C', known: true });
    expect(lineColor({ routeColor: 'ED8B00' })).toEqual({ color: '#ED8B00', known: true });
  });

  it('falls back to the official MBTA colour for a known line without one', () => {
    expect(lineColor({ routeShortName: 'Orange' }).color).toBe('#ED8B00');
    expect(lineColor({ routeShortName: 'Blue' }).color).toBe('#003DA5');
    expect(lineColor({ routeShortName: 'C' }).color).toBe('#00843D');
  });

  it('never renders an unknown line as MBTA blue', () => {
    expect(lineColor({ routeShortName: '39' })).toEqual({ color: UNKNOWN_LINE_COLOR, known: false });
    expect(lineColor({ routeColor: 'not-a-colour' })).toEqual({ color: UNKNOWN_LINE_COLOR, known: false });
    expect(UNKNOWN_LINE_COLOR).not.toBe('#003DA5');
  });

  it('names lines readably', () => {
    expect(lineName({ routeShortName: 'Red', mode: 'subway' })).toBe('Red Line');
    expect(lineName({ routeShortName: 'B', mode: 'subway' })).toBe('Green Line B');
  });
});

describe('route geometry', () => {
  it('draws a Red → Green transfer as two segments in their own colours, in order', () => {
    const f = routeLineFeatures(TRANSFER_TRIP).features;
    expect(f.map((x) => [x.properties.kind, x.properties.color])).toEqual([
      ['ride', '#DA291C'],
      ['ride', '#00843D'],
    ]);
    expect(f[0].geometry.coordinates).toEqual(RED.geometry);
  });

  it('never draws straight-line walking estimates', () => {
    const f = routeLineFeatures(TRANSFER_TRIP).features;
    expect(f.some((x) => x.properties.kind === 'walk')).toBe(false);
    expect(isVerifiedWalkGeometry(TRANSFER_TRIP[0])).toBe(false);
  });

  it('draws walking legs as white dashes once their geometry is a verified pedestrian route', () => {
    // TEST FIXTURE: the proposed provenance marker for routed walking paths.
    const routed = walk([-71.12, 42.374], [-71.119, 42.373], 'pedestrian-route: TEST FIXTURE');
    routed.geometry = [[-71.12, 42.374], [-71.1195, 42.3738], [-71.119, 42.373]];
    expect(isVerifiedWalkGeometry(routed)).toBe(true);
    const f = routeLineFeatures([routed, RED]).features;
    expect(f[0].properties).toEqual({ kind: 'walk', color: '#FFFFFF', order: 0 });
    expect(f[0].geometry.coordinates).toHaveLength(3);
  });

  it('skips legs without usable geometry', () => {
    expect(routeLineFeatures([{ ...RED, geometry: [[-71, 42]] }]).features).toEqual([]);
  });

  it('marks boarding, transfer and exit stations with their line colours', () => {
    expect(routeStations(TRANSFER_TRIP).map((s) => [s.role, s.name, s.color])).toEqual([
      ['board', 'Harvard', '#DA291C'],
      ['transfer', 'Park Street', '#00843D'],
      ['exit', 'Kenmore', '#00843D'],
    ]);
  });

  it('bounds every drawn segment, station and the trip endpoints', () => {
    const b = routeBounds(TRANSFER_TRIP, [{ lat: 42.374, lng: -71.12 }, { lat: 42.347, lng: -71.097 }])!;
    expect(b).toEqual([[-71.12, 42.347], [-71.062, 42.374]]);
    expect(routeBounds([])).toBeNull();
  });
});

describe('route API responses', () => {
  const okBody = { status: 'ok', option: { durationSec: 1500, transfers: 1, legs: TRANSFER_TRIP }, lastTrainBack: null };

  it('accepts the server shapes and rejects malformed ones', () => {
    expect(isRouteResponse(okBody)).toBe(true);
    expect(isRouteResponse({ status: 'no_tier1_route', reason: 'same_stop' })).toBe(true);
    expect(isRouteResponse({ status: 'no_service', message: 'No trains' })).toBe(true);
    expect(isRouteResponse({ status: 'ok', option: { legs: 'nope' } })).toBe(false);
    expect(isRouteResponse({ status: 'weird' })).toBe(false);
    expect(isRouteResponse(null)).toBe(false);
    for (const geometry of [[[NaN, 42], [-71, 42]], [[-71, 142], [-71,42]], [null, null], [[-71,42]]]) {
      expect(isRouteResponse({ ...okBody, option: { ...okBody.option, legs: [{ ...RED, geometry }] } })).toBe(false);
    }
    expect(isRouteResponse({ ...okBody, timing: {kind: 'scheduled', departsAt: 'invalid'} })).toBe(false);
  });

  it('posts only the two points and returns the result', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    const r = await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, new AbortController().signal, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ kind: 'result', result: okBody });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/transit/route');
    expect(JSON.parse(init.body as string)).toEqual({ origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 } });
  });

  it('distinguishes an unreachable API from an invalid response', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect((await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, new AbortController().signal, down)).kind).toBe('error');
    const html = (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch;
    const r = await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, new AbortController().signal, html);
    expect(r).toMatchObject({ kind: 'error', reason: 'invalid_response' });
  });

  it('rethrows cancellation so a stale request is simply dropped', async () => {
    const abort = new AbortController();
    const slow = ((_: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))) as unknown as typeof fetch;
    const p = fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, abort.signal, slow);
    abort.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
