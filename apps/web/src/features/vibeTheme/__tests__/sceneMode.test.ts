/** vibeTheme scene mode: buildMapStyle scene parameters, applyStyle, transitions and setScene. */
import { describe, expect, it } from 'vitest';
import { basePalette, BUILDING_3D_BANDS, buildingColorAt, buildMapStyle, DEFAULT_SCENE_STYLE, lightShadowAngle, mapStyle, type SceneStyle } from '../../../mapStyle';
import type { AccountState, AccountStore } from '../../account/session';
import { applyStyle, COLOR_PAINT, setColorTransition } from '../apply';
import { sceneStyleOf, startThemeController, type SceneRender } from '../controller';
import { fakeEffects, fakeMap } from './fakeMap';

const SCENE: SceneStyle = {
  lightIntensity: 0.2,
  lightPosition: [1.4, 200, 60],
  fogColor: '#7f8ea3',
  skyHorizonBlend: 0.3,
  horizonFogBlend: 0.45,
  fogGroundBlend: 0.75,
  transitionMs: 800,
};

const night = { ...basePalette, land: '#14172b', building3d: '#494f64', sky: '#101438', textPrimary: '#f1f3f4' };

function render(palette = night, extra: Partial<SceneRender> = {}): SceneRender {
  return {
    hash: JSON.stringify([palette, extra]),
    palette,
    darkMode: false,
    lighting: { color: palette.light, intensity: 0.2, position: [1.4, 200, 60] },
    sky: { fogColor: '#7f8ea3', skyHorizonBlend: 0.3, horizonFogBlend: 0.45, fogGroundBlend: 0.75 },
    motion: { transitionMs: 800 },
    ...extra,
  };
}

function store(initial: AccountState = { status: 'signed_out' }) {
  let state = initial;
  const subs = new Set<(s: AccountState) => void>();
  return {
    getState: () => state,
    subscribe: (fn: (s: AccountState) => void) => (subs.add(fn), () => void subs.delete(fn)),
    set(next: AccountState) {
      state = next;
      for (const fn of subs) fn(state);
    },
  } as unknown as AccountStore & { set(s: AccountState): void };
}

describe('buildMapStyle scene parameters', () => {
  it('defaults to today’s style exactly', () => {
    expect(buildMapStyle(basePalette)).toEqual(mapStyle);
    expect(buildMapStyle(basePalette, DEFAULT_SCENE_STYLE)).toEqual(mapStyle);
  });

  it('carries light, sky/fog and transition into the style', () => {
    const s = buildMapStyle(basePalette, SCENE);
    expect(s.light).toMatchObject({ intensity: 0.2, position: [1.4, 200, 60] });
    expect(s.sky).toMatchObject({ 'fog-color': '#7f8ea3', 'sky-horizon-blend': 0.3, 'horizon-fog-blend': 0.45, 'fog-ground-blend': 0.75 });
    expect(buildMapStyle(basePalette, { ...SCENE, transitionMs: 150 }).transition).toEqual({ duration: 150, delay: 0 });
  });

  it('puts pin shadows opposite the light', () => {
    expect(lightShadowAngle(295)).toBe(115);
    expect(lightShadowAngle(115)).toBe(295);
    expect(lightShadowAngle(200)).toBe(20);
  });
});

describe('applyStyle and color transitions', () => {
  it('is a no-op between identical inputs', () => {
    const f = fakeMap();
    applyStyle(f.map, { palette: basePalette }, { palette: basePalette, scene: { ...DEFAULT_SCENE_STYLE } });
    expect(f.counts).toMatchObject({ setPaintProperty: 0, setLight: 0, setSky: 0 });
  });

  it('applies light and sky changes without touching paint when only the scene parameters change', () => {
    const f = fakeMap();
    applyStyle(f.map, { palette: basePalette }, { palette: basePalette, scene: SCENE });
    expect(f.counts).toMatchObject({ setPaintProperty: 0, setLight: 1, setSky: 1 });
    f.expectStyle(basePalette, SCENE);
  });

  it('sets a transition on every color paint property, and nothing else', () => {
    const f = fakeMap();
    setColorTransition(f.map, 150);
    expect(f.counts.setPaintProperty).toBe(COLOR_PAINT.length);
    expect(f.paint.get('background')!['background-color-transition']).toEqual({ duration: 150, delay: 0 });
    expect(COLOR_PAINT.every(([, p]) => p.endsWith('-color'))).toBe(true);
    expect(f.unexpected).toEqual([]);
  });
});

describe('ThemeController.setScene', () => {
  it('applies the scene in place: only paint/light/sky, never setStyle, camera, layers or handlers', () => {
    const f = fakeMap();
    const effects = fakeEffects();
    const theme = startThemeController(f.map, store(), { effects });
    const r = render();
    theme.setScene(r);
    f.expectStyle(night, sceneStyleOf(r));
    expect(f.unexpected).toEqual([]);
    expect(f.counts.off).toEqual([]);
    expect(effects.renders.at(-1)).toEqual({ layers: [], darkMode: false });
    expect(f.cssVars['--pin-shadow-angle']).toBe('20deg');
  });

  it('skips a re-delivered identical scene', () => {
    const f = fakeMap();
    const theme = startThemeController(f.map, store(), { effects: fakeEffects() });
    const r = render();
    theme.setScene(r);
    const before = { ...f.counts };
    theme.setScene({ ...r });
    expect(f.counts).toEqual(before);
  });

  it('uses the session’s transition timing, and sets it only when it changes', () => {
    const f = fakeMap();
    const theme = startThemeController(f.map, store(), { effects: fakeEffects() });
    theme.setScene(render(), { transitionMs: 150 });
    expect(f.paint.get('water')!['fill-color-transition']).toEqual({ duration: 150, delay: 0 });
    const calls = f.counts.setPaintProperty;
    theme.setScene(render({ ...night, water: '#182748' }), { transitionMs: 150 });
    expect(f.counts.setPaintProperty - calls).toBeLessThan(5); // just the changed colors
  });

  it('waits for the style to load, then applies the latest scene', () => {
    const f = fakeMap({ loaded: false });
    const theme = startThemeController(f.map, store(), { effects: fakeEffects() });
    theme.setScene(render(basePalette));
    theme.setScene(render());
    expect(f.counts.setPaintProperty).toBe(0);
    f.load();
    f.expectStyle(night, sceneStyleOf(render()));
  });

  it('null hands the look back to account mode; destroy restores the plain map', () => {
    const f = fakeMap();
    const effects = fakeEffects();
    const theme = startThemeController(f.map, store(), { effects });
    theme.setScene(render(), { transitionMs: 150 });
    theme.setScene(null);
    f.expectStyle(basePalette);
    expect(f.paint.get('water')!['fill-color-transition']).toEqual({ duration: 800, delay: 0 });
    expect(f.cssVars['--pin-shadow-angle']).toBe('115deg');
    theme.setScene(render());
    theme.destroy();
    f.expectStyle(basePalette);
    expect(effects.destroyed).toBe(true);
  });

  it('account mode is unchanged while no scene is set, and ignored while one is', () => {
    const f = fakeMap();
    const s = store();
    const theme = startThemeController(f.map, s, { effects: fakeEffects() });
    theme.preview({ late_night: 1 }, 1);
    const themed = f.paint.get('background')!['background-color'];
    expect(themed).not.toBe(basePalette.land);
    theme.setScene(render());
    theme.preview({ cozy: 1 }, 1);
    expect(f.paint.get('background')!['background-color']).toBe(night.land);
  });
});

describe('transition fixes from browser QA', () => {
  it('no color paint is data-driven: MapLibre would snap it and re-lay-out tiles on every change', async () => {
    const { DATA_DRIVEN_PAINT } = await import('../apply');
    expect(DATA_DRIVEN_PAINT).toEqual([]);
  });

  it('3D building bands cover every height exactly once, all with constant colors', () => {
    expect(BUILDING_3D_BANDS[0]).toMatchObject({ id: 'building-3d', min: 0 });
    expect(BUILDING_3D_BANDS.at(-1)!.max).toBe(Infinity);
    BUILDING_3D_BANDS.forEach((b, i) => {
      if (i > 0) expect(b.min).toBe(BUILDING_3D_BANDS[i - 1].max);
      expect(b.sampleHeight).toBeGreaterThanOrEqual(b.min);
    });
    const style = buildMapStyle(night);
    for (const b of BUILDING_3D_BANDS) {
      const layer = style.layers.find((l) => l.id === b.id) as { paint: Record<string, unknown> };
      expect(typeof layer.paint['fill-extrusion-color']).toBe('string');
      expect(layer.paint['fill-extrusion-color']).toBe(buildingColorAt(night, b.sampleHeight));
    }
  });

  it('band colors follow the former height gradient (0 → building3d, 60 → mid, 200 → high)', () => {
    expect(buildingColorAt(night, 0)).toBe(night.building3d);
    expect(buildingColorAt(night, 60)).toBe(night.building3dMid);
    expect(buildingColorAt(night, 250)).toBe(night.building3dHigh);
  });

  it('building colors change as plain paint values, so they ease natively with everything else', () => {
    const f = fakeMap();
    const theme = startThemeController(f.map, store(), { effects: fakeEffects() });
    theme.setScene(render(), { transitionMs: 450 });
    for (const b of BUILDING_3D_BANDS) expect(f.paint.get(b.id)!['fill-extrusion-color']).toBe(buildingColorAt(night, b.sampleHeight));
    for (const b of BUILDING_3D_BANDS) expect(f.paint.get(b.id)!['fill-extrusion-color-transition']).toEqual({ duration: 450, delay: 0 });
  });

  it('light and sky ease on the scene clock, not the style-wide 800 ms', () => {
    const f = fakeMap();
    const theme = startThemeController(f.map, store(), { effects: fakeEffects() });
    theme.setScene(render(), { transitionMs: 150 });
    expect(f.light()).toMatchObject({ 'intensity-transition': { duration: 150, delay: 0 }, 'position-transition': { duration: 150, delay: 0 } });
    expect(f.sky()).toMatchObject({ 'sky-color-transition': { duration: 150, delay: 0 }, 'fog-color-transition': { duration: 150, delay: 0 } });
  });
});
