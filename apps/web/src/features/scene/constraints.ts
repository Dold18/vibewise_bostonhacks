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
  return best && best.weight >= MIN_DISCRETE_WEIGHT && best.value !== setting.default ? best : null;
}

const set = (work: Work, key: SceneKey, choices: Choice[]) => {
  const slot = work.get(key);
  if (slot) work.set(key, { choices, provenance: 'constraint' });
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

/** Paint above the canvas tints routes and stops, so these go entirely while navigating. */
const ROUTE_SUPPRESSED_GROUPS = new Set(['cinematic_and_artistic']);
const ROUTE_SUPPRESSED_KEYS = new Set([
  'air_and_atmosphere.rain', 'air_and_atmosphere.snow', 'air_and_atmosphere.sparkle', 'air_and_atmosphere.fireflies',
  'air_and_atmosphere.petals', 'air_and_atmosphere.dust_motes', 'air_and_atmosphere.light_shafts', 'air_and_atmosphere.lens_glare',
  'air_and_atmosphere.chromatic_aberration', 'air_and_atmosphere.scanlines', 'air_and_atmosphere.distortion',
  'air_and_atmosphere.volumetric_weather', 'air_and_atmosphere.haze_profile', 'natural_land.leaf_particles',
  'neighborhood_and_places.place_scene_particles', 'lighting_and_shadows.bloom',
]);
/** Kept but capped while navigating: [key, value, max weight]. */
const ROUTE_CAPS: ReadonlyArray<readonly [SceneKey, string, number]> = [
  ['air_and_atmosphere.fog_volume', 'whisper', 0.35],
  ['air_and_atmosphere.vignette', 'soft', 0.35],
];

const navigationLegibility: ConstraintRule = {
  id: 'navigation_legibility',
  apply(work, { catalog, context, note }) {
    if (context.navigation === 'browse') return;
    const dropped: string[] = [];
    for (const s of catalog.settings) {
      if (!ROUTE_SUPPRESSED_GROUPS.has(s.group.id) && !ROUTE_SUPPRESSED_KEYS.has(s.key)) continue;
      if (winner(work, s.key, catalog)) {
        set(work, s.key, []);
        dropped.push(s.key);
      }
    }
    for (const [key, value, cap] of ROUTE_CAPS) {
      const w = winner(work, key, catalog);
      if (w && (w.value !== value || w.weight > cap)) {
        set(work, key, [{ value, weight: Math.min(w.weight, cap) }]);
        dropped.push(`${key}→${value}`);
      }
    }
    if (winner(work, 'air_and_atmosphere.fog_volume', catalog)) {
      set(work, 'neighborhood_and_places.local_fog_clearing', [{ value: 'clear_route_area', weight: 1 }]);
    }
    if (dropped.length) note('navigation_legibility', `${context.navigation}: protected route legibility (${dropped.join(', ')})`);
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

/** Rough relative GPU/compositing cost of a visible effect. */
export const COST: Readonly<Record<SceneKey, number>> = {
  'air_and_atmosphere.rain': 3, 'air_and_atmosphere.snow': 3, 'air_and_atmosphere.petals': 2, 'air_and_atmosphere.fireflies': 2,
  'air_and_atmosphere.sparkle': 2, 'air_and_atmosphere.dust_motes': 1.5, 'air_and_atmosphere.fog_volume': 2,
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
