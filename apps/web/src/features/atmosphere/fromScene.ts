/**
 * SceneState → AtmosphereParams.
 *
 * Reads only what the Scene Composer already resolved (dominant catalog value
 * + effective strength per key, palette, light and sky), so the atmosphere is
 * a pure function of the shared scene and never invents its own vibe. Each
 * catalog value contributes a bundle of continuous amounts scaled by its
 * presence; contributions to the same control combine as a soft maximum, so
 * stacking several sources approaches but never exceeds full strength.
 *
 * The catalog values handled here are exactly those MAP_RENDERER_V2 declares
 * (`ATMOSPHERE_VALUES`); everything else stays disabled in the compiler.
 */
import {
  clamp01, hexToRgb, luminance, mixRgb, NEUTRAL_PARAMS, type AtmosphereParams, type ColorKey, type MutableParams, type RGB, type ScalarKey,
} from './params';

/** The slice of a SceneState this module reads (structural; no scene import). */
export interface AtmosphereSceneInput {
  readonly hash: string;
  readonly resolved?: Readonly<Record<string, string>>;
  readonly strengths?: Readonly<Record<string, number>>;
  readonly palette: Readonly<Record<string, string>>;
  readonly lighting: { readonly color: string; readonly intensity: number; readonly position: readonly [number, number, number] };
  readonly sky: { readonly fogColor: string };
  readonly motion: { readonly transitionMs: number };
}

type Bundle = Partial<Record<ScalarKey, number>> & { colors?: Partial<Record<ColorKey, string>> };

/** Catalog value → contribution at full presence. Shape knobs (fogHeight, grainSize, wind, glowThreshold) are set, not added. */
export const VALUE_BUNDLES: Readonly<Record<string, Readonly<Record<string, Bundle>>>> = {
  'air_and_atmosphere.fog_volume': {
    whisper: { fogDensity: 0.22 },
    light: { fogDensity: 0.4 },
    medium: { fogDensity: 0.62, fogHeight: 0.45 },
    heavy: { fogDensity: 0.85, fogHeight: 0.6, hazeHorizon: 0.25 },
  },
  'air_and_atmosphere.haze_profile': {
    horizon: { hazeHorizon: 0.55 },
    edge: { hazeEdge: 0.5 },
    ground: { hazeGround: 0.45, fogDensity: 0.12, fogHeight: 0.15 },
    waterfront: { hazeHorizon: 0.35, hazeGround: 0.25, colors: { hazeColor: '#cfe0ec' } },
  },
  'air_and_atmosphere.vignette': {
    soft: { vignette: 0.35 },
    cinematic: { vignette: 0.6 },
    strong: { vignette: 0.8 },
    warm: { vignette: 0.5, colors: { vignetteColor: '#3a1c08' } },
    cool: { vignette: 0.5, colors: { vignetteColor: '#08152e' } },
  },
  'air_and_atmosphere.grain': {
    fine_film: { grain: 0.35, grainSize: 0.2 },
    coarse_film: { grain: 0.6, grainSize: 0.75 },
    analog_noise: { grain: 0.5, grainSize: 0.45, scanlines: 0.12 },
    paper_grain: { grain: 0.22, grainSize: 0.35, paper: 0.35 },
  },
  'air_and_atmosphere.dust_motes': {
    subtle: { dust: 0.3 },
    visible: { dust: 0.6 },
    sunlit: { dust: 0.55, shafts: 0.2 },
  },
  'air_and_atmosphere.rain': {
    drizzle: { rain: 0.25, fogDensity: 0.08 },
    light: { rain: 0.45, fogDensity: 0.12 },
    cinematic: { rain: 0.7, fogDensity: 0.18, wind: 0.3 },
    storm_visual: { rain: 0.95, fogDensity: 0.3, wind: 0.55, hazeHorizon: 0.2 },
  },
  'air_and_atmosphere.snow': {
    few_flakes: { snow: 0.2 },
    gentle: { snow: 0.5, fogDensity: 0.08 },
    dense: { snow: 0.85, fogDensity: 0.2, hazeHorizon: 0.2 },
  },
  'air_and_atmosphere.sparkle': {
    tiny: { sparkle: 0.25 },
    playful: { sparkle: 0.5 },
    magical: { sparkle: 0.65, glow: 0.12, colors: { sparkleColor: '#f4e7ff' } },
    neon: { sparkle: 0.6, colors: { sparkleColor: '#ff5cc8' } },
  },
  'air_and_atmosphere.fireflies': {
    few: { fireflies: 0.3 },
    gentle: { fireflies: 0.55 },
    many: { fireflies: 0.85 },
  },
  'air_and_atmosphere.petals': {
    few: { petals: 0.3 },
    slow_fall: { petals: 0.55 },
    whimsical: { petals: 0.8, wind: 0.35 },
  },
  'air_and_atmosphere.light_shafts': {
    subtle: { shafts: 0.3 },
    sunbeams: { shafts: 0.65, hazeHorizon: 0.1 },
    night_beams: { shafts: 0.55, colors: { shaftColor: '#b8ccff' } },
  },
  'air_and_atmosphere.scanlines': {
    subtle: { scanlines: 0.3 },
    retro_monitor: { scanlines: 0.6, vignette: 0.25 },
    holographic: { scanlines: 0.45, glow: 0.2, colors: { glowColor: '#9ff3ff' } },
  },
  'air_and_atmosphere.volumetric_weather': {
    local_mist: { fogDensity: 0.45, fogHeight: 0.18, fogDrift: 0.8 },
    dramatic_fog: { fogDensity: 0.8, fogHeight: 0.65, fogDrift: 0.9 },
    heavy_rain: { rain: 0.9, fogDensity: 0.3, wind: 0.45 },
  },
  'cinematic_and_artistic.render_aesthetic': {
    editorial_atlas: { paper: 0.35, vignette: 0.2 },
    watercolor: { watercolor: 0.6, paper: 0.2 },
    storybook: { paper: 0.3, glow: 0.3, vignette: 0.3, colors: { vignetteColor: '#3a1c08' } },
    noir: { grain: 0.4, vignette: 0.55 },
    cyberpunk: { scanlines: 0.25, glow: 0.55, hazeHorizon: 0.2, colors: { glowColor: '#ff7ae0', hazeColor: '#6b4c9a' } },
    vintage_film: { grain: 0.45, leak: 0.3, scratches: 0.25, vignette: 0.4 },
    retro_game: { scanlines: 0.55 },
    blueprint: { grid: 0.6, paper: 0.25, colors: { paperColor: '#cfe1f3', gridColor: '#2f6aa8' } },
    paper_diorama: { paper: 0.5, vignette: 0.25 },
    comic_ink: { halftone: 0.55 },
  },
  'cinematic_and_artistic.paper_texture': {
    cream_fiber: { paper: 0.4 },
    aged_parchment: { paper: 0.65, colors: { paperColor: '#ead8b0' } },
    blueprint_paper: { paper: 0.35, grid: 0.3, colors: { paperColor: '#cfe1f3', gridColor: '#2f6aa8' } },
    grainy_print: { paper: 0.4, grain: 0.2 },
  },
  'cinematic_and_artistic.halftone': {
    subtle: { halftone: 0.3 },
    comic_print: { halftone: 0.6 },
    retro_newsprint: { halftone: 0.5, paper: 0.25, colors: { paperColor: '#ece6d6' } },
  },
  'cinematic_and_artistic.analog_aging': {
    faded_film: { wash: 0.25, grain: 0.15, colors: { washTop: '#f2e6cf', washBottom: '#e9dcc4' } },
    light_leak: { leak: 0.6 },
    film_burn: { leak: 0.85, scratches: 0.3 },
  },
  'cinematic_and_artistic.grid_overlay': {
    faint_blueprint: { grid: 0.35 },
    sci_fi: { grid: 0.5, colors: { gridColor: '#1fb5d6' } },
    subtle_graph: { grid: 0.25, colors: { gridColor: '#7c8794' } },
  },
  'lighting_and_shadows.bloom': {
    subtle: { glow: 0.3 },
    dreamy: { glow: 0.55, glowThreshold: 0.55 },
    neon: { glow: 0.7, glowThreshold: 0.45 },
    cinematic: { glow: 0.5, glowThreshold: 0.65 },
  },
  'sky_and_horizon.horizon_glow': {
    warm_band: { wash: 0.22, hazeHorizon: 0.12 },
    cool_band: { wash: 0.2, hazeHorizon: 0.12 },
    rose_band: { wash: 0.22, hazeHorizon: 0.12 },
    neon_band: { wash: 0.25, glow: 0.1 },
    pale_mist: { wash: 0.15, hazeHorizon: 0.3 },
  },
  'animation_and_morph.ambient_pace': {
    slow: { motion: 0.4, drift: 0.5 },
    balanced: { motion: 0.7, drift: 0.8 },
    lively: { motion: 1, drift: 1 },
  },
  'animation_and_morph.particle_motion': {
    drift: { wind: 0.3, drift: 0.6 },
    float: { motion: 0.45, drift: 0.5 },
    twinkle: { sparkle: 0.1 },
    swirl: { wind: 0.5, motion: 0.8 },
  },
  'building_surfaces.window_glow': {
    warm_low: { windowLight: 0.3 },
    warm_high: { windowLight: 0.65 },
    cold_white: { windowLight: 0.45, colors: { windowColor: '#e8f1ff' } },
    blue: { windowLight: 0.45, colors: { windowColor: '#7fb2ff' } },
    mixed: { windowLight: 0.5, colors: { windowColor: '#ffd38a' } },
  },
};

/** Fog tints for `air_and_atmosphere.fog_hue` (neutral follows the sky's own fog color). */
export const FOG_HUES: Readonly<Record<string, string>> = {
  silver: '#c9ced4', pearl: '#ebe6f1', blue: '#8fa8cc', violet: '#9583c9', warm_gold: '#e8c48a', rose: '#e7a3b5',
};

/** Catalog values the atmosphere renderer realizes (for the capability profile). */
export const ATMOSPHERE_VALUES: Readonly<Record<string, readonly string[]>> = Object.fromEntries([
  ...Object.entries(VALUE_BUNDLES).map(([key, values]) => [key, Object.keys(values)]),
  ['air_and_atmosphere.fog_hue', Object.keys(FOG_HUES)],
]);

/** Keys whose value sets a shape rather than an amount (latest strongest source wins, blended from the neutral value). */
const SHAPE_KEYS = new Set<ScalarKey>(['fogHeight', 'grainSize', 'wind', 'glowThreshold', 'motion', 'fogDrift', 'drift']);

/**
 * How much of a value's bundle shows at a given effective strength. Preset
 * choices are often written at 0.3–0.6 within a preset, so full presence is
 * reached at 0.6; below that the effect fades in proportionally.
 */
export const presence = (strength: number) => clamp01(strength / 0.6);

const softAdd = (a: number, b: number) => 1 - (1 - a) * (1 - b);

export function paramsFromScene(scene: AtmosphereSceneInput | null): AtmosphereParams {
  if (!scene) return NEUTRAL_PARAMS;
  const out = { ...NEUTRAL_PARAMS } as MutableParams;
  const resolved = scene.resolved ?? {};
  const strengths = scene.strengths ?? {};
  const shapeWeight: Partial<Record<ScalarKey, number>> = {};

  // Scene-derived base colors: fog and haze start from the MapLibre sky fog so the
  // world fog meets the horizon; glow and shafts take the scene light.
  const fog = hexToRgb(scene.sky.fogColor);
  const horizon = hexToRgb(scene.palette.horizon ?? scene.sky.fogColor);
  const light = hexToRgb(scene.lighting.color);
  // Fog is lit air: lift it toward the lit horizon so it reads against light and dark ground alike.
  out.fogColor = mixRgb(fog, mixRgb(horizon, light, 0.3), 0.45);
  out.hazeColor = mixRgb(fog, horizon, 0.5);
  out.washTop = horizon;
  out.washBottom = mixRgb(hexToRgb(scene.palette.land ?? '#f3efe6'), light, 0.25);
  out.glowColor = mixRgb(light, [1, 1, 1], 0.35);
  out.shaftColor = mixRgb(light, [1, 0.93, 0.78], 0.4);

  for (const [key, bundles] of Object.entries(VALUE_BUNDLES)) {
    const value = resolved[key];
    const bundle = value ? bundles[value] : undefined;
    if (!bundle) continue;
    const p = presence(strengths[key] ?? 0);
    if (p <= 0) continue;
    for (const [k, v] of Object.entries(bundle) as [ScalarKey | 'colors', number | Bundle['colors']][]) {
      if (k === 'colors') {
        for (const [ck, hex] of Object.entries(v as Record<ColorKey, string>)) out[ck as ColorKey] = mixRgb(out[ck as ColorKey], hexToRgb(hex), p);
        continue;
      }
      const amount = v as number;
      if (SHAPE_KEYS.has(k)) {
        // Strongest source sets the shape; it eases in from the neutral shape with presence.
        if (p >= (shapeWeight[k] ?? 0)) {
          shapeWeight[k] = p;
          out[k] = NEUTRAL_PARAMS[k] + (amount - NEUTRAL_PARAMS[k]) * p;
        }
      } else {
        out[k] = softAdd(out[k], clamp01(amount * p));
      }
    }
  }

  const hue = resolved['air_and_atmosphere.fog_hue'];
  if (hue && FOG_HUES[hue]) {
    const p = presence(strengths['air_and_atmosphere.fog_hue'] ?? 0);
    out.fogColor = mixRgb(out.fogColor, hexToRgb(FOG_HUES[hue]), p);
    out.hazeColor = mixRgb(out.hazeColor, hexToRgb(FOG_HUES[hue]), p * 0.6);
  }
  // Light leaks burn toward the scene's own warm light, never a fixed orange on a cold scene.
  out.leakColor = mixRgb(hexToRgb('#ff8a3d'), light, 0.3);
  return Object.freeze(out);
}

/** 0 = bright daytime ground, 1 = night: from the scene's ground and sky lightness. */
export function sceneDarkness(scene: Pick<AtmosphereSceneInput, 'palette'> | null): number {
  if (!scene) return 0;
  const land = luminance(hexToRgb(scene.palette.land ?? '#f3efe6'));
  const sky = luminance(hexToRgb(scene.palette.sky ?? '#cfe3f5'));
  return clamp01((0.75 - (land * 0.7 + sky * 0.3)) / 0.55);
}

export type { RGB };
