/** Presets, swatches and the lexicon may only speak the catalog's (and the manifests') language. */
import { describe, expect, it } from 'vitest';
import { basePalette } from '../../../mapStyle';
import { VIBE_KEYS } from '../../account/vibes';
import { PALETTE_ADAPTER_V0, SCENE_ADAPTER_V1_PROPOSED } from '../capabilities';
import { SCENE_CATALOG } from '../catalog';
import { presetsFromDescriptors, presetsFromVibeTags, VIBE_KEY_PRESETS } from '../lexicon';
import { choiceOf, PRESET_IDS, PRESETS } from '../presets';
import { LABEL_SYSTEMS, PALETTE_SWATCHES, RELATIONS } from '../swatches';
import { realRegistry } from './fixtures';

describe('presets', () => {
  it.each(PRESET_IDS)('%s uses only valid, model-editable catalog values', (id) => {
    const preset = PRESETS[id];
    expect(preset.id).toBe(id);
    for (const [key, choice] of Object.entries(preset.settings)) {
      const setting = SCENE_CATALOG.byKey.get(key);
      expect(setting, key).toBeDefined();
      expect(setting!.group.aiSelectable, key).toBe(true);
      const { value, strength } = choiceOf(choice);
      expect(setting!.values, key).toContain(value);
      expect(strength, key).toBeGreaterThan(0);
      expect(strength, key).toBeLessThanOrEqual(1);
    }
  });

  it('set pieces name verified layouts that may activate from vibe alone', () => {
    const { registry } = realRegistry();
    for (const id of PRESET_IDS) {
      for (const layoutId of PRESETS[id].setPieces ?? []) {
        expect(registry.layouts.get(layoutId)?.activation, `${id} → ${layoutId}`).toBe('vibe_selected');
      }
    }
  });
});

describe('swatches', () => {
  it('only realize catalog values, and never a setting default', () => {
    for (const [key, table] of Object.entries(PALETTE_SWATCHES)) {
      const setting = SCENE_CATALOG.byKey.get(key);
      expect(setting, key).toBeDefined();
      for (const value of Object.keys(table)) {
        expect(setting!.values, `${key}.${value}`).toContain(value);
        expect(value, `${key}: the default must stay the plain map`).not.toBe(setting!.default);
      }
    }
    for (const value of Object.keys(LABEL_SYSTEMS)) expect(SCENE_CATALOG.byKey.get('text_and_labels.label_color_system')!.values).toContain(value);
  });

  it('realize every non-default value of every palette-driven setting', () => {
    for (const key of Object.keys(PALETTE_SWATCHES)) {
      const setting = SCENE_CATALOG.byKey.get(key)!;
      expect(Object.keys(PALETTE_SWATCHES[key]).sort(), key).toEqual(setting.values.filter((v) => v !== setting.default).sort());
    }
  });

  it('relations name real palette keys and list anchors before their dependents', () => {
    const seen = new Set<string>();
    for (const [dep, anchor] of RELATIONS) {
      expect(basePalette).toHaveProperty(dep);
      expect(basePalette).toHaveProperty(anchor);
      expect(seen.has(dep), `${dep} is used as an anchor before it is derived`).toBe(false);
      seen.add(anchor);
    }
  });

  const realized = (profile: typeof PALETTE_ADAPTER_V0) =>
    [...profile.values].reduce((n, [key, values]) => n + [...values].filter((v) => v !== SCENE_CATALOG.byKey.get(key)!.default).length, 0);

  it('V0 realizes 128 of the 828 catalog variations; the proposed v1 adapter 148', () => {
    expect(realized(PALETTE_ADAPTER_V0)).toBe(128);
    expect(realized(SCENE_ADAPTER_V1_PROPOSED)).toBe(148);
  });
});

describe('lexicon', () => {
  it('maps every account vibe key to real presets', () => {
    expect(Object.keys(VIBE_KEY_PRESETS).sort()).toEqual([...VIBE_KEYS].sort());
    for (const pull of Object.values(VIBE_KEY_PRESETS)) for (const id of Object.keys(pull)) expect(PRESET_IDS).toContain(id);
  });

  it('turns descriptors into at most three presets at the requested presence', () => {
    const p = presetsFromDescriptors(['moody', 'rain-lit', 'intimate', 'cinematic'], 0.6);
    expect(p[0].id).toBe('noir_jazz');
    expect(p.map((x) => x.id)).toContain('neon_city');
    expect(p.length).toBeLessThanOrEqual(3);
    expect(p.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(0.6, 2);
  });

  it('understands the adaptive engine’s current descriptors (account vibe keys)', () => {
    expect(presetsFromDescriptors(['cozy'])).toEqual([{ id: 'amber_refuge', weight: 0.6 }]);
  });

  it('ignores unknown words and avoids prefix false positives', () => {
    expect(presetsFromDescriptors(['xyzzy', 'mlem'])).toEqual([]);
    expect(presetsFromDescriptors(['season', 'diverse', 'rainbow', 'seat'])).toEqual([]);
  });

  it('weights account taste by its strength and its strongest vibe', () => {
    expect(presetsFromVibeTags({ cozy: 1 }, 0.5)).toEqual([{ id: 'amber_refuge', weight: 0.5 }]);
    expect(presetsFromVibeTags({ cozy: 0.2 }, 1)).toEqual([{ id: 'amber_refuge', weight: 0.2 }]);
    expect(presetsFromVibeTags({}, 1)).toEqual([]);
    expect(presetsFromVibeTags({ cozy: 1 }, 0)).toEqual([]);
  });
});

describe('PRESETS.md', () => {
  it('its capability table matches the code', async () => {
    const { readFileSync } = await import('node:fs');
    const { renderPresetTable } = await import('../report');
    const doc = readFileSync(new URL('../PRESETS.md', import.meta.url), 'utf8');
    const table = doc.split('<!-- preset-table:start -->\n')[1]?.split('\n<!-- preset-table:end -->')[0];
    expect(table).toBe(renderPresetTable());
  });
});
