import { mapPaletteForPreview } from './design/visualFoundation';
import { hexToLab, labToHex } from './features/scene/color';
import { withMaterialOverlays } from './features/map/baseMaterials';
import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';

/**
 * Google-Maps-inspired MapLibre style over OpenStreetMap vector tiles.
 *
 * Tiles, fonts and the data schema (OpenMapTiles) come from OpenFreeMap,
 * which serves OpenStreetMap data for free with no API key.
 */

type Filter = ExpressionSpecification;

/**
 * Every color the map style uses. The vibe theme (src/features/vibeTheme)
 * blends these toward a user's top vibes; `basePalette` is the plain map.
 */
export const basePalette = mapPaletteForPreview({
  // Neutral architectural-atlas daylight: warm paper ground, stone/concrete/
  // glass building tones, restrained streets. Deliberately not tied to any vibe;
  // the Scene Composer compiles every scene from these values.
  land: '#f3f2ee',
  urban: '#e7e1d9',
  water: '#8bbbe4',
  waterLabel: '#35658c',
  park: '#b8d8a0',
  wood: '#a3c98d',
  hospital: '#f3d7d2',
  school: '#eedecb',
  sand: '#ede2c6',
  building: '#d9d4ca',
  buildingOutline: '#c5baa9',
  building3d: '#e3ddd2',
  roadMinor: '#fdfaf3',
  roadCasing: '#d8cfc0',
  roadMajor: '#fffdf6',
  roadMajorCasing: '#cbbfad',
  highway: '#f5d184',
  highwayCasing: '#d6a95c',
  path: '#cdc2b0',
  rail: '#b2b4b8',
  textPrimary: '#34383c',
  textSecondary: '#5b5f64',
  halo: '#ffffff',
  aeroway: '#e6ded5',
  runway: '#d6ccbf',
  building3dMid: '#d4d0c8',
  building3dHigh: '#cbd0d6',
  neighbourhoodLabel: '#7a7c80',
  sky: '#c0dcf2',
  horizon: '#f3efe6',
  light: '#ffffff',
});
export type PaletteKey = keyof typeof basePalette;
/** Colors as `#rrggbb`. */
export type Palette = Record<PaletteKey, string>;

/** How long paint changes (e.g. a theme change) animate, in ms. */
export const THEME_TRANSITION_MS = 800;

/** `#rrggbb` → `rgba(r,g,b,alpha)`. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const SOURCE = 'openmaptiles';
export const BUILDING_3D_LAYER = 'building-3d';
export const BUILDING_3D_OPACITY = 0.92;

/**
 * 3D buildings are drawn in height bands, each with a constant color sampled
 * from the height gradient (0 m → building3d, 60 m → building3dMid, 200 m →
 * building3dHigh). A single layer colored by `render_height` is data-driven
 * paint, which MapLibre never animates and re-lays-out in its workers on
 * every change (browser QA: a visible snap on every theme change, ~400 ms per
 * relayout). Constant per-band colors transition natively with the rest of
 * the map. A building has one height, so it gets one band color either way.
 * The first band keeps the original layer id.
 */
export const BUILDING_3D_BANDS: readonly { id: string; min: number; max: number; sampleHeight: number }[] = [
  { id: BUILDING_3D_LAYER, min: 0, max: 15, sampleHeight: 7.5 },
  { id: 'building-3d-b2', min: 15, max: 35, sampleHeight: 25 },
  { id: 'building-3d-b3', min: 35, max: 60, sampleHeight: 47.5 },
  { id: 'building-3d-b4', min: 60, max: 110, sampleHeight: 85 },
  { id: 'building-3d-b5', min: 110, max: 200, sampleHeight: 155 },
  { id: 'building-3d-b6', min: 200, max: Infinity, sampleHeight: 200 },
];
/** Every 3D building layer (for camera-driven opacity in main.ts). */
export const BUILDING_3D_LAYERS: readonly string[] = BUILDING_3D_BANDS.flatMap((b) => ['neutral', 'neutral-alt', 'brick', 'stone', 'glass'].map((m) => buildingLayerId(b.id, m)));
/** Layer id for a band and material; the neutral tone keeps the band's original id. */
export function buildingLayerId(bandId: string, material: string): string {
  return material === 'neutral' ? bandId : `${bandId}-${material}`;
}

/** Per-channel sRGB interpolation, as MapLibre's `interpolate` does for colors. */
function mixHex(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = (n: number, shift: number) => (n >> shift) & 255;
  return `#${[16, 8, 0].map((s) => Math.round(ch(ca, s) + (ch(cb, s) - ch(ca, s)) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The height-gradient color at `h` meters (what the former single layer showed). */
export function buildingColorAt(palette: Palette, h: number): string {
  if (h <= 0) return palette.building3d;
  if (h < 60) return mixHex(palette.building3d, palette.building3dMid, h / 60);
  if (h < 200) return mixHex(palette.building3dMid, palette.building3dHigh, (h - 60) / 140);
  return palette.building3dHigh;
}

/**
 * Building material tones. OpenMapTiles derives a building's `colour` from
 * OSM `building:colour` / `building:material` (brick → #bd8161, glass →
 * #5a81a0, ...). Real tagged materials pick a tone; untagged buildings split
 * into two neutral tones by feature id, so blocks read as separate buildings
 * without inventing materials. Each tone is a small OKLab offset from the
 * current band color, so any palette (and every Scene Composer scene) still
 * recolors all of them, and colors stay constant per layer (no data-driven
 * paint, which MapLibre would not animate).
 */
export type BuildingMaterial = 'neutral' | 'neutral-alt' | 'brick' | 'stone' | 'glass';
const MATERIAL_COLOURS: Record<'brick' | 'stone' | 'glass', readonly string[]> = {
  brick: ['#bd8161', '#9d8b75', '#d48741'], // brick/masonry/traditional, clay/mud, wood
  stone: ['#b4a995', '#d3c2b0', '#dadbdb'], // stone/sandstone, concrete, plaster
  glass: ['#5a81a0', '#6a7880', '#b7b1a6'], // glass, cement block, metal/steel
};
/** OKLab [ΔL, Δa, Δb] per material at full variation. */
const MATERIAL_SHIFT: Record<BuildingMaterial, readonly [number, number, number]> = {
  neutral: [0, 0, 0],
  'neutral-alt': [-0.028, 0.002, 0.006],
  brick: [-0.07, 0.013, 0.016],
  stone: [0.012, 0.002, 0.016],
  glass: [-0.045, -0.008, -0.026],
};
export const BUILDING_MATERIALS: readonly BuildingMaterial[] = ['neutral', 'neutral-alt', 'brick', 'stone', 'glass'];

function materialFilter(material: BuildingMaterial): Filter {
  const colour: ExpressionSpecification = ['downcase', ['to-string', ['coalesce', ['get', 'colour'], '']]];
  const tagged: Filter = ['match', colour, [...MATERIAL_COLOURS.brick, ...MATERIAL_COLOURS.stone, ...MATERIAL_COLOURS.glass], true, false];
  if (material === 'neutral') return ['all', ['!', tagged], ['==', ['%', ['to-number', ['id'], 0], 2], 0]];
  if (material === 'neutral-alt') return ['all', ['!', tagged], ['!=', ['%', ['to-number', ['id'], 0], 2], 0]];
  return ['match', colour, [...MATERIAL_COLOURS[material]], true, false];
}

/** A band color shifted toward a material, scaled by `variation` (0 = uniform). */
export function materialColor(base: string, material: BuildingMaterial, variation = 1): string {
  const [dL, da, db] = MATERIAL_SHIFT[material];
  if (!variation || (dL === 0 && da === 0 && db === 0)) return base;
  const [L, a, b] = hexToLab(base);
  // Dark palettes (night scenes) lift instead of sinking further into black.
  const sign = L < 0.35 && dL < 0 ? -0.6 : 1;
  return labToHex([L + dL * variation * sign, a + da * variation, b + db * variation]);
}

/** Every building color the style uses for a palette (tests, previews). */
export function buildingMaterialColors(palette: Palette, variation = 1): string[] {
  return BUILDING_3D_BANDS.flatMap((band) => BUILDING_MATERIALS.map((m) => materialColor(buildingColorAt(palette, band.sampleHeight), m, variation)));
}

/** Contact shadow under footprints: grounds 3D buildings without real AO. */
export const footprintShadowColor = (palette: Palette) => {
  const [L, a, b] = hexToLab(palette.buildingOutline);
  return labToHex([Math.max(0, L - 0.2), a, b]);
};

const name: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];

const notTunnel: Filter = ['!=', ['get', 'brunnel'], 'tunnel'];
const isLine: Filter = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const classIn = (...classes: string[]): Filter => ['match', ['get', 'class'], classes, true, false];

/** Road width curve in px, given the width at zoom 10, 14 and 20. */
const roadWidth = (w10: number, w14: number, w20: number): ExpressionSpecification => [
  'interpolate',
  ['exponential', 1.4],
  ['zoom'],
  10,
  w10,
  14,
  w14,
  20,
  w20,
];

function road(
  id: string,
  classes: string[],
  color: string,
  casing: string,
  widths: [number, number, number],
  minzoom = 0,
): LayerSpecification[] {
  const filter: Filter = ['all', isLine, notTunnel, classIn(...classes)];
  const [a, b, c] = widths;
  return [
    {
      id: `${id}-casing`,
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      // Restrained casing: a hairline at city zooms, a curb-like edge close up.
      paint: { 'line-color': casing, 'line-width': roadWidth(a + 0.5, b + 1.1, c + 2.2) },
    },
    {
      id,
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': roadWidth(a, b, c) },
    },
  ];
}

const buildLayers = (palette: Palette, scene: Readonly<SceneStyle>): LayerSpecification[] => [
  { id: 'background', type: 'background', paint: { 'background-color': palette.land } },

  // --- Land use & land cover ---
  {
    id: 'landuse-urban',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    filter: classIn('residential', 'commercial', 'industrial', 'retail'),
    paint: { 'fill-color': palette.urban, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 0.55] },
  },
  {
    id: 'landuse-hospital',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    filter: classIn('hospital'),
    paint: { 'fill-color': palette.hospital },
  },
  {
    id: 'landuse-school',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    filter: classIn('school', 'university', 'college'),
    paint: { 'fill-color': palette.school },
  },
  {
    id: 'landcover-wood',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landcover',
    filter: classIn('wood', 'forest'),
    paint: { 'fill-color': palette.wood },
  },
  {
    id: 'landcover-grass',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landcover',
    filter: classIn('grass', 'wetland'),
    paint: { 'fill-color': palette.park },
  },
  {
    id: 'landcover-sand',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landcover',
    filter: classIn('sand'),
    paint: { 'fill-color': palette.sand },
  },
  {
    id: 'park',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'park',
    paint: { 'fill-color': palette.park },
  },
  {
    id: 'landuse-pitch',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    filter: classIn('pitch', 'cemetery', 'track'),
    paint: { 'fill-color': palette.park, 'fill-opacity': 0.8 },
  },

  // --- Water ---
  {
    id: 'water',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'water',
    filter: notTunnel,
    paint: { 'fill-color': palette.water },
  },
  {
    id: 'waterway',
    type: 'line',
    source: SOURCE,
    'source-layer': 'waterway',
    filter: notTunnel,
    paint: {
      'line-color': palette.water,
      'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 8, 0.5, 14, 2, 20, 8],
    },
  },

  // Wharves, piers and pedestrian plazas (OSM area polygons): a paved surface
  // tone, drawn over water so Boston's waterfront reads as built ground.
  {
    id: 'transport-area',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 13,
    filter: ['all', ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], classIn('pier', 'path', 'pedestrian')],
    paint: { 'fill-color': palette.path, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.85] },
  },

  // --- Aeroways ---
  {
    id: 'aeroway-area',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'aeroway',
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    paint: { 'fill-color': palette.aeroway },
  },
  {
    id: 'aeroway-runway',
    type: 'line',
    source: SOURCE,
    'source-layer': 'aeroway',
    filter: ['all', isLine, classIn('runway', 'taxiway')],
    paint: {
      'line-color': palette.runway,
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 2, 17, 50],
    },
  },

  // Contact shadow: the footprint nudged away from the light, visible only at
  // the foot of 3D walls. Fades in with the extrusions.
  {
    id: 'building-contact-shadow',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-color': footprintShadowColor(palette),
      'fill-translate': [2.5, 2],
      'fill-translate-anchor': 'viewport',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.22],
    },
  },

  // --- Flat building footprints (what you see in top-down view and when zoomed out) ---
  {
    id: 'building',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'building',
    minzoom: 13,
    paint: {
      'fill-color': palette.building,
      'fill-outline-color': palette.buildingOutline,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1],
    },
  },

  // --- Roads (drawn smallest to largest so big roads sit on top) ---
  {
    id: 'path',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 15,
    filter: ['all', isLine, notTunnel, classIn('path', 'pedestrian')],
    paint: {
      'line-color': palette.path,
      'line-dasharray': [2, 1.5],
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 20, 3],
    },
  },
  // Widths at z10 / z14 / z20. Tuned at the default camera (z16, 60° pitch)
  // so streets frame the buildings instead of overpowering them; highways stay
  // the widest and keep their color, minor streets never vanish when zoomed out.
  ...road('road-service', ['service', 'track'], palette.roadMinor, palette.roadCasing, [0, 0.6, 5.5], 14),
  ...road('road-minor', ['minor'], palette.roadMinor, palette.roadCasing, [0.3, 1.8, 9], 12),
  ...road('road-secondary', ['secondary', 'tertiary'], palette.roadMajor, palette.roadMajorCasing, [0.7, 2.5, 12], 9),
  ...road('road-primary', ['primary', 'trunk'], palette.roadMajor, palette.roadMajorCasing, [1, 3.2, 15], 7),
  ...road('road-motorway', ['motorway'], palette.highway, palette.highwayCasing, [1.2, 3.5, 17], 5),
  {
    id: 'rail',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 12,
    filter: ['all', isLine, notTunnel, classIn('rail', 'transit')],
    paint: {
      'line-color': palette.rail,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 3],
    },
  },

  // --- 2.5D extruded buildings (height bands; see BUILDING_3D_BANDS) ---
  ...BUILDING_3D_BANDS.flatMap((band): LayerSpecification[] => {
    const height: ExpressionSpecification = ['coalesce', ['get', 'render_height'], 0];
    const inBand: Filter[] = [['>=', height, band.min]];
    if (Number.isFinite(band.max)) inBand.push(['<', height, band.max]);
    const bandColor = buildingColorAt(palette, band.sampleHeight);
    return BUILDING_MATERIALS.map((material): LayerSpecification => ({
      id: buildingLayerId(band.id, material),
      type: 'fill-extrusion',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 14,
      filter: ['all', ['!', ['has', 'hide_3d']], ...inBand, materialFilter(material)],
      paint: {
        'fill-extrusion-color': materialColor(bandColor, material, scene.materialVariation ?? 1),
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, height],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        // Starts at full strength; main.ts fades it with camera pitch (0 when top-down).
        'fill-extrusion-opacity': BUILDING_3D_OPACITY,
        // Follows the camera pitch frame by frame, so it keeps MapLibre's default
        // 300ms instead of the slower style-wide theme transition.
        'fill-extrusion-opacity-transition': { duration: 300, delay: 0 },
        'fill-extrusion-vertical-gradient': true,
      },
    }));
  }),

  // --- Labels ---
  {
    id: 'water-label',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'water_name',
    layout: {
      'text-field': name,
      'text-font': ['Noto Sans Italic'],
      'text-size': 13,
      'text-max-width': 8,
    },
    paint: { 'text-color': palette.waterLabel, 'text-halo-color': withAlpha(palette.halo, 0.6), 'text-halo-width': 1 },
  },
  {
    id: 'place-neighbourhood',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'place',
    minzoom: 12,
    filter: classIn('neighbourhood', 'suburb', 'quarter'),
    layout: {
      'text-field': name,
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.12,
      'text-max-width': 7,
    },
    paint: { 'text-color': palette.neighbourhoodLabel, 'text-halo-color': palette.halo, 'text-halo-width': 1.5 },
  },
  {
    id: 'place-city',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'place',
    maxzoom: 14,
    filter: classIn('city', 'town', 'village'),
    layout: {
      'text-field': name,
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 12, 18],
    },
    paint: { 'text-color': palette.textPrimary, 'text-halo-color': palette.halo, 'text-halo-width': 2 },
  },
];

/**
 * Light, sky/fog and transition parameters a scene may set (Scene Composer,
 * approved interface). The defaults are today's values, so
 * `buildMapStyle(palette)` is unchanged.
 */
export interface SceneStyle {
  /** MapLibre light intensity, 0–1. */
  lightIntensity: number;
  /** MapLibre light position [radial, azimuthal°, polar°], viewport-anchored. */
  lightPosition: [number, number, number];
  /** Fog color; null = follow `palette.land` (today's behavior). */
  fogColor: string | null;
  skyHorizonBlend: number;
  horizonFogBlend: number;
  fogGroundBlend: number;
  /** Duration of the style-wide transition (used once, when the map is created). */
  transitionMs: number;
  /**
   * Building material tone variation, 0 (uniform walls per height band) to 1
   * (default). A scene can flatten or restore the OSM-material tones without
   * touching layers; colors still come from its palette.
   */
  materialVariation?: number;
  /** Ground texture strength, 0 (plain fills) to 1 (default); see features/map/baseMaterials. */
  materialStrength?: number;
}

export const DEFAULT_SCENE_STYLE: Readonly<SceneStyle> = Object.freeze({
  lightIntensity: 0.35,
  lightPosition: [1.4, 295, 40] as [number, number, number],
  fogColor: null,
  skyHorizonBlend: 0.6,
  horizonFogBlend: 0.7,
  fogGroundBlend: 0.85,
  transitionMs: THEME_TRANSITION_MS,
});

/** The full map style in the given colors and scene parameters. */
export function buildMapStyle(palette: Palette, scene: Readonly<SceneStyle> = DEFAULT_SCENE_STYLE): StyleSpecification {
  return {
    version: 8,
    name: 'Vibenta Maps Draft',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      [SOURCE]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    transition: { duration: scene.transitionMs, delay: 0 },
    // Light from the screen's left by default (azimuth 295°). Pin shadows in
    // style.css fall the opposite way via --light-azimuth (lightShadowAngle),
    // so the two stay consistent when a scene moves the light.
    light: { anchor: 'viewport', color: palette.light, intensity: scene.lightIntensity, position: [...scene.lightPosition] },
    sky: {
      'sky-color': palette.sky,
      'horizon-color': palette.horizon,
      'fog-color': scene.fogColor ?? palette.land,
      'sky-horizon-blend': scene.skyHorizonBlend,
      'horizon-fog-blend': scene.horizonFogBlend,
      'fog-ground-blend': scene.fogGroundBlend,
    },
    layers: withMaterialOverlays(buildLayers(palette, scene), scene.materialStrength ?? 1),
  };
}

export const mapStyle: StyleSpecification = buildMapStyle(basePalette);

/** Screen angle (deg) pin shadows fall at for a light azimuth: directly opposite the light. */
export const lightShadowAngle = (azimuth: number) => (((azimuth + 180) % 360) + 360) % 360;
