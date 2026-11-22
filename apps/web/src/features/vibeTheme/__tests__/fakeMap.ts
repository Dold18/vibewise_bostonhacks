/**
 * A strict fake MapLibre map for theme/scene tests. It keeps live paint, light
 * and sky state seeded from the real base style plus the runtime MBTA route
 * layers, and records every method called on it. Anything outside the paint
 * API (camera moves, setStyle, layer/source removal, handler changes, marker
 * work) lands in `unexpected`, so tests can prove scene updates never do it.
 */
import { expect } from 'vitest';
import type { LightSpecification, SkySpecification } from '@maplibre/maplibre-gl-style-spec';
import { buildMapStyle, neutralPalette, DEFAULT_SCENE_STYLE, type Palette, type SceneStyle } from '../../../mapStyle';
import type { EffectLayer } from '../effects';
import type { ThemeMap } from '../controller';

/** The route overlay's runtime layers (transitRoute.ts), with their real paint. */
export const ROUTE_LAYERS: Record<string, Record<string, unknown>> = {
  'transit-route-casing': { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
  'transit-route-ride': { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.9 },
  'transit-route-walk': { 'line-color': '#374151', 'line-width': 4, 'line-dasharray': [1, 1.5] },
};

const ALLOWED = new Set(['isStyleLoaded', 'once', 'off', 'getCanvasContainer', 'getContainer', 'getLayer', 'setPaintProperty', 'setLight', 'setSky']);

export function fakeMap({ loaded = true } = {}) {
  // The live map's default style: the neutral city (Carbon).
  const style = buildMapStyle(neutralPalette);
  const paint = new Map<string, Record<string, unknown>>();
  for (const l of style.layers) paint.set(l.id, JSON.parse(JSON.stringify(('paint' in l && l.paint) || {})));
  for (const [id, p] of Object.entries(ROUTE_LAYERS)) paint.set(id, JSON.parse(JSON.stringify(p)));
  let light = style.light as LightSpecification;
  let sky = style.sky as SkySpecification;
  let isLoaded = loaded;
  let onLoad: (() => void) | null = null;
  const cssVars: Record<string, string> = {};
  const counts = { setPaintProperty: 0, setLight: 0, setSky: 0, off: [] as string[] };
  const unexpected: string[] = [];

  const impl: Record<string, (...args: never[]) => unknown> = {
    isStyleLoaded: () => isLoaded,
    once: ((_: string, fn: () => void) => void (onLoad = fn)) as never,
    off: ((event: string) => void counts.off.push(event)) as never,
    getCanvasContainer: () => {
      throw new Error('fakeMap: inject effects instead of mounting the DOM layer');
    },
    getContainer: () => ({ style: { setProperty: (k: string, v: string) => void (cssVars[k] = v) } }),
    getLayer: ((id: string) => (paint.has(id) ? { id } : undefined)) as never,
    setPaintProperty: ((id: string, prop: string, value: unknown) => {
      counts.setPaintProperty++;
      paint.get(id)![prop] = value;
    }) as never,
    setLight: ((l: LightSpecification) => {
      counts.setLight++;
      light = l;
    }) as never,
    setSky: ((s: SkySpecification) => {
      counts.setSky++;
      sky = s;
    }) as never,
  };

  const map = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      if (ALLOWED.has(prop)) return impl[prop];
      if (prop === 'then') return undefined; // not a thenable
      return (..._args: unknown[]) => void unexpected.push(prop);
    },
  }) as unknown as ThemeMap & Record<string, (...args: unknown[]) => unknown>;

  return {
    map,
    paint,
    counts,
    unexpected,
    cssVars,
    light: () => light,
    sky: () => sky,
    load() {
      isLoaded = true;
      onLoad?.();
    },
    /** Every base-style paint value, light and sky equal the style built from these inputs; route layers untouched. */
    expectStyle(palette: Palette, scene: Readonly<SceneStyle> = DEFAULT_SCENE_STYLE) {
      const want = buildMapStyle(palette, scene);
      for (const l of want.layers) {
        const got = paint.get(l.id)!;
        for (const [prop, value] of Object.entries(('paint' in l && l.paint) || {})) {
          if (prop === 'fill-extrusion-opacity') continue; // pitch-driven, never a theme value
          expect(got[prop], `${l.id} ${prop}`).toEqual(value);
        }
      }
      expect(withoutTransitions(light)).toEqual(want.light);
      expect(withoutTransitions(sky)).toEqual(want.sky);
      for (const [id, p] of Object.entries(ROUTE_LAYERS)) expect(paint.get(id), id).toEqual(p);
    },
  };
}

/** Light/sky as set, minus the `*-transition` timing keys (checked separately). */
export const withoutTransitions = (spec: object) =>
  Object.fromEntries(Object.entries(spec).filter(([k]) => !k.endsWith('-transition')));

export function fakeEffects() {
  const renders: Array<{ layers: EffectLayer[]; darkMode: boolean }> = [];
  return {
    renders,
    destroyed: false,
    render(layers: EffectLayer[], darkMode: boolean) {
      renders.push({ layers, darkMode });
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

/** Records what the theme controller hands the atmosphere renderer (features/atmosphere). */
export function fakeAtmosphere() {
  const scenes: Array<{ scene: unknown; transitionMs?: number }> = [];
  const navigation: string[] = [];
  return {
    scenes,
    navigation,
    destroyed: false,
    setNavigation(mode: string) {
      navigation.push(mode);
    },
    setScene(scene: unknown, timing?: { transitionMs?: number }) {
      scenes.push({ scene, transitionMs: timing?.transitionMs });
    },
    destroy() {
      this.destroyed = true;
    },
  };
}
