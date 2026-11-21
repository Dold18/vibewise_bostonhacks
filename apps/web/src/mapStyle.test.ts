import { describe, expect, it } from 'vitest';
import { basePalette, buildMapStyle, mapStyle, THEME_TRANSITION_MS } from './mapStyle';

describe('buildMapStyle', () => {
  it('takes every color in the built style from the palette', () => {
    const json = JSON.stringify(buildMapStyle(basePalette));
    const hexes = json.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const allowed = new Set(Object.values(basePalette).map((c) => c.toLowerCase()));
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(allowed, hex).toContain(hex.toLowerCase());
  });

  it('reflects palette changes', () => {
    const style = buildMapStyle({ ...basePalette, land: '#000000' });
    const background = style.layers.find((l) => l.id === 'background');
    expect(background?.paint).toMatchObject({ 'background-color': '#000000' });
    expect(style.sky?.['fog-color']).toBe('#000000');
  });

  it('animates paint changes', () => {
    expect(THEME_TRANSITION_MS).toBe(800);
    expect(buildMapStyle(basePalette).transition?.duration).toBe(800);
  });

  it('keeps the camera-driven 3D building fade at its old 300ms transition', () => {
    const layer = buildMapStyle(basePalette).layers.find((l) => l.id === 'building-3d');
    expect(layer?.paint).toMatchObject({ 'fill-extrusion-opacity-transition': { duration: 300, delay: 0 } });
  });

  it('keeps the default map export built from the base palette', () => {
    expect(mapStyle).toEqual(buildMapStyle(basePalette));
  });
});
