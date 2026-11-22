/**
 * Verified asset IDs from the scene asset library (PR #33 manifests under
 * public/scene-assets). The compiler references assets only through this
 * registry: an ID that is not in a manifest cannot reach a SceneState.
 *
 * This module only reads parsed manifest JSON; runtime.ts and modelLoader.ts
 * own decoding, lazy loading and rendering.
 */
import type { SceneKey } from './catalog';

export interface LayoutRecord {
  readonly id: string;
  readonly activation: string;
  readonly mood: string;
  readonly slots?: Readonly<Record<string, { center: number[]; radius: number; placements: Placement[] }>>;
  readonly heroAssetIds: readonly string[];
  readonly accentAssetIds: readonly string[];
}

export interface Placement {
  assetId: string; position: number[]; yawDegrees: number; targetMaxDimension: number;
}
export interface AssetSource { readonly uri: string; readonly rect?: readonly number[] }

export interface AssetRegistry {
  readonly sources?: ReadonlyMap<string, AssetSource>;
  readonly models: ReadonlySet<string>;
  /** Manifest `tags` per model ID (e.g. street, nightlife), for themed decoration selection. */
  readonly modelTags?: ReadonlyMap<string, readonly string[]>;
  readonly svg: ReadonlySet<string>;
  readonly layouts: ReadonlyMap<string, LayoutRecord>;
  /** Verified SVG IDs usable for a catalog key (from manifest `usedBy` and the requirements map). */
  readonly texturesByKey: ReadonlyMap<SceneKey, readonly string[]>;
}

export interface ManifestInput {
  /** third-party/kaykit/manifest.v1.json */
  readonly kaykit: unknown;
  /** third-party/modelibr/manifest.v1.json */
  readonly modelibr: unknown;
  /** v1/manifest.json */
  readonly svgV1: unknown;
  /** v2/manifest.json */
  readonly svgV2: unknown;
  /** third-party/composites/layouts.v1.json */
  readonly layouts: unknown;
  /** v1/requirements-map.v1.json */
  readonly requirementsMap?: unknown;
}

/** Layout activations the compiler may trigger from vibe alone. Everything else needs verified context. */
export const VIBE_ACTIVATIONS = new Set(['vibe_selected']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown, field: string): unknown[] => (isObj(v) && Array.isArray(v[field]) ? v[field] : []);
const ids = (v: unknown, field: string) =>
  list(v, field).flatMap((x) => (isObj(x) && typeof x.id === 'string' ? [x.id] : []));

export function buildAssetRegistry(input: ManifestInput): { registry: AssetRegistry; problems: string[] } {
  const problems: string[] = [];
  const sources = new Map<string, AssetSource>();
  for (const manifest of [input.kaykit, input.modelibr]) for (const m of list(manifest, "models")) {
    if (isObj(m) && typeof m.id === "string" && typeof m.uri === "string" && m.uri.startsWith("/scene-assets/")) sources.set(m.id, { uri: m.uri });
  }
  for (const [manifest, root] of [[input.svgV1, "v1"], [input.svgV2, "v2"]] as const) for (const a of list(manifest, "assets")) {
    if (!isObj(a) || typeof a.id !== "string") continue;
    const file = a.file ?? a.atlas;
    if (typeof file === "string" && !file.includes("..") && !file.includes(":")) sources.set(a.id, { uri: `/scene-assets/${root}/${file}`, rect: Array.isArray(a.rect) ? a.rect as number[] : undefined });
  }
  const modelTags = new Map<string, readonly string[]>();
  for (const manifest of [input.kaykit, input.modelibr]) for (const m of list(manifest, 'models')) {
    if (isObj(m) && typeof m.id === 'string' && Array.isArray(m.tags)) modelTags.set(m.id, Object.freeze(m.tags.filter((t): t is string => typeof t === 'string')));
  }
  const models = new Set<string>();
  for (const id of [...ids(input.kaykit, 'models'), ...ids(input.modelibr, 'models')]) {
    if (models.has(id)) problems.push(`duplicate model id ${id}`);
    models.add(id);
  }
  const svg = new Set([...ids(input.svgV1, 'assets'), ...ids(input.svgV2, 'assets')]);

  const layouts = new Map<string, LayoutRecord>();
  for (const s of list(input.layouts, 'scenes')) {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.activation !== 'string' || !isObj(s.slots)) {
      problems.push('layout without id/activation/slots skipped');
      continue;
    }
    const slots = s.slots;
    const slot = (name: string) =>
      list(slots[name], 'placements').flatMap((p) => (isObj(p) && typeof p.assetId === 'string' ? [p.assetId] : []));
    const hero = slot('hero_installation');
    const accent = slot('ambient_accent');
    const missing = [...hero, ...accent].filter((id) => !models.has(id));
    if (missing.length) {
      problems.push(`layout ${s.id} rejected: unknown model ids ${missing.join(', ')}`);
      continue;
    }
    layouts.set(s.id, Object.freeze({ id: s.id, activation: s.activation, mood: String(s.mood ?? ''), heroAssetIds: hero, accentAssetIds: accent, slots: slots as unknown as LayoutRecord["slots"] }));
  }

  const textures = new Map<SceneKey, string[]>();
  const addTexture = (key: unknown, id: unknown) => {
    if (typeof key !== 'string' || typeof id !== 'string') return;
    if (!svg.has(id)) {
      problems.push(`texture ${id} for ${key} is not in an SVG manifest`);
      return;
    }
    const cur = textures.get(key) ?? [];
    if (!cur.includes(id)) textures.set(key, [...cur, id]);
  };
  for (const a of list(input.svgV1, 'assets')) if (isObj(a) && Array.isArray(a.usedBy)) for (const key of a.usedBy) addTexture(key, a.id);
  for (const p of list(input.requirementsMap, 'properties')) {
    if (isObj(p) && Array.isArray(p.availableAssetIds)) for (const id of p.availableAssetIds) addTexture(p.key, id);
  }
  for (const v of textures.values()) v.sort();

  return { registry: Object.freeze({ models, modelTags, svg, layouts, texturesByKey: textures, sources }), problems };
}
