import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../../../discovery/store';
import type { RouteEndpoint, RouteProvider, RouteResult } from '../routing';
import { canRoute, createTripRouter, initialTripState, missingEndpoint, needsRoute, tripReducer, type TripAction, type TripState } from '../trip';

const PARK: RouteEndpoint = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'discovery_origin' };
const KENMORE: RouteEndpoint = { label: 'Kenmore station', location: { lat: 42.348949, lng: -71.095169 }, source: 'local_suggestion' };
const CAFE: RouteEndpoint = { label: 'Fixture Cafe', location: { lat: 42.3466, lng: -71.0972 }, source: 'map_place', placeId: 'node/1' };
const MUSEUM: RouteEndpoint = { label: 'Fixture Museum', location: { lat: 42.3394, lng: -71.0940 }, source: 'map_place' };

const run = (...actions: TripAction[]) => actions.reduce(tripReducer, initialTripState());

describe('Search defaults', () => {
  it('opens with both fields empty when nothing is selected', () => {
    const s = run({ type: 'openSearch', discoveryOrigin: null, selectedPlace: null });
    expect(s).toMatchObject({ searchOpen: true, navigationOpen: false, from: null, to: null });
  });

  it('fills the starting location from the discovery panel', () => {
    expect(run({ type: 'openSearch', discoveryOrigin: PARK, selectedPlace: null }).from).toEqual(PARK);
  });

  it("fills the destination from the open popup's place, keeping its id", () => {
    expect(run({ type: 'openSearch', discoveryOrigin: null, selectedPlace: CAFE }).to).toEqual(CAFE);
  });

  it('fills both when both exist, and never requests a route', () => {
    const s = run({ type: 'openSearch', discoveryOrigin: PARK, selectedPlace: CAFE });
    expect([s.from?.label, s.to?.label]).toEqual(['Park Street station', 'Fixture Cafe']);
    expect(canRoute(s)).toBe(true);
    expect(needsRoute(s)).toBe(false); // filling both fields in Search is not navigation
  });

  it('copies defaults so later edits never reach the discovery preference', () => {
    const origin = { ...PARK, location: { ...PARK.location } };
    const s = run({ type: 'openSearch', discoveryOrigin: origin, selectedPlace: null }, { type: 'setFrom', endpoint: KENMORE });
    expect(s.from?.label).toBe('Kenmore station');
    expect(origin.label).toBe('Park Street station');
  });

  it('edits each field independently and swaps labels and coordinates', () => {
    let s = run({ type: 'openSearch', discoveryOrigin: PARK, selectedPlace: CAFE });
    s = tripReducer(s, { type: 'setTo', endpoint: MUSEUM });
    expect([s.from?.label, s.to?.label]).toEqual(['Park Street station', 'Fixture Museum']);
    s = tripReducer(s, { type: 'swap' });
    expect(s.from).toEqual(MUSEUM);
    expect(s.to).toEqual(PARK);
  });

  it('rejects typed text without coordinates as an endpoint', () => {
    const s = run({ type: 'setFrom', endpoint: { label: 'somewhere', location: { lat: NaN, lng: NaN }, source: 'typed' } });
    expect(s.from).toBeNull();
  });
});

describe('Navigate defaults', () => {
  it('with a discovery starting point: both endpoints filled, routing wanted', () => {
    const s = run({ type: 'navigateTo', destination: CAFE, discoveryOrigin: PARK });
    expect(s).toMatchObject({ navigationOpen: true, from: PARK, to: CAFE });
    expect(needsRoute(s)).toBe(true);
  });

  it('without any starting point: navigation opens, destination filled, start empty, no route', () => {
    const s = run({ type: 'navigateTo', destination: CAFE, discoveryOrigin: null });
    expect(s).toMatchObject({ navigationOpen: true, from: null, to: CAFE });
    expect(missingEndpoint(s)).toBe('from');
    expect(needsRoute(s)).toBe(false);
  });

  it('never invents a starting point (no Boston Common)', () => {
    expect(run({ type: 'navigateTo', destination: CAFE, discoveryOrigin: null }).from).toBeNull();
  });

  it("prefers a starting location the user picked in Search over the panel's", () => {
    const s = run(
      { type: 'openSearch', discoveryOrigin: PARK, selectedPlace: null },
      { type: 'setFrom', endpoint: KENMORE },
      { type: 'closeSearch' },
      { type: 'navigateTo', destination: CAFE, discoveryOrigin: PARK },
    );
    expect(s.from?.label).toBe('Kenmore station');
  });

  it('Get directions navigates between the chosen endpoints, only when both are valid', () => {
    const half = run({ type: 'openSearch', discoveryOrigin: null, selectedPlace: CAFE }, { type: 'getDirections' });
    expect(half.navigationOpen).toBe(false);
    const s = run({ type: 'openSearch', discoveryOrigin: PARK, selectedPlace: CAFE }, { type: 'getDirections' });
    expect(s).toMatchObject({ navigationOpen: true, directionsExpanded: true, searchOpen: false, from: PARK, to: CAFE });
    expect(needsRoute(s)).toBe(true);
  });

  it('Search opened during navigation keeps the live trip', () => {
    const nav = run({ type: 'navigateTo', destination: CAFE, discoveryOrigin: PARK });
    const s = tripReducer(nav, { type: 'openSearch', discoveryOrigin: null, selectedPlace: MUSEUM });
    expect(s).toMatchObject({ navigationOpen: true, searchOpen: true, from: PARK, to: CAFE, generation: nav.generation });
    expect(tripReducer(s, { type: 'closeSearch' }).navigationOpen).toBe(true);
  });
});

describe('route lifecycle', () => {
  const ok: RouteResult = { status: 'no_route', message: 'fixture', provider: 'P', retrievedAt: 'now' };

  it('ignores a late answer for old endpoints', () => {
    let s = run({ type: 'navigateTo', destination: CAFE, discoveryOrigin: PARK });
    const old = s.generation;
    s = tripReducer(s, { type: 'requestStarted', generation: old });
    s = tripReducer(s, { type: 'setTo', endpoint: MUSEUM }); // endpoints changed mid-request
    expect(s.route.kind).toBe('idle');
    expect(tripReducer(s, { type: 'resultArrived', generation: old, result: ok })).toBe(s);
  });

  it('ignores answers after navigation ends', () => {
    let s = run({ type: 'navigateTo', destination: CAFE, discoveryOrigin: PARK });
    s = tripReducer(s, { type: 'requestStarted', generation: s.generation });
    const ended = tripReducer(s, { type: 'endNavigation' });
    expect(tripReducer(ended, { type: 'resultArrived', generation: s.generation, result: ok })).toBe(ended);
  });

  function fakeProvider() {
    const calls: { signal: AbortSignal; resolve: (r: RouteResult) => void }[] = [];
    const provider: RouteProvider = {
      name: 'fake',
      plan: (_req, signal) =>
        new Promise((resolve, reject) => {
          calls.push({ signal, resolve });
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    };
    return { provider, calls };
  }

  it('requests only while navigating with both endpoints, and aborts superseded requests', async () => {
    const store = createStore(tripReducer, initialTripState() as TripState);
    const { provider, calls } = fakeProvider();
    const router = createTripRouter(store, provider);

    store.dispatch({ type: 'openSearch', discoveryOrigin: PARK, selectedPlace: CAFE });
    expect(calls).toHaveLength(0); // Search never routes

    store.dispatch({ type: 'getDirections' });
    expect(calls).toHaveLength(1);
    expect(store.getState().route.kind).toBe('loading');

    store.dispatch({ type: 'setTo', endpoint: MUSEUM }); // new endpoint: old request aborted, new one sent
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);

    calls[1].resolve(ok);
    await vi.waitFor(() => expect(store.getState().route.kind).toBe('done'));

    store.dispatch({ type: 'endNavigation' });
    store.dispatch({ type: 'setFrom', endpoint: KENMORE });
    expect(calls).toHaveLength(2); // nothing while not navigating
    router.dispose();
  });

  it('waits for a missing starting location, then routes once it is chosen', () => {
    const store = createStore(tripReducer, initialTripState() as TripState);
    const { provider, calls } = fakeProvider();
    createTripRouter(store, provider);
    store.dispatch({ type: 'navigateTo', destination: CAFE, discoveryOrigin: null });
    expect(calls).toHaveLength(0);
    store.dispatch({ type: 'setFrom', endpoint: KENMORE });
    expect(calls).toHaveLength(1);
  });

  it('ending navigation aborts the in-flight request', () => {
    const store = createStore(tripReducer, initialTripState() as TripState);
    const { provider, calls } = fakeProvider();
    createTripRouter(store, provider);
    store.dispatch({ type: 'navigateTo', destination: CAFE, discoveryOrigin: PARK });
    store.dispatch({ type: 'endNavigation' });
    expect(calls[0].signal.aborted).toBe(true);
    expect(store.getState().route.kind).toBe('idle');
  });

  it('turns a thrown provider error into an error state', async () => {
    const store = createStore(tripReducer, initialTripState() as TripState);
    createTripRouter(store, { name: 'boom', plan: async () => Promise.reject(new Error('socket hang up')) });
    store.dispatch({ type: 'navigateTo', destination: CAFE, discoveryOrigin: PARK });
    await vi.waitFor(() => expect(store.getState().route).toMatchObject({ kind: 'done', result: { status: 'error', message: 'socket hang up' } }));
  });
});

describe('Directions presentation is independent of navigation', () => {
  it('opens Directions immediately for resolved endpoints and for a missing origin', () => {
    expect(run({type:'navigateTo',destination:CAFE,discoveryOrigin:PARK}).directionsExpanded).toBe(true);
    expect(run({type:'navigateTo',destination:CAFE,discoveryOrigin:null}).directionsExpanded).toBe(true);
  });
  it('collapsing and expanding leaves the in-flight request and generation intact', () => {
    let s = run({type:'navigateTo',destination:CAFE,discoveryOrigin:PARK});
    s=tripReducer(s,{type:'requestStarted',generation:s.generation});
    const expanded=tripReducer(s,{type:'setDirectionsExpanded',expanded:true});
    const collapsed=tripReducer(expanded,{type:'setDirectionsExpanded',expanded:false});
    expect(collapsed.navigationOpen).toBe(true); expect(collapsed.route).toBe(s.route); expect(collapsed.generation).toBe(s.generation);
  });
  it('collapse does not abort or duplicate requests; Exit does', () => {
    const store=createStore(tripReducer,initialTripState());
    let signal: AbortSignal | undefined;
    const plan=vi.fn((_r, s: AbortSignal)=> { signal=s; return new Promise<RouteResult>(()=>{}); });
    const router=createTripRouter(store,{name:'TEST FIXTURE',plan});
    store.dispatch({type:'navigateTo',destination:CAFE,discoveryOrigin:PARK});
    store.dispatch({type:'setDirectionsExpanded',expanded:true});
    store.dispatch({type:'setDirectionsExpanded',expanded:false});
    expect(signal!.aborted).toBe(false);expect(plan).toHaveBeenCalledOnce();
    store.dispatch({type:'endNavigation'});expect(signal!.aborted).toBe(true);expect(store.getState().directionsExpanded).toBe(false);
    router.dispose();
  });
});
