/** Decoration engine parameters. Every visual decision is a function of these, the theme and the map. */
import type { ThemeOverrides } from './themes';

export interface DecorBudget {
  /** Instances rendered at once across all tiers. */
  readonly maxInstances: number;
  /** Triangles rendered at once (sum over visible instances). */
  readonly maxTriangles: number;
  /** Distinct models resident (load + GPU). Never all 312. */
  readonly maxAssets: number;
  /** Sum of glTF primitives across resident models (≈ draw calls with instancing). */
  readonly maxDrawCalls: number;
}

export interface DecorLod {
  /** Minimum camera zoom per tier. */
  readonly minZoom: { readonly micro: number; readonly secondary: number; readonly hero: number };
  /** Max ground distance (m) from the view center at zoom 16; doubles per zoom level out. */
  readonly range: { readonly micro: number; readonly secondary: number; readonly hero: number };
}

export interface DecorConfig {
  /** Stable session seed: same seed + scene + map ⇒ same world. */
  readonly seed: string;
  /** 0..1 overall richness (scaled again by the vibe's strength). */
  readonly density: number;
  readonly tiers: { readonly micro: boolean; readonly secondary: boolean; readonly hero: boolean };
  /** Multiplier on family size ranges. */
  readonly scale: number;
  /** 0 = every member at its family's median size, 1 = full log-uniform range. */
  readonly scaleVariance: number;
  /** 0 = evenly dispersed accents, 1 = mostly clustered vignettes and groves. */
  readonly clustering: number;
  /** Minimum spacing between same-tier decorations (m). */
  readonly minSpacing: { readonly micro: number; readonly secondary: number; readonly hero: number };
  /** Hero installations shown at once (nearest regions first, `minSpacing.hero` apart). */
  readonly maxHeroes: number;
  /** Discovery progress at which hero installations may appear. */
  readonly heroProgress: number;
  /** Distinct models per tier in the scene's coherent "cast". */
  readonly castSize: { readonly micro: number; readonly secondary: number };
  /** Clearance around destination pins (m): decorations never imply venue features or hide pins. */
  readonly venueClearance: number;
  readonly budget: DecorBudget;
  readonly lod: DecorLod;
  readonly theme?: ThemeOverrides;
}

export const DENSITY_PRESETS = { low: 0.3, medium: 0.6, high: 1 } as const;

export const PERFORMANCE_BUDGETS: Readonly<Record<'low' | 'medium' | 'high', DecorBudget>> = {
  low: { maxInstances: 120, maxTriangles: 120_000, maxAssets: 10, maxDrawCalls: 24 },
  medium: { maxInstances: 320, maxTriangles: 200_000, maxAssets: 16, maxDrawCalls: 44 },
  high: { maxInstances: 560, maxTriangles: 380_000, maxAssets: 22, maxDrawCalls: 64 },
};

export const DEFAULT_CONFIG: DecorConfig = Object.freeze({
  seed: 'vibenta',
  density: DENSITY_PRESETS.medium,
  tiers: { micro: true, secondary: true, hero: true },
  /** Stylized public-art scale: props must read at a pitched z16–17 view. */
  scale: 1.2,
  scaleVariance: 0.75,
  clustering: 0.5,
  minSpacing: { micro: 3.5, secondary: 11, hero: 260 },
  heroProgress: 0.7,
  maxHeroes: 2,
  castSize: { micro: 5, secondary: 7 },
  venueClearance: 28,
  budget: PERFORMANCE_BUDGETS.medium,
  lod: { minZoom: { micro: 16.4, secondary: 14.6, hero: 14.2 }, range: { micro: 350, secondary: 900, hero: 2200 } },
});

export type DecorConfigInput = Partial<Omit<DecorConfig, 'tiers' | 'minSpacing' | 'castSize' | 'budget' | 'lod'>> & {
  readonly tiers?: Partial<DecorConfig['tiers']>;
  readonly minSpacing?: Partial<DecorConfig['minSpacing']>;
  readonly castSize?: Partial<DecorConfig['castSize']>;
  readonly budget?: Partial<DecorBudget>;
  readonly lod?: Partial<DecorLod>;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function resolveConfig(base: DecorConfig, input: DecorConfigInput = {}): DecorConfig {
  return Object.freeze({
    ...base,
    ...input,
    density: clamp01(input.density ?? base.density),
    clustering: clamp01(input.clustering ?? base.clustering),
    scaleVariance: clamp01(input.scaleVariance ?? base.scaleVariance),
    scale: Math.max(0.25, Math.min(3, input.scale ?? base.scale)),
    tiers: { ...base.tiers, ...input.tiers },
    minSpacing: { ...base.minSpacing, ...input.minSpacing },
    castSize: { ...base.castSize, ...input.castSize },
    budget: { ...base.budget, ...input.budget },
    lod: { ...base.lod, ...input.lod },
  });
}

/** Key of everything that changes *where* things go (budget/LOD only change what is shown). */
export const placementKey = (c: DecorConfig) => JSON.stringify([c.seed, c.density, c.tiers, c.scale, c.scaleVariance, c.clustering, c.minSpacing, c.castSize, c.heroProgress, c.maxHeroes, c.budget.maxAssets, c.budget.maxDrawCalls]);
