/** Synthetic but realistic downtown block geometry in a real Boston z14 tile frame. */
import { TileGeometry, tileAt, tileFrame, SOURCE_ZOOM } from '../geometry';
import { runtimeAssets } from '../../registry';
import { buildDecorCatalog } from '../catalog';
import { ASSET_METRICS, LAYOUT_CONTEXT } from '../index';

export const BOSTON_TILE = tileAt(-71.0636, 42.3555, SOURCE_ZOOM);
export const catalog = buildDecorCatalog({ modelIds: runtimeAssets.models, metrics: ASSET_METRICS });
export { runtimeAssets, LAYOUT_CONTEXT };

const rect = (x0: number, y0: number, x1: number, y1: number) => Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]);
const line = (...pts: number[]) => Float64Array.from(pts);

export const ROAD_XS = [40, 150, 260, 370, 480, 590];
export const ROAD_YS = [-40, -150, -260, -370, -480, -590];
/** Block (column, row) indices that are parks / plazas instead of buildings. */
export const PARK_BLOCKS = new Set(['1,1', '3,2']);
export const PLAZA_BLOCKS = new Set(['2,3']);
export const SETBACK = 9.5;

/** 6×6 street grid (minor roads, one secondary avenue), building blocks with sidewalks, two parks with paths, a plaza and a waterfront. */
export function syntheticCity(): TileGeometry {
  const g = new TileGeometry(tileFrame(BOSTON_TILE));
  for (const x of ROAD_XS) g.addLine('road', x === 260 ? 'secondary' : 'minor', line(x, 0, x, -700), x === 260 ? 7.5 : 5);
  for (const y of ROAD_YS) g.addLine('road', 'minor', line(0, y, 700, y), 5);
  g.addLine('rail', 'rail', line(0, -650, 700, -650), 2.5);
  for (let i = 0; i + 1 < ROAD_XS.length; i++) for (let j = 0; j + 1 < ROAD_YS.length; j++) {
    const x0 = ROAD_XS[i]!, x1 = ROAD_XS[i + 1]!, y1 = ROAD_YS[j]!, y0 = ROAD_YS[j + 1]!;
    const key = `${i},${j}`;
    if (PARK_BLOCKS.has(key)) {
      g.addArea('park', 'park', [rect(x0 + 6, y0 + 6, x1 - 6, y1 - 6)]);
      g.addLine('path', 'path', line(x0 + 6, y0 + 6, x1 - 6, y1 - 6), 1.2);
    } else if (PLAZA_BLOCKS.has(key)) {
      g.addArea('plaza', 'pedestrian', [rect(x0 + 7, y0 + 7, x1 - 7, y1 - 7)]);
    } else {
      const s = SETBACK + (x0 === 260 || x1 === 260 ? 3 : 0);
      // Roof heights vary by block; one block has a taller tower part (non-flat roof).
      g.addArea('building', 'building', [rect(x0 + s, y0 + s, x1 - s, y1 - s)], 18 + 7 * ((i + 2 * j) % 5));
      if (key === '0,0') g.addArea('building', 'building', [rect(x0 + 30, y0 + 30, x0 + 60, y0 + 60)], 95);
    }
  }
  g.addArea('water', 'river', [rect(640, -700, 760, 0)]);
  return g;
}

/** Minimal protobuf writer for hand-built MVT fixtures. */
export class PbfWriter {
  bytes: number[] = [];
  varint(n: number) { while (n >= 0x80) { this.bytes.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } this.bytes.push(n); return this; }
  tag(field: number, wire: number) { return this.varint((field << 3) | wire); }
  message(field: number, inner: PbfWriter) { this.tag(field, 2).varint(inner.bytes.length); this.bytes.push(...inner.bytes); return this; }
  string(field: number, s: string) { const b = new TextEncoder().encode(s); this.tag(field, 2).varint(b.length); this.bytes.push(...b); return this; }
  packed(field: number, values: number[]) { const w = new PbfWriter(); for (const v of values) w.varint(v); return this.message(field, w); }
}
export const zigzag = (n: number) => (n << 1) ^ (n >> 31);
