/**
 * What a renderer can actually show. The catalog's `tier` is a planning label;
 * this is the runtime truth the compiler clips against (design §3).
 *
 * A setting's default value is always "supported": it is the no-op baseline.
 * Any other value is supported only if the profile lists it. Unsupported
 * requests are dropped from the scene and reported in `SceneState.disabled`.
 */
import type { SceneCatalog, SceneKey } from './catalog';
import {
  CONTRAST, FOG_COLORS, HIGHLIGHT_TINT, HORIZON_BLEND, HUE_BIAS, LABEL_SYSTEMS, LIGHT_INTENSITY,
  LIGHT_POSITION, PALETTE_SWATCHES, SATURATION, SHADOW_TINT, TEMPERATURE, TRANSITION_MS,
} from './swatches';

/** Non-setting features the compiler may reference. */
export type SceneFeature =
  | 'set_piece_3d'
  | 'svg_textures'
  /** Two-tone (light + dark) pin outline, proposed to the map owner; lets the ground change lightness continuously. */
  | 'pin_contrast_ring';

export interface CapabilityProfile {
  readonly id: string;
  /** Supported non-default values per key. Keys not listed support only their default. */
  readonly values: ReadonlyMap<SceneKey, ReadonlySet<string>>;
  readonly features: ReadonlySet<SceneFeature>;
}

export function supports(profile: CapabilityProfile, key: SceneKey, value: string, defaultValue: string): boolean {
  return value === defaultValue || profile.values.get(key)?.has(value) === true;
}

function profile(id: string, tables: Record<SceneKey, readonly string[]>, features: SceneFeature[] = []): CapabilityProfile {
  return Object.freeze({
    id,
    values: new Map(Object.entries(tables).map(([k, v]) => [k, new Set(v)])),
    features: new Set(features),
  });
}

const keysOf = (o: object) => Object.keys(o);

/**
 * Settings the existing vibeTheme `applyPalette()` can render today with no
 * map-owner change: everything that becomes a `Palette` color.
 */
const PALETTE_TABLES: Record<SceneKey, readonly string[]> = {
  ...Object.fromEntries(Object.entries(PALETTE_SWATCHES).map(([key, values]) => [key, keysOf(values)])),
  'global_grade.saturation': keysOf(SATURATION),
  'global_grade.temperature': keysOf(TEMPERATURE),
  'global_grade.hue_bias': keysOf(HUE_BIAS),
  'global_grade.shadow_tint': keysOf(SHADOW_TINT),
  'global_grade.highlight_tint': keysOf(HIGHLIGHT_TINT),
  'global_grade.contrast_curve': keysOf(CONTRAST),
  'text_and_labels.label_color_system': keysOf(LABEL_SYSTEMS),
};

export const PALETTE_ADAPTER_V0: CapabilityProfile = profile('palette-adapter-v0', PALETTE_TABLES);

/**
 * V0 plus light intensity/angle, sky blends, fog color and transition timing,
 * as rendered by vibeTheme's `setScene` through `buildMapStyle(palette, scene)`.
 */
export const SCENE_ADAPTER_V1: CapabilityProfile = profile('scene-adapter-v1', {
  ...PALETTE_TABLES,
  'lighting_and_shadows.light_intensity': keysOf(LIGHT_INTENSITY),
  'lighting_and_shadows.light_angle': keysOf(LIGHT_POSITION),
  'sky_and_horizon.horizon_blend': keysOf(HORIZON_BLEND),
  'sky_and_horizon.fog_horizon_color': keysOf(FOG_COLORS),
  'animation_and_morph.scene_transition': keysOf(TRANSITION_MS),
});

/**
 * What the live map renders today (vibeTheme controller `setScene`): V1 plus
 * the always-on two-tone pin ring. Use this for the real map session.
 */
export const MAP_RENDERER_V1: CapabilityProfile = Object.freeze({
  id: 'map-renderer-v1',
  values: SCENE_ADAPTER_V1.values,
  features: new Set<SceneFeature>(['pin_contrast_ring']),
});

/**
 * Every catalog value. For compiler tests and design previews only:
 * renderers must never use this to claim an effect is live.
 */
export function previewAllCapabilities(catalog: SceneCatalog): CapabilityProfile {
  return profile(
    'preview-all',
    Object.fromEntries(catalog.settings.map((s) => [s.key, s.values])),
    ['set_piece_3d', 'svg_textures', 'pin_contrast_ring'],
  );
}

/** Any profile plus extra features (e.g. to preview the proposed pin ring). */
export function withFeatures(base: CapabilityProfile, ...features: SceneFeature[]): CapabilityProfile {
  return Object.freeze({ id: `${base.id}+${features.join('+')}`, values: base.values, features: new Set([...base.features, ...features]) });
}
