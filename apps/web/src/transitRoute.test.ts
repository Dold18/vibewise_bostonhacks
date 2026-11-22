import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { drawRoute } from './transitRoute';

/** Records layers in draw order, like MapLibre's style. */
function fakeMap() {
  const layers: { id: string; paint?: Record<string, unknown> }[] = [];
  const sources = new Map<string, { setData(d: unknown): void }>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: () => {} }),
    addLayer: (layer: { id: string; paint?: Record<string, unknown> }) => layers.push(layer),
  } as unknown as MapLibreMap;
  return { map, layers };
}

describe('drawRoute', () => {
  it('draws a white casing under every route line so it stays visible on any map theme', () => {
    const { map, layers } = fakeMap();
    drawRoute(map, [
      { mode: 'walk', geometry: [[-71.06, 42.35], [-71.05, 42.36]] },
      { mode: 'transit', routeColor: '#da291c', geometry: [[-71.05, 42.36], [-71.04, 42.37]] },
    ] as never);
    const ids = layers.map((l) => l.id);
    const casing = layers.find((l) => l.id === 'transit-route-casing');
    expect(casing?.paint?.['line-color']).toBe('#ffffff');
    expect(casing?.paint?.['line-width']).toBeGreaterThan(6);
    expect(ids.indexOf('transit-route-casing')).toBeLessThan(ids.indexOf('transit-route-ride'));
    expect(ids.indexOf('transit-route-casing')).toBeLessThan(ids.indexOf('transit-route-walk'));
  });
});
