import { describe, expect, it } from 'vitest';
import { ICON_ART, ICON_NAME_BY_ART, iconMarkup, type IconName } from '../icons';
import { wordmarkSvg } from '../wordmark';
import { sceneAccent, sceneTone, vivid } from '../sceneAccent';
import { basePalette } from '../../mapStyle';
import { ICONS } from '../../discovery/ui/dom';

describe('Vibenta icon family', () => {
  it('draws every icon with marker ink and keeps art unique', () => {
    for (const [name, art] of Object.entries(ICON_ART)) expect(art, name).toContain('vx-i-ink');
    expect(new Set(Object.values(ICON_ART)).size).toBe(Object.keys(ICON_ART).length);
  });

  it('maps every legacy ICONS key to original art (no third-party paths left)', () => {
    for (const [key, art] of Object.entries(ICONS)) expect(ICON_NAME_BY_ART.has(art), key).toBe(true);
  });

  it('renders decorative, labelled-by-parent SVG markup', () => {
    const svg = iconMarkup('search' as IconName, 18);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('vx-icon--search');
    expect(svg).toContain('width="18"');
  });
});

describe('wordmark', () => {
  it('is an accessible image with an ink pass, a print pass and a spark', () => {
    const svg = wordmarkSvg();
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Vibenta"');
    for (const part of ['vx-wm-ink', 'vx-wm-print', 'vx-wm-spark']) expect(svg).toContain(part);
  });
});

describe('scene accent', () => {
  it('keeps the identity accent on the neutral map', () => {
    expect(sceneAccent({ palette: basePalette, ui: { accent: null } })).toBeNull();
    expect(sceneTone({ palette: basePalette })).toBe('light');
  });

  it('borrows the scene sky hue, re-voiced for Carbon', () => {
    const accent = sceneAccent({ palette: { ...basePalette, sky: '#2a1a5e', land: '#140030' } });
    expect(accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(accent).not.toBe('#2a1a5e');
    expect(sceneTone({ palette: { ...basePalette, land: '#140030' } })).toBe('dark');
  });

  it('prefers an explicit scene UI accent', () => {
    expect(sceneAccent({ palette: basePalette, ui: { accent: '#d9822b' } })).toBe(vivid('#d9822b'));
  });

  it('falls back to paper for a hueless sky', () => {
    expect(vivid('#808080')).toBe('#f3eee3');
  });
});
