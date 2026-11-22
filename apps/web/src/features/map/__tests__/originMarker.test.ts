import { describe, expect, it } from 'vitest';
import {
  createOriginMarker,
  haloRadiusPx,
  hasAccuracyHalo,
  MAX_HALO_PX,
  metersPerPixelAt,
  recenterTarget,
  shouldRevealOrigin,
  type OriginLike,
  type OriginMarkerDeps,
} from '../originMarker';

/** Fake map: records markers instead of drawing them. */
function fakeMap(mpp = 1) {
  const markers: { el: HTMLElement; lngLat: [number, number]; flat: boolean; removed: boolean }[] = [];
  const zoomListeners = new Set<() => void>();
  let metersPerPixel = mpp;
  const deps: OriginMarkerDeps = {
    addMarker(el, lngLat, flat) {
      const m = { el, lngLat, flat, removed: false };
      markers.push(m);
      return { setLngLat: (ll) => void (m.lngLat = ll), remove: () => void (m.removed = true) };
    },
    metersPerPixel: () => metersPerPixel,
    onZoom: (l) => {
      zoomListeners.add(l);
      return () => zoomListeners.delete(l);
    },
  };
  const live = () => markers.filter((m) => !m.removed);
  const zoomTo = (newMpp: number) => {
    metersPerPixel = newMpp;
    zoomListeners.forEach((l) => l());
  };
  return { deps, markers, live, zoomTo, zoomListeners };
}

// Minimal DOM for marker elements (tests run in Node).
class FakeEl {
  className = '';
  innerHTML = '';
  title = '';
  hidden = false;
  attrs = new Map<string, string>();
  style = { props: new Map<string, string>(), setProperty(k: string, v: string) { this.props.set(k, v); } };
  classList = { set: new Set<string>(), toggle(c: string, on: boolean) { if (on) this.set.add(c); else this.set.delete(c); } };
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
}
globalThis.document ??= { createElement: () => new FakeEl() } as unknown as Document;

const KENMORE: OriginLike = { label: 'Kenmore station', location: { lat: 42.348949, lng: -71.095169 }, source: 'local_suggestion' };
const PARK: OriginLike = { label: 'Park Street station', location: { lat: 42.35639, lng: -71.0624 }, source: 'local_suggestion' };
const GPS: OriginLike = { label: 'Current location', location: { lat: 42.3505, lng: -71.1054 }, source: 'device_geolocation', accuracyMeters: 30 };

describe('origin marker lifecycle', () => {
  it('creates nothing until an origin is selected', () => {
    const map = fakeMap();
    const marker = createOriginMarker(map.deps);
    expect(marker.update(null)).toBe('unchanged');
    expect(map.markers).toHaveLength(0);
  });

  it('creates one dot, moves it on change, and removes it when cleared', () => {
    const map = fakeMap();
    const marker = createOriginMarker(map.deps);
    expect(marker.update(KENMORE)).toBe('created');
    expect(map.live()).toHaveLength(1);
    expect(map.live()[0].lngLat).toEqual([-71.095169, 42.348949]);
    expect(map.live()[0].flat).toBe(false);

    expect(marker.update(PARK)).toBe('moved');
    expect(map.markers).toHaveLength(1); // moved, not recreated
    expect(map.live()[0].lngLat).toEqual([-71.0624, 42.35639]);

    expect(marker.update({ ...PARK })).toBe('unchanged');
    expect(marker.update(null)).toBe('removed');
    expect(map.live()).toHaveLength(0);
  });

  it('labels manual origins as a starting point, not a live position', () => {
    const map = fakeMap();
    createOriginMarker(map.deps).update(KENMORE);
    const el = map.live()[0].el as unknown as FakeEl;
    expect(el.attrs.get('aria-label')).toBe('Starting point: Kenmore station');
    expect(el.classList.set.has('is-device')).toBe(false);
  });

  it('adds a flat accuracy halo only for a real browser geolocation fix', () => {
    expect(hasAccuracyHalo(KENMORE)).toBe(false);
    expect(hasAccuracyHalo({ ...KENMORE, accuracyMeters: 30 })).toBe(false); // manual origin with a stray accuracy: still no halo
    expect(hasAccuracyHalo(GPS)).toBe(true);

    const map = fakeMap(0.5);
    const marker = createOriginMarker(map.deps);
    marker.update(GPS);
    const halo = map.live().find((m) => m.flat)!;
    expect(halo).toBeDefined();
    expect((halo.el as unknown as FakeEl).style.props.get('--halo-size')).toBe('120.0px'); // 30 m / 0.5 m/px = 60 px radius

    map.zoomTo(1); // zooming out halves the halo
    expect((halo.el as unknown as FakeEl).style.props.get('--halo-size')).toBe('60.0px');

    marker.update(KENMORE); // switching to a manual origin removes the halo
    expect(map.live().filter((m) => m.flat)).toHaveLength(0);
  });

  it('destroy removes markers and stops listening to zoom', () => {
    const map = fakeMap();
    const marker = createOriginMarker(map.deps);
    marker.update(GPS);
    marker.destroy();
    expect(map.live()).toHaveLength(0);
    expect(map.zoomListeners.size).toBe(0);
  });
});

describe('halo size', () => {
  it('hides a halo smaller than the dot and caps very large ones', () => {
    expect(haloRadiusPx(5, 1)).toBe(0);
    expect(haloRadiusPx(50, 1)).toBe(50);
    expect(haloRadiusPx(10_000, 1)).toBe(MAX_HALO_PX);
  });

  it('uses Web Mercator meters per pixel for 512px tiles', () => {
    // At the equator, zoom 0: 40,075,016.686 m / 512 px.
    expect(metersPerPixelAt(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metersPerPixelAt(42.35, 16)).toBeCloseTo(metersPerPixelAt(42.35, 15) / 2, 6);
  });
});

describe('camera helpers', () => {
  it('reveals a new or moved origin only when it is off-screen', () => {
    expect(shouldRevealOrigin('created', false)).toBe(true);
    expect(shouldRevealOrigin('moved', false)).toBe(true);
    expect(shouldRevealOrigin('moved', true)).toBe(false);
    expect(shouldRevealOrigin('unchanged', false)).toBe(false);
    expect(shouldRevealOrigin('removed', false)).toBe(false);
  });

  it('recenters on the starting point, or the default view without one', () => {
    const BOSTON = { lng: -71.0636, lat: 42.3555 };
    expect(recenterTarget(KENMORE, BOSTON)).toEqual({ center: [-71.095169, 42.348949], isOrigin: true });
    expect(recenterTarget(null, BOSTON)).toEqual({ center: [-71.0636, 42.3555], isOrigin: false });
  });
});
