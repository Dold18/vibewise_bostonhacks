import { describe, expect, it } from 'vitest';
import { basePalette, BUILDING_3D_LAYERS, buildingMaterialColors, buildMapStyle, footprintShadowColor, mapStyle, materialColor, THEME_TRANSITION_MS } from './mapStyle';

describe('buildMapStyle', () => {
  it('takes every color in the built style from the palette', () => {
    // Paint, light and sky only: filters legitimately match OSM `colour` values.
    const style = buildMapStyle(basePalette);
    const json = JSON.stringify([style.layers.map((l) => ('paint' in l ? l.paint : null)), style.light, style.sky]);
    const hexes = json.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    // Palette entries, plus 3D building band/material tones and the contact
    // shadow, all derived from palette entries.
    const allowed = new Set([...Object.values(basePalette), ...buildingMaterialColors(basePalette), footprintShadowColor(basePalette)].map((c) => c.toLowerCase()));
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

  it('recolors every building material tone with the palette', () => {
    const night = { ...basePalette, building3d: '#202430', building3dMid: '#2a3040', building3dHigh: '#343c50' };
    const day = new Set(buildingMaterialColors(basePalette));
    for (const c of buildingMaterialColors(night)) expect(day.has(c), c).toBe(false);
  });

  it('flattens material tones when a scene sets materialVariation 0', () => {
    expect(materialColor('#d6d4cf', 'brick', 0)).toBe('#d6d4cf');
    const style = buildMapStyle(basePalette, { lightIntensity: 0.35, lightPosition: [1.4, 295, 40], fogColor: null, skyHorizonBlend: 0.6, horizonFogBlend: 0.7, fogGroundBlend: 0.85, transitionMs: 800, materialVariation: 0 });
    const colors = new Set(style.layers.filter((l) => l.type === 'fill-extrusion').map((l) => JSON.stringify((l.paint as Record<string, unknown>)['fill-extrusion-color'])));
    expect(colors.size).toBe(6); // one per height band
  });

  it('lists every 3D building layer for the camera-driven fade', () => {
    const ids = buildMapStyle(basePalette).layers.filter((l) => l.type === 'fill-extrusion').map((l) => l.id);
    expect([...BUILDING_3D_LAYERS].sort()).toEqual(ids.sort());
  });

  it('keeps highways the widest road without overpowering buildings', () => {
    const width = (id: string) => (buildMapStyle(basePalette).layers.find((l) => l.id === id)?.paint as Record<string, unknown>)['line-width'] as number[];
    const at = (id: string, zoom: number) => { const w = width(id); return w[w.indexOf(zoom) + 1]; };
    expect(at('road-motorway', 14)).toBeLessThanOrEqual(4);
    expect(at('road-motorway', 20)).toBeLessThanOrEqual(18);
    expect(at('road-motorway', 20)).toBeGreaterThan(at('road-primary', 20));
    expect(at('road-primary', 20)).toBeGreaterThan(at('road-secondary', 20));
    expect(at('road-secondary', 20)).toBeGreaterThan(at('road-minor', 20));
    expect(at('road-minor', 14)).toBeGreaterThan(1);
  });

  it('keeps the default map export built from the base palette', () => {
    expect(mapStyle).toEqual(buildMapStyle(basePalette));
  });
});
