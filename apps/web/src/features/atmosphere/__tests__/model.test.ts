import { describe, expect, it } from 'vitest';
import { compileScene } from '../../scene/compile';
import { MAP_RENDERER_V1, MAP_RENDERER_V2 } from '../../scene/capabilities';
import { SCENE_CATALOG } from '../../scene/catalog';
import { PRESET_IDS, type ScenePresetId } from '../../scene/presets';
import { intent, readJson } from '../../scene/__tests__/fixtures';
import { TEXTURE_ASSETS } from '../assets';
import {
  CEILINGS, composeAtmosphere, LOAD_WEIGHTS, NAV_VIGNETTE_MAX, PASS_ORDER, QUALITY, SLOW_FPS, VISUAL_LOAD_CAP, withParams, type ComposeContext,
} from '../compose';
import { ATMOSPHERE_VALUES, paramsFromScene, presence, sceneDarkness } from '../fromScene';
import {
  AMOUNT_KEYS, COLOR_KEYS, isEmpty, lerpParams, NEUTRAL_PARAMS, sanitizeParams, SCALAR_KEYS, type AtmosphereParams,
} from '../params';
import { createGovernor, detectQuality } from '../quality';
import { createTween, ease } from '../tween';

const ctx = (over: Partial<ComposeContext> = {}): ComposeContext => ({ navigation: 'browse', reducedMotion: false, quality: 'high', darkness: 0, ...over });
const scene = (presets: Array<[ScenePresetId, number]>, extra: Parameters<typeof intent>[1] = {}, context = {}) =>
  compileScene({ outing: intent(presets, extra), capabilities: MAP_RENDERER_V2, context: { performance: 'high', ...context } });
const params = (over: Partial<Record<string, number>>) => sanitizeParams(over);

describe('capability profile V2', () => {
  it('declares only real, non-default catalog values and keeps everything V1 renders', () => {
    for (const [key, values] of Object.entries(ATMOSPHERE_VALUES)) {
      const setting = SCENE_CATALOG.byKey.get(key);
      expect(setting, key).toBeDefined();
      for (const v of values) {
        expect(setting!.values, `${key}=${v}`).toContain(v);
        expect(v, `${key} default is the baseline, never a renderer value`).not.toBe(setting!.default);
      }
    }
    for (const [key, values] of MAP_RENDERER_V1.values) for (const v of values) expect(MAP_RENDERER_V2.values.get(key)?.has(v), `${key}=${v}`).toBe(true);
  });

  it('V1 clips every atmosphere value; V2 lets the presets’ atmosphere through', () => {
    const v1 = compileScene({ outing: intent([['noir_nocturne', 1]]), capabilities: MAP_RENDERER_V1 });
    expect(v1.overlays).toEqual([]);
    const v2 = scene([['noir_nocturne', 1]]);
    expect(v2.overlays.map((o) => o.key)).toEqual(
      expect.arrayContaining(['air_and_atmosphere.fog_volume', 'air_and_atmosphere.vignette', 'air_and_atmosphere.grain', 'cinematic_and_artistic.render_aesthetic']),
    );
    // Values the renderer does not draw stay honestly disabled.
    const glare = scene([], { overrides: [{ key: 'air_and_atmosphere.lens_glare', value: 'starburst', intensity: 0.8 }] });
    expect(glare.disabled.map((d) => d.key)).toContain('air_and_atmosphere.lens_glare');
  });
});

describe('params', () => {
  it('sanitizes: clamps, drops unknown keys, accepts hex or RGB colors', () => {
    const p = sanitizeParams({ fogDensity: 3, wind: -4, grain: Number.NaN, bogus: 1, fogColor: '#ff0000', glowColor: [2, 0.5, -1] });
    expect(p.fogDensity).toBe(1);
    expect(p.wind).toBe(-1);
    expect(p.grain).toBe(NEUTRAL_PARAMS.grain);
    expect(p).not.toHaveProperty('bogus');
    expect(p.fogColor).toEqual([1, 0, 0]);
    expect(p.glowColor).toEqual([1, 0.5, 0]);
  });

  it('neutral is empty and lerp hits both ends exactly', () => {
    expect(isEmpty(NEUTRAL_PARAMS)).toBe(true);
    const b = params({ fogDensity: 0.8, rain: 0.4 });
    expect(lerpParams(NEUTRAL_PARAMS, b, 0)).toBe(NEUTRAL_PARAMS);
    expect(lerpParams(NEUTRAL_PARAMS, b, 1)).toBe(b);
    expect(lerpParams(NEUTRAL_PARAMS, b, 0.5).fogDensity).toBeCloseTo(0.4);
  });
});

describe('paramsFromScene', () => {
  it('a neutral scene is no atmosphere at all', () => {
    expect(isEmpty(paramsFromScene(compileScene({ capabilities: MAP_RENDERER_V2 })))).toBe(true);
    expect(paramsFromScene(null)).toBe(NEUTRAL_PARAMS);
  });

  it('every preset produces a distinct atmosphere within 0..1', () => {
    const seen = new Set<string>();
    for (const id of PRESET_IDS.filter((p) => p !== 'neutral')) {
      const p = paramsFromScene(scene([[id, 1]]));
      for (const k of SCALAR_KEYS) expect(p[k], `${id}.${k}`).toBeGreaterThanOrEqual(k === 'wind' ? -1 : 0), expect(p[k]).toBeLessThanOrEqual(1);
      const sig = AMOUNT_KEYS.map((k) => p[k].toFixed(2)).join();
      expect(seen.has(sig), `${id} duplicates another preset`).toBe(false);
      seen.add(sig);
    }
  });

  it('scales with presence, so a faint early answer is a faint atmosphere', () => {
    const faint = paramsFromScene(scene([['noir_nocturne', 0.2]]));
    const full = paramsFromScene(scene([['noir_nocturne', 1]]));
    expect(faint.vignette).toBeGreaterThan(0);
    expect(faint.vignette).toBeLessThan(full.vignette);
    expect(presence(0.3)).toBeCloseTo(0.5);
  });

  it('composes freely from overrides: fog + grain + warm light + rain in chosen proportions, no preset', () => {
    const s = scene([], {
      overrides: [
        { key: 'air_and_atmosphere.fog_volume', value: 'medium', intensity: 0.6 },
        { key: 'air_and_atmosphere.grain', value: 'fine_film', intensity: 0.5 },
        { key: 'lighting_and_shadows.light_color', value: 'amber', intensity: 0.7 },
        { key: 'air_and_atmosphere.rain', value: 'light', intensity: 0.4 },
      ],
    });
    const p = paramsFromScene(s);
    expect(p.fogDensity).toBeGreaterThan(0.5);
    expect(p.grain).toBeGreaterThan(0.2);
    expect(p.rain).toBeGreaterThan(0.2);
    // The amber light reaches the glow/shaft colors through the scene light, not a theme.
    expect(p.shaftColor[0]).toBeGreaterThan(p.shaftColor[2]);
  });

  it('stacked sources approach but never exceed 1 (soft maximum)', () => {
    const s = scene([], {
      overrides: [
        { key: 'cinematic_and_artistic.paper_texture', value: 'aged_parchment', intensity: 1 },
        { key: 'cinematic_and_artistic.render_aesthetic', value: 'paper_diorama', intensity: 1 },
        { key: 'air_and_atmosphere.grain', value: 'paper_grain', intensity: 1 },
      ],
    });
    const p = paramsFromScene(s);
    expect(p.paper).toBeGreaterThan(0.65);
    expect(p.paper).toBeLessThan(1);
  });

  it('fog starts from the sky fog color (so it meets the horizon), lifted toward the light; fog_hue tints it', () => {
    const s = scene([], { overrides: [{ key: 'air_and_atmosphere.fog_volume', value: 'light', intensity: 1 }] });
    const sky = sanitizeParams({ fogColor: s.sky.fogColor }).fogColor;
    paramsFromScene(s).fogColor.forEach((c, i) => expect(Math.abs(c - sky[i])).toBeLessThan(0.08));
    const rose = paramsFromScene(scene([], { overrides: [
      { key: 'air_and_atmosphere.fog_volume', value: 'light', intensity: 1 },
      { key: 'air_and_atmosphere.fog_hue', value: 'rose', intensity: 1 },
    ] }));
    expect(rose.fogColor[0]).toBeGreaterThan(rose.fogColor[2]);
  });

  it('darkness reads night scenes as dark and the plain map as daylight', () => {
    expect(sceneDarkness(compileScene({ capabilities: MAP_RENDERER_V2 }))).toBe(0);
    expect(sceneDarkness(scene([['noir_nocturne', 1]]))).toBeGreaterThan(0.6);
  });
});

describe('composeAtmosphere', () => {
  const busy = params({ fogDensity: 0.8, rain: 0.7, grain: 0.6, paper: 0.6, halftone: 0.6, vignette: 0.8, glow: 0.7, shafts: 0.6, dust: 0.5, hazeHorizon: 0.6 });

  it('navigation removes everything but a soft vignette and stops motion', () => {
    for (const navigation of ['route', 'focus'] as const) {
      const plan = composeAtmosphere(busy, ctx({ navigation }));
      for (const k of AMOUNT_KEYS) if (k !== 'vignette') expect(plan.params[k], k).toBe(0);
      expect(plan.params.vignette).toBeLessThanOrEqual(NAV_VIGNETTE_MAX);
      expect(plan.world.active).toBe(false);
      expect(plan.fps).toBe(0);
    }
  });

  it('reduced motion: no animation, particles held still and thinned', () => {
    const plan = composeAtmosphere(busy, ctx({ reducedMotion: true }));
    expect(plan.params.motion).toBe(0);
    expect(plan.fps).toBe(0);
    expect(plan.params.rain).toBeLessThan(composeAtmosphere(busy, ctx()).params.rain);
  });

  it('resolves contradictions instead of stacking them', () => {
    const both = composeAtmosphere(params({ rain: 0.8, snow: 0.4, fireflies: 0.6, petals: 0.5 }), ctx({ darkness: 1 })).params;
    expect(both.snow).toBeLessThan(0.05);
    expect(both.fireflies).toBeLessThan(0.15);
    const snowy = composeAtmosphere(params({ snow: 0.8, petals: 0.6 }), ctx()).params;
    expect(snowy.petals).toBeLessThan(0.15);
    const printed = composeAtmosphere(params({ paper: 0.7, glow: 0.6 }), ctx()).params;
    expect(printed.glow).toBeLessThan(0.6 * 0.6);
    const night = composeAtmosphere(params({ dust: 0.6, fireflies: 0.6 }), ctx({ darkness: 1 })).params;
    const day = composeAtmosphere(params({ dust: 0.6, fireflies: 0.6 }), ctx({ darkness: 0 })).params;
    expect(night.fireflies).toBeGreaterThan(day.fireflies);
    expect(night.dust).toBeLessThan(day.dust);
  });

  it('caps total visual load and per-effect ceilings for any combination (fuzz)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
      const input: Record<string, number> = {};
      for (const k of SCALAR_KEYS) input[k] = k === 'wind' ? rnd() * 2 - 1 : rnd();
      const plan = composeAtmosphere(params(input), ctx({ darkness: rnd(), quality: (['low', 'medium', 'high'] as const)[i % 3] }));
      let load = 0;
      for (const [k, w] of Object.entries(LOAD_WEIGHTS)) load += plan.params[k as keyof AtmosphereParams as never] * (w as number);
      expect(load).toBeLessThanOrEqual(VISUAL_LOAD_CAP + 1e-6);
      for (const [k, cap] of Object.entries(CEILINGS)) expect(plan.params[k as never] as number, k).toBeLessThanOrEqual((cap as number) + 1e-9);
      expect(plan.centerFogMax).toBeLessThan(0.5);
    }
  });

  it('is deterministic and reports every adjustment', () => {
    const a = composeAtmosphere(busy, ctx());
    expect(composeAtmosphere(busy, ctx())).toEqual(a);
    expect(a.notes.join('\n')).toMatch(/visual load|ceiling|precipitation|print/);
  });

  it('quality changes cost, not the look: slices, counts, bloom and fps follow the tier', () => {
    const low = composeAtmosphere(busy, ctx({ quality: 'low' }));
    const high = composeAtmosphere(busy, ctx({ quality: 'high' }));
    expect(low.params).toEqual(high.params);
    expect(low.world.fogSlices).toBeLessThan(high.world.fogSlices);
    expect(low.world.maxRain).toBeLessThan(high.world.maxRain);
    expect(low.grade.bloom).toBe(false);
    expect(high.grade.bloom).toBe(true);
    expect(low.fps).toBeLessThan(high.fps);
    expect(60 % high.fps).toBe(0);
    expect(60 % low.fps).toBe(0);
  });

  it('slow drifts (fog banks, shafts, leaks) repaint only when the scene asks for ambient motion', () => {
    expect(composeAtmosphere(params({ fogDensity: 0.6, shafts: 0.5, leak: 0.4 }), ctx()).fps).toBe(0);
    expect(composeAtmosphere(params({ fogDensity: 0.6, drift: 0.8 }), ctx()).fps).toBe(SLOW_FPS);
    expect(composeAtmosphere(params({ fogDensity: 0.6, drift: 0.8 }), ctx({ reducedMotion: true })).fps).toBe(0);
    expect(composeAtmosphere(params({ fogDensity: 0.6, drift: 0.8, rain: 0.3 }), ctx()).fps).toBe(QUALITY.high.fps);
    expect(paramsFromScene(scene([], { overrides: [{ key: 'animation_and_morph.ambient_pace', value: 'lively', intensity: 1 }] })).drift).toBe(1);
  });

  it('static atmospheres need no animation loop', () => {
    const plan = composeAtmosphere(params({ vignette: 0.5, paper: 0.4, grain: 0.3 }), ctx());
    expect(plan.fps).toBe(0);
    expect(plan.world.active).toBe(false);
    expect(plan.grade.active).toBe(true);
  });

  it('withParams follows tweened values without re-applying rules', () => {
    const target = composeAtmosphere(params({ rain: 0.6 }), ctx());
    const mid = withParams(target, lerpParams(NEUTRAL_PARAMS, target.params, 0.5), 'high');
    expect(mid.params.rain).toBeCloseTo(target.params.rain / 2);
    expect(mid.world.active).toBe(true);
    expect(withParams(target, NEUTRAL_PARAMS, 'high').world.active).toBe(false);
  });

  it('documents every pass with its space, blend and keys', () => {
    expect(PASS_ORDER.map((p) => p.id)).toEqual(['height-fog', 'precipitation', 'particles', 'haze', 'print', 'light']);
    for (const p of PASS_ORDER) expect(p.technique.length).toBeGreaterThan(40);
    const covered = new Set(PASS_ORDER.flatMap((p) => p.keys));
    for (const k of AMOUNT_KEYS) expect(covered.has(k), k).toBe(true);
    expect(Object.keys(QUALITY)).toEqual(['low', 'medium', 'high']);
  });
});

describe('tween', () => {
  const a = NEUTRAL_PARAMS;
  const b = params({ fogDensity: 1, grain: 0.5, fogColor: [0, 0, 0] as unknown as number });

  it('eases from what is on screen and lands exactly', () => {
    const t = createTween(a);
    t.retarget(b, 1000, 0);
    expect(t.sample(0).params.fogDensity).toBe(0);
    expect(t.sample(500).params.fogDensity).toBeCloseTo(0.5);
    expect(t.sample(1000)).toEqual({ params: b, done: true });
    expect(ease(0.25)).toBeLessThan(0.25);
  });

  it('retargeting mid-flight never jumps', () => {
    const t = createTween(a);
    t.retarget(b, 1000, 0);
    const before = t.sample(400).params.fogDensity;
    t.retarget(a, 1000, 400);
    expect(t.sample(400).params.fogDensity).toBeCloseTo(before, 6);
    expect(t.sample(1400).params.fogDensity).toBe(0);
  });

  it('a zero-length transition is immediate', () => {
    const t = createTween(a);
    t.retarget(b, 0, 10);
    expect(t.sample(10)).toEqual({ params: b, done: true });
  });
});

describe('quality', () => {
  it('detects tiers from the device', () => {
    expect(detectQuality({ hardwareConcurrency: 10, deviceMemory: 16, devicePixelRatio: 2, viewportArea: 1440 * 900 }).quality).toBe('high');
    expect(detectQuality({ hardwareConcurrency: 4, deviceMemory: 4, devicePixelRatio: 3, mobile: true, viewportArea: 390 * 844 }).quality).toBe('low');
    expect(detectQuality({ hardwareConcurrency: 8, deviceMemory: 8, saveData: true }).quality).toBe('low');
    expect(detectQuality({}).quality).toBe('medium');
  });

  it('the governor steps down only on sustained misses', () => {
    const g = createGovernor('high', 10);
    for (let i = 0; i < 10; i++) expect(g.record(i === 3 ? 200 : 17, 60)).toBeNull(); // one hitch
    expect(g.quality).toBe('high');
    let changed = null;
    for (let i = 0; i < 10; i++) changed = g.record(40, 60) ?? changed;
    expect(changed).toBe('medium');
    for (let i = 0; i < 10; i++) g.record(90, 30);
    expect(g.quality).toBe('low');
    for (let i = 0; i < 10; i++) expect(g.record(500, 24)).toBeNull(); // nothing below low
    expect(g.history.length).toBe(2);
  });
});

describe('texture assets', () => {
  const v1 = readJson('v1/manifest.json') as { assets: Array<{ id: string; file: string }> };
  const v2 = readJson('v2/manifest.json') as { assets: Array<{ id: string; atlas: string; rect: number[] }> };

  it('every texture is a real manifest asset with its real file and atlas cell', () => {
    for (const t of TEXTURE_ASSETS) {
      const a1 = v1.assets.find((a) => a.id === t.assetId);
      const a2 = v2.assets.find((a) => a.id === t.assetId);
      expect(a1 ?? a2, t.assetId).toBeDefined();
      if (a1) expect(t.file).toBe(`scene-assets/v1/${a1.file}`);
      if (a2) {
        expect(t.file).toBe(`scene-assets/v2/${a2.atlas}`);
        expect(t.rect).toEqual(a2.rect);
      }
    }
  });

  it('color keys and scalar keys do not overlap', () => {
    expect(SCALAR_KEYS.filter((k) => (COLOR_KEYS as readonly string[]).includes(k))).toEqual([]);
  });
});
