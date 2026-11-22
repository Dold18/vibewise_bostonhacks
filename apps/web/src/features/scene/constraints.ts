/**
 * Deterministic conflict and safety rules (design §5), applied in a fixed order
 * to the compiler's working set of weighted choices. Every change is reported.
 *
 * Precedence: hard safety > active navigation > current outing > saved taste > neutral.
 * Group locks (navigation_safe, camera) are applied before these rules run.
 */
import type { SceneCatalog, SceneKey } from './catalog';
import type { Choice, Provenance, SceneContext } from './state';

export interface Slot {
  choices: Choice[];
  provenance: Provenance;
  /** The value shown last time (hysteresis hint); absent on a first compile. */
  prefer?: string;
}
export type Work = Map<SceneKey, Slot>;

export interface RuleEnv {
  readonly catalog: SceneCatalog;
  readonly context: SceneContext;
  note(code: string, detail: string): void;
}

export interface ConstraintRule {
  readonly id: string;
  apply(work: Work, env: RuleEnv): void;
}

/** Below this weight a discrete setting stays at its default (palette blending still uses it). */
export const MIN_DISCRETE_WEIGHT = 0.08;

/**
 * Hysteresis for discrete values, used when the previous scene is known:
 * a value that is off must reach `enter` to appear; a value that is on stays
 * while it keeps `exit` weight and trails the leader by less than `margin`.
 * The band around MIN_DISCRETE_WEIGHT stops a value flickering on and off
 * when quiz weights hover near the threshold.
 */
export const HYSTERESIS = Object.freeze({ enter: 0.1, exit: 0.06, margin: 0.05 });

/** The dominant choice of a slot, or null when the default holds. Ties go to catalog value order. */
export function winner(work: Work, key: SceneKey, catalog: SceneCatalog): Choice | null {
  const slot = work.get(key);
  const setting = catalog.byKey.get(key);
  if (!slot || !setting || slot.choices.length === 0) return null;
  let best: Choice | null = null;
  for (const c of slot.choices) {
    if (
      !best ||
      c.weight > best.weight + 1e-9 ||
      (Math.abs(c.weight - best.weight) <= 1e-9 && setting.values.indexOf(c.value) < setting.values.indexOf(best.value))
    ) best = c;
  }
  const on = best && best.value !== setting.default ? best : null;
  const prefer = slot.prefer;
  if (prefer === undefined) return on && on.weight >= MIN_DISCRETE_WEIGHT ? on : null;
  if (prefer === setting.default) return on && on.weight >= HYSTERESIS.enter ? on : null;
  const held = slot.choices.find((c) => c.value === prefer);
  if (held && held.weight >= HYSTERESIS.exit && best!.weight - held.weight < HYSTERESIS.margin) return held;
  return on && on.weight >= MIN_DISCRETE_WEIGHT ? on : null;
}

const set = (work: Work, key: SceneKey, choices: Choice[]) => {
  const slot = work.get(key);
  if (slot) work.set(key, { choices, provenance: 'constraint', prefer: slot.prefer });
};

const DAY_SKIES = new Set(['neutral', 'clear_blue', 'warm_dawn', 'golden_hour', 'storm_gray', 'dream_pastel']);
const NIGHT_SKIES = new Set(['night_indigo', 'purple_twilight']);

const skyConsistency: ConstraintRule = {
  id: 'sky_consistency',
  apply(work, { catalog, note }) {
    const SKY = 'sky_and_horizon.sky_mode';
    const STARS = 'sky_and_horizon.starfield';
    const ORB = 'sky_and_horizon.celestial_symbol';
    const sky = winner(work, SKY, catalog)?.value ?? 'neutral';
    const stars = winner(work, STARS, catalog);
    if (stars && DAY_SKIES.has(sky)) {
      if (work.get(STARS)?.provenance === 'override' && work.get(SKY)?.provenance !== 'override') {
        set(work, SKY, [{ value: 'night_indigo', weight: stars.weight }]);
        note('sky_consistency', `stars were requested explicitly; ${sky} sky switched to night_indigo`);
      } else {
        set(work, STARS, []);
        note('sky_consistency', `starfield dropped under a ${sky} sky`);
      }
    }
    const nowSky = winner(work, SKY, catalog)?.value ?? 'neutral';
    const orb = winner(work, ORB, catalog);
    if (orb?.value === 'sun_disc' && NIGHT_SKIES.has(nowSky)) {
      set(work, ORB, [{ value: 'crescent_moon', weight: orb.weight }]);
      note('sky_consistency', `sun_disc under ${nowSky} became crescent_moon`);
    } else if ((orb?.value === 'crescent_moon' || orb?.value === 'full_moon') && (nowSky === 'clear_blue' || nowSky === 'golden_hour')) {
      set(work, ORB, []);
      note('sky_consistency', `${orb.value} dropped under a ${nowSky} sky`);
    }
  },
};

const singlePrecipitation: ConstraintRule = {
  id: 'single_precipitation',
  apply(work, { catalog, note }) {
    const rain = winner(work, 'air_and_atmosphere.rain', catalog);
    const snow = winner(work, 'air_and_atmosphere.snow', catalog);
    if (!rain || !snow) return;
    const drop = snow.weight > rain.weight ? 'air_and_atmosphere.rain' : 'air_and_atmosphere.snow';
    set(work, drop, []);
    note('single_precipitation', `rain and snow together; kept the stronger, dropped ${drop} (stylized visuals, never live weather)`);
  },
};

/**
 * Navigation policy (design §5, ratified 2026-11-21): while a route or focused
 * destination is on screen the scene keeps its palette and a safe version of its
 * lighting, but nothing may compete with routes, stops or pins.
 */
/** Overlay paint sits above the canvas and tints routes: every overlay goes except a soft edge vignette. */
const NAV_OVERLAY_GROUPS = new Set(['air_and_atmosphere', 'cinematic_and_artistic']);
const NAV_KEEP = new Set(['air_and_atmosphere.vignette']);
/** Decorations and glows outside the overlay groups. */
const NAV_DECORATIONS = new Set([
  'natural_land.leaf_particles', 'neighborhood_and_places.place_scene_particles', 'lighting_and_shadows.bloom',
]);
/** Ambient motion is stilled (scene color transitions and pin updates still animate). */
const NAV_STILL = new Set([
  'animation_and_morph.ambient_pace', 'animation_and_morph.particle_motion', 'animation_and_morph.motion_texture',
  'animation_and_morph.color_wave', 'animation_and_morph.effect_stagger', 'animation_and_morph.building_reveal_motion',
  'sky_and_horizon.cloud_motion', 'water_and_coast.surface_motion', 'water_and_coast.shimmer_speed',
  'marker_recommendations.pin_pulse',
]);
/** Safe lighting: [key, value, replacement] so buildings and streets stay readable. */
const NAV_SAFE_LIGHT: ReadonlyArray<readonly [SceneKey, string, string]> = [
  ['lighting_and_shadows.light_intensity', 'dim', 'subtle'],
  ['lighting_and_shadows.ambient_fill', 'deep_shadow', 'muted'],
];
export const NAV_VIGNETTE_MAX = 0.35;

const navigationLegibility: ConstraintRule = {
  id: 'navigation_legibility',
  apply(work, { catalog, context, note }) {
    if (context.navigation === 'browse') return;
    const dropped: string[] = [];
    const stilled: string[] = [];
    for (const s of catalog.settings) {
      const overlay = NAV_OVERLAY_GROUPS.has(s.group.id) && !NAV_KEEP.has(s.key);
      if (!overlay && !NAV_DECORATIONS.has(s.key) && !NAV_STILL.has(s.key)) continue;
      if (!winner(work, s.key, catalog)) continue;
      set(work, s.key, []);
      (NAV_STILL.has(s.key) ? stilled : dropped).push(s.key);
    }
    const vignette = winner(work, 'air_and_atmosphere.vignette', catalog);
    if (vignette && (vignette.value !== 'soft' || vignette.weight > NAV_VIGNETTE_MAX)) {
      set(work, 'air_and_atmosphere.vignette', [{ value: 'soft', weight: Math.min(vignette.weight, NAV_VIGNETTE_MAX) }]);
      dropped.push('air_and_atmosphere.vignette→soft');
    }
    const lit: string[] = [];
    for (const [key, from, to] of NAV_SAFE_LIGHT) {
      const slot = work.get(key);
      if (!slot?.choices.some((c) => c.value === from)) continue;
      const merged = new Map<string, number>();
      for (const c of slot.choices) merged.set(c.value === from ? to : c.value, (merged.get(c.value === from ? to : c.value) ?? 0) + c.weight);
      set(work, key, [...merged].map(([value, weight]) => ({ value, weight: Math.round(weight * 1000) / 1000 })));
      lit.push(`${key} ${from}→${to}`);
    }
    const parts = [
      dropped.length && `overlays/decorations off: ${dropped.join(', ')}`,
      stilled.length && `ambient motion stilled: ${stilled.join(', ')}`,
      lit.length && `safe lighting: ${lit.join(', ')}`,
    ].filter(Boolean);
    if (parts.length) note('navigation_legibility', `${context.navigation}: palette kept; ${parts.join('; ')}`);
  },
};

/** Forced values under reduced motion; `null` means "back to the default". */
const REDUCED_MOTION: ReadonlyArray<readonly [SceneKey, string | null]> = [
  ['animation_and_morph.scene_transition', 'quick_fade'],
  ['animation_and_morph.ambient_pace', null],
  ['animation_and_morph.particle_motion', null],
  ['animation_and_morph.motion_texture', null],
  ['animation_and_morph.color_wave', null],
  ['animation_and_morph.effect_stagger', null],
  ['animation_and_morph.building_reveal_motion', null],
  ['animation_and_morph.light_shift_motion', null],
  ['animation_and_morph.sky_shift_motion', null],
  ['animation_and_morph.pin_update_motion', 'fade_scale'],
  ['sky_and_horizon.cloud_motion', null],
  ['water_and_coast.surface_motion', null],
  ['water_and_coast.shimmer_speed', null],
  ['marker_recommendations.pin_pulse', null],
  ['air_and_atmosphere.distortion', null],
  ['air_and_atmosphere.chromatic_aberration', null],
];

const reducedMotion: ConstraintRule = {
  id: 'reduced_motion',
  apply(work, { catalog, context, note }) {
    if (!context.reducedMotion) return;
    const changed: string[] = [];
    for (const [key, forced] of REDUCED_MOTION) {
      const w = winner(work, key, catalog);
      if (forced === null ? w !== null : w?.value !== forced) {
        set(work, key, forced === null ? [] : [{ value: forced, weight: 1 }]);
        changed.push(key);
      }
    }
    const ring = winner(work, 'marker_recommendations.selected_ring', catalog);
    if (ring?.value === 'soft_pulse') {
      set(work, 'marker_recommendations.selected_ring', [{ value: 'halo', weight: ring.weight }]);
      changed.push('marker_recommendations.selected_ring');
    }
    if (changed.length) note('reduced_motion', `prefers-reduced-motion: stilled ${changed.length} motion settings`);
  },
};

/** Rough relative GPU/compositing cost; fog is now a cached static SVG illustration. */
export const COST: Readonly<Record<SceneKey, number>> = {
  'air_and_atmosphere.rain': 3, 'air_and_atmosphere.snow': 3, 'air_and_atmosphere.petals': 2, 'air_and_atmosphere.fireflies': 2,
  'air_and_atmosphere.sparkle': 2, 'air_and_atmosphere.dust_motes': 1.5, 'air_and_atmosphere.fog_volume': 1,
  'air_and_atmosphere.volumetric_weather': 4, 'air_and_atmosphere.light_shafts': 3, 'air_and_atmosphere.distortion': 4,
  'air_and_atmosphere.grain': 1, 'air_and_atmosphere.vignette': 0.5, 'air_and_atmosphere.scanlines': 1,
  'air_and_atmosphere.chromatic_aberration': 2, 'air_and_atmosphere.lens_glare': 1, 'air_and_atmosphere.haze_profile': 1,
  'natural_land.leaf_particles': 2, 'lighting_and_shadows.bloom': 3, 'cinematic_and_artistic.halftone': 1.5,
  'cinematic_and_artistic.paper_texture': 1, 'cinematic_and_artistic.analog_aging': 1.5,
  'neighborhood_and_places.place_scene_particles': 3, 'roads_and_ground.wet_sheen': 1,
};
export const EFFECT_BUDGET: Readonly<Record<SceneContext['performance'], number>> = { low: 3, medium: 6, high: 10 };

/** Runs after capability clipping, so only effects that would really render are counted. */
export const performanceBudget: ConstraintRule = {
  id: 'performance_budget',
  apply(work, { catalog, context, note }) {
    const budget = EFFECT_BUDGET[context.performance];
    const active = catalog.settings
      .map((s, index) => ({ key: s.key, index, cost: COST[s.key] ?? 0, w: winner(work, s.key, catalog) }))
      .filter((e) => e.cost > 0 && e.w);
    let total = active.reduce((s, e) => s + e.cost, 0);
    // Weakest first; among equals, the later catalog entry goes first.
    active.sort((a, b) => a.w!.weight - b.w!.weight || b.index - a.index);
    const dropped: string[] = [];
    for (const e of active) {
      if (total <= budget) break;
      set(work, e.key, []);
      total -= e.cost;
      dropped.push(e.key);
    }
    if (dropped.length) note('performance_budget', `${context.performance} budget ${budget}: dropped ${dropped.join(', ')}`);
  },
};

/** Rules applied before capability clipping, in order. */
export const RULES: readonly ConstraintRule[] = [skyConsistency, singlePrecipitation, navigationLegibility, reducedMotion];
