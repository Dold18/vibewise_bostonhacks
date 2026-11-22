/**
 * Building appearance contract — the slice of the city appearance
 * configuration this renderer consumes.
 *
 * STATUS: proposed. The shared "city-engine" contract (Chat 1) did not exist
 * in any branch when this renderer was written, so this file defines the
 * building slice locally. It is intentionally composable: every field is a
 * material / architectural parameter, never a cuisine, mood or preset name.
 * When the shared contract lands, it should either re-export these types or
 * map onto them with a pure adapter — the renderer only depends on
 * `BuildingAppearance`.
 */

/** Physical surface families the shader knows how to structure. */
export const SURFACE_KINDS = [
  'brick',
  'stone',
  'stucco',
  'plaster',
  'concrete',
  'glass',
  'metal',
  'timber',
] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const WINDOW_SHAPES = ['none', 'punched', 'arched', 'ribbon', 'curtain'] as const;
export type WindowShape = (typeof WINDOW_SHAPES)[number];

export const ROOF_KINDS = ['membrane', 'gravel', 'tile', 'seam', 'green', 'solar'] as const;
export type RoofKind = (typeof ROOF_KINDS)[number];

export const CORNER_STYLES = ['none', 'pilaster', 'quoin'] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];

/**
 * Reference to an asset in the existing scene-asset library.
 * - v2 atlas cells: `brick_masonry.running_bond.warm` (see /scene-assets/v2/manifest.json)
 * - v1 single SVGs: `stone-blocks` (see /scene-assets/v1/manifest.json)
 */
export type AssetRef = string;

export interface WindowTreatment {
  shape: WindowShape;
  /** Storey height in metres; windows and string courses align to it. */
  floorHeight: number;
  /** Target bay width in metres; each wall edge gets a whole number of bays. */
  bayWidth: number;
  /** Window width as a fraction of the bay (0..1). */
  widthRatio: number;
  /** Window height as a fraction of the storey (0..1). */
  heightRatio: number;
  /** Glass colour (unlit). */
  glassColor: string;
  /** Frame / mullion colour. */
  frameColor: string;
  /** Fraction of windows that are lit (0..1), chosen per window deterministically. */
  litFraction: number;
  /** Interior light colour for lit windows. */
  glowColor: string;
  /** Ground floor treated as a tall glazed storefront. */
  storefront: boolean;
}

export interface TrimTreatment {
  color: string;
  /** Cornice band height at the top of the wall, metres (0 = none). */
  corniceHeight: number;
  /** Base course height at the foot of the wall, metres (0 = none). */
  baseHeight: number;
  /** Draw a thin band at every floor line. */
  stringCourses: boolean;
  corners: CornerStyle;
  /** Corner pilaster / quoin width, metres. */
  cornerWidth: number;
  /** Parapet height in metres. The roof is lowered by this amount inside the real building height. */
  parapetHeight: number;
}

export interface SurfaceMaterial {
  kind: SurfaceKind;
  /** Optional detail texture from the asset library (geometry-bound). */
  asset?: AssetRef;
  /** Base colour the texture is tinted toward. */
  color: string;
  /** 0 = asset colours as authored, 1 = fully tinted to `color` (luminance preserved). */
  tintStrength: number;
  /** Metres covered by one repetition of the texture. */
  textureScale: number;
  /** Texture rotation in degrees on the surface. */
  textureRotation: number;
  /** 0 = mirror-like, 1 = fully diffuse. */
  roughness: number;
  /** Analytic sky reflection strength 0..1 (not true scene reflections). */
  reflectivity: number;
  /** Staining, streaks and ground-level grime 0..1. */
  weathering: number;
}

/** One candidate wall treatment; the procedural rules pick one per building. */
export interface FacadeTreatment {
  /** Free-form label for diagnostics; never interpreted by the renderer. */
  label?: string;
  /** Relative weight among the treatments eligible for a building. */
  weight: number;
  /** Only buildings whose height (m) is within [min, max) are eligible. */
  heightRange?: [number, number];
  /** Only buildings whose footprint area (m²) is within [min, max) are eligible. */
  footprintRange?: [number, number];
  wall: SurfaceMaterial;
  windows: WindowTreatment;
  trim: TrimTreatment;
  /** Index into `roofs`; when omitted the roof is chosen by the same deterministic hash. */
  roof?: number;
}

export interface RoofTreatment {
  label?: string;
  weight: number;
  kind: RoofKind;
  surface: SurfaceMaterial;
  /** Align the roof texture to the building's longest edge (true) or to north (false). */
  alignToFootprint: boolean;
}

export interface BuildingLighting {
  /** Sun azimuth in degrees, clockwise: from north (`map`), or from the top of the screen (`viewport`). */
  sunAzimuth: number;
  /**
   * Frame of `sunAzimuth`. `viewport` matches MapLibre's viewport-anchored light (the map's own
   * extrusions), so the key light turns with the camera. Default `map`.
   */
  sunAnchor?: 'map' | 'viewport';
  /** Sun altitude in degrees above the horizon. */
  sunAltitude: number;
  sunColor: string;
  ambient: number;
  /** 0 = day, 1 = night (dims walls, raises window glow). */
  night: number;
  /** Lit-window emission multiplier. */
  glowStrength: number;
  skyColor: string;
  horizonColor: string;
}

export interface VariationRules {
  /** Session seed: the same seed + same buildings = the same city. */
  seed: string;
  /** Per-building colour jitter 0..1 (deterministic). */
  colorJitter: number;
  /** Per-building storey-height jitter in metres (deterministic). */
  floorJitter: number;
  /**
   * Spatial coherence in metres: neighbouring buildings inside a cell of this
   * size tend to share a treatment (districts). 0 = fully per-building.
   */
  districtSize: number;
  /** Probability 0..1 that a building follows its district instead of its own hash. */
  districtCoherence: number;
}

export interface BuildingAppearance {
  version: 1;
  /** 0 = neutral map buildings, 1 = full treatment. */
  strength: number;
  facades: FacadeTreatment[];
  roofs: RoofTreatment[];
  lighting: BuildingLighting;
  variation: VariationRules;
}

/** Renderer limits (uniform array sizes). */
export const MAX_FACADES = 8;
export const MAX_ROOFS = 6;

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Clamp a config into the renderer's supported envelope and report every
 * adjustment. Never throws; an invalid colour falls back to neutral grey.
 */
export function normalizeAppearance(input: BuildingAppearance): { appearance: BuildingAppearance; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const color = (path: string, v: string) => {
    if (HEX.test(v)) return v.toLowerCase();
    issues.push({ path, message: `invalid colour ${JSON.stringify(v)}` });
    return '#9a9a9a';
  };
  const num = (path: string, v: number, lo: number, hi: number) => {
    const c = clamp(v, lo, hi);
    if (c !== v) issues.push({ path, message: `${v} clamped to ${c}` });
    return c;
  };
  const surface = (p: string, s: SurfaceMaterial): SurfaceMaterial => ({
    kind: (SURFACE_KINDS as readonly string[]).includes(s.kind) ? s.kind : (issues.push({ path: `${p}.kind`, message: `unknown ${s.kind}` }), 'concrete'),
    asset: s.asset,
    color: color(`${p}.color`, s.color),
    tintStrength: num(`${p}.tintStrength`, s.tintStrength, 0, 1),
    textureScale: num(`${p}.textureScale`, s.textureScale, 0.5, 200),
    textureRotation: ((s.textureRotation % 360) + 360) % 360,
    roughness: num(`${p}.roughness`, s.roughness, 0.02, 1),
    reflectivity: num(`${p}.reflectivity`, s.reflectivity, 0, 1),
    weathering: num(`${p}.weathering`, s.weathering, 0, 1),
  });
  let facades = input.facades;
  if (facades.length > MAX_FACADES) {
    issues.push({ path: 'facades', message: `${facades.length} treatments; only the first ${MAX_FACADES} are rendered` });
    facades = facades.slice(0, MAX_FACADES);
  }
  let roofs = input.roofs;
  if (roofs.length > MAX_ROOFS) {
    issues.push({ path: 'roofs', message: `${roofs.length} roofs; only the first ${MAX_ROOFS} are rendered` });
    roofs = roofs.slice(0, MAX_ROOFS);
  }
  return {
    issues,
    appearance: {
      version: 1,
      strength: num('strength', input.strength, 0, 1),
      facades: facades.map((f, i) => {
        const p = `facades[${i}]`;
        const w = f.windows;
        const t = f.trim;
        return {
          label: f.label,
          weight: num(`${p}.weight`, f.weight, 0, 1000),
          heightRange: f.heightRange,
          footprintRange: f.footprintRange,
          roof: f.roof !== undefined && f.roof >= 0 && f.roof < roofs.length ? f.roof : undefined,
          wall: surface(`${p}.wall`, f.wall),
          windows: {
            shape: (WINDOW_SHAPES as readonly string[]).includes(w.shape) ? w.shape : 'punched',
            floorHeight: num(`${p}.windows.floorHeight`, w.floorHeight, 2.4, 8),
            bayWidth: num(`${p}.windows.bayWidth`, w.bayWidth, 1.2, 12),
            widthRatio: num(`${p}.windows.widthRatio`, w.widthRatio, 0.05, 0.98),
            heightRatio: num(`${p}.windows.heightRatio`, w.heightRatio, 0.05, 0.98),
            glassColor: color(`${p}.windows.glassColor`, w.glassColor),
            frameColor: color(`${p}.windows.frameColor`, w.frameColor),
            litFraction: num(`${p}.windows.litFraction`, w.litFraction, 0, 1),
            glowColor: color(`${p}.windows.glowColor`, w.glowColor),
            storefront: !!w.storefront,
          },
          trim: {
            color: color(`${p}.trim.color`, t.color),
            corniceHeight: num(`${p}.trim.corniceHeight`, t.corniceHeight, 0, 4),
            baseHeight: num(`${p}.trim.baseHeight`, t.baseHeight, 0, 6),
            stringCourses: !!t.stringCourses,
            corners: (CORNER_STYLES as readonly string[]).includes(t.corners) ? t.corners : 'none',
            cornerWidth: num(`${p}.trim.cornerWidth`, t.cornerWidth, 0, 3),
            parapetHeight: num(`${p}.trim.parapetHeight`, t.parapetHeight, 0, 3),
          },
        };
      }),
      roofs: roofs.map((r, i) => ({
        label: r.label,
        weight: num(`roofs[${i}].weight`, r.weight, 0, 1000),
        kind: (ROOF_KINDS as readonly string[]).includes(r.kind) ? r.kind : 'membrane',
        surface: surface(`roofs[${i}].surface`, r.surface),
        alignToFootprint: !!r.alignToFootprint,
      })),
      lighting: {
        sunAzimuth: ((input.lighting.sunAzimuth % 360) + 360) % 360,
        ...(input.lighting.sunAnchor === 'viewport' ? { sunAnchor: 'viewport' as const } : {}),
        sunAltitude: num('lighting.sunAltitude', input.lighting.sunAltitude, 2, 90),
        sunColor: color('lighting.sunColor', input.lighting.sunColor),
        ambient: num('lighting.ambient', input.lighting.ambient, 0, 1),
        night: num('lighting.night', input.lighting.night, 0, 1),
        glowStrength: num('lighting.glowStrength', input.lighting.glowStrength, 0, 4),
        skyColor: color('lighting.skyColor', input.lighting.skyColor),
        horizonColor: color('lighting.horizonColor', input.lighting.horizonColor),
      },
      variation: {
        seed: String(input.variation.seed ?? ''),
        colorJitter: num('variation.colorJitter', input.variation.colorJitter, 0, 1),
        floorJitter: num('variation.floorJitter', input.variation.floorJitter, 0, 2),
        districtSize: num('variation.districtSize', input.variation.districtSize, 0, 5000),
        districtCoherence: num('variation.districtCoherence', input.variation.districtCoherence, 0, 1),
      },
    },
  };
}
