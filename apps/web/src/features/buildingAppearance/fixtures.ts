/**
 * Example configurations for QA and tests. They are plain data composed from
 * the contract's parameters — the renderer has no code path keyed to any of
 * them, and a scene composer is expected to emit its own combinations.
 */
import type { BuildingAppearance, FacadeTreatment, RoofTreatment, SurfaceMaterial, TrimTreatment, WindowTreatment } from './contract';

export const DAY_LIGHTING: BuildingAppearance['lighting'] = {
  sunAzimuth: 215,
  sunAltitude: 38,
  sunColor: '#fff3df',
  ambient: 0.52,
  night: 0,
  glowStrength: 0.8,
  skyColor: '#8fbbe8',
  horizonColor: '#e8eef4',
};

export const surface = (s: Partial<SurfaceMaterial> & Pick<SurfaceMaterial, 'kind' | 'color'>): SurfaceMaterial => ({
  tintStrength: 0.6,
  textureScale: 4,
  textureRotation: 0,
  roughness: 0.85,
  reflectivity: 0.05,
  weathering: 0,
  ...s,
});

export const windows = (w: Partial<WindowTreatment> = {}): WindowTreatment => ({
  shape: 'punched',
  floorHeight: 3.4,
  bayWidth: 3.2,
  widthRatio: 0.5,
  heightRatio: 0.58,
  glassColor: '#2b3a48',
  frameColor: '#e9e4da',
  litFraction: 0.12,
  glowColor: '#ffcf8a',
  storefront: false,
  ...w,
});

export const trim = (t: Partial<TrimTreatment> = {}): TrimTreatment => ({
  color: '#e8e2d6',
  corniceHeight: 0,
  baseHeight: 0,
  stringCourses: false,
  corners: 'none',
  cornerWidth: 0,
  parapetHeight: 0,
  ...t,
});

const roof = (r: Partial<RoofTreatment> & Pick<RoofTreatment, 'kind' | 'surface'>): RoofTreatment => ({ weight: 1, alignToFootprint: true, ...r });

const facade = (f: Partial<FacadeTreatment> & Pick<FacadeTreatment, 'wall'>): FacadeTreatment => ({
  weight: 1,
  windows: windows(),
  trim: trim(),
  ...f,
});

const base = (facades: FacadeTreatment[], roofs: RoofTreatment[], extra: Partial<BuildingAppearance> = {}): BuildingAppearance => ({
  version: 1,
  strength: 1,
  facades,
  roofs,
  lighting: DAY_LIGHTING,
  variation: { seed: 'qa-seed-1', colorJitter: 0.25, floorJitter: 0.3, districtSize: 0, districtCoherence: 0 },
  ...extra,
});

const MEMBRANE = roof({ kind: 'membrane', surface: surface({ kind: 'concrete', color: '#8d8f92', asset: 'stone_concrete.pitted_concrete.cool', textureScale: 6, tintStrength: 0.8 }) });

/** Plain massing: smooth concrete, no windows or trim — the closest analogue to the native extrusions. */
export const NEUTRAL_MASSING = base(
  [facade({ wall: surface({ kind: 'concrete', color: '#e6e3df', tintStrength: 1, roughness: 1 }), windows: windows({ shape: 'none' }) })],
  [roof({ kind: 'membrane', surface: surface({ kind: 'concrete', color: '#d9d6d2', tintStrength: 1 }) })],
  { variation: { seed: 'qa-seed-1', colorJitter: 0, floorJitter: 0, districtSize: 0, districtCoherence: 0 } },
);

/** Red and buff brick, punched windows, stone base, cornices, quoins; clay-tile and slate roofs. */
export const MASONRY = base(
  [
    facade({
      label: 'red running bond',
      weight: 3,
      wall: surface({ kind: 'brick', color: '#a5523a', asset: 'brick_masonry.running_bond.warm', textureScale: 3.2, tintStrength: 0.45 }),
      windows: windows({ widthRatio: 0.42, heightRatio: 0.6, frameColor: '#f1ece1', bayWidth: 2.8 }),
      trim: trim({ color: '#d9cfbd', corniceHeight: 0.9, baseHeight: 1.6, corners: 'quoin', cornerWidth: 0.9, parapetHeight: 0.9 }),
    }),
    facade({
      label: 'buff stacked bond',
      weight: 2,
      wall: surface({ kind: 'brick', color: '#c9a27a', asset: 'brick_masonry.stacked_bond.warm', textureScale: 3.2, tintStrength: 0.5 }),
      windows: windows({ shape: 'arched', widthRatio: 0.45, heightRatio: 0.66, frameColor: '#3b2f28', bayWidth: 3.0 }),
      trim: trim({ color: '#8a5a44', corniceHeight: 0.6, baseHeight: 1.0, stringCourses: true, corners: 'pilaster', cornerWidth: 0.7, parapetHeight: 0.6 }),
    }),
    facade({
      label: 'dark slim brick, tall',
      weight: 1,
      heightRange: [30, 1000],
      wall: surface({ kind: 'brick', color: '#5e3a30', asset: 'brick_masonry.slim_bricks.warm', textureScale: 3.6, tintStrength: 0.5 }),
      windows: windows({ shape: 'ribbon', heightRatio: 0.5, frameColor: '#cfc6b6' }),
      trim: trim({ color: '#cfc6b6', corniceHeight: 1.4, baseHeight: 4, parapetHeight: 1.2 }),
    }),
  ],
  [
    roof({ kind: 'tile', weight: 2, surface: surface({ kind: 'brick', color: '#9c4f35', asset: 'roofing.clay_roof_tiles.warm', textureScale: 4, tintStrength: 0.3 }) }),
    roof({ kind: 'tile', weight: 1, surface: surface({ kind: 'stone', color: '#4c5460', asset: 'roofing.slate_shingles.cool', textureScale: 4, tintStrength: 0.3 }) }),
    MEMBRANE,
  ],
);

/** Weathered limestone/granite ashlar and spalling lime plaster over brick. */
export const WEATHERED_STONE_PLASTER = base(
  [
    facade({
      label: 'limestone ashlar',
      weight: 2,
      wall: surface({ kind: 'stone', color: '#cdbf9f', asset: 'stone_concrete.limestone_slabs.warm', textureScale: 4.5, tintStrength: 0.55, weathering: 0.85 }),
      windows: windows({ shape: 'arched', widthRatio: 0.4, heightRatio: 0.62, frameColor: '#2f2a25', glassColor: '#24303a' }),
      trim: trim({ color: '#e2d8c2', corniceHeight: 1.2, baseHeight: 2.2, stringCourses: true, corners: 'quoin', cornerWidth: 1.0, parapetHeight: 1.0 }),
    }),
    facade({
      label: 'granite block',
      weight: 1,
      wall: surface({ kind: 'stone', color: '#8e8c86', asset: 'stone_concrete.granite_blocks.cool', textureScale: 4.5, tintStrength: 0.5, weathering: 0.7 }),
      windows: windows({ widthRatio: 0.38, heightRatio: 0.55, frameColor: '#d8d2c6' }),
      trim: trim({ color: '#6f6c66', corniceHeight: 1.0, baseHeight: 2.5, parapetHeight: 0.8 }),
    }),
    facade({
      label: 'lime plaster',
      weight: 2,
      wall: surface({ kind: 'plaster', color: '#e3cfa8', asset: 'stone_concrete.stucco_plaster.pastel', textureScale: 5, tintStrength: 0.85, weathering: 0.9 }),
      windows: windows({ widthRatio: 0.38, heightRatio: 0.6, frameColor: '#5d6b5a', glassColor: '#28323a' }),
      trim: trim({ color: '#f1e8d6', corniceHeight: 0.5, baseHeight: 0.9, corners: 'pilaster', cornerWidth: 0.5, parapetHeight: 0.4 }),
    }),
  ],
  [
    roof({ kind: 'gravel', surface: surface({ kind: 'stone', color: '#9a9488', asset: 'pavement.rounded_cobbles.cool', textureScale: 5, tintStrength: 0.85, weathering: 0.6 }) }),
    roof({ kind: 'tile', surface: surface({ kind: 'stone', color: '#5a5f66', asset: 'roofing.slate_shingles.cool', textureScale: 4, tintStrength: 0.4, weathering: 0.6 }) }),
  ],
);

/** Curtain-wall glass towers, metal-panel mid-rises, ribbon-window concrete; solar and seam roofs. */
export const GLASS_MODERN = base(
  [
    facade({
      label: 'curtain glass',
      weight: 3,
      wall: surface({ kind: 'glass', color: '#3f6f8f', asset: 'glass_metal.window_grid.cool', textureScale: 6, tintStrength: 0.7, roughness: 0.15, reflectivity: 0.9 }),
      windows: windows({ shape: 'curtain', floorHeight: 3.9, bayWidth: 1.6, glassColor: '#2d5876', frameColor: '#b8c4cc', litFraction: 0.25, glowColor: '#dff2ff' }),
      trim: trim({ color: '#c9d2d8', parapetHeight: 0.4 }),
    }),
    facade({
      label: 'metal panel',
      weight: 2,
      heightRange: [0, 60],
      wall: surface({ kind: 'metal', color: '#9aa3ab', asset: 'glass_metal.brushed_metal.cool', textureScale: 3, tintStrength: 0.6, roughness: 0.35, reflectivity: 0.4 }),
      windows: windows({ shape: 'ribbon', heightRatio: 0.55, glassColor: '#1f3346', frameColor: '#2b3036', litFraction: 0.2, glowColor: '#e8f4ff', storefront: true }),
      trim: trim({ color: '#3a4047', parapetHeight: 0.5 }),
    }),
    facade({
      label: 'board-formed concrete',
      weight: 1,
      wall: surface({ kind: 'concrete', color: '#b8b5ae', asset: 'stone_concrete.pitted_concrete.cool', textureScale: 5, tintStrength: 0.7, roughness: 0.9 }),
      windows: windows({ shape: 'ribbon', heightRatio: 0.42, glassColor: '#1d2a36', frameColor: '#55595e', storefront: true }),
      trim: trim({ color: '#a6a39c', parapetHeight: 0.6 }),
    }),
  ],
  [
    roof({ kind: 'solar', weight: 2, surface: surface({ kind: 'concrete', color: '#c4c6c8', tintStrength: 1 }) }),
    roof({ kind: 'seam', weight: 1, surface: surface({ kind: 'metal', color: '#8c959d', asset: 'roofing.standing_seam.cool', textureScale: 3, tintStrength: 0.6, roughness: 0.35, reflectivity: 0.5 }) }),
    roof({ kind: 'green', weight: 1, surface: surface({ kind: 'timber', color: '#6f8f4e', asset: 'nature_ground.moss.warm', textureScale: 6, tintStrength: 0.5 }) }),
  ],
);

/**
 * Architectural variation: height-dependent rules in one configuration —
 * low-rise timber/plaster, mid-rise masonry, high-rise glass — at dusk with
 * lit windows and spatially coherent districts.
 */
export const HEIGHT_ZONED_DUSK = base(
  [
    facade({
      label: 'low timber',
      weight: 1,
      heightRange: [0, 14],
      wall: surface({ kind: 'timber', color: '#7a5236', asset: 'timber.horizontal_planks.warm', textureScale: 3, tintStrength: 0.4 }),
      windows: windows({ widthRatio: 0.45, frameColor: '#efe6d2', litFraction: 0.55, storefront: true }),
      trim: trim({ color: '#efe6d2', corniceHeight: 0.4, corners: 'pilaster', cornerWidth: 0.35 }),
    }),
    facade({
      label: 'low plaster',
      weight: 1,
      heightRange: [0, 14],
      wall: surface({ kind: 'stucco', color: '#d9a679', asset: 'stone_concrete.stucco_plaster.warm', textureScale: 4, tintStrength: 0.8, weathering: 0.3 }),
      windows: windows({ shape: 'arched', widthRatio: 0.42, frameColor: '#3d5a4a', litFraction: 0.5 }),
      trim: trim({ color: '#f3e5cc', corniceHeight: 0.5, baseHeight: 0.8, parapetHeight: 0.4 }),
    }),
    facade({
      label: 'mid masonry',
      weight: 1,
      heightRange: [14, 45],
      wall: surface({ kind: 'brick', color: '#94503a', asset: 'brick_masonry.running_bond.warm', textureScale: 3.2, tintStrength: 0.45 }),
      windows: windows({ widthRatio: 0.44, frameColor: '#efe8da', litFraction: 0.45 }),
      trim: trim({ color: '#dccfb8', corniceHeight: 1.0, baseHeight: 1.8, stringCourses: true, corners: 'quoin', cornerWidth: 0.9, parapetHeight: 0.9 }),
    }),
    facade({
      label: 'high glass',
      weight: 1,
      heightRange: [45, 1000],
      wall: surface({ kind: 'glass', color: '#2f4f6a', roughness: 0.12, reflectivity: 0.95, tintStrength: 1 }),
      windows: windows({ shape: 'curtain', floorHeight: 4, bayWidth: 1.5, glassColor: '#1c3348', frameColor: '#6f7f8c', litFraction: 0.3, glowColor: '#ffe6bd' }),
      trim: trim({ color: '#9fb0bd', parapetHeight: 0.5 }),
    }),
  ],
  [
    roof({ kind: 'tile', surface: surface({ kind: 'brick', color: '#8e4a33', asset: 'roofing.clay_roof_tiles.warm', textureScale: 4, tintStrength: 0.35 }) }),
    roof({ kind: 'green', surface: surface({ kind: 'timber', color: '#5d7a45', asset: 'nature_ground.moss.warm', textureScale: 6, tintStrength: 0.5 }) }),
    roof({ kind: 'gravel', surface: surface({ kind: 'stone', color: '#7d7a74', tintStrength: 1 }) }),
  ],
  {
    lighting: { ...DAY_LIGHTING, sunAzimuth: 250, sunAltitude: 9, sunColor: '#ffb27a', ambient: 0.42, night: 0.55, glowStrength: 1.3, skyColor: '#4a5a8a', horizonColor: '#f0a878' },
    variation: { seed: 'qa-seed-1', colorJitter: 0.3, floorJitter: 0.35, districtSize: 220, districtCoherence: 0.7 },
  },
);

export const QA_FIXTURES = { NEUTRAL_MASSING, MASONRY, WEATHERED_STONE_PLASTER, GLASS_MODERN, HEIGHT_ZONED_DUSK } as const;
