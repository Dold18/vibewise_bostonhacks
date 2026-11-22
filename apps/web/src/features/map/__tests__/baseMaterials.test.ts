import { describe, expect, it } from 'vitest';
import type { LayerSpecification } from 'maplibre-gl';
import { BASE_MATERIALS, imageId, overlayLayer, toDetail } from '../baseMaterials';
import { buildMapStyle, basePalette } from '../../../mapStyle';

describe('toDetail', () => {
  it('stores only neutral luminance detail in alpha (no color)', () => {
    // Two pixels: one darker and one lighter than the mean, with a strong hue.
    const out = toDetail(new Uint8ClampedArray([200, 40, 40, 255, 255, 120, 120, 255]));
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 0]);
    expect([out[4], out[5], out[6]]).toEqual([255, 255, 255]);
    expect(out[3]).toBeGreaterThan(0);
    expect(out[7]).toBeGreaterThan(0);
  });

  it('is fully transparent for a flat texture', () => {
    const out = toDetail(new Uint8ClampedArray([90, 90, 90, 255, 90, 90, 90, 255]));
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(0);
  });
});

describe('overlayLayer', () => {
  const style = buildMapStyle(basePalette);
  const byId = (id: string) => style.layers.find((l) => l.id === id) as LayerSpecification;

  it('overlays only base layers that exist in the style, with the same source and filter', () => {
    for (const spec of BASE_MATERIALS) {
      for (const baseId of spec.over) {
        const base = byId(baseId);
        expect(base, baseId).toBeDefined();
        const layer = overlayLayer(spec, base, 1) as LayerSpecification & { filter?: unknown; 'source-layer'?: string };
        expect(layer.type).toBe('fill');
        expect(layer['source-layer']).toBe((base as { 'source-layer'?: string })['source-layer']);
        expect(layer.filter).toEqual((base as { filter?: unknown }).filter);
        expect((layer.paint as Record<string, unknown>)['fill-pattern']).toBe(imageId(spec.surface));
      }
    }
  });

  it('never sets a color, so scene palettes keep ownership of the ground', () => {
    for (const spec of BASE_MATERIALS) {
      const layer = overlayLayer(spec, byId(spec.over[0]), 0.5)!;
      expect(Object.keys(layer.paint ?? {}).some((p) => p.endsWith('-color'))).toBe(false);
      expect((layer.paint as Record<string, number>)['fill-opacity']).toBeCloseTo(spec.opacity * 0.5);
    }
  });

  it('refuses non-fill base layers', () => {
    const extrusion = style.layers.find((l) => l.type === 'fill-extrusion')!;
    expect(overlayLayer(BASE_MATERIALS[0], extrusion, 1)).toBeNull();
  });
});
