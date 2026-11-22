import { describe, expect, it } from 'vitest';
import { basePalette } from '../mapStyle';
import {
  mapPaletteForPreview,
  parseVisualPreview,
  PREVIEW_MAP_COLORS,
  VISUAL_PREVIEWS,
} from './visualFoundation';

const luminance = (hex: string): number => {
  const channels = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

const contrast = (a: string, b: string) => {
  const brighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (brighter + 0.05) / (darker + 0.05);
};

describe('Visual Foundation dev-only previews', () => {
  it('accepts only known names, never arbitrary URL input', () => {
    for (const id of VISUAL_PREVIEWS) expect(parseVisualPreview(id)).toBe(id);
    for (const value of [null, '', 'default', 'cyberpunk', 'CARBON', '__proto__', '<script>']) {
      expect(parseVisualPreview(value)).toBeNull();
    }
  });

  it('leaves the unchanged baseline object alone when disabled', () => {
    expect(mapPaletteForPreview(basePalette, null)).toBe(basePalette);
  });

  it('covers every existing MapLibre palette key and keeps valid hex colors', () => {
    const baselineKeys = Object.keys(basePalette).sort();
    for (const id of VISUAL_PREVIEWS) {
      const colors = PREVIEW_MAP_COLORS[id];
      expect(Object.keys(colors).sort()).toEqual(baselineKeys);
      for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      const palette = mapPaletteForPreview(basePalette, id);
      expect(palette.land).toBe(colors.land);
      expect(palette.building3d).toBe(colors.building3d);
      expect(palette.roadMajor).toBe(colors.roadMajor);
    }
  });

  it('keeps core map labels readable in all three starting looks', () => {
    for (const id of VISUAL_PREVIEWS) {
      const p = mapPaletteForPreview(basePalette, id);
      expect(contrast(p.textPrimary, p.land)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textSecondary, p.land)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.neighbourhoodLabel, p.land)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.waterLabel, p.water)).toBeGreaterThanOrEqual(3);
    }
  });
});
