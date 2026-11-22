import { describe, expect, it } from 'vitest';
import { classifyRings, decodeMvt } from '../mvt';
import { buildTileGeometry, cellRect, latFromMercator, lngFromMercator, mercatorX, mercatorY, tileAt, tileFrame, toLngLat, toLocal } from '../geometry';
import { BOSTON_TILE, PbfWriter, zigzag } from './fixtures';

/** Encode commands for a polygon ring/line in tile coordinates (the cursor persists across a feature's parts). */
let cx = 0, cy = 0;
function commands(points: Array<[number, number]>, close: boolean, reset = true) {
  const out: number[] = [];
  if (reset) { cx = 0; cy = 0; }
  points.forEach(([x, y], i) => {
    if (i === 0) out.push((1 << 3) | 1);
    if (i === 1) out.push(((points.length - 1) << 3) | 2);
    out.push(zigzag(x - cx), zigzag(y - cy)); cx = x; cy = y;
  });
  if (close) out.push((1 << 3) | 7);
  return out;
}

function tileBytes() {
  const building = new PbfWriter().string(1, 'building').varint(0);
  // Feature: polygon with a hole (exterior clockwise in y-down tile space = positive area).
  const exterior = commands([[100, 100], [300, 100], [300, 300], [100, 300]], true);
  const hole = commands([[150, 150], [150, 250], [250, 250], [250, 150]], true, false);
  const poly = new PbfWriter().packed(2, [0, 0]).tag(3, 0).varint(3).packed(4, [...exterior, ...hole]);
  const layerB = new PbfWriter().tag(15, 0).varint(2).string(1, 'building').message(2, poly).string(3, 'class').message(4, new PbfWriter().string(1, 'commercial')).tag(5, 0).varint(4096);
  const road = new PbfWriter().packed(2, [0, 0, 1, 1]).tag(3, 0).varint(2).packed(4, commands([[0, 2048], [4096, 2048]], false));
  const layerT = new PbfWriter().tag(15, 0).varint(2).string(1, 'transportation').message(2, road).string(3, 'class').string(3, 'brunnel')
    .message(4, new PbfWriter().string(1, 'minor')).message(4, new PbfWriter().string(1, 'bridge')).tag(5, 0).varint(4096);
  void building;
  return Uint8Array.from(new PbfWriter().message(3, layerB).message(3, layerT).bytes);
}

describe('MVT decoding', () => {
  it('decodes layers, properties and geometry', () => {
    const layers = decodeMvt(tileBytes());
    const b = layers.get('building')!;
    expect(b.extent).toBe(4096);
    expect(b.features[0]!.properties).toEqual({ class: 'commercial' });
    expect(b.features[0]!.type).toBe(3);
    const rings = classifyRings(b.features[0]!.geometry);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(2); // exterior + hole
    expect(Array.from(rings[0]![0]!.slice(0, 4))).toEqual([100, 100, 300, 100]);
    const t = layers.get('transportation')!;
    expect(t.features[0]!.properties).toEqual({ class: 'minor', brunnel: 'bridge' });
    expect(Array.from(t.features[0]!.geometry[0]!)).toEqual([0, 2048, 4096, 2048]);
  });

  it('only decodes requested layers', () => {
    expect([...decodeMvt(tileBytes(), new Set(['transportation'])).keys()]).toEqual(['transportation']);
  });

  it('builds metric geometry: holes, bridges never host sidewalks', () => {
    const g = buildTileGeometry(BOSTON_TILE, decodeMvt(tileBytes()));
    const s = g.frame.size / 4096;
    expect(g.areaAt('building', 120 * s, -120 * s)).toBeDefined();
    expect(g.areaAt('building', 200 * s, -200 * s)).toBeUndefined(); // inside the hole
    expect(g.lines[0]!.cls).toBe('minor:bridge');
  });
});

describe('world frame', () => {
  it('round-trips lng/lat through the local metric frame and mercator', () => {
    const frame = tileFrame(BOSTON_TILE);
    const [x, y] = toLocal(frame, -71.0636, 42.3555);
    const [lng, lat] = toLngLat(frame, x, y);
    expect(lng).toBeCloseTo(-71.0636, 9);
    expect(lat).toBeCloseTo(42.3555, 9);
    expect(lngFromMercator(mercatorX(-71.06))).toBeCloseTo(-71.06, 10);
    expect(latFromMercator(mercatorY(42.36))).toBeCloseTo(42.36, 10);
    // z14 at Boston ≈ 1.8 km; cell (z17) ≈ 226 m and lies inside its source tile.
    expect(frame.size).toBeGreaterThan(1790); expect(frame.size).toBeLessThan(1820);
    const cell = tileAt(-71.0636, 42.3555, 17);
    const [x0, y0, x1, y1] = cellRect(frame, cell);
    expect(x1 - x0).toBeCloseTo(frame.size / 8, 6);
    expect(x0 <= x && x < x1 && y0 <= y && y < y1).toBe(true);
  });
});
