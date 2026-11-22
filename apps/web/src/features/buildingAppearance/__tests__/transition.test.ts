import { describe, expect, it } from 'vitest';
import { blendUniforms, structuralKey } from '../layer';
import type { UniformValue } from '../uniforms';

const f4 = (...v: number[]) => ({ type: '4fv' as const, value: new Float32Array(v) });

describe('building uniform interpolation', () => {
  const from: Record<string, UniformValue> = { u_fWallA: f4(0, 0, 0, 0.5), u_fWallB: f4(1, 4, 0, 2), u_strength: { type: '1f', value: 1 } };
  const to: Record<string, UniformValue> = { u_fWallA: f4(1, 1, 1, 0.5), u_fWallB: f4(3, 5, 0, 7), u_strength: { type: '1f', value: 0.6 } };

  it('interpolates colours and strength, and switches enum-coded uniforms at the midpoint', () => {
    const q = blendUniforms(from, to, 0.25);
    expect([...(q.u_fWallA!.value as Float32Array)]).toEqual([0.25, 0.25, 0.25, 0.5]);
    expect((q.u_strength as { value: number }).value).toBeCloseTo(0.9, 5);
    expect([...(q.u_fWallB!.value as Float32Array)]).toEqual([1, 4, 0, 2]); // texture layer / surface kind: not blended
    expect([...(blendUniforms(from, to, 0.75).u_fWallB!.value as Float32Array)]).toEqual([3, 5, 0, 7]);
    expect(blendUniforms(from, to, 1)).toBe(to);
  });

  it('structure covers only what the mesh bakes in (colour changes never rebuild)', () => {
    const facade = { weight: 1, trim: { parapetHeight: 0 }, wall: { color: '#ffffff' } };
    const a = { facades: [facade], roofs: [], variation: { seed: 's' } } as never;
    const b = { facades: [{ ...facade, wall: { color: '#000000' } }], roofs: [], variation: { seed: 's' } } as never;
    expect(structuralKey(a)).toBe(structuralKey(b));
  });
});
