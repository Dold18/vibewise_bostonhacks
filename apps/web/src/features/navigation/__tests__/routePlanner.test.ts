import { describe, expect, it, vi } from 'vitest';
import { initialPreferences, preferencesReducer } from '../../../discovery/preferences';
import { createStore } from '../../../discovery/store';
import { canRoute, initialPlannerState, requestRoutes, routePlannerReducer, type RoutePlannerAction } from '../routePlanner';
import type { RouteEndpoint, RouteProvider, RouteResult } from '../routing';
import { originToEndpoint } from '../ui/routePlannerView';

const FROM: RouteEndpoint = { label: 'Kenmore station', location: { lat: 42.348949, lng: -71.095169 }, source: 'discovery_origin' };
const TO: RouteEndpoint = { label: 'Fixture Cafe', location: { lat: 42.3555, lng: -71.0636 }, source: 'map_place', placeId: 'node/1' };
const OTHER: RouteEndpoint = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'local_suggestion' };
const run = (...actions: RoutePlannerAction[]) => actions.reduce(routePlannerReducer, initialPlannerState());
const OK: RouteResult = { status: 'ok', options: [], provider: 'fake', retrievedAt: '2026-11-21T20:00:00Z' };

describe('opening the planner', () => {
  it('uses the given defaults', () => {
    const s = run({ type: 'open', from: FROM, to: TO });
    expect(s).toMatchObject({ open: true, from: FROM, to: TO, status: { kind: 'idle' } });
  });

  it('leaves a missing default empty', () => {
    expect(run({ type: 'open', from: null, to: TO })).toMatchObject({ from: null, to: TO });
    expect(canRoute(run({ type: 'open', from: null, to: TO }))).toBe(false);
  });

  it('rejects a default without valid coordinates', () => {
    const bad = { ...FROM, location: { lat: NaN, lng: 0 } };
    expect(run({ type: 'open', from: bad, to: TO }).from).toBeNull();
  });

  it('copies defaults so planner edits never touch the source objects', () => {
    const source = { ...FROM, location: { ...FROM.location } };
    const s = run({ type: 'open', from: source, to: TO });
    expect(s.from).toEqual(source);
    expect(s.from).not.toBe(source);
    expect(s.from!.location).not.toBe(source.location);
  });
});

describe('editing endpoints', () => {
  it('edits From and To independently', () => {
    const s = run({ type: 'open', from: FROM, to: TO }, { type: 'setFrom', endpoint: OTHER });
    expect(s.from).toEqual(OTHER);
    expect(s.to).toEqual(TO);
    expect(run({ type: 'open', from: FROM, to: TO }, { type: 'setTo', endpoint: OTHER })).toMatchObject({ from: FROM, to: OTHER });
  });

  it('ignores an endpoint without coordinates (a typed label alone is not a location)', () => {
    const typed = { label: 'somewhere I typed', location: undefined as unknown as RouteEndpoint['location'], source: 'typed' };
    expect(run({ type: 'open', from: FROM, to: TO }, { type: 'setTo', endpoint: typed }).to).toBeNull();
  });

  it('swap exchanges labels and coordinates', () => {
    const s = run({ type: 'open', from: FROM, to: TO }, { type: 'swap' });
    expect(s.from).toEqual(TO);
    expect(s.to).toEqual(FROM);
  });

  it('every edit invalidates earlier results', () => {
    const s = run({ type: 'open', from: FROM, to: TO });
    expect(run({ type: 'open', from: FROM, to: TO }, { type: 'swap' }).generation).toBe(s.generation + 1);
  });
});

describe('separation from discovery preferences', () => {
  it('editing the planner never changes the saved starting point', () => {
    let prefs = preferencesReducer(initialPreferences(), {
      type: 'setOrigin',
      origin: { label: 'Kenmore station', location: { lat: 42.348949, lng: -71.095169 }, source: 'local_suggestion' },
    });
    const before = JSON.stringify(prefs);
    const defaultFrom: RouteEndpoint = { label: prefs.origin!.label, location: prefs.origin!.location, source: 'discovery_origin' };
    let s = run({ type: 'open', from: defaultFrom, to: TO });
    s = routePlannerReducer(s, { type: 'setFrom', endpoint: OTHER });
    s = routePlannerReducer(s, { type: 'swap' });
    s.to!.location.lat = 0; // even mutating planner state can't reach the preference
    expect(JSON.stringify(prefs)).toBe(before);
    prefs = preferencesReducer(prefs, { type: 'setBudget', choice: 'under_25' });
    expect(s.from).toEqual(TO);
  });

  it('converts location-field picks to endpoints, keeping only real place ids', () => {
    expect(originToEndpoint({ label: 'Fixture', location: { lat: 1, lng: 2 }, source: 'map_place', sourceRef: 'node/5' })).toEqual({
      label: 'Fixture',
      location: { lat: 1, lng: 2 },
      source: 'map_place',
      placeId: 'node/5',
    });
    expect(originToEndpoint({ label: 'Tile', location: { lat: 1, lng: 2 }, source: 'map_place', sourceRef: 'tile/1,2' })).not.toHaveProperty('placeId');
    expect(originToEndpoint({ label: 'Kenmore', location: { lat: 1, lng: 2 }, source: 'local_suggestion', sourceRef: 'mbta:place-kencl' })).not.toHaveProperty('placeId');
  });
});

describe('routing requests', () => {
  it('opening the planner never requests routes', () => {
    const plan = vi.fn();
    const store = createStore(routePlannerReducer, initialPlannerState());
    store.dispatch({ type: 'open', from: FROM, to: TO });
    expect(plan).not.toHaveBeenCalled();
    expect(store.getState().status).toEqual({ kind: 'idle' });
  });

  it('without a provider: "not connected", no request, no results', async () => {
    const store = createStore(routePlannerReducer, run({ type: 'open', from: FROM, to: TO }));
    await requestRoutes(store.getState, store.dispatch, null);
    expect(store.getState().status).toEqual({ kind: 'not_connected' });
  });

  it('does nothing until both endpoints are valid', async () => {
    const provider: RouteProvider = { name: 'fake', plan: vi.fn(async () => OK) };
    const store = createStore(routePlannerReducer, run({ type: 'open', from: null, to: TO }));
    await requestRoutes(store.getState, store.dispatch, provider);
    expect(provider.plan).not.toHaveBeenCalled();
  });

  it('applies a result for the current endpoints', async () => {
    const provider: RouteProvider = { name: 'fake', plan: vi.fn(async () => OK) };
    const store = createStore(routePlannerReducer, run({ type: 'open', from: FROM, to: TO }));
    await requestRoutes(store.getState, store.dispatch, provider);
    expect(provider.plan).toHaveBeenCalledWith({ origin: FROM, destination: TO });
    expect(store.getState().status).toMatchObject({ kind: 'done', result: OK });
  });

  it('ignores a stale result after the endpoints change (requests are not cancellable)', async () => {
    let resolve!: (r: RouteResult) => void;
    const provider: RouteProvider = { name: 'fake', plan: () => new Promise((r) => (resolve = r)) };
    const store = createStore(routePlannerReducer, run({ type: 'open', from: FROM, to: TO }));
    const pending = requestRoutes(store.getState, store.dispatch, provider);
    store.dispatch({ type: 'swap' });
    resolve(OK);
    await pending;
    expect(store.getState().status).toEqual({ kind: 'idle' });
  });

  it('ignores a result that arrives after the planner closed', async () => {
    let resolve!: (r: RouteResult) => void;
    const provider: RouteProvider = { name: 'fake', plan: () => new Promise((r) => (resolve = r)) };
    const store = createStore(routePlannerReducer, run({ type: 'open', from: FROM, to: TO }));
    const pending = requestRoutes(store.getState, store.dispatch, provider);
    store.dispatch({ type: 'close' });
    resolve(OK);
    await pending;
    expect(store.getState()).toMatchObject({ open: false, status: { kind: 'idle' } });
  });
});
