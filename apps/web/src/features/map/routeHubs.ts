import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { vwIconHtml } from '../../design/vibewise/icons';
import type { RouteStation } from '../../transitRoute';
export interface HubMarker { setLngLat(p: [number, number]): unknown; remove(): void }
/** A keyed marker set: collapse/reopen reuses hubs; route changes and exit remove obsolete hubs. */
export function createRouteHubs(map: MapLibreMap, add: (el: HTMLElement, p: [number, number]) => HubMarker = (el, p) => new Marker({ element: el }).setLngLat(p).addTo(map)) {
  const markers = new Map<string, { marker: HubMarker; el: HTMLElement; caption: HTMLElement }>();
  return {
    update(stations: RouteStation[]) {
      const keys = new Set<string>();
      for (const [index, station] of stations.entries()) {
        const key = station.id ?? `${station.name}:${station.lng.toFixed(5)}:${station.lat.toFixed(5)}`;
        if (keys.has(key)) continue;
        keys.add(key);
        let entry = markers.get(key);
        if (!entry) {
          const el = document.createElement('div'); el.className = 'vb-route-hub'; el.setAttribute('role', 'img'); el.tabIndex = 0;
          el.innerHTML = vwIconHtml('train', { size: 18 });
          const caption = document.createElement('span'); caption.className = 'vb-hub-label'; caption.setAttribute('aria-hidden', 'true'); el.append(caption);
          entry = { el, caption, marker: add(el, [station.lng, station.lat]) }; markers.set(key, entry);
        }
        entry.marker.setLngLat([station.lng, station.lat]);
        entry.el.classList.toggle('is-transfer', station.role === 'transfer');
        entry.el.classList.toggle('label-above', station.role === 'transfer' && index % 2 === 0);
        entry.el.style.setProperty('--hub-color', station.color);
        const label = `${station.role === 'board' ? 'Boarding' : station.role === 'exit' ? 'Exit' : 'Transfer'} station: ${station.name}`;
        entry.caption.textContent = station.name;
        entry.el.setAttribute('aria-label', label); entry.el.title = label;
      }
      for (const [key, entry] of markers) if (!keys.has(key)) { entry.marker.remove(); markers.delete(key); }
    },
  };
}
