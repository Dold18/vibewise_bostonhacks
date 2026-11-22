/**
 * Shared performance budgets. The tier comes from `SceneContext.performance`;
 * the plan carries a per-section allocation; renderers self-limit and report
 * `usage()`; the engine flags overruns in `stats()`.
 */
import type { PerformanceTier, ResourceBudget, ResourceKey, SectionId } from './contracts';
import { SECTION_IDS } from './contracts';

export const RESOURCE_KEYS: readonly ResourceKey[] = Object.freeze(['styleLayers', 'textureMB', 'modelInstances', 'particles', 'overlayElements', 'customLayers']);

/**
 * Whole-city totals per tier. `low` (phones) gets no 3D models and no custom WebGL layers.
 * Reconciled at integration with what the mounted renderers really use: buildings 1 custom
 * layer, decorations 1 (instances capped by decor/config.ts PERFORMANCE_BUDGETS), atmosphere 2
 * (world + grade), streets ~30 style layers of fixed pattern slots.
 */
export const TIER_BUDGETS: Readonly<Record<PerformanceTier, ResourceBudget>> = Object.freeze({
  low: { styleLayers: 36, textureMB: 12, modelInstances: 0, particles: 150, overlayElements: 4, customLayers: 0 },
  medium: { styleLayers: 48, textureMB: 48, modelInstances: 320, particles: 600, overlayElements: 8, customLayers: 4 },
  high: { styleLayers: 56, textureMB: 80, modelInstances: 560, particles: 1500, overlayElements: 12, customLayers: 4 },
});

export type BudgetShares = Readonly<Record<SectionId, Partial<Record<ResourceKey, number>>>>;

/** Default split of each resource between sections (each resource's shares sum to 1). */
export const DEFAULT_SHARES: BudgetShares = Object.freeze({
  buildings: { styleLayers: 0.1, textureMB: 0.3, customLayers: 0.25 },
  streets: { styleLayers: 0.75, textureMB: 0.3 },
  decorations: { styleLayers: 0.15, textureMB: 0.25, modelInstances: 1, particles: 0.3, customLayers: 0.25 },
  atmosphere: { textureMB: 0.15, particles: 0.7, overlayElements: 1, customLayers: 0.5 },
});

const zero = (): Record<ResourceKey, number> => ({ styleLayers: 0, textureMB: 0, modelInstances: 0, particles: 0, overlayElements: 0, customLayers: 0 });

/** Split a tier's totals by shares. Shares per resource are normalized when they exceed 1. */
export function allocateBudget(tier: PerformanceTier, shares: BudgetShares = DEFAULT_SHARES): Record<SectionId, ResourceBudget> {
  const total = TIER_BUDGETS[tier];
  const out = Object.fromEntries(SECTION_IDS.map((s) => [s, zero()])) as Record<SectionId, Record<ResourceKey, number>>;
  for (const r of RESOURCE_KEYS) {
    const sum = SECTION_IDS.reduce((acc, s) => acc + Math.max(0, shares[s][r] ?? 0), 0);
    const norm = sum > 1 ? sum : 1;
    for (const s of SECTION_IDS) out[s][r] = Math.floor((total[r] * Math.max(0, shares[s][r] ?? 0)) / norm);
  }
  return out;
}

/** Scale a (possibly planner-edited) allocation down so each resource fits the tier total. */
export function clampBudget(tier: PerformanceTier, budget: Readonly<Record<SectionId, ResourceBudget>>): Record<SectionId, ResourceBudget> {
  const total = TIER_BUDGETS[tier];
  const out = Object.fromEntries(SECTION_IDS.map((s) => [s, zero()])) as Record<SectionId, Record<ResourceKey, number>>;
  for (const r of RESOURCE_KEYS) {
    const asked = SECTION_IDS.map((s) => Math.max(0, Number(budget[s]?.[r]) || 0));
    const sum = asked.reduce((a, b) => a + b, 0);
    const factor = sum > total[r] ? total[r] / sum : 1;
    SECTION_IDS.forEach((s, i) => (out[s][r] = Math.floor(asked[i]! * factor)));
  }
  return out;
}

/** Resources a renderer reported above its allocation, e.g. `['particles 900 > 420']`. */
export function overBudget(usage: Partial<ResourceBudget> | undefined, budget: ResourceBudget): string[] {
  if (!usage) return [];
  return RESOURCE_KEYS.flatMap((r) => (usage[r] !== undefined && usage[r]! > budget[r] ? [`${r} ${usage[r]} > ${budget[r]}`] : []));
}
