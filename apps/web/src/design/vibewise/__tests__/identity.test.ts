import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORY_ICON, ICON_NAMES, iconForCategoryMark, iconSource, normalizeIconMarkup, resolveCut } from '../icons';
import { cradlePath, sheetPath, sheetSvg } from '../sheets';
import { CATEGORIES } from '../../../osm';

/*
 * Expected paths were produced by the identity exploration's own geometry
 * (design/identity-exploration/js/shapes.js SHAPES.cradle.panel and
 * v2/js/shapes.js SHAPES_V2.b.panel) at commit e4588f4.
 */
const V1_CRADLE_392x610 = 'M18 0 L345.87 0 A9 9 0 0 1 354.7 7.28 A38 38 0 0 0 384.72 37.3 A9 9 0 0 1 392 46.13 L392 592 A18 18 0 0 1 374 610 L34 610 A34 34 0 0 1 0 576 L0 18 A18 18 0 0 1 18 0 Z';
const V1_CRADLE_358x82 = 'M18 0 L311.87 0 A9 9 0 0 1 320.7 7.28 A38 38 0 0 0 350.72 37.3 A9 9 0 0 1 358 46.13 L358 64 A18 18 0 0 1 340 82 L34 82 A34 34 0 0 1 0 48 L0 18 A18 18 0 0 1 18 0 Z';
const V2_B_392x500 = 'M26 0 L382 0 A10 10 0 0 1 392 10 L392 474 A26 26 0 0 1 366 500 L10 500 A10 10 0 0 1 0 490 L0 26 A26 26 0 0 1 26 0 Z';

describe('V1 3C Button Cradle geometry', () => {
  it('matches the approved V1 outline exactly, expanded and collapsed', () => {
    expect(cradlePath(392, 610)).toBe(V1_CRADLE_392x610);
    expect(cradlePath(358, 82)).toBe(V1_CRADLE_358x82);
  });
  it('keeps the scoop the same size at every panel size (the recess never scales)', () => {
    const scoop = (d: string) => d.match(/A38 38 0 0 0 [\d.]+ [\d.]+/)![0];
    const end = (w: number) => cradlePath(w, 500).match(/A38 38 0 0 0 ([\d.]+) ([\d.]+)/)!.slice(1).map(Number);
    expect(scoop(cradlePath(300, 200))).toContain('A38 38');
    const [x1, y1] = end(300), [x2, y2] = end(392);
    expect(+(392 - x2).toFixed(2)).toBe(+(300 - x1).toFixed(2));
    expect(y1).toBe(y2);
  });
  it('draws the coral backing and the paper front from the same path', () => {
    const svg = sheetSvg('cradle', 392, 610);
    const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(paths).toEqual([V1_CRADLE_392x610, V1_CRADLE_392x610]);
    expect(svg).toContain('translate(6 7)');
    expect(svg).toContain('aria-hidden="true"');
  });
});

describe('V2 B layered sheet', () => {
  it('matches the V2 B body outline', () => {
    expect(sheetPath(392, 500)).toBe(V2_B_392x500);
  });
});

describe('V3 icon family', () => {
  const dir = new URL('../icons/', import.meta.url);
  it('ships all 80 approved SVGs: detailed and optical cut for each of the 40 actions', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();
    expect(files).toHaveLength(80);
    expect(files).toEqual(ICON_NAMES.flatMap((n) => [`${n}-sm.svg`, `${n}.svg`]).sort());
    for (const name of ICON_NAMES) {
      expect(iconSource(name, 'detailed')).toBe(readFileSync(new URL(`${name}.svg`, dir), 'utf8'));
      expect(iconSource(name, 'optical')).toBe(readFileSync(new URL(`${name}-sm.svg`, dir), 'utf8'));
    }
  });
  it('removes titles and per-file sizing so decorative icons add no text to their buttons', () => {
    for (const name of ICON_NAMES) {
      const svg = normalizeIconMarkup(iconSource(name, 'detailed'));
      const root = svg.slice(0, svg.indexOf('>'));
      expect(svg).not.toMatch(/<title>/);
      expect(root).not.toMatch(/\s(role|aria-label|width|height)=/);
      expect(root).toContain('viewBox=');
    }
  });
  it('uses optical cuts at 24px and below, per the V3 icon rule', () => {
    expect(resolveCut(18)).toBe('optical');
    expect(resolveCut(24)).toBe('optical');
    expect(resolveCut(28)).toBe('detailed');
    expect(resolveCut(18, 'detailed')).toBe('detailed');
  });
  it('gives every map category a V3 glyph, reachable from its emoji mark', () => {
    for (const c of CATEGORIES) {
      expect(ICON_NAMES).toContain(CATEGORY_ICON[c.id]);
      expect(iconForCategoryMark(c.icon)).toBe(CATEGORY_ICON[c.id]);
    }
    expect(iconForCategoryMark(undefined)).toBe('pin');
  });
});
