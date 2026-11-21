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

export const palette = {
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
} as const;

const SOURCE = 'openmaptiles';
export const BUILDING_3D_LAYER = 'building-3d';
export const BUILDING_3D_OPACITY = 0.92;
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

const layers: LayerSpecification[] = [
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
    paint: { 'fill-color': '#e4e6ea' },
  },
  {
    id: 'aeroway-runway',
    type: 'line',
    source: SOURCE,
    'source-layer': 'aeroway',
    filter: ['all', isLine, classIn('runway', 'taxiway')],
    paint: {
      'line-color': '#d4d7dc',
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

  // --- 2.5D extruded buildings ---
  {
    id: BUILDING_3D_LAYER,
    type: 'fill-extrusion',
    source: SOURCE,
    'source-layer': 'building',
    minzoom: 14,
    filter: ['!', ['has', 'hide_3d']],
    paint: {
      'fill-extrusion-color': [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'render_height'], 0],
        0,
        palette.building3d,
        60,
        '#e2e0e6',
        200,
        '#d9dbe6',
      ],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 0]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      // Starts at full strength; main.ts fades it with camera pitch (0 when top-down).
      'fill-extrusion-opacity': BUILDING_3D_OPACITY,
      'fill-extrusion-vertical-gradient': true,
    },
  },

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
    paint: { 'text-color': palette.waterLabel, 'text-halo-color': 'rgba(255,255,255,0.6)', 'text-halo-width': 1 },
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
    paint: { 'text-color': '#80868b', 'text-halo-color': palette.halo, 'text-halo-width': 1.5 },
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

export const mapStyle: StyleSpecification = {
  version: 8,
  name: 'Vibenta Maps Draft',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    [SOURCE]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  // Light from the screen's left (azimuth 295°); pin shadows in style.css fall
  // the opposite way (115°) so the two stay consistent.
  light: { anchor: 'viewport', color: '#ffffff', intensity: 0.35, position: [1.4, 295, 40] },
  sky: {
    'sky-color': '#bcd9f7',
    'horizon-color': '#e9f2fb',
    'fog-color': palette.land,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.85,
  },
  layers,
};
