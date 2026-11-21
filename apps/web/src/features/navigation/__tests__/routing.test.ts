import { describe, expect, it } from 'vitest';
import { createApiRouteProvider, isValidEndpoint, placeIdFor, realPlaceId, toRouteResult, type RouteEndpoint } from '../routing';

const A: RouteEndpoint = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'discovery_origin' };
const B: RouteEndpoint = { label: 'Fixture Cafe', location: { lat: 42.3466, lng: -71.0972 }, source: 'map_place', placeId: 'node/1' };
const AT = '2026-11-21T20:00:00.000Z';

describe('endpoints', () => {
  it('needs a label and real coordinates', () => {
    expect(isValidEndpoint(A)).toBe(true);
    expect(isValidEndpoint(null)).toBe(false);
    expect(isValidEndpoint({ ...A, label: '  ' })).toBe(false);
    expect(isValidEndpoint({ ...A, location: { lat: NaN, lng: -71 } })).toBe(false);
    expect(isValidEndpoint({ ...A, location: { lat: 91, lng: -71 } })).toBe(false);
  });

  it('only treats real OSM element ids (or our catalog ids) as place ids', () => {
    expect(realPlaceId('node/123')).toBe('node/123');
    expect(realPlaceId('way/9')).toBe('way/9');
    expect(realPlaceId('tile/42.35,-71.06')).toBeUndefined();
    expect(realPlaceId('mbta:place-pktrm')).toBeUndefined();
    expect(realPlaceId(undefined)).toBeUndefined();
    expect(placeIdFor({ id: 'node/5', tags: {} })).toBe('node/5');
    expect(placeIdFor({ id: 'c0ffee', tags: { 'catalog:place_id': 'c0ffee' } })).toBe('c0ffee');
    expect(placeIdFor({ id: 'tile/1,2', tags: {} })).toBeUndefined();
  });
});

describe('route results', () => {
  it('maps each server status to a distinct, honest state', () => {
    expect(toRouteResult({ kind: 'result', result: { status: 'no_tier1_route', reason: 'same_stop' } }, 'P', AT)).toMatchObject({
      status: 'no_route',
      message: expect.stringContaining('same one'),
    });
    expect(toRouteResult({ kind: 'result', result: { status: 'no_service', message: 'Red is not running', nextScheduledDepartureAt: AT } }, 'P', AT)).toMatchObject({
      status: 'no_service',
      nextScheduledDepartureAt: AT,
    });
    expect(toRouteResult({ kind: 'result', result: { status: 'error', message: 'MBTA down' } }, 'P', AT)).toMatchObject({ status: 'error', reason: 'server' });
    expect(toRouteResult({ kind: 'error', reason: 'unreachable', message: 'x' }, 'P', AT)).toMatchObject({ status: 'error', reason: 'unreachable' });
    expect(toRouteResult({ kind: 'error', reason: 'invalid_response', message: 'x' }, 'P', AT)).toMatchObject({ status: 'error', reason: 'invalid_response' });
  });

  it('the API provider posts only the two coordinates', async () => {
    let body: unknown;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ status: 'no_tier1_route', reason: 'no_shared_pattern' }));
    }) as unknown as typeof fetch;
    const r = await createApiRouteProvider(fetchImpl, () => new Date(AT)).plan({ origin: A, destination: B }, new AbortController().signal);
    expect(body).toEqual({ origin: A.location, destination: B.location });
    expect(r).toMatchObject({ status: 'no_route', retrievedAt: AT });
  });
});
