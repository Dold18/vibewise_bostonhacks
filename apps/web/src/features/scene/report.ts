/**
 * Preset capability report: what each preset asks for versus what a renderer
 * profile can actually show. Generates the table in PRESETS.md (a test keeps
 * the document in sync with the code).
 */
import { MAP_RENDERER_V1, PALETTE_ADAPTER_V0, supports, type CapabilityProfile } from './capabilities';
import { assetCapabilities } from './runtime';
const ASSETS = assetCapabilities(false);
import { SCENE_CATALOG } from './catalog';
import { choiceOf, PRESET_IDS, PRESETS, type ScenePresetId } from './presets';

export interface PresetReport {
  readonly id: ScenePresetId;
  readonly settings: number;
  /** Settings this profile renders, per profile id. */
  readonly rendered: Readonly<Record<string, number>>;
  /** Requested settings no listed profile renders yet, grouped by catalog system. */
  readonly pending: Readonly<Record<string, readonly string[]>>;
  readonly setPieces: readonly string[];
}

export function presetReport(id: ScenePresetId, profiles: readonly CapabilityProfile[] = [PALETTE_ADAPTER_V0, MAP_RENDERER_V1, ASSETS]): PresetReport {
  const entries = Object.entries(PRESETS[id].settings).map(([key, c]) => ({ key, value: choiceOf(c).value, setting: SCENE_CATALOG.byKey.get(key)! }));
  const ok = (p: CapabilityProfile, e: (typeof entries)[number]) => supports(p, e.key, e.value, e.setting.default);
  const pending: Record<string, string[]> = {};
  for (const e of entries) {
    if (profiles.some((p) => ok(p, e))) continue;
    (pending[e.setting.group.id] ??= []).push(e.setting.id);
  }
  return {
    id,
    settings: entries.length,
    rendered: Object.fromEntries(profiles.map((p) => [p.id, entries.filter((e) => ok(p, e)).length])),
    pending,
    setPieces: PRESETS[id].setPieces ?? [],
  };
}

/** The Markdown capability table for every preset. */
export function renderPresetTable(): string {
  const rows = PRESET_IDS.map((id) => {
    const r = presetReport(id);
    const pending = Object.entries(r.pending).map(([g, ids]) => `${g} (${ids.length})`).join(', ') || 'none';
    return `| \`${id}\` | ${r.settings} | ${r.rendered[PALETTE_ADAPTER_V0.id]} | ${r.rendered[MAP_RENDERER_V1.id]} | ${r.rendered[ASSETS.id]} | ${pending} | ${r.setPieces.map((s) => `\`${s}\``).join(', ') || 'none'} |`;
  });
  return [
    '| Preset | Settings chosen | Palette only (V0) | Baseline (`map-renderer-v1`) | Live assets (`map-assets-v2`) | Not rendered yet, by system | 3D set piece |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
