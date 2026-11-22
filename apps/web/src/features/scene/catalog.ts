/**
 * The versioned Scene Effect Catalog (PR #32), parsed and checked strictly.
 *
 * The JSON in `data/` is the runtime copy of `docs/scene/scene-effect-catalog.v1.json`;
 * a test keeps the two identical. The catalog is a vocabulary, not a list of
 * working effects: whether a value actually renders is decided by the
 * capability profile (capabilities.ts), never by the catalog's `tier`.
 */
import raw from './data/scene-effect-catalog.v1.json';

/** `"<group>.<setting>"`, e.g. `"sky_and_horizon.sky_mode"`. */
export type SceneKey = string;
export type SceneTier = 'foundation' | 'extension' | 'custom';

export interface SceneGroup {
  readonly id: string;
  readonly renderer: string;
  /** False for groups the model may never write (navigation safety, camera). */
  readonly aiSelectable: boolean;
  readonly selectPolicy: string;
}

export interface SceneSetting {
  readonly key: SceneKey;
  readonly group: SceneGroup;
  readonly id: string;
  readonly default: string;
  readonly values: readonly string[];
  readonly tier: SceneTier;
  readonly allowIntensity: boolean;
}

export interface SceneCatalog {
  readonly schemaVersion: string;
  readonly groups: readonly SceneGroup[];
  /** Every setting, in catalog order (this order is part of the output's stability). */
  readonly settings: readonly SceneSetting[];
  readonly byKey: ReadonlyMap<SceneKey, SceneSetting>;
  /** Overrides accepted from model-written (untrusted) SceneIntents. */
  readonly aiOverrideLimit: number;
  /**
   * Overrides accepted when local code submits a composer encoding as `source: 'composer'`
   * (SceneSession.submit options; never asserted by the payload). Every override is still
   * validated exactly like a model's. Defaults to `aiOverrideLimit`; never below it.
   */
  readonly composerOverrideLimit: number;
  readonly maxWeightedPresets: number;
}

export class CatalogError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid scene catalog:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

const ID = /^[a-z][a-z0-9_]*$/;
const TIERS = new Set<string>(['foundation', 'extension', 'custom']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Parse untrusted catalog JSON. Collects every problem, then throws once. */
export function parseCatalog(json: unknown): SceneCatalog {
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);
  if (!isObj(json)) throw new CatalogError(['catalog is not an object']);

  const schemaVersion = typeof json.schemaVersion === 'string' && /^\d+\.\d+\.\d+$/.test(json.schemaVersion) ? json.schemaVersion : '';
  if (!schemaVersion) fail('schemaVersion must be a semver string');

  const policy = isObj(json.runtimePolicy) ? json.runtimePolicy : {};
  const limit = (v: unknown, name: string, fallback: number) => {
    if (Number.isInteger(v) && (v as number) > 0) return v as number;
    fail(`runtimePolicy.${name} must be a positive integer`);
    return fallback;
  };
  const aiOverrideLimit = limit(policy.aiOverrideLimit, 'aiOverrideLimit', 12);
  const composerOverrideLimit =
    policy.composerOverrideLimit === undefined ? aiOverrideLimit : Math.max(aiOverrideLimit, limit(policy.composerOverrideLimit, 'composerOverrideLimit', aiOverrideLimit));
  const maxWeightedPresets = limit(policy.maxWeightedPresets, 'maxWeightedPresets', 3);

  const groups: SceneGroup[] = [];
  const settings: SceneSetting[] = [];
  const byKey = new Map<SceneKey, SceneSetting>();
  if (!Array.isArray(json.groups) || json.groups.length === 0) fail('groups must be a non-empty array');

  for (const [gi, g] of (Array.isArray(json.groups) ? json.groups : []).entries()) {
    const where = `groups[${gi}]`;
    if (!isObj(g) || typeof g.id !== 'string' || !ID.test(g.id)) {
      fail(`${where}.id is missing or malformed`);
      continue;
    }
    if (groups.some((x) => x.id === g.id)) fail(`duplicate group id ${g.id}`);
    if (typeof g.renderer !== 'string' || !g.renderer) fail(`${g.id}.renderer is missing`);
    if (typeof g.aiSelectable !== 'boolean') fail(`${g.id}.aiSelectable must be boolean`);
    const group: SceneGroup = Object.freeze({
      id: g.id,
      renderer: String(g.renderer ?? ''),
      aiSelectable: g.aiSelectable === true,
      selectPolicy: String(g.selectPolicy ?? ''),
    });
    groups.push(group);

    if (!Array.isArray(g.settings) || g.settings.length === 0) fail(`${g.id}.settings must be a non-empty array`);
    for (const [si, s] of (Array.isArray(g.settings) ? g.settings : []).entries()) {
      if (!isObj(s) || typeof s.id !== 'string' || !ID.test(s.id)) {
        fail(`${g.id}.settings[${si}].id is missing or malformed`);
        continue;
      }
      const key = `${g.id}.${s.id}`;
      if (byKey.has(key)) fail(`duplicate setting key ${key}`);
      if (s.type !== 'enum') fail(`${key}.type must be "enum"`);
      const values = Array.isArray(s.values) ? s.values : [];
      if (values.length === 0) fail(`${key}.values must be a non-empty array`);
      if (!values.every((v) => typeof v === 'string' && ID.test(v))) fail(`${key}.values must be snake_case ids`);
      if (new Set(values).size !== values.length) fail(`${key}.values has duplicates`);
      if (typeof s.default !== 'string' || !values.includes(s.default)) fail(`${key}.default is not one of its values`);
      if (typeof s.tier !== 'string' || !TIERS.has(s.tier)) fail(`${key}.tier is invalid`);
      if (typeof s.allowIntensity !== 'boolean') fail(`${key}.allowIntensity must be boolean`);
      const setting: SceneSetting = Object.freeze({
        key,
        group,
        id: s.id,
        default: String(s.default),
        values: Object.freeze(values.map(String)),
        tier: s.tier as SceneTier,
        allowIntensity: s.allowIntensity === true,
      });
      settings.push(setting);
      byKey.set(key, setting);
    }
  }

  if (problems.length) throw new CatalogError(problems);
  return Object.freeze({
    schemaVersion,
    groups: Object.freeze(groups),
    settings: Object.freeze(settings),
    byKey,
    aiOverrideLimit,
    composerOverrideLimit,
    maxWeightedPresets,
  });
}

/** The bundled catalog v1. Throws at import time if the JSON is invalid (CI catches it). */
export const SCENE_CATALOG: SceneCatalog = parseCatalog(raw);
