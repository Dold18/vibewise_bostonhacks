import { describe, expect, it } from 'vitest';
import { contrastRatio, mix } from '../color';

describe('mix', () => {
  it('interpolates sRGB channels', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mix('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('returns lowercase #rrggbb and clamps t', () => {
    expect(mix('#ABCDEF', '#ABCDEF', 2)).toBe('#abcdef');
    expect(mix('#000000', '#ffffff', -1)).toBe('#000000');
  });
});

describe('contrastRatio', () => {
  it('matches WCAG 2 values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#3c4043', '#f3f3f0')).toBeGreaterThan(4.5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#f2711c', '#f3f3f0')).toBeCloseTo(contrastRatio('#f3f3f0', '#f2711c'), 10);
  });
});
