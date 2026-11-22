/**
 * Move the live map from one palette to another by setting only the paint
 * values that differ. `map.setStyle` would rebuild the style and drop
 * everything added at runtime (the route overlay, catalog layers), so it is
 * never used here. The pitch-driven 3D building opacity is not a palette
 * value and is never touched.
 */
import type { LightSpecification, SkySpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { basePalette, buildMapStyle, DEFAULT_SCENE_STYLE, type Palette, type SceneStyle } from '../../mapStyle';

export interface PaintChange {
  layerId: string;
  property: string;
  value: unknown;
}

/** The slice of MapLibre's Map this module needs (easy to fake in tests). */
export interface PaintTarget {
  setPaintProperty(id: string, prop: string, value: unknown): void;
  setSky(sky: SkySpecification): void;
  setLight(light: LightSpecification): void;
  getLayer(id: string): unknown;
}

const NEVER_SET = new Set(['fill-extrusion-opacity']);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Paint values in `to` that differ from `from`, matched by layer id. */
export function diffPaint(from: StyleSpecification, to: StyleSpecification): PaintChange[] {
  const before = new Map(from.layers.map((l) => [l.id, (('paint' in l && l.paint) || {}) as Record<string, unknown>]));
  const changes: PaintChange[] = [];
  for (const layer of to.layers) {
    const paint = (('paint' in layer && layer.paint) || {}) as Record<string, unknown>;
    const old = before.get(layer.id) ?? {};
    for (const [property, value] of Object.entries(paint)) {
      if (!same(old[property], value)) changes.push({ layerId: layer.id, property, value });
    }
  }
  return changes;
}

export function applyPalette(map: PaintTarget, from: Palette, to: Palette): void {
  applyStyle(map, { palette: from }, { palette: to });
}

/** What the live style is built from: colors plus optional scene light/sky parameters. */
export interface StyleInputs {
  palette: Palette;
  scene?: Readonly<SceneStyle>;
}

export interface ApplyOptions {
  /**
   * Light and sky ease over this many ms (per-property `*-transition` keys).
   * Without it they use the style-wide transition fixed at map creation, which
   * would leave them out of step with scene colors (e.g. under reduced motion).
   */
  transitionMs?: number;
}

/**
 * Move the live map between two sets of style inputs: only changed paint
 * values, then sky and light if they differ. Never `setStyle`.
 */
export function applyStyle(map: PaintTarget, from: StyleInputs, to: StyleInputs, options: ApplyOptions = {}): void {
  const a = buildMapStyle(from.palette, from.scene ?? DEFAULT_SCENE_STYLE);
  const b = buildMapStyle(to.palette, to.scene ?? DEFAULT_SCENE_STYLE);
  for (const { layerId, property, value } of diffPaint(a, b)) {
    if (NEVER_SET.has(property) || !map.getLayer(layerId)) continue;
    map.setPaintProperty(layerId, property, value);
  }
  const t = options.transitionMs;
  if (b.sky && !same(a.sky, b.sky)) map.setSky(t === undefined ? b.sky : withTransitions(b.sky, t));
  if (b.light && !same(a.light, b.light)) map.setLight(t === undefined ? b.light : withTransitions(b.light, t));
}

/** Add a `<key>-transition` for every animatable key of a light or sky spec. */
function withTransitions<T extends object>(spec: T, durationMs: number): T {
  const transition = { duration: Math.max(0, Math.round(durationMs)), delay: 0 };
  const out: Record<string, unknown> = { ...(spec as Record<string, unknown>) };
  for (const key of Object.keys(spec)) if (key !== 'anchor') out[`${key}-transition`] = transition;
  return out as T;
}

/**
 * Color paint that depends on feature data. MapLibre applies such changes
 * instantly (no transition) and re-lays-out the source's tiles in its workers,
 * so theme colors must never be data-driven; a test keeps this list empty.
 * (3D buildings use constant-color height bands for this reason; mapStyle.ts.)
 */
export const DATA_DRIVEN_PAINT: readonly (readonly [string, string])[] = buildMapStyle(basePalette).layers.flatMap((l) =>
  Object.entries(('paint' in l && l.paint) || {})
    .filter(([p, v]) => /-color$/.test(p) && /\["(get|has|feature-state|properties|id|geometry-type)"/.test(JSON.stringify(v)))
    .map(([p]) => [l.id, p] as const),
);

/** Every color paint property of the base style, as [layerId, property]. */
export const COLOR_PAINT: readonly (readonly [string, string])[] = buildMapStyle(basePalette).layers.flatMap((l) =>
  Object.keys(('paint' in l && l.paint) || {})
    .filter((p) => p.endsWith('-color'))
    .map((p) => [l.id, p] as const),
);

/**
 * Set how long color changes take, per paint property (`<prop>-transition`,
 * part of the public style API), so a scene can fade faster under reduced
 * motion or slower for a cinematic change without rebuilding the style.
 */
export function setColorTransition(map: PaintTarget, durationMs: number): void {
  const transition = { duration: Math.max(0, Math.round(durationMs)), delay: 0 };
  for (const [layerId, property] of COLOR_PAINT) {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, `${property}-transition`, transition);
  }
}
