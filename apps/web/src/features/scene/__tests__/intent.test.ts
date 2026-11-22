import { describe, expect, it } from 'vitest';
import { parseCatalog } from '../catalog';
import raw from '../data/scene-effect-catalog.v1.json';
import { sanitizeIntent } from '../intent';
import { DESIGN_EXAMPLE, intent } from './fixtures';

const codes = (r: ReturnType<typeof sanitizeIntent>) => r.diagnostics.map((d) => d.code);

describe('sanitizeIntent', () => {
  it('accepts the design-doc example unchanged', () => {
    const { intent: out, diagnostics } = sanitizeIntent(DESIGN_EXAMPLE);
    expect(diagnostics).toEqual([]);
    expect(out).toEqual(DESIGN_EXAMPLE);
  });

  it('treats a missing intent as no intent, silently', () => {
    expect(sanitizeIntent(undefined)).toEqual({ intent: null, diagnostics: [] });
    expect(sanitizeIntent(null)).toEqual({ intent: null, diagnostics: [] });
  });

  it.each([
    ['a string', 'make it moody'],
    ['an array', []],
    ['a wrong schema version', { ...DESIGN_EXAMPLE, schemaVersion: '2.0.0' }],
    ['a negative session version', { ...DESIGN_EXAMPLE, sessionVersion: -1 }],
    ['a fractional session version', { ...DESIGN_EXAMPLE, sessionVersion: 1.5 }],
  ])('rejects %s', (_, raw) => {
    const r = sanitizeIntent(raw);
    expect(r.intent).toBeNull();
    expect(codes(r)).toEqual(['intent_rejected']);
  });

  it('drops unknown presets and bad weights; sums duplicates', () => {
    const r = sanitizeIntent(
      {
        ...intent(),
        presets: [
          { id: 'noir_nocturne', weight: 0.2 },
          { id: 'noir_nocturne', weight: 0.1 },
          { id: 'vaporwave', weight: 0.5 },
          { id: 'neon_city', weight: Number.NaN },
          { id: 'amber_refuge', weight: -1 },
          'retro_atlas',
        ],
      },
    );
    expect(r.intent!.presets).toEqual([{ id: 'noir_nocturne', weight: 0.3 }]);
    expect(codes(r).filter((c) => c === 'preset_dropped')).toHaveLength(4);
  });

  it('keeps the three strongest presets and normalizes only when weights exceed 1', () => {
    const many = sanitizeIntent(intent([['noir_nocturne', 0.9], ['neon_city', 0.6], ['amber_refuge', 0.3], ['retro_atlas', 0.2]]));
    expect(many.intent!.presets.map((p) => p.id)).toEqual(['noir_nocturne', 'neon_city', 'amber_refuge']);
    expect(many.intent!.presets.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 2);

    // Weights under 1 are a deliberate partial scene; the rest is the plain map.
    const faint = sanitizeIntent(intent([['noir_nocturne', 0.2], ['neon_city', 0.1]]));
    expect(faint.intent!.presets).toEqual([{ id: 'noir_nocturne', weight: 0.2 }, { id: 'neon_city', weight: 0.1 }]);
  });

  it('orders presets canonically so equivalent intents are identical', () => {
    const a = sanitizeIntent(intent([['neon_city', 0.3], ['noir_nocturne', 0.3]])).intent;
    const b = sanitizeIntent(intent([['noir_nocturne', 0.3], ['neon_city', 0.3]])).intent;
    expect(a).toEqual(b);
  });

  it('only accepts overrides for model-editable keys with documented values', () => {
    const r = sanitizeIntent(
      intent([], {
        overrides: [
          { key: 'navigation_safe.route_treatment', value: 'high_contrast_leg_colors' },
          { key: 'camera_and_perspective.camera_shake', value: 'tiny_artistic' },
          { key: 'sky_and_horizon.sky_mode', value: 'plaid' },
          { key: 'sky_and_horizon.not_a_setting', value: 'x' },
          { key: 'sky_and_horizon.sky_mode', value: 'night_indigo' },
          { key: 'sky_and_horizon.sky_mode', value: 'clear_blue' },
        ],
      }),
    );
    expect(r.intent!.overrides).toEqual([{ key: 'sky_and_horizon.sky_mode', value: 'night_indigo' }]);
    expect(codes(r)).toEqual(['override_locked', 'override_locked', 'override_dropped', 'override_dropped', 'override_dropped']);
  });

  it('clamps intensity and drops it where a setting takes none', () => {
    // In catalog v1 every model-editable setting takes an intensity, so use a variant.
    const variant = JSON.parse(JSON.stringify(raw));
    variant.groups.find((g: { id: string }) => g.id === 'building_surfaces').settings.find((s: { id: string }) => s.id === 'corner_appearance').allowIntensity = false;
    const r = sanitizeIntent(
      intent([], {
        overrides: [
          { key: 'air_and_atmosphere.fog_volume', value: 'light', intensity: 7 },
          { key: 'building_surfaces.corner_appearance', value: 'softened', intensity: 0.5 },
        ],
      }),
      parseCatalog(variant),
    );
    const settingTakesIntensity = r.intent!.overrides[0];
    expect(settingTakesIntensity.intensity).toBe(1);
    expect(r.intent!.overrides[1]).toEqual({ key: 'building_surfaces.corner_appearance', value: 'softened' });
    expect(codes(r)).toEqual(['intensity_dropped']);
  });

  it('caps overrides at the catalog limit', () => {
    const keys = [
      'global_grade.palette_family', 'global_grade.hue_bias', 'global_grade.saturation', 'global_grade.contrast_curve',
      'global_grade.temperature', 'global_grade.shadow_tint', 'global_grade.highlight_tint', 'sky_and_horizon.sky_mode',
      'sky_and_horizon.horizon_glow', 'lighting_and_shadows.light_color', 'water_and_coast.water_palette',
      'natural_land.park_palette', 'natural_land.wood_palette',
    ];
    const values = ['pastel', 'rose', 'muted', 'low_soft', 'sun_warm', 'purple', 'peach', 'dream_pastel', 'rose_band', 'pink', 'aqua', 'storybook', 'muted'];
    const r = sanitizeIntent(intent([], { overrides: keys.map((key, i) => ({ key, value: values[i] })) }));
    expect(r.intent!.overrides).toHaveLength(12);
    expect(codes(r)).toContain('override_dropped');
  });

  it('cleans descriptors: trimmed, lowercased, deduplicated, length- and count-capped', () => {
    const r = sanitizeIntent(intent([], { descriptors: ['  Moody ', 'moody', 'x'.repeat(80), 'RAIN  lit', ...Array(20).fill(0).map((_, i) => `w${i}`)] }));
    expect(r.intent!.descriptors.slice(0, 2)).toEqual(['moody', 'rain lit']);
    expect(r.intent!.descriptors).toHaveLength(12);
  });

  it('never throws on hostile input', () => {
    const junk: unknown[] = [
      0, true, Symbol.iterator.toString(), { schemaVersion: '1.0.0', sessionVersion: 0, presets: 'all', overrides: {}, descriptors: 5 },
      { schemaVersion: '1.0.0', sessionVersion: 0, presets: [null, [], { id: {} }], overrides: [null, 1, { key: 1, value: 2 }] },
      JSON.parse('{"schemaVersion":"1.0.0","sessionVersion":3,"__proto__":{"polluted":true},"presets":[{"id":"__proto__","weight":1}]}'),
    ];
    for (const j of junk) expect(() => sanitizeIntent(j)).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
