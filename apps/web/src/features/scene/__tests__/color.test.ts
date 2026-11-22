import { describe, expect, it } from 'vitest';
import { basePalette } from '../../../mapStyle';
import { hexToLab, labToHex, lightness, mixOk } from '../color';

describe('OKLab color math', () => {
  it('round-trips every base palette color exactly', () => {
    for (const hex of Object.values(basePalette)) expect(labToHex(hexToLab(hex))).toBe(hex.toLowerCase());
  });

  it('maps black and white to the ends of the lightness axis', () => {
    expect(lightness('#000000')).toBeCloseTo(0, 6);
    expect(lightness('#ffffff')).toBeCloseTo(1, 6);
  });

  it('mixOk returns the endpoints at t = 0 and 1 and clamps t', () => {
    expect(mixOk('#123456', '#abcdef', 0)).toBe('#123456');
    expect(mixOk('#123456', '#abcdef', 1)).toBe('#abcdef');
    expect(mixOk('#123456', '#abcdef', -3)).toBe('#123456');
    expect(mixOk('#123456', '#abcdef', 9)).toBe('#abcdef');
  });

  it('keeps blends of complementary colors brighter than sRGB averaging does', () => {
    // Blue + yellow: sRGB averaging gives a dull grey; OKLab keeps the midpoint's lightness.
    const mid = mixOk('#0000ff', '#ffff00', 0.5);
    expect(lightness(mid)).toBeGreaterThan(lightness('#808080'));
  });

  it('reduces chroma, not lightness, for out-of-gamut colors', () => {
    const L = 0.7;
    const hex = labToHex([L, 0.4, 0.4]);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightness(hex)).toBeCloseTo(L, 2);
  });

  it('rejects malformed hex', () => {
    expect(() => hexToLab('red')).toThrow();
  });
});
