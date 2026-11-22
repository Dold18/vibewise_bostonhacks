import { describe, expect, it } from 'vitest';
import { basePalette, BUILDING_MATERIALS, buildingLayerId, buildMapStyle } from '../../../mapStyle';
import { applyPalette, diffPaint, type PaintTarget } from '../apply';

function fakeMap(missing: string[] = []) {
  const calls: { kind: string; args: unknown[] }[] = [];
  const style = buildMapStyle(basePalette);
  const target: PaintTarget = {
    setPaintProperty: (...args) => calls.push({ kind: 'paint', args }),
    setSky: (...args) => calls.push({ kind: 'sky', args }),
    setLight: (...args) => calls.push({ kind: 'light', args }),
    getLayer: (id) => (missing.includes(id) ? undefined : style.layers.find((l) => l.id === id)),
  };
  return { target, calls };
}

describe('diffPaint', () => {
  it('returns only changed paint values', () => {
    const from = buildMapStyle(basePalette);
    const to = buildMapStyle({ ...basePalette, land: '#000000' });
    const changes = diffPaint(from, to);
    expect(changes).toContainEqual({ layerId: 'background', property: 'background-color', value: '#000000' });
    for (const change of changes) {
      const before = from.layers.find((l) => l.id === change.layerId)?.paint as Record<string, unknown>;
      expect(JSON.stringify(before[change.property])).not.toBe(JSON.stringify(change.value));
    }
  });

  it('finds no changes between identical palettes', () => {
    expect(diffPaint(buildMapStyle(basePalette), buildMapStyle({ ...basePalette }))).toEqual([]);
  });

  it('reports every 3D building band a changed palette entry feeds', () => {
    // building3dHigh shapes the gradient from 60 m up: bands b4 (60–110 m) to b6 (200 m+),
    // each drawn as one layer per OSM material tone (mapStyle BUILDING_MATERIALS).
    const changes = diffPaint(buildMapStyle(basePalette), buildMapStyle({ ...basePalette, building3dHigh: '#000000' }));
    const expected = ['building-3d-b4', 'building-3d-b5', 'building-3d-b6'].flatMap((band) =>
      BUILDING_MATERIALS.map((m) => `${buildingLayerId(band, m)}/fill-extrusion-color`),
    );
    expect(changes.map((c) => `${c.layerId}/${c.property}`).sort()).toEqual(expected.sort());
  });
});

describe('applyPalette', () => {
  it('ignores layers not in the built style and never sets fill-extrusion-opacity', () => {
    const { target, calls } = fakeMap(['water']);
    applyPalette(target, basePalette, { ...basePalette, water: '#000000', building3d: '#111111', land: '#222222' });
    const painted = calls.filter((c) => c.kind === 'paint').map((c) => c.args);
    expect(painted.some(([id]) => id === 'water')).toBe(false);
    expect(painted.some(([id]) => id === 'waterway')).toBe(true);
    expect(painted.some(([, prop]) => prop === 'fill-extrusion-opacity')).toBe(false);
  });

  it('sets sky only when sky colors change', () => {
    const unchanged = fakeMap();
    applyPalette(unchanged.target, basePalette, { ...basePalette, park: '#000000' });
    expect(unchanged.calls.some((c) => c.kind === 'sky')).toBe(false);

    const changed = fakeMap();
    applyPalette(changed.target, basePalette, { ...basePalette, sky: '#000000' });
    expect(changed.calls.filter((c) => c.kind === 'sky')).toHaveLength(1);
    expect(changed.calls.some((c) => c.kind === 'light')).toBe(false);
  });

  it('sets light only when the light color changes', () => {
    const { target, calls } = fakeMap();
    applyPalette(target, basePalette, { ...basePalette, light: '#ffd9a8' });
    expect(calls.filter((c) => c.kind === 'light')).toHaveLength(1);
  });
});
