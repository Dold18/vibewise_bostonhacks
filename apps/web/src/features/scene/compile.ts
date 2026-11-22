/**
 * compileScene: SceneIntent (untrusted, compact) → SceneState (complete, safe).
 *
 * Pure and deterministic: the same inputs always give a byte-identical state,
 * so reversing a quiz answer reproduces the earlier scene exactly, and states
 * can be cached by hash. Pipeline (design §4):
 *
 *   sanitize → pick source (outing > account > neutral) → weigh preset choices
 *   → apply overrides → lock protected groups → constraint rules
 *   → clip to renderer capabilities → performance budget
 *   → realize palette/light/sky/overlays → contrast guard → assets → hash
 */
import { basePalette, type Palette } from '../../mapStyle';
import type { VibeKey } from '../account/vibes';
import type { AssetRegistry } from './assets';
import { VIBE_ACTIVATIONS } from './assets';
import { PALETTE_ADAPTER_V0, supports, type CapabilityProfile } from './capabilities';
import { SCENE_CATALOG, type SceneCatalog, type SceneKey } from './catalog';
import { performanceBudget, RULES, winner, type RuleEnv, type Slot, type Work } from './constraints';
import { guardPalette } from './guard';
import { sanitizeIntent, SCENE_SCHEMA_VERSION, type Diagnostic, type SceneIntent, type WeightedPreset } from './intent';
import { presetsFromDescriptors, presetsFromVibeTags } from './lexicon';
import { choiceOf, PRESETS, PRESET_IDS } from './presets';
import {
  groupValues, preferredLabels, realizeLighting, realizeMotion, realizeOverlays, realizePalette, realizeSky, realizeUi,
} from './realize';
import { DEFAULT_CONTEXT, hashString, stableStringify, type DisabledRequest, type SceneContext, type SceneState, type SetPiece } from './state';

export const COMPILER_VERSION = '0.1.0';

/** Default override intensity is the scene's presence, but never fainter than this. */
export const MIN_OVERRIDE_PRESENCE = 0.35;
/** A preset needs at least this weight before its 3D set piece is considered. */
export const SET_PIECE_MIN_WEIGHT = 0.35;

export interface CompileInput {
  /** Current-outing SceneIntent from the model or the local fallback (untrusted). */
  readonly outing?: unknown;
  /** Saved account taste, as vibeTheme's ThemeTarget. Used only without an outing scene. */
  readonly account?: { readonly tags: Partial<Record<VibeKey, number>>; readonly strength: number } | null;
  readonly capabilities?: CapabilityProfile;
  readonly context?: Partial<SceneContext>;
  readonly assets?: AssetRegistry | null;
  readonly catalog?: SceneCatalog;
  readonly base?: Palette;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface Picked {
  readonly source: SceneState['source'];
  readonly presets: readonly WeightedPreset[];
  readonly overrides: SceneIntent['overrides'];
  readonly sessionVersion: number;
}

function pickSource(intent: SceneIntent | null, account: CompileInput['account']): Picked {
  if (intent) {
    const presets = intent.presets.length ? intent.presets : presetsFromDescriptors(intent.descriptors);
    if (presets.some((p) => p.id !== 'neutral') || intent.overrides.length) {
      return { source: 'outing', presets, overrides: intent.overrides, sessionVersion: intent.sessionVersion };
    }
  }
  const fromAccount = account ? presetsFromVibeTags(account.tags ?? {}, account.strength) : [];
  if (fromAccount.length) return { source: 'account', presets: fromAccount, overrides: [], sessionVersion: intent?.sessionVersion ?? 0 };
  return { source: 'neutral', presets: [], overrides: [], sessionVersion: intent?.sessionVersion ?? 0 };
}

function weigh(catalog: SceneCatalog, presets: readonly WeightedPreset[]): Work {
  const work: Work = new Map();
  for (const s of catalog.settings) {
    if (!s.group.aiSelectable) {
      work.set(s.key, { choices: [], provenance: 'locked' });
      continue;
    }
    const votes = new Map<string, number>();
    for (const { id, weight } of presets) {
      const choice = PRESETS[id].settings[s.key];
      if (choice === undefined) continue;
      const { value, strength } = choiceOf(choice);
      votes.set(value, (votes.get(value) ?? 0) + weight * strength);
    }
    const choices = [...votes]
      .map(([value, weight]) => ({ value, weight: round3(weight) }))
      .filter((c) => c.weight > 0)
      .sort((a, b) => b.weight - a.weight || s.values.indexOf(a.value) - s.values.indexOf(b.value));
    work.set(s.key, { choices, provenance: choices.length ? 'preset' : 'default' } satisfies Slot);
  }
  return work;
}

export function compileScene(input: CompileInput = {}): SceneState {
  const catalog = input.catalog ?? SCENE_CATALOG;
  const base = input.base ?? basePalette;
  const capabilities = input.capabilities ?? PALETTE_ADAPTER_V0;
  const context: SceneContext = { ...DEFAULT_CONTEXT, ...input.context };
  const diagnostics: Diagnostic[] = [];
  const note = (code: string, detail: string) => diagnostics.push({ code, detail });

  const { intent, diagnostics: intentNotes } = sanitizeIntent(input.outing, catalog);
  diagnostics.push(...intentNotes);
  const { source, presets, overrides, sessionVersion } = pickSource(intent, input.account);

  // 1. Weighted preset choices, then explicit overrides on top.
  const work = weigh(catalog, presets);
  const presence = Math.min(1, presets.reduce((s, p) => s + (p.id === 'neutral' ? 0 : p.weight), 0));
  for (const o of overrides) {
    const setting = catalog.byKey.get(o.key)!;
    const weight = round3(o.intensity ?? Math.max(MIN_OVERRIDE_PRESENCE, presence));
    work.set(o.key, { choices: o.value === setting.default ? [] : [{ value: o.value, weight }], provenance: 'override' });
  }

  // 2. Conflict and safety rules.
  const env: RuleEnv = { catalog, context, note };
  for (const rule of RULES) rule.apply(work, env);

  // 3. Clip to what this renderer can actually show; never report the rest as active.
  const disabled: DisabledRequest[] = [];
  for (const s of catalog.settings) {
    const slot = work.get(s.key)!;
    const kept = slot.choices.filter((c) => supports(capabilities, s.key, c.value, s.default));
    if (kept.length === slot.choices.length) continue;
    for (const c of slot.choices) {
      if (!kept.includes(c)) disabled.push({ key: s.key, value: c.value, reason: `not implemented in ${capabilities.id}` });
    }
    work.set(s.key, { choices: kept, provenance: 'capability' });
  }
  performanceBudget.apply(work, env);

  // 4. Discrete resolution: one value per catalog key.
  const resolved: Record<SceneKey, string> = {};
  const strengths: Record<SceneKey, number> = {};
  const provenance: Record<SceneKey, Slot['provenance']> = {};
  for (const s of catalog.settings) {
    const w = winner(work, s.key, catalog);
    resolved[s.key] = w?.value ?? s.default;
    if (w) strengths[s.key] = w.weight;
    provenance[s.key] = work.get(s.key)!.provenance;
  }

  // 5. Realization and the contrast guard.
  const guarded = guardPalette(realizePalette(work, base), preferredLabels(work, catalog));
  for (const c of guarded.corrections) note('contrast_guard', c);
  const palette = guarded.palette;
  const textures = (key: string) => (capabilities.features.has('svg_textures') ? input.assets?.texturesByKey.get(key) ?? [] : []);

  const state: Omit<SceneState, 'hash'> = {
    schemaVersion: SCENE_SCHEMA_VERSION,
    catalogVersion: catalog.schemaVersion,
    compilerVersion: COMPILER_VERSION,
    capabilityProfile: capabilities.id,
    sessionVersion,
    source,
    presets: presets.map((p) => ({ id: p.id, weight: p.weight })),
    resolved,
    strengths,
    provenance,
    disabled,
    palette,
    darkMode: guarded.darkMode,
    lighting: realizeLighting(work, palette),
    sky: realizeSky(work, palette),
    overlays: realizeOverlays(work, catalog, textures),
    markers: groupValues(work, catalog, 'marker_recommendations'),
    ui: realizeUi(work, catalog),
    motion: realizeMotion(work, catalog, context.reducedMotion),
    setPiece: chooseSetPiece(presets, input.assets ?? null, capabilities, context, disabled, note),
    diagnostics,
  };
  return Object.freeze({ ...state, hash: hashString(stableStringify(state)) });
}

/**
 * A 3D set piece only from a strong enough preset, only a `vibe_selected`
 * layout whose every model ID is verified, never while navigating, and only on
 * a renderer that has a 3D layer. Explicit cuisine/music layouts need verified
 * venue context, which SceneIntent v1 does not carry.
 */
function chooseSetPiece(
  presets: readonly WeightedPreset[],
  assets: AssetRegistry | null,
  capabilities: CapabilityProfile,
  context: SceneContext,
  disabled: DisabledRequest[],
  note: (code: string, detail: string) => void,
): SetPiece | null {
  const ordered = [...presets].sort((a, b) => b.weight - a.weight || PRESET_IDS.indexOf(a.id) - PRESET_IDS.indexOf(b.id));
  const lead = ordered.find((p) => p.weight >= SET_PIECE_MIN_WEIGHT && PRESETS[p.id].setPieces?.length);
  if (!lead) return null;
  for (const layoutId of PRESETS[lead.id].setPieces!) {
    const layout = assets?.layouts.get(layoutId);
    if (!assets) {
      note('set_piece', `${layoutId}: no asset registry loaded`);
      return null;
    }
    if (!layout) {
      note('set_piece', `${layoutId}: not a verified layout`);
      continue;
    }
    if (!VIBE_ACTIVATIONS.has(layout.activation)) {
      note('set_piece', `${layoutId}: activation ${layout.activation} needs verified context`);
      continue;
    }
    if (context.navigation !== 'browse') {
      note('set_piece', `${layoutId}: hidden while navigating`);
      return null;
    }
    if (!capabilities.features.has('set_piece_3d')) {
      disabled.push({ key: 'assets.set_piece', value: layoutId, reason: `not implemented in ${capabilities.id}` });
      return null;
    }
    return { layoutId, heroAssetIds: layout.heroAssetIds, accentAssetIds: layout.accentAssetIds };
  }
  return null;
}
