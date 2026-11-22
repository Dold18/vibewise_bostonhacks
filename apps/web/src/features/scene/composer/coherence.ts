/**
 * Artistic coherence checks, run on the scene the compiler actually resolved.
 *
 * Hard rules (must be zero for any composed world):
 *   - exclusive_tags: no stylistically conflicting values (day sky with night
 *     light, neon on paper, rain under a clear sky, two seasons, noir sparkle...)
 *     — this includes consistent lighting direction (morning vs evening vs noon).
 *   - single_particle_system: at most one particle system.
 *   - explicit_only: seasonal/observance-like values only when explicitly requested.
 *   - visual_density: decorative layers within the world's density cap.
 *
 * Soft metrics (reported, compared against random assemblies in tests):
 *   - harmony: palette fit to the harmony's hue roles; distinct hue families.
 *   - figureGround: lightness separation between ground, buildings and roads.
 *   - accentSeparation: the accent hue stands apart from the dominant hue.
 */
import type { Palette } from '../../../mapStyle';
import { SCENE_CATALOG, type SceneCatalog, type SceneKey } from '../catalog';
import { ACCENTS } from '../swatches';
import { isDecorative } from './compose';
import { angularDistance, paletteHarmony, sample, type Harmony } from './harmony';
import { EXPLICIT_ONLY_TAGS, MAX_PARTICLE_SYSTEMS, tagConflicts, tagsOf } from './tags';

export type CoherenceRule = 'exclusive_tags' | 'single_particle_system' | 'explicit_only' | 'visual_density';

export interface Violation {
  readonly rule: CoherenceRule;
  /** Keys involved; the encoder may change any of them that is not explicit. */
  readonly keys: readonly SceneKey[];
  readonly detail: string;
}

export interface CoherenceMetrics {
  readonly harmony: number | null;
  readonly hueFamilies: number;
  /** OKLab lightness gaps: |land − buildings|, |land − major roads|. */
  readonly figureGround: { readonly buildings: number; readonly roads: number };
  /** Degrees between the UI accent and the dominant role (null without an accent). */
  readonly accentSeparation: number | null;
}

export interface CoherenceReport {
  readonly ok: boolean;
  readonly violations: readonly Violation[];
  readonly metrics: CoherenceMetrics;
}

export interface CoherenceOptions {
  readonly catalog?: SceneCatalog;
  readonly densityCap?: number;
  readonly explicitKeys?: ReadonlySet<SceneKey>;
  readonly palette?: Palette;
  readonly harmony?: Harmony;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Non-default (key, value) pairs of a resolved map. */
export function activeValues(resolved: Readonly<Record<SceneKey, string>>, catalog: SceneCatalog = SCENE_CATALOG): Array<[SceneKey, string]> {
  return catalog.settings.filter((s) => resolved[s.key] !== undefined && resolved[s.key] !== s.default).map((s) => [s.key, resolved[s.key]]);
}

export function checkCoherence(resolved: Readonly<Record<SceneKey, string>>, options: CoherenceOptions = {}): CoherenceReport {
  const catalog = options.catalog ?? SCENE_CATALOG;
  const active = activeValues(resolved, catalog);
  const violations: Violation[] = [];

  const seen = new Set<string>();
  for (const c of tagConflicts(active)) {
    const id = [c.a.key, c.b.key].sort().join('|') + `|${[c.a.tag, c.b.tag].sort().join('×')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    violations.push({ rule: 'exclusive_tags', keys: [c.a.key, c.b.key], detail: `${c.a.key}=${c.a.value} vs ${c.b.key}=${c.b.value}: ${c.reason}` });
  }

  const particles = active.filter(([k, v]) => tagsOf(k, v).includes('particles'));
  if (particles.length > MAX_PARTICLE_SYSTEMS) {
    violations.push({ rule: 'single_particle_system', keys: particles.map(([k]) => k), detail: `${particles.length} particle systems: ${particles.map(([k, v]) => `${k}=${v}`).join(', ')}` });
  }

  for (const [k, v] of active) {
    if (tagsOf(k, v).some((t) => EXPLICIT_ONLY_TAGS.has(t)) && !options.explicitKeys?.has(k)) {
      violations.push({ rule: 'explicit_only', keys: [k], detail: `${k}=${v} needs an explicit request` });
    }
  }

  if (options.densityCap !== undefined) {
    const layers = active.filter(([k]) => isDecorative(k));
    if (layers.length > options.densityCap) {
      violations.push({ rule: 'visual_density', keys: layers.map(([k]) => k), detail: `${layers.length} decorative layers > cap ${options.densityCap}` });
    }
  }

  return { ok: violations.length === 0, violations, metrics: metricsFor(resolved, options) };
}

function metricsFor(resolved: Readonly<Record<SceneKey, string>>, options: CoherenceOptions): CoherenceMetrics {
  const p = options.palette;
  const h = options.harmony;
  const ph = p && h ? paletteHarmony(p, h) : null;
  const L = (hex: string) => sample(hex).lightness;
  const accent = resolved['interface_and_cards.accent_token'];
  return {
    harmony: ph ? ph.score : null,
    hueFamilies: ph ? ph.hueFamilies : 0,
    figureGround: p ? { buildings: round3(Math.abs(L(p.land) - L(p.building3d))), roads: round3(Math.abs(L(p.land) - L(p.roadMajor))) } : { buildings: 0, roads: 0 },
    accentSeparation: h && accent && ACCENTS[accent] ? Math.round(angularDistance(sample(ACCENTS[accent]).hue, h.roles.dominant)) : null,
  };
}
