/**
 * The starting-point marker: a blue dot with a white ring, separate from the
 * destination pins (clearing or reloading pins never touches it).
 *
 * - Every origin gets the dot. Only a real browser geolocation fix also gets
 *   an accuracy halo, sized from the reported accuracy at the current zoom.
 *   A manually chosen station or landmark never looks like a GPS position.
 * - The fix is a one-time reading, not live tracking, so nothing pulses.
 *
 * Map access is injected (`OriginMarkerDeps`) so the lifecycle is testable
 * without WebGL; `mapLibreOriginDeps(map)` is the real implementation.
 */
import { Marker, type Map as MapLibreMap } from 'maplibre-gl';

export interface OriginLike {
  label: string;
  location: { lat: number; lng: number };
  source: string;
  accuracyMeters?: number;
}

export interface MarkerHandle {
  setLngLat(lngLat: [number, number]): void;
  remove(): void;
}

export interface OriginMarkerDeps {
  /** `flat`: lie on the ground plane (the halo); otherwise face the camera (the dot). */
  addMarker(el: HTMLElement, lngLat: [number, number], flat: boolean): MarkerHandle;
  metersPerPixel(lat: number): number;
  /** Subscribe to zoom changes; returns an unsubscribe. */
  onZoom(listener: () => void): () => void;
}

export type OriginUpdate = 'created' | 'moved' | 'removed' | 'unchanged';

/** Largest halo drawn, in px; bigger accuracies are drawn at this size. */
export const MAX_HALO_PX = 600;
const DOT_RADIUS_PX = 8;

export const hasAccuracyHalo = (o: OriginLike | null): boolean =>
  !!o && o.source === 'device_geolocation' && typeof o.accuracyMeters === 'number' && o.accuracyMeters > 0;

/** Halo radius in px, or 0 when it would hide under the dot. */
export function haloRadiusPx(accuracyMeters: number, metersPerPixel: number): number {
  const px = accuracyMeters / metersPerPixel;
  return px <= DOT_RADIUS_PX ? 0 : Math.min(MAX_HALO_PX, px);
}

const sameSpot = (a: OriginLike, b: OriginLike) => a.location.lat === b.location.lat && a.location.lng === b.location.lng;

export function createOriginMarker(deps: OriginMarkerDeps) {
  let current: OriginLike | null = null;
  let dot: MarkerHandle | null = null;
  let halo: { handle: MarkerHandle; el: HTMLElement } | null = null;
  let dotEl: HTMLElement | null = null;

  const lngLat = (o: OriginLike): [number, number] => [o.location.lng, o.location.lat];

  const sizeHalo = () => {
    if (!halo || !current || !hasAccuracyHalo(current)) return;
    const r = haloRadiusPx(current.accuracyMeters!, deps.metersPerPixel(current.location.lat));
    halo.el.style.setProperty('--halo-size', `${(r * 2).toFixed(1)}px`);
    halo.el.hidden = r === 0;
  };
  const stopZoom = deps.onZoom(sizeHalo);

  function syncHalo(o: OriginLike) {
    if (hasAccuracyHalo(o)) {
      if (!halo) {
        const el = document.createElement('div');
        el.className = 'vb-origin-halo';
        el.setAttribute('aria-hidden', 'true');
        halo = { el, handle: deps.addMarker(el, lngLat(o), true) };
      } else {
        halo.handle.setLngLat(lngLat(o));
      }
      sizeHalo();
    } else if (halo) {
      halo.handle.remove();
      halo = null;
    }
  }

  function label(o: OriginLike) {
    return o.source === 'device_geolocation' ? `Starting point: your location (${o.label})` : `Starting point: ${o.label}`;
  }

  return {
    update(o: OriginLike | null): OriginUpdate {
      if (!o) {
        if (!current) return 'unchanged';
        dot?.remove();
        halo?.handle.remove();
        dot = halo = null;
        dotEl = null;
        current = null;
        return 'removed';
      }
      const prev = current;
      current = { ...o, location: { ...o.location } };
      if (!dot) {
        dotEl = document.createElement('div');
        dotEl.className = 'vb-origin';
        dotEl.setAttribute('role', 'img');
        dotEl.innerHTML = '<span class="vb-origin-dot"></span>';
        dot = deps.addMarker(dotEl, lngLat(o), false);
      }
      dotEl!.setAttribute('aria-label', label(o));
      dotEl!.title = label(o);
      dotEl!.classList.toggle('is-device', o.source === 'device_geolocation');
      syncHalo(current);
      if (!prev) return 'created';
      if (!sameSpot(prev, o)) {
        dot.setLngLat(lngLat(o));
        return 'moved';
      }
      return 'unchanged';
    },
    current: () => current,
    destroy() {
      stopZoom();
      dot?.remove();
      halo?.handle.remove();
      dot = halo = null;
      current = null;
    },
  };
}

/** Bring a newly chosen origin into view only if it moved and is off-screen. */
export function shouldRevealOrigin(update: OriginUpdate, inView: boolean): boolean {
  return (update === 'created' || update === 'moved') && !inView;
}

/** Recenter target: the starting point if set, else the default view. Never asks for location. */
export function recenterTarget(
  origin: OriginLike | null,
  fallback: { lng: number; lat: number },
): { center: [number, number]; isOrigin: boolean } {
  return origin
    ? { center: [origin.location.lng, origin.location.lat], isOrigin: true }
    : { center: [fallback.lng, fallback.lat], isOrigin: false };
}

/** Web Mercator meters per CSS pixel for MapLibre's 512px world tiles. */
export const metersPerPixelAt = (lat: number, zoom: number) =>
  (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

export function mapLibreOriginDeps(map: MapLibreMap): OriginMarkerDeps {
  return {
    addMarker(el, lngLat, flat) {
      return new Marker({
        element: el,
        anchor: 'center',
        pitchAlignment: flat ? 'map' : 'viewport',
        rotationAlignment: flat ? 'map' : 'viewport',
      })
        .setLngLat(lngLat)
        .addTo(map);
    },
    metersPerPixel: (lat) => metersPerPixelAt(lat, map.getZoom()),
    onZoom(listener) {
      map.on('zoom', listener);
      return () => map.off('zoom', listener);
    },
  };
}
