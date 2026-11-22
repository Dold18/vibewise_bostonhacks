/**
 * Surface layers and pattern slots.
 *
 * Every surface layer is added **once** and references a **fixed** image name
 * (a "slot"). A material change repaints the slot's pixels in place with
 * `map.updateImage` (same size ⇒ only the GPU atlas is patched; no tile
 * reload, no worker re-layout). Intensity changes are plain, animated opacity
 * paint. Pattern names, filters and layout never change after install, so
 * switching worlds never re-requests or re-lays-out vector tiles.
 *
 * Each layer reads the real OpenMapTiles geometry for its surface class:
 * streets by road class, footways and plazas, open ground, parks, grass,
 * woods. Water, buildings and labels are never patterned here.
 */
import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GreenAccent, SurfaceRecipe } from './recipe';
import type { SlotKind, TextureSpec } from './textures';
import { mixOk } from '../scene/color';
import { ROAD_WIDTHS, roadWidth } from '../../mapStyle';

const SOURCE = 'openmaptiles';
export const SURFACE_PREFIX = 'ws-';

/** Image slots: fixed names, fixed sizes (logical px at pixelRatio 2; fills are drawn at this size, line patterns are scaled to the line width). */
export const SLOTS = {
  roadMinor: ['ws-tex-road-minor-0', 'ws-tex-road-minor-1', 'ws-tex-road-minor-2'],
  roadMajor: ['ws-tex-road-major-0', 'ws-tex-road-major-1'],
  motorway: 'ws-tex-road-motorway',
  walk: 'ws-tex-walk',
  plaza: 'ws-tex-plaza',
  ground: 'ws-tex-ground',
  green: 'ws-tex-green',
  wood: 'ws-tex-wood',
  lamps: 'ws-tex-lamps',
} as const;

export const PIXEL_RATIO = 2;
export const SLOT_SIZE: Readonly<Record<SlotKind, readonly [number, number]>> = {
  // Line patterns: height = the full street cross-section (scaled to the line width by MapLibre).
  road: [64, 32],
  walk: [32, 16],
  plaza: [64, 64],
  ground: [128, 128],
  green: [128, 128],
  wood: [128, 128],
  lamps: [96, 32],
};

export const ALL_SLOTS: readonly { id: string; kind: SlotKind }[] = [
  ...SLOTS.roadMinor.map((id) => ({ id, kind: 'road' as const })),
  ...SLOTS.roadMajor.map((id) => ({ id, kind: 'road' as const })),
  { id: SLOTS.motorway, kind: 'road' },
  { id: SLOTS.walk, kind: 'walk' },
  { id: SLOTS.plaza, kind: 'plaza' },
  { id: SLOTS.ground, kind: 'ground' },
  { id: SLOTS.green, kind: 'green' },
  { id: SLOTS.wood, kind: 'wood' },
  { id: SLOTS.lamps, kind: 'lamps' },
];

// --- geometry filters (same classes as mapStyle.ts) --------------------------

const isLine: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isPoly: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const classIn = (...c: string[]): ExpressionSpecification => ['match', ['get', 'class'], c, true, false];
const roadFilter = (...c: string[]): FilterSpecification => ['all', isLine, notTunnel, classIn(...c)];

// Street materials ride the real carriageways: the base map's own widths, never a copy.
export { ROAD_WIDTHS, roadWidth };
const widthOf = (k: keyof typeof ROAD_WIDTHS) => {
  const [a, b, c] = ROAD_WIDTHS[k];
  return roadWidth(a, b, c);
};

/**
 * Street-to-street variation: the same street always gets the same variant
 * (derived from its name), so wear does not shimmer while the camera moves.
 */
export const variantPattern = (slots: readonly string[]): ExpressionSpecification => {
  const pick: ExpressionSpecification = ['%', ['length', ['coalesce', ['get', 'name'], ['get', 'class'], '']], slots.length];
  const arms: (number | string)[] = [];
  slots.slice(0, -1).forEach((s, i) => arms.push(i, s));
  return ['match', pick, ...arms, slots[slots.length - 1]] as ExpressionSpecification;
};

export interface SurfaceLayerDef {
  readonly layer: LayerSpecification;
  /** Base-style layer this one goes directly above. */
  readonly after: string;
}

const line = (id: string, filter: FilterSpecification, paint: Record<string, unknown>, minzoom: number, layout: Record<string, unknown> = {}): LayerSpecification =>
  ({ id, type: 'line', source: SOURCE, 'source-layer': 'transportation', minzoom, filter, layout: { 'line-cap': 'round', 'line-join': 'round', ...layout }, paint: { 'line-opacity': 0, ...paint } }) as LayerSpecification;

const ZERO_T = { duration: 0, delay: 0 };

/** Every surface layer, in stacking order, with its anchor in the base style. */
export function surfaceLayers(): SurfaceLayerDef[] {
  const roadPattern = (id: string, classes: string[], width: ExpressionSpecification, pattern: ExpressionSpecification | string, minzoom: number) =>
    line(id, roadFilter(...classes), { 'line-pattern': pattern, 'line-width': width }, minzoom);
  const edge = (id: string, classes: string[], width: ExpressionSpecification) =>
    line(id, roadFilter(...classes), { 'line-gap-width': width, 'line-width': 1, 'line-color': '#000000', 'line-blur': 0 }, 14);
  const majorClasses = ['secondary', 'tertiary', 'primary', 'trunk'];
  return [
    // Open ground (world-anchored pattern; landuse, parks, water and buildings draw above it).
    { after: 'background', layer: { id: 'ws-ground', type: 'background', paint: { 'background-pattern': SLOTS.ground, 'background-opacity': 0 } } },

    // Woods, grass, parks, pitches.
    { after: 'landuse-pitch', layer: { id: 'ws-wood', type: 'fill', source: SOURCE, 'source-layer': 'landcover', filter: classIn('wood', 'forest'), paint: { 'fill-pattern': SLOTS.wood, 'fill-opacity': 0 } } },
    { after: 'ws-wood', layer: { id: 'ws-green-grass', type: 'fill', source: SOURCE, 'source-layer': 'landcover', filter: classIn('grass', 'wetland'), paint: { 'fill-pattern': SLOTS.green, 'fill-opacity': 0 } } },
    { after: 'ws-green-grass', layer: { id: 'ws-green-park', type: 'fill', source: SOURCE, 'source-layer': 'park', paint: { 'fill-pattern': SLOTS.green, 'fill-opacity': 0 } } },
    { after: 'ws-green-park', layer: { id: 'ws-green-pitch', type: 'fill', source: SOURCE, 'source-layer': 'landuse', filter: classIn('pitch', 'track'), paint: { 'fill-pattern': SLOTS.green, 'fill-opacity': 0 } } },
    {
      after: 'ws-green-pitch',
      layer: { id: 'ws-green-edge', type: 'line', source: SOURCE, 'source-layer': 'park', minzoom: 13, layout: { 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-width': 1, 'line-blur': 0, 'line-opacity': 0 } },
    },

    // Plazas: pedestrian areas mapped as polygons.
    { after: 'aeroway-runway', layer: { id: 'ws-plaza', type: 'fill', source: SOURCE, 'source-layer': 'transportation', minzoom: 14, filter: ['all', isPoly, classIn('pedestrian', 'path')], paint: { 'fill-pattern': SLOTS.plaza, 'fill-opacity': 0 } } },

    // Sidewalks / footpaths (real OSM footways), widened so pavers read.
    {
      after: 'path',
      layer: line('ws-walk', roadFilter('path', 'pedestrian'), { 'line-pattern': SLOTS.walk, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 15, 1.5, 17, 4, 19, 9, 20, 12] }, 15),
    },

    // Streets, each directly above its own base fill so intersections keep the base stacking.
    { after: 'road-service', layer: roadPattern('ws-road-service', ['service', 'track'], widthOf('service'), variantPattern(SLOTS.roadMinor), 15) },
    { after: 'road-minor', layer: roadPattern('ws-road-minor', ['minor'], widthOf('minor'), variantPattern(SLOTS.roadMinor), 14) },
    { after: 'ws-road-minor', layer: edge('ws-edge-minor', ['minor'], widthOf('minor')) },
    { after: 'road-secondary', layer: roadPattern('ws-road-secondary', ['secondary', 'tertiary'], widthOf('secondary'), variantPattern(SLOTS.roadMajor), 13) },
    { after: 'ws-road-secondary', layer: edge('ws-edge-secondary', ['secondary', 'tertiary'], widthOf('secondary')) },
    { after: 'road-primary', layer: roadPattern('ws-road-primary', ['primary', 'trunk'], widthOf('primary'), variantPattern(SLOTS.roadMajor), 13) },
    { after: 'ws-road-primary', layer: edge('ws-edge-primary', ['primary', 'trunk'], widthOf('primary')) },
    // Lane markings: one layer per style (dash arrays are fixed; only color/opacity change).
    { after: 'ws-edge-primary', layer: line('ws-lanes-fine', roadFilter(...majorClasses), { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 18, 1.4], 'line-dasharray': [4, 5] }, 15, { 'line-cap': 'butt' }) },
    { after: 'ws-lanes-fine', layer: line('ws-lanes-strong', roadFilter(...majorClasses), { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.2, 18, 3], 'line-dasharray': [2, 1.4] }, 15, { 'line-cap': 'butt' }) },
    { after: 'ws-lanes-strong', layer: line('ws-lanes-retro', roadFilter(...majorClasses), { 'line-color': '#000000', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 18, 1], 'line-gap-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 18, 2.6] }, 15, { 'line-cap': 'butt' }) },
    { after: 'road-motorway', layer: roadPattern('ws-road-motorway', ['motorway'], widthOf('motorway'), SLOTS.motorway, 13) },
    // Street-lamp pools at a fixed spacing along every street, spilling onto the sidewalks.
    {
      after: 'ws-road-motorway',
      layer: line(
        'ws-lamps',
        roadFilter('minor', 'service', 'secondary', 'tertiary', 'primary', 'trunk'),
        {
          'line-pattern': SLOTS.lamps,
          'line-width': [
            'interpolate', ['exponential', 1.4], ['zoom'],
            14, ['match', ['get', 'class'], ['primary', 'trunk'], 9, ['secondary', 'tertiary'], 7, 5],
            20, ['match', ['get', 'class'], ['primary', 'trunk'], 52, ['secondary', 'tertiary'], 44, 34],
          ],
        },
        15,
      ),
    },
  ].map((d) => ({ after: d.after, layer: withTransitions(d.layer as LayerSpecification) }));
}

/** Pattern/width paint never animates (and never changes); opacity and colors do. */
function withTransitions(layer: LayerSpecification): LayerSpecification {
  const paint = { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) };
  for (const key of Object.keys(paint)) if (key.endsWith('-pattern')) paint[`${key}-transition`] = ZERO_T;
  return { ...layer, paint } as LayerSpecification;
}

export const SURFACE_LAYER_IDS: readonly string[] = surfaceLayers().map((d) => d.layer.id);

// --- recipe → textures and paint ----------------------------------------------

/** What each slot should contain for a recipe; slots whose surface is off are omitted. */
export function textureSpecs(r: SurfaceRecipe): Map<string, TextureSpec> {
  const c = r.colors;
  const common = {
    pixelRatio: PIXEL_RATIO, ink: c.ink, light: c.light, sky: c.sky, park: c.park, accentA: c.accentA, accentB: c.accentB,
    mosaic: c.mosaic, wet: 0, wear: r.wear, scale: r.scale, reflection: r.reflection, night: r.night, accent: 'none' as GreenAccent, variant: 0,
  };
  const size = (kind: SlotKind) => ({ width: SLOT_SIZE[kind][0], height: SLOT_SIZE[kind][1] });
  const out = new Map<string, TextureSpec>();
  if (r.roads.intensity > 0) {
    const wearOf = [0.6, 1, 1.35];
    SLOTS.roadMinor.forEach((id, i) =>
      out.set(id, { ...common, ...size('road'), kind: 'road', material: r.roads.minor, base: c.road, wet: r.wet, wear: Math.min(1, r.wear * wearOf[i]), variant: i }),
    );
    SLOTS.roadMajor.forEach((id, i) =>
      out.set(id, { ...common, ...size('road'), kind: 'road', material: r.roads.major, base: c.roadMajor, wet: r.wet, wear: Math.min(1, r.wear * (i ? 1 : 0.6)), variant: i, scale: r.scale * 1.15 }),
    );
    out.set(SLOTS.motorway, { ...common, ...size('road'), kind: 'road', material: r.roads.motorway, base: c.motorway, wet: r.wet, wear: r.wear * 0.5, variant: 0 });
  }
  if (r.walk.intensity > 0) {
    const walkBase = mixOk(c.road, c.land, 0.35);
    out.set(SLOTS.walk, { ...common, ...size('walk'), kind: 'walk', material: r.walk.material, base: walkBase });
    out.set(SLOTS.plaza, { ...common, ...size('plaza'), kind: 'plaza', material: r.walk.material, base: walkBase, scale: r.scale * 1.3 });
  }
  if (r.ground.intensity > 0) out.set(SLOTS.ground, { ...common, ...size('ground'), kind: 'ground', material: r.ground.material, base: c.land });
  if (r.green.intensity > 0) out.set(SLOTS.green, { ...common, ...size('green'), kind: 'green', material: r.green.material, base: c.park, accent: r.green.accent });
  if (r.wood.intensity > 0) out.set(SLOTS.wood, { ...common, ...size('wood'), kind: 'wood', material: r.wood.material, base: c.wood });
  if (r.lamps.intensity > 0) out.set(SLOTS.lamps, { ...common, ...size('lamps'), kind: 'lamps', material: r.lamps.style, base: c.light });
  return out;
}

export interface PaintValue {
  readonly layer: string;
  readonly property: string;
  readonly value: unknown;
}

/** Opacity that fades in with zoom, so textures never turn tiny streets to noise. */
const ramp = (z0: number, z1: number, v: number): ExpressionSpecification | number =>
  v <= 0 ? 0 : (['interpolate', ['linear'], ['zoom'], z0, 0, z1, round(v)] as ExpressionSpecification);
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Every paint value the surface layers should have for a recipe. */
export function paintPlan(r: SurfaceRecipe): PaintValue[] {
  const out: PaintValue[] = [];
  const set = (layer: string, property: string, value: unknown) => out.push({ layer, property, value });
  const roadI = r.roads.intensity;
  set('ws-ground', 'background-opacity', round(r.ground.intensity));
  set('ws-wood', 'fill-opacity', round(r.wood.intensity));
  for (const id of ['ws-green-grass', 'ws-green-park', 'ws-green-pitch']) set(id, 'fill-opacity', round(r.green.intensity));
  set('ws-plaza', 'fill-opacity', ramp(14, 15.5, r.walk.intensity));
  set('ws-walk', 'line-opacity', ramp(15, 16, r.walk.intensity));
  set('ws-road-service', 'line-opacity', ramp(15, 16, roadI));
  set('ws-road-minor', 'line-opacity', ramp(14, 15.5, roadI));
  set('ws-road-secondary', 'line-opacity', ramp(13.5, 15, roadI * 0.9));
  set('ws-road-primary', 'line-opacity', ramp(13.5, 15, roadI * 0.9));
  set('ws-road-motorway', 'line-opacity', ramp(13.5, 15, roadI * 0.85));

  // Park edges.
  const ge = r.green.edge;
  set('ws-green-edge', 'line-color', r.green.edgeColor);
  set('ws-green-edge', 'line-width', ge === 'glow' ? ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 8] : ge === 'hedge' ? ['interpolate', ['linear'], ['zoom'], 13, 0.8, 18, 4] : ['interpolate', ['linear'], ['zoom'], 13, 0.6, 18, 1.6]);
  set('ws-green-edge', 'line-blur', ge === 'glow' ? 4 : ge === 'hedge' ? 0.8 : 0);
  set('ws-green-edge', 'line-opacity', ge === 'none' ? 0 : ramp(13, 14.5, r.green.intensity * (ge === 'ink' ? 0.55 : 0.8)));

  // Road edges: curbs, ink, gold trim, neon.
  const e = r.edges;
  const neon = e.style === 'neon';
  const ew = (lo: number, hi: number) => ['interpolate', ['linear'], ['zoom'], 14, lo, 18, hi];
  const edgeWidth = neon ? ew(0.6, 2.2) : e.style === 'curb' ? ew(0.5, 2) : ew(0.5, 1.4);
  for (const [id, k] of [['ws-edge-minor', 0.75], ['ws-edge-secondary', 1], ['ws-edge-primary', 1]] as const) {
    set(id, 'line-color', e.color);
    set(id, 'line-width', edgeWidth);
    set(id, 'line-blur', neon ? 1.6 : 0);
    set(id, 'line-opacity', e.style === 'none' ? 0 : ramp(neon ? 15.5 : 14.5, neon ? 17 : 16, e.intensity * k));
  }

  // Lane markings.
  const lanes: Record<string, string> = { fine_lines: 'ws-lanes-fine', strong_graphic: 'ws-lanes-strong', retro_diagram: 'ws-lanes-retro' };
  for (const id of Object.values(lanes)) {
    const on = lanes[r.lanes.style] === id;
    set(id, 'line-color', r.lanes.color);
    set(id, 'line-opacity', on ? ramp(15, 16.5, r.lanes.intensity) : 0);
  }

  // Pools are a fixed pixel spacing, so they would bead together when zoomed out; fade in late.
  set('ws-lamps', 'line-opacity', ramp(15.8, 17.2, r.lamps.intensity));
  return out;
}
