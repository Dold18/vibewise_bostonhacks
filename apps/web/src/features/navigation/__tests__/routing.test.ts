import { describe, expect, it, vi } from 'vitest';
import type { LivePlanResult } from '../../transit/ride';
import type { TransitOption } from '../../transit/types';
import { createTransitRouteProvider, isValidEndpoint, realPlaceId, type RouteEndpoint } from '../routing';

const A: RouteEndpoint = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'discovery_origin' };
const B: RouteEndpoint = { label: 'Fixture Cafe', location: { lat: 42.3466, lng: -71.0972 }, source: 'map_place', placeId: 'node/1' };
const NOW = new Date('2026-11-21T20:00:00Z');

/** Shaped like transit's real results; values are test fixtures, not MBTA data. */
const OPTION: TransitOption = { id: 'fixture-option', durationSec: 900, transfers: 0, legs: [] };
const stop = { stop_id: 'place-x', name: 'X', lat: 42.35, lng: -71.06 };
const nearest = { stop, walkMeters: 100, walkSeconds: 75, source: 'estimate' as const };

describe('endpoints', () => {
  it('needs a label and real coordinates', () => {
    expect(isValidEndpoint(A)).toBe(true);
    expect(isValidEndpoint(null)).toBe(false);
    expect(isValidEndpoint({ ...A, label: '  ' })).toBe(false);
    expect(isValidEndpoint({ ...A, location: { lat: NaN, lng: -71 } })).toBe(false);
    expect(isValidEndpoint({ ...A, location: { lat: 91, lng: -71 } })).toBe(false);
  });

  it('only treats real OSM element ids as place ids', () => {
    expect(realPlaceId('node/123')).toBe('node/123');
    expect(realPlaceId('way/9')).toBe('way/9');
    expect(realPlaceId('tile/42.35,-71.06')).toBeUndefined();
    expect(realPlaceId('mbta:place-pktrm')).toBeUndefined();
    expect(realPlaceId(undefined)).toBeUndefined();
  });
});

describe('transit adapter (prepared, not wired into the app)', () => {
  const provider = (result: LivePlanResult | Error) => {
    const planTripLive = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    return { planTripLive, routes: createTransitRouteProvider(planTripLive, () => NOW) };
  };

  it('passes only coordinates (no invented place ids) to planTripLive', async () => {
    const { planTripLive, routes } = provider({ status: 'no_tier1_route', reason: 'same_stop', originStop: stop, destinationStop: stop });
    await routes.plan({ origin: A, destination: B });
    expect(planTripLive).toHaveBeenCalledWith(A.location, B.location, { now: NOW });
  });

  it('maps ok to the contract option unchanged', async () => {
    const ok = {
      status: 'ok',
      tier: 1,
      option: OPTION,
      lastTrainBack: null,
      plan: {},
      timing: {},
      service: {},
    } as unknown as LivePlanResult;
    expect(await provider(ok).routes.plan({ origin: A, destination: B })).toEqual({
      status: 'ok',
      options: [OPTION],
      provider: 'MBTA V3 (subway, tiered)',
      retrievedAt: NOW.toISOString(),
    });
  });

  it('maps no route, no service and errors to messages without inventing anything', async () => {
    const noRoute = await provider({ status: 'no_tier1_route', reason: 'no_valid_hub', originStop: stop, destinationStop: stop }).routes.plan({ origin: A, destination: B });
    expect(noRoute).toMatchObject({ status: 'no_route', message: expect.stringMatching(/one transfer/) });
    expect(noRoute).not.toHaveProperty('options');

    const noService = await provider({ status: 'no_service', message: 'No Red Line service now', originStop: nearest, destinationStop: nearest, checkedAt: NOW.toISOString() }).routes.plan({ origin: A, destination: B });
    expect(noService).toMatchObject({ status: 'no_service', message: 'No Red Line service now' });

    const error = await provider({ status: 'error', message: 'MBTA unavailable', originStop: nearest, destinationStop: nearest, checkedAt: NOW.toISOString() }).routes.plan({ origin: A, destination: B });
    expect(error).toMatchObject({ status: 'error', message: 'MBTA unavailable' });

    const thrown = await provider(new Error('network down')).routes.plan({ origin: A, destination: B });
    expect(thrown).toMatchObject({ status: 'error', message: 'Routing failed: network down' });
  });
});
