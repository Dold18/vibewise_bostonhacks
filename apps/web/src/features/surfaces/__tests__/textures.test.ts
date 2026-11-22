import { describe, expect, it } from 'vitest';
import { GREEN_MATERIALS, GROUND_MATERIALS, ROAD_MATERIALS, WALK_MATERIALS } from '../recipe';
import { PIXEL_RATIO, SLOT_SIZE } from '../layers';
import { paintTexture, type GrainMap, type TextureSpec } from '../textures';
import type { SlotKind } from '../textures';

const spec = (kind: SlotKind, material: string, extra: Partial<TextureSpec> = {}): TextureSpec => ({
  kind, material, variant: 0, width: SLOT_SIZE[kind][0], height: SLOT_SIZE[kind][1], pixelRatio: PIXEL_RATIO,
  base: '#d9cbb0', ink: '#3c4043', light: '#ffd28a', sky: '#bcd9f7', park: '#a9d48c', accentA: '#ff4fd8', accentB: '#33e6ff',
  mosaic: ['#ffe8db', '#b5ca8c', '#9fd8e6', '#d9c2ff'], wet: 0, wear: 0.5, scale: 1, reflection: 'none', night: false, accent: 'none', ...extra,
});

const ALL: Array<[SlotKind, string]> = [
  ...ROAD_MATERIALS.map((m): [SlotKind, string] => ['road', m]),
  ...WALK_MATERIALS.map((m): [SlotKind, string] => ['walk', m]),
  ...GROUND_MATERIALS.filter((m) => m !== 'none').map((m): [SlotKind, string] => ['ground', m]),
  ...GREEN_MATERIALS.filter((m) => m !== 'none').map((m): [SlotKind, string] => ['green', m]),
  ['wood', 'canopy'], ['wood', 'dense_canopy'], ['wood', 'sparse_canopy'],
  ['lamps', 'sparse_amber'], ['lamps', 'dense_amber'], ['lamps', 'cold_white'], ['lamps', 'neon'],
];

/** Mean RGB difference between two pixel columns (x) or rows (y). */
function lineDiff(img: { width: number; height: number; data: Uint8ClampedArray }, axis: 'x' | 'y', a: number, b: number): number {
  let sum = 0;
  const n = axis === 'x' ? img.height : img.width;
  for (let i = 0; i < n; i++) {
    const pa = axis === 'x' ? (i * img.width + a) * 4 : (a * img.width + i) * 4;
    const pb = axis === 'x' ? (i * img.width + b) * 4 : (b * img.width + i) * 4;
    for (let c = 0; c < 3; c++) sum += Math.abs(img.data[pa + c] - img.data[pb + c]);
  }
  return sum / (n * 3);
}

describe('procedural textures', () => {
  it.each(ALL)('%s/%s paints at the slot size, deterministically', (kind, material) => {
    const s = spec(kind, material);
    const a = paintTexture(s);
    expect(a.width).toBe(SLOT_SIZE[kind][0] * PIXEL_RATIO);
    expect(a.height).toBe(SLOT_SIZE[kind][1] * PIXEL_RATIO);
    expect(Buffer.from(paintTexture(s).data).equals(Buffer.from(a.data))).toBe(true);
  });

  it.each(ALL.filter(([k]) => k !== 'lamps'))('%s/%s tiles seamlessly (seam no harsher than interior)', (kind, material) => {
    const img = paintTexture(spec(kind, material));
    // Harshest step between neighbouring interior columns/rows (joints, plank gaps, stone edges).
    const interior = (axis: 'x' | 'y', size: number) => {
      let m = 0;
      for (let i = 1; i < size; i++) m = Math.max(m, lineDiff(img, axis, i - 1, i));
      return m;
    };
    // Line patterns repeat along the street (x); fills repeat on both axes.
    expect(lineDiff(img, 'x', img.width - 1, 0)).toBeLessThanOrEqual(interior('x', img.width) + 2);
    if (kind !== 'road' && kind !== 'walk') expect(lineDiff(img, 'y', img.height - 1, 0)).toBeLessThanOrEqual(interior('y', img.height) + 2);
  });

  it('every road material looks different', () => {
    const imgs = ROAD_MATERIALS.map((m) => Buffer.from(paintTexture(spec('road', m)).data));
    for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(imgs[i].equals(imgs[j]), `${ROAD_MATERIALS[i]} vs ${ROAD_MATERIALS[j]}`).toBe(false);
  });

  it('wetness darkens the street and adds reflections; street variants differ', () => {
    const lum = (d: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4); };
    const dry = paintTexture(spec('road', 'granite_setts'));
    const wet = paintTexture(spec('road', 'granite_setts', { wet: 0.9, reflection: 'neon' }));
    expect(lum(wet.data)).toBeLessThan(lum(dry.data));
    const v1 = paintTexture(spec('road', 'aged_asphalt', { variant: 1 }));
    expect(Buffer.from(v1.data).equals(Buffer.from(paintTexture(spec('road', 'aged_asphalt')).data))).toBe(false);
  });

  it('gutters sit on the road edges (first/last rows darker or lighter than the lane)', () => {
    const img = paintTexture(spec('road', 'asphalt', { wear: 0 }));
    expect(lineDiff(img, 'y', 0, Math.floor(img.height / 2))).toBeGreaterThan(8);
  });

  it('mixes in real asset grain only at an exact, tileable step', () => {
    const grain: GrainMap = { size: 256, data: Float32Array.from({ length: 256 * 256 }, (_, i) => ((i * 7919) % 13) / 6 - 1) };
    const grains = new Map([['v1/asphalt-grit', grain]]);
    const plain = paintTexture(spec('road', 'asphalt'));
    const grained = paintTexture(spec('road', 'asphalt'), grains);
    expect(Buffer.from(plain.data).equals(Buffer.from(grained.data))).toBe(false);
    // Lamps are 192 px wide: 256/192 is not an integer, so no grain (it would leave a seam).
    expect(Buffer.from(paintTexture(spec('lamps', 'neon'), grains).data).equals(Buffer.from(paintTexture(spec('lamps', 'neon')).data))).toBe(true);
  });
});
