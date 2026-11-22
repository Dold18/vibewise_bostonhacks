import { describe, expect, it } from 'vitest';
import { basePalette } from '../../../mapStyle';
import { appearanceFromScene, cheerOf, duskOf, frontKeyAzimuth, verdancyOf } from '../buildings/appearance';
import type { BuildingPlan, RenderEnv, SceneView } from '../contracts';

type Values = Record<string, [string, number]>;

/** A minimal policy-applied scene: only what the building adapter reads. */
function view(values: Values, extra: { land?: string; azimuth?: number } = {}): SceneView {
  return {
    resolved: Object.fromEntries(Object.entries(values).map(([k, [v]]) => [k, v])),
    strengths: Object.fromEntries(Object.entries(values).map(([k, [, s]]) => [k, s])),
    palette: { ...basePalette, land: extra.land ?? basePalette.land },
    lighting: { color: '#ffffff', intensity: 0.35, position: [1.4, extra.azimuth ?? 295, 40] },
    sky: { skyColor: '#bcd9f7', horizonColor: '#f6c6c4', fogColor: '#ffffff', skyHorizonBlend: 0.6, horizonFogBlend: 0.7, fogGroundBlend: 0.85 },
    context: {},
  } as unknown as SceneView;
}

function section(treatments: Record<string, [string, number]> = {}): BuildingPlan {
  return {
    enabled: true,
    treatments: Object.fromEntries(Object.entries(treatments).map(([k, [style, intensity]]) => [k, { key: `building_surfaces.${k}`, style, intensity, scale: 1, tint: null, assets: [] }])),
    variation: { amount: 0.5, cellMeters: 120 },
  } as unknown as BuildingPlan;
}

const env = { seed: 7, tier: 'high', mode: { navigation: 'browse' }, palette: basePalette } as unknown as RenderEnv;

describe('building key light', () => {
  it('keeps the key light in the viewer half and mirrors back-lights, keeping left/right', () => {
    expect(frontKeyAzimuth(3.3)).toBeCloseTo(176.7, 5);
    expect(frontKeyAzimuth(295)).toBeCloseTo(245, 5);
    expect(frontKeyAzimuth(80)).toBeCloseTo(100, 5);
    for (const az of [90, 180, 210, 270]) expect(frontKeyAzimuth(az)).toBeCloseTo(az, 5);
    for (let az = 0; az < 360; az += 7) {
      const d = frontKeyAzimuth(az);
      expect(d >= 90 && d <= 270).toBe(true);
    }
  });

  it('is viewport-anchored, like MapLibre’s own extrusion light', () => {
    const a = appearanceFromScene(section({ facade_look: ['brick_illustration', 0.8] }), env, view({}, { azimuth: 3.3 }))!;
    expect(a.lighting.sunAnchor).toBe('viewport');
    expect(a.lighting.sunAzimuth).toBeCloseTo(176.7, 3);
  });

  it('lowers and warms the sun and lights windows at dusk over a still-light ground', () => {
    const day = appearanceFromScene(section({ facade_look: ['brick_illustration', 0.8] }), env, view({}))!;
    const dusk = appearanceFromScene(section({ facade_look: ['brick_illustration', 0.8] }), env, view({ 'sky_and_horizon.sky_mode': ['rose_dusk', 0.9] }))!;
    expect(duskOf(view({ 'sky_and_horizon.sky_mode': ['rose_dusk', 0.9] }))).toBeGreaterThan(0.7);
    expect(dusk.lighting.sunAltitude).toBeLessThan(day.lighting.sunAltitude);
    expect(dusk.lighting.glowStrength).toBeGreaterThan(day.lighting.glowStrength);
    expect(dusk.facades[0]!.windows.litFraction).toBeGreaterThan(day.facades[0]!.windows.litFraction);
    expect(dusk.lighting.night).toBeLessThan(0.3); // dusk, not night: the ground is still light
  });
});

describe('architecture from the base theme', () => {
  it('soft plaster walls read as render and painted boards, not concrete', () => {
    const a = appearanceFromScene(section(), env, view({ 'building_surfaces.wall_palette': ['soft_plaster', 0.9] }))!;
    expect(a.facades.map((f) => f.label)).toEqual(['lime render', 'painted clapboard', 'rendered tower']);
  });

  it('lets a strong wall palette lead over a faint requested look, which still contributes a variant', () => {
    const a = appearanceFromScene(section({ facade_look: ['brick_illustration', 0.16] }), env, view({ 'building_surfaces.wall_palette': ['slate', 0.77] }))!;
    const labels = a.facades.map((f) => f.label);
    expect(labels.slice(0, 2)).toEqual(['limestone ashlar', 'granite blocks']);
    expect(labels).toContain('red running bond');
    // slate walls put granite first among the stone family
    const granite = a.facades.find((f) => f.label === 'granite blocks')!;
    const limestone = a.facades.find((f) => f.label === 'limestone ashlar')!;
    expect(granite.weight).toBeGreaterThan(limestone.weight);
  });

  it('keeps a strong requested look ahead of the wall palette', () => {
    const a = appearanceFromScene(section({ facade_look: ['glass_grid', 0.9] }), env, view({ 'building_surfaces.wall_palette': ['brick_amber', 0.5] }))!;
    expect(a.facades[0]!.label).toBe('metal panel low-rise');
  });

  it('plants green roofs only when parks and woods are both verdant, and not at night or dusk', () => {
    const verdant = { 'natural_land.park_palette': ['sage', 0.95], 'natural_land.wood_palette': ['olive', 0.95] } satisfies Values;
    expect(verdancyOf(view(verdant))).toBeGreaterThan(0.7);
    expect(verdancyOf(view({ 'natural_land.park_palette': ['sage', 0.95] }))).toBe(0);
    const roofs = (v: SceneView) => appearanceFromScene(section({ facade_look: ['stone_blocks', 0.8] }), env, v)!.roofs.map((r) => r.label);
    expect(roofs(view(verdant))).toContain('green roofs');
    expect(roofs(view({ ...verdant, 'sky_and_horizon.sky_mode': ['purple_twilight', 0.9] }))).not.toContain('green roofs');
    expect(roofs(view(verdant, { land: '#1d2230' }))).not.toContain('green roofs');
  });

  it('paints part of the street under bright grades, keeping the paint colour', () => {
    const plain = appearanceFromScene(section(), env, view({ 'building_surfaces.wall_palette': ['soft_plaster', 0.9] }))!;
    const sunny = appearanceFromScene(section(), env, view({ 'building_surfaces.wall_palette': ['soft_plaster', 0.9], 'global_grade.palette_family': ['sunwashed', 0.8] }))!;
    expect(cheerOf(view({ 'global_grade.palette_family': ['sunwashed', 0.8] }))).toBeCloseTo(0.8, 5);
    expect(plain.facades.some((f) => f.label?.includes('painted render'))).toBe(false);
    const painted = sunny.facades.filter((f) => /mustard|coral|sea-glass/.test(f.label ?? ''));
    expect(painted).toHaveLength(3);
    for (const f of painted) expect(f.wall.tintStrength).toBeGreaterThan(0.8);
    expect(sunny.facades.length).toBeLessThanOrEqual(8);
    expect(sunny.facades[sunny.facades.length - 1]!.heightRange).toEqual([45, 1000]); // tower last
  });
});
