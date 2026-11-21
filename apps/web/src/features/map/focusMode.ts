import type { Map as MapLibreMap } from 'maplibre-gl';
export type FocusMode = 'discovery' | 'search' | 'navigation';
export const deriveFocusMode = (s: { navigationOpen: boolean; searchOpen: boolean }): FocusMode => s.navigationOpen ? 'navigation' : s.searchOpen ? 'search' : 'discovery';
export const FOCUS_LAYER = 'vb-map-focus';
export const FOCUS_OPACITY = { discovery: 0, search: 0.23, navigation: 0.36 };
export function createFocusController(map: MapLibreMap, pitch: { lock(): void; unlock(): void }) {
  let current: FocusMode = 'discovery';
  let ready = map.isStyleLoaded();
  function syncLayer() {
    if (!ready) return;
    const layers = map.getStyle().layers ?? [];
    const before = layers.find(l => l.id.startsWith('transit-route-') || l.type === 'symbol')?.id;
    if (!map.getSource(FOCUS_LAYER)) map.addSource(FOCUS_LAYER, { type: 'geojson', data: {
      type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]] },
    } });
    if (!map.getLayer(FOCUS_LAYER)) map.addLayer({ id: FOCUS_LAYER, type: 'fill', source: FOCUS_LAYER,
      paint: { 'fill-color': '#0B1220', 'fill-opacity': FOCUS_OPACITY[current], 'fill-opacity-transition': { duration: 300 } } }, before);
    else {
      map.setPaintProperty(FOCUS_LAYER, 'fill-opacity', FOCUS_OPACITY[current]);
      if (before) map.moveLayer(FOCUS_LAYER, before);
    }
  }
  const onStyle = () => { ready = true; syncLayer(); };
  map.on('style.load', onStyle);
  syncLayer();
  return {
    apply(s: { navigationOpen: boolean; searchOpen: boolean }) {
      const next = deriveFocusMode(s);
      if (current === next) return;
      if (next === 'navigation') pitch.lock();
      else if (current === 'navigation') pitch.unlock();
      current = next;
      document.body.dataset.focus = next;
      syncLayer();
    },
    refresh: syncLayer,
    mode: () => current,
    destroy: () => map.off('style.load', onStyle),
  };
}
