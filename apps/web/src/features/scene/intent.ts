/**
 * SceneIntent: the compact art direction a model (or local fallback) proposes.
 * Shape from docs/SCENE_COMPOSER_DESIGN.md §2. It is structurally compatible
 * with the boundary type in the adaptive vibe engine's `adapters.ts`.
 *
 * Everything here is untrusted. `sanitizeIntent` never throws: it keeps what
 * is valid, drops the rest and says why.
 */
import { SCENE_CATALOG, type SceneCatalog, type SceneKey } from './catalog';
import { PRESET_IDS, type ScenePresetId } from './presets';

export const SCENE_SCHEMA_VERSION = '1.0.0';

export interface SceneOverride {
  /** `group.setting`, from the catalog. */
  readonly key: SceneKey;
  /** One of that setting's documented values. */
  readonly value: string;
  /** 0..1, only for settings with `allowIntensity`. */
  readonly intensity?: number;
}

export interface WeightedPreset {
  readonly id: ScenePresetId;
  /** 0..1. Weights may sum to less than 1; the remainder is the plain map. */
  readonly weight: number;
}

export interface SceneIntent {
  readonly schemaVersion: typeof SCENE_SCHEMA_VERSION;
  /** Quiz snapshot version; newer always wins (see sceneState in a later phase). */
  readonly sessionVersion: number;
  readonly presets: readonly WeightedPreset[];
  /** Human words ("moody", "rain-lit"); mapped to presets only when `presets` is empty. */
  readonly descriptors: readonly string[];
  readonly overrides: readonly SceneOverride[];
}

export interface Diagnostic {
  readonly code: string;
  readonly detail: string;
}

export const MAX_DESCRIPTORS = 12;
const MAX_DESCRIPTOR_LENGTH = 48;
const PRESETS = new Set<string>(PRESET_IDS);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Who wrote an intent, as asserted by the calling code (never by the payload).
 * `model`: an untrusted model/fallback intent. `composer`: the local procedural composer,
 * which may use `composerOverrideLimit`; its overrides are validated identically.
 */
export type IntentTrust = 'model' | 'composer';

export function sanitizeIntent(
  raw: unknown,
  catalog: SceneCatalog = SCENE_CATALOG,
  trust: IntentTrust = 'model',
): { intent: SceneIntent | null; diagnostics: Diagnostic[] } {
  const overrideLimit = trust === 'composer' ? catalog.composerOverrideLimit : catalog.aiOverrideLimit;
  const diagnostics: Diagnostic[] = [];
  const note = (code: string, detail: string) => diagnostics.push({ code, detail });

  if (raw === null || raw === undefined) return { intent: null, diagnostics };
  if (!isObj(raw)) {
    note('intent_rejected', 'intent is not an object');
    return { intent: null, diagnostics };
  }
  if (raw.schemaVersion !== SCENE_SCHEMA_VERSION) {
    note('intent_rejected', `unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}`);
    return { intent: null, diagnostics };
  }
  if (!Number.isInteger(raw.sessionVersion) || (raw.sessionVersion as number) < 0) {
    note('intent_rejected', 'sessionVersion must be a non-negative integer');
    return { intent: null, diagnostics };
  }

  // Presets: known IDs, clamped weights, duplicates summed, strongest N kept, total ≤ 1.
  const weights = new Map<ScenePresetId, number>();
  for (const p of Array.isArray(raw.presets) ? raw.presets : []) {
    if (!isObj(p) || typeof p.id !== 'string' || !PRESETS.has(p.id)) {
      note('preset_dropped', `unknown preset ${JSON.stringify(isObj(p) ? p.id : p)}`);
      continue;
    }
    if (!finite(p.weight) || p.weight <= 0) {
      note('preset_dropped', `${p.id}: weight must be a positive number`);
      continue;
    }
    const id = p.id as ScenePresetId;
    weights.set(id, (weights.get(id) ?? 0) + clamp01(p.weight));
  }
  if (raw.presets !== undefined && !Array.isArray(raw.presets)) note('preset_dropped', 'presets is not an array');
  let presets = [...weights].map(([id, weight]) => ({ id, weight }));
  presets.sort((a, b) => b.weight - a.weight || PRESET_IDS.indexOf(a.id) - PRESET_IDS.indexOf(b.id));
  if (presets.length > catalog.maxWeightedPresets) {
    note('preset_dropped', `kept the ${catalog.maxWeightedPresets} strongest of ${presets.length} presets`);
    presets = presets.slice(0, catalog.maxWeightedPresets);
  }
  const total = presets.reduce((s, p) => s + p.weight, 0);
  if (total > 1) presets = presets.map((p) => ({ ...p, weight: p.weight / total }));
  presets = presets.map((p) => ({ ...p, weight: round3(p.weight) }));

  // Descriptors: short trimmed lowercase strings, deduplicated.
  const descriptors: string[] = [];
  for (const d of Array.isArray(raw.descriptors) ? raw.descriptors : []) {
    if (typeof d !== 'string') continue;
    const clean = d.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!clean || clean.length > MAX_DESCRIPTOR_LENGTH || descriptors.includes(clean)) continue;
    if (descriptors.length >= MAX_DESCRIPTORS) {
      note('descriptor_dropped', `more than ${MAX_DESCRIPTORS} descriptors`);
      break;
    }
    descriptors.push(clean);
  }

  // Overrides: catalog keys in AI-selectable groups, documented values, first one per key wins.
  const overrides: SceneOverride[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw.overrides) ? raw.overrides : [];
  for (const o of list) {
    if (overrides.length >= overrideLimit) {
      note('override_dropped', `more than ${overrideLimit} overrides`);
      break;
    }
    if (!isObj(o) || typeof o.key !== 'string' || typeof o.value !== 'string') {
      note('override_dropped', 'override needs string key and value');
      continue;
    }
    const setting = catalog.byKey.get(o.key);
    if (!setting) {
      note('override_dropped', `unknown key ${o.key}`);
      continue;
    }
    if (!setting.group.aiSelectable) {
      note('override_locked', `${o.key} is not model-editable (${setting.group.selectPolicy})`);
      continue;
    }
    if (!setting.values.includes(o.value)) {
      note('override_dropped', `${o.key}: unknown value ${o.value}`);
      continue;
    }
    if (seen.has(o.key)) {
      note('override_dropped', `${o.key}: duplicate, first kept`);
      continue;
    }
    seen.add(o.key);
    let intensity: number | undefined;
    if (o.intensity !== undefined) {
      if (!setting.allowIntensity) note('intensity_dropped', `${o.key} does not take an intensity`);
      else if (!finite(o.intensity)) note('intensity_dropped', `${o.key}: intensity is not a number`);
      else intensity = round3(clamp01(o.intensity));
    }
    overrides.push(intensity === undefined ? { key: o.key, value: o.value } : { key: o.key, value: o.value, intensity });
  }

  return {
    intent: {
      schemaVersion: SCENE_SCHEMA_VERSION,
      sessionVersion: raw.sessionVersion as number,
      presets,
      descriptors,
      overrides,
    },
    diagnostics,
  };
}

/** True when the intent asks for anything at all (otherwise the next source applies). */
export const intentIsEmpty = (i: SceneIntent) =>
  i.presets.every((p) => p.id === 'neutral') && i.descriptors.length === 0 && i.overrides.length === 0;
