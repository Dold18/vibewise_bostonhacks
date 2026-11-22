/**
 * Composition: independent parameters → one coherent, legible, affordable plan.
 *
 * Pure and deterministic. Rules run in a fixed order and every adjustment is
 * reported in `notes`:
 *
 *   1. hard context   navigation (route/focus) and reduced motion
 *   2. coherence      contradictory combinations are resolved, not stacked
 *   3. visual load    the total amount of atmosphere is capped so the city stays readable
 *   4. legibility     per-effect ceilings and the fog cap at the screen centre
 *   5. quality        device tier scales particle counts, fog slices and bloom
 *
 * Draw order and blending are fixed (`PASS_ORDER`) and documented per effect,
 * including whether it is depth-aware or a screen-space approximation.
 */
import { clamp01, EPSILON, isEmpty, mixRgb, PARTICLE_KEYS, type AtmosphereParams, type MutableParams, type ScalarKey } from './params';

export type Quality = 'low' | 'medium' | 'high';
export type Navigation = 'browse' | 'route' | 'focus';

export interface ComposeContext {
  readonly navigation: Navigation;
  readonly reducedMotion: boolean;
  readonly quality: Quality;
  /** 0 = daylight ground, 1 = night (fromScene.sceneDarkness). */
  readonly darkness: number;
}

export const DEFAULT_COMPOSE_CONTEXT: ComposeContext = Object.freeze({ navigation: 'browse', reducedMotion: false, quality: 'medium', darkness: 0 });

export type Space = 'world-depth-tested' | 'screen-below-labels';
export type Blend = 'over' | 'multiply' | 'screen' | 'additive';

export interface PassSpec {
  readonly id: string;
  readonly space: Space;
  readonly blend: Blend;
  readonly keys: readonly ScalarKey[];
  /** One honest sentence about what this pass really is. */
  readonly technique: string;
}

/**
 * Fixed draw order, bottom to top. Everything here draws after the 3D
 * buildings and before routes, the focus mask, all symbol layers (labels) and
 * the DOM pins, so navigation information is never tinted or covered.
 */
export const PASS_ORDER: readonly PassSpec[] = [
  { id: 'height-fog', space: 'world-depth-tested', blend: 'over', keys: ['fogDensity'],
    technique: 'Stacked horizontal fog slices in world space; per-fragment optical depth from the real view ray (exponential height falloff, path length through each slice), forward scattering toward the scene light; occluded by building extrusions. A sliced approximation of a volume, not ray-marched.' },
  { id: 'precipitation', space: 'world-depth-tested', blend: 'over', keys: ['rain', 'snow'],
    technique: 'GPU-procedural rain streaks (lines) and snow flakes (points) animated in the vertex shader inside a world-anchored, camera-scaled volume; depth-tested so buildings occlude them. Stylized speed/size, never live weather.' },
  { id: 'particles', space: 'world-depth-tested', blend: 'additive', keys: ['dust', 'sparkle', 'fireflies', 'petals'],
    technique: 'GPU-procedural point particles at world altitudes (fireflies near the ground, dust in the lower air); depth-tested against buildings.' },
  { id: 'haze', space: 'screen-below-labels', blend: 'over', keys: ['hazeHorizon', 'hazeEdge', 'hazeGround', 'wash'],
    technique: 'Screen-space haze: horizon band placed from camera pitch and FOV, edge and ground gradients, procedural breakup; sky-to-ground color wash.' },
  { id: 'print', space: 'screen-below-labels', blend: 'multiply', keys: ['paper', 'watercolor', 'halftone', 'scanlines', 'grid', 'scratches', 'grain', 'vignette'],
    technique: 'Screen-space multiply of SVG-asset textures (paper fibre, watercolor wash, halftone, scanlines, blueprint grid, film scratches, film grain) and a colored vignette.' },
  { id: 'light', space: 'screen-below-labels', blend: 'screen', keys: ['glow', 'shafts', 'leak', 'grain'],
    technique: 'Screen blend of a real bloom (threshold + separable blur of a 1/4-resolution copy of the rendered city, before labels), light shafts radiating from the scene light direction, and edge light leaks. Shafts are a screen-space approximation, not volumetric scattering.' },
];

export interface AtmospherePlan {
  readonly params: AtmosphereParams;
  readonly empty: boolean;
  readonly world: {
    readonly active: boolean;
    readonly fogSlices: number;
    /** Per-kind maxima at density 1 (the renderer draws `amount × max`). */
    readonly maxRain: number;
    readonly maxPoints: number;
  };
  readonly grade: { readonly active: boolean; readonly bloom: boolean };
  /** Animation repaint rate: the tier's fps for falling/flying particles, SLOW_FPS for drifting fog/light, 0 = draw only when the map redraws anyway. */
  readonly fps: number;
  /** Fog opacity allowed along the ray through the screen centre. */
  readonly centerFogMax: number;
  /** Visual load after composition (0..VISUAL_LOAD_CAP). */
  readonly load: number;
  readonly notes: readonly string[];
}

/** How much each effect weighs on readability. Vignette is edge-only and nearly free. */
export const LOAD_WEIGHTS: Readonly<Partial<Record<ScalarKey, number>>> = {
  fogDensity: 1, rain: 0.8, snow: 0.7, dust: 0.3, sparkle: 0.35, fireflies: 0.3, petals: 0.35,
  hazeHorizon: 0.4, hazeEdge: 0.35, hazeGround: 0.45, wash: 0.3, grain: 0.45, paper: 0.55, watercolor: 0.6,
  halftone: 0.7, scanlines: 0.5, grid: 0.45, scratches: 0.3, vignette: 0.15, glow: 0.5, shafts: 0.45, leak: 0.35,
};
export const VISUAL_LOAD_CAP = 2.4;

/** Per-effect ceilings that keep streets, buildings and water readable under any combination. */
export const CEILINGS: Readonly<Partial<Record<ScalarKey, number>>> = {
  fogDensity: 0.9, hazeHorizon: 0.75, hazeEdge: 0.65, hazeGround: 0.55, wash: 0.45, paper: 0.75, watercolor: 0.7,
  halftone: 0.65, scanlines: 0.6, grid: 0.6, scratches: 0.6, grain: 0.75, vignette: 0.85, glow: 0.8, shafts: 0.75, leak: 0.7,
};

export const NAV_VIGNETTE_MAX = 0.35;
export const CENTER_FOG_MAX = 0.42;

export const QUALITY: Readonly<Record<Quality, { fogSlices: number; maxRain: number; maxPoints: number; bloom: boolean; fps: number }>> = {
  low: { fogSlices: 4, maxRain: 2500, maxPoints: 900, bloom: false, fps: 20 },
  medium: { fogSlices: 5, maxRain: 6000, maxPoints: 2200, bloom: true, fps: 30 },
  // Weather animates at a cinematic 30 fps on every capable tier (a divisor of 60 Hz: no judder);
  // tiers differ in particle counts, fog slices and bloom.
  high: { fogSlices: 7, maxRain: 11000, maxPoints: 4000, bloom: true, fps: 30 },
};

/** Effects that move fast enough to need the tier's frame rate. */
const FAST: readonly ScalarKey[] = PARTICLE_KEYS;
/** Slow drifts (fog banks, shaft shimmer, leak wander) read as continuous at a low rate. */
const SLOW: readonly ScalarKey[] = ['fogDensity', 'shafts', 'leak'];
export const SLOW_FPS = 10;

export function composeAtmosphere(input: AtmosphereParams, ctx: ComposeContext = DEFAULT_COMPOSE_CONTEXT): AtmospherePlan {
  const p = { ...input } as MutableParams;
  const notes: string[] = [];
  const scale = (k: ScalarKey, f: number, why: string) => {
    if (p[k] < EPSILON || f >= 1) return;
    const before = p[k];
    p[k] = before * Math.max(0, f);
    if (before - p[k] > 0.02) notes.push(`${k} ${before.toFixed(2)}→${p[k].toFixed(2)}: ${why}`);
  };

  // 1. Hard context.
  if (ctx.navigation !== 'browse') {
    const kept = Math.min(p.vignette, NAV_VIGNETTE_MAX);
    for (const k of Object.keys(LOAD_WEIGHTS) as ScalarKey[]) if (k !== 'vignette') p[k] = 0;
    if (p.vignette > kept) notes.push(`navigation (${ctx.navigation}): vignette capped at ${NAV_VIGNETTE_MAX}`);
    p.vignette = kept;
    p.motion = 0;
    p.drift = 0;
    notes.push(`navigation (${ctx.navigation}): all atmosphere off except a soft edge vignette`);
  }
  if (ctx.reducedMotion && (p.motion > 0 || p.drift > 0)) {
    p.motion = 0;
    p.drift = 0;
    // A frozen frame of falling particles reads as clutter; keep a lighter, still trace.
    for (const k of PARTICLE_KEYS) scale(k, 0.6, 'reduced motion: particles held still and thinned');
    notes.push('reduced motion: all environmental animation stopped');
  }

  // 2. Coherence: resolve contradictions instead of stacking them.
  if (p.rain >= EPSILON && p.snow >= EPSILON) {
    const [strong, weak] = p.rain >= p.snow ? (['rain', 'snow'] as const) : (['snow', 'rain'] as const);
    scale(weak, (1 - p[strong]) ** 2, `single precipitation (${strong} dominates)`);
  }
  const precip = Math.max(p.rain, p.snow);
  scale('fireflies', 1 - precip, 'fireflies do not fly in rain or snow');
  scale('petals', 1 - p.snow, 'petals and snow contradict');
  scale('dust', 1 - precip, 'dust motes are washed out by precipitation');
  scale('shafts', 1 - 0.7 * precip, 'precipitation blocks direct light');
  // Dust motes are lit specks: barely visible without daylight; fireflies need the dark.
  scale('dust', 1 - 0.6 * ctx.darkness, 'dust motes need light');
  scale('fireflies', 0.35 + 0.65 * ctx.darkness, 'fireflies only glow against darkness');
  // Flat print media vs. luminous effects: a printed page does not bloom.
  const print = Math.max(p.paper, p.watercolor, p.halftone);
  scale('glow', 1 - 0.6 * print, 'printed treatments flatten bloom');
  // Analog vs. digital screen artifacts: the weaker yields.
  if (p.scanlines >= EPSILON && Math.max(p.paper, p.watercolor) >= EPSILON) {
    const paperish = Math.max(p.paper, p.watercolor);
    if (p.scanlines < paperish) scale('scanlines', 1 - paperish, 'scanlines and paper contradict');
    else { scale('paper', 1 - p.scanlines, 'paper and scanlines contradict'); scale('watercolor', 1 - p.scanlines, 'watercolor and scanlines contradict'); }
  }
  // Particle population: several kinds share one sky.
  const particles = p.dust + p.sparkle + p.fireflies + p.petals;
  if (particles > 1) for (const k of ['dust', 'sparkle', 'fireflies', 'petals'] as const) scale(k, 1 / particles, 'particle kinds share one population');
  // Bloom threshold follows the light level: night scenes glow from lit features, day scenes only from highlights.
  p.glowThreshold = clamp01(p.glowThreshold + 0.25 * (1 - ctx.darkness) - 0.15 * ctx.darkness);
  // Night-adapted colors: shafts turn moonlit, haze cools slightly.
  if (ctx.darkness > 0) p.shaftColor = mixRgb(p.shaftColor, [0.72, 0.8, 1], 0.5 * ctx.darkness);

  // 3. Weather/effect density multiplies only what fills the air.
  for (const k of PARTICLE_KEYS) p[k] = clamp01(p[k] * p.density);

  // 4. Legibility ceilings, then the visual load budget.
  for (const [k, cap] of Object.entries(CEILINGS) as [ScalarKey, number][]) if (p[k] > cap) scale(k, cap / p[k], `legibility ceiling ${cap}`);
  let load = 0;
  for (const [k, w] of Object.entries(LOAD_WEIGHTS) as [ScalarKey, number][]) load += p[k] * w;
  if (load > VISUAL_LOAD_CAP) {
    // The edge vignette is exempt, so only the rest shares the remaining budget.
    const fixed = p.vignette * (LOAD_WEIGHTS.vignette ?? 0);
    const f = Math.max(0, VISUAL_LOAD_CAP - fixed) / (load - fixed);
    for (const k of Object.keys(LOAD_WEIGHTS) as ScalarKey[]) if (k !== 'vignette') p[k] *= f;
    notes.push(`visual load ${load.toFixed(2)} > ${VISUAL_LOAD_CAP}: every effect scaled by ${f.toFixed(2)}`);
    load = 0;
    for (const [k, w] of Object.entries(LOAD_WEIGHTS) as [ScalarKey, number][]) load += p[k] * w;
  }

  // 5. Quality tier.
  // Navigation already zeroes fog (it fades out); the centre cap stays constant so nothing pops.
  return planOf(Object.freeze(p), ctx.quality, CENTER_FOG_MAX, Math.round(load * 1000) / 1000, notes);
}

const GRADE_KEYS: readonly ScalarKey[] = ['hazeHorizon', 'hazeEdge', 'hazeGround', 'wash', 'grain', 'paper', 'watercolor', 'halftone', 'scanlines', 'grid', 'scratches', 'vignette', 'glow', 'shafts', 'leak'];

function planOf(params: AtmosphereParams, quality: Quality, centerFogMax: number, load: number, notes: readonly string[]): AtmospherePlan {
  const q = QUALITY[quality];
  const empty = isEmpty(params);
  const fast = params.motion > EPSILON && FAST.some((k) => params[k] >= EPSILON);
  const slow = params.drift > EPSILON && SLOW.some((k) => params[k] >= EPSILON);
  const fps = fast ? q.fps : slow ? SLOW_FPS : 0;
  return Object.freeze({
    params,
    empty,
    world: Object.freeze({
      active: !empty && (params.fogDensity >= EPSILON || PARTICLE_KEYS.some((k) => params[k] >= EPSILON)),
      fogSlices: q.fogSlices, maxRain: q.maxRain, maxPoints: q.maxPoints,
    }),
    grade: Object.freeze({ active: !empty && GRADE_KEYS.some((k) => params[k] >= EPSILON), bloom: q.bloom && params.glow >= EPSILON }),
    fps,
    centerFogMax,
    load,
    notes: Object.freeze([...notes]),
  });
}

/**
 * The same plan for intermediate (tweened) parameters: pass activity, bloom
 * and animation rate follow the values on screen; rules are not re-applied
 * (they already shaped both ends of the transition).
 */
export function withParams(plan: AtmospherePlan, params: AtmosphereParams, quality: Quality): AtmospherePlan {
  return planOf(params, quality, plan.centerFogMax, plan.load, plan.notes);
}
