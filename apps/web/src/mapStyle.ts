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
export const basePalette = {
  land: '#f3f3f0',
  urban: '#eceae6',
  water: '#9fcaf5',
  waterLabel: '#3f7cc0',
  park: '#c3e8bd',
  wood: '#b3dfab',
  hospital: '#fbe3e3',
  school: '#f1ece2',
  sand: '#f5ecd2',
  building: '#e6e3df',
  buildingOutline: '#d8d4cf',
  building3d: '#ebe8e4',
  roadMinor: '#ffffff',
  roadCasing: '#dadce0',
  roadMajor: '#ffffff',
  roadMajorCasing: '#c8ccd2',
  highway: '#fcd56a',
  highwayCasing: '#e2ad38',
  path: '#d6d3cd',
  rail: '#bfc4ca',
  textPrimary: '#3c4043',
  textSecondary: '#5f6368',
  halo: '#ffffff',
  aeroway: '#e4e6ea',
  runway: '#d4d7dc',
  building3dMid: '#e2e0e6',
  building3dHigh: '#d9dbe6',
  neighbourhoodLabel: '#80868b',
  sky: '#bcd9f7',
  horizon: '#e9f2fb',
  light: '#ffffff',
};
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
export const BUILDING_3D_LAYERS: readonly string[] = BUILDING_3D_BANDS.map((b) => b.id);

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
      paint: { 'line-color': casing, 'line-width': roadWidth(a + 1, b + 2, c + 3) },
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

const buildLayers = (palette: Palette): LayerSpecification[] => [
  { id: 'background', type: 'background', paint: { 'background-color': palette.land } },

  // --- Land use & land cover ---
  {
    id: 'landuse-urban',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    filter: classIn('residential', 'commercial', 'industrial', 'retail'),
    paint: { 'fill-color': palette.urban, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 0.35] },
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
  ...road('road-service', ['service', 'track'], palette.roadMinor, palette.roadCasing, [0, 0.8, 8], 14),
  ...road('road-minor', ['minor'], palette.roadMinor, palette.roadCasing, [0.3, 2.5, 18], 12),
  ...road('road-secondary', ['secondary', 'tertiary'], palette.roadMajor, palette.roadMajorCasing, [0.8, 4, 24], 9),
  ...road('road-primary', ['primary', 'trunk'], palette.roadMajor, palette.roadMajorCasing, [1.2, 5, 28], 7),
  ...road('road-motorway', ['motorway'], palette.highway, palette.highwayCasing, [1.5, 6, 32], 5),
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
  ...BUILDING_3D_BANDS.map((band): LayerSpecification => {
    const height: ExpressionSpecification = ['coalesce', ['get', 'render_height'], 0];
    const inBand: Filter[] = [['>=', height, band.min]];
    if (Number.isFinite(band.max)) inBand.push(['<', height, band.max]);
    return {
      id: band.id,
      type: 'fill-extrusion',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 14,
      filter: ['all', ['!', ['has', 'hide_3d']], ...inBand],
      paint: {
        'fill-extrusion-color': buildingColorAt(palette, band.sampleHeight),
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, height],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        // Starts at full strength; main.ts fades it with camera pitch (0 when top-down).
        'fill-extrusion-opacity': BUILDING_3D_OPACITY,
        // Follows the camera pitch frame by frame, so it keeps MapLibre's default
        // 300ms instead of the slower style-wide theme transition.
        'fill-extrusion-opacity-transition': { duration: 300, delay: 0 },
        'fill-extrusion-vertical-gradient': true,
      },
    };
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
    id: 'road-label',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'transportation_name',
    minzoom: 13,
    filter: classIn('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
    layout: {
      'symbol-placement': 'line',
      'text-field': name,
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13],
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'viewport',
    },
    paint: { 'text-color': palette.textSecondary, 'text-halo-color': palette.halo, 'text-halo-width': 1.5 },
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
    layers: buildLayers(palette),
  };
}

export const mapStyle: StyleSpecification = buildMapStyle(basePalette);

/** Screen angle (deg) pin shadows fall at for a light azimuth: directly opposite the light. */
export const lightShadowAngle = (azimuth: number) => (((azimuth + 180) % 360) + 360) % 360;
