/** Scene compiler acceptance (docs/SCENE_COMPOSER_DESIGN.md §9). */
import { describe, expect, it } from 'vitest';
import { basePalette, buildMapStyle } from '../../../mapStyle';
import { buildAssetRegistry } from '../assets';
import { PALETTE_ADAPTER_V0, previewAllCapabilities, SCENE_ADAPTER_V1_PROPOSED, supports } from '../capabilities';
import { SCENE_CATALOG } from '../catalog';
import { hexToLab } from '../color';
import { compileScene } from '../compile';
import { COST, EFFECT_BUDGET } from '../constraints';
import { FLOORS, labelsPass, pinsPass, ringPasses } from '../guard';
import { contrastRatio } from '../color';
import { PRESET_IDS, type ScenePresetId } from '../presets';
import { diffScene, stableStringify, type SceneState } from '../state';
import { DESIGN_EXAMPLE, intent, realManifests, realRegistry } from './fixtures';

const ALL = previewAllCapabilities(SCENE_CATALOG);
const dE = (a: string, b: string) => {
  const [x, y] = [hexToLab(a), hexToLab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const only = (id: ScenePresetId, weight = 1, extra = {}) => compileScene({ outing: intent([[id, weight]]), ...extra });

function expectLegible(s: SceneState) {
  const p = s.palette;
  expect(labelsPass(p), `labels on ${p.land}`).toBe(true);
  expect(s.pinEdge === 'two_tone' ? ringPasses(p.land) : pinsPass(p.land, s.darkMode), `pins on ${p.land}`).toBe(true);
  expect(contrastRatio(p.waterLabel, p.water)).toBeGreaterThanOrEqual(FLOORS.water);
}

describe('neutral and completeness', () => {
  it('with no input is exactly today’s map', () => {
    const s = compileScene();
    expect(s.source).toBe('neutral');
    expect(s.palette).toEqual(basePalette);
    expect(s.darkMode).toBe(false);
    expect(s.disabled).toEqual([]);
    expect(s.overlays).toEqual([]);
    expect(s.setPiece).toBeNull();
    for (const set of SCENE_CATALOG.settings) expect(s.resolved[set.key]).toBe(set.default);
    // Light and sky match the live style, so applying a neutral scene is a no-op.
    const style = buildMapStyle(basePalette);
    expect(s.lighting).toEqual({ color: style.light!.color, intensity: style.light!.intensity, position: style.light!.position });
    expect(s.sky).toEqual({
      skyColor: style.sky!['sky-color'], horizonColor: style.sky!['horizon-color'], fogColor: style.sky!['fog-color'],
      skyHorizonBlend: style.sky!['sky-horizon-blend'], horizonFogBlend: style.sky!['horizon-fog-blend'], fogGroundBlend: style.sky!['fog-ground-blend'],
    });
    expect(s.motion).toEqual({ transitionMs: 800, ambient: false });
  });

  it('the neutral preset and an empty intent are the plain map too', () => {
    expect(compileScene({ outing: intent([['neutral', 1]]) }).palette).toEqual(basePalette);
    expect(compileScene({ outing: intent() }).source).toBe('neutral');
  });

  it.each(PRESET_IDS)('%s resolves exactly one documented value for all 178 keys', (id) => {
    const s = only(id, 1, { capabilities: ALL });
    expect(Object.keys(s.resolved)).toEqual(SCENE_CATALOG.settings.map((x) => x.key));
    for (const set of SCENE_CATALOG.settings) expect(set.values).toContain(s.resolved[set.key]);
  });
});

describe('determinism', () => {
  it('the same intent and profile give a byte-identical state', () => {
    const a = compileScene({ outing: DESIGN_EXAMPLE, capabilities: SCENE_ADAPTER_V1_PROPOSED });
    const b = compileScene({ outing: JSON.parse(JSON.stringify(DESIGN_EXAMPLE)), capabilities: SCENE_ADAPTER_V1_PROPOSED });
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(a.hash).toBe(b.hash);
  });

  it('reversing a quiz answer restores the earlier scene exactly, not an approximation', () => {
    const before = compileScene({ outing: intent([['amber_refuge', 0.4]], { sessionVersion: 3 }) });
    compileScene({ outing: intent([['neon_city', 0.7]], { sessionVersion: 4 }) });
    const reverted = compileScene({ outing: intent([['amber_refuge', 0.4]], { sessionVersion: 3 }) });
    expect(reverted).toEqual(before);
  });

  it('different capability profiles hash differently', () => {
    expect(compileScene({ outing: DESIGN_EXAMPLE }).hash).not.toBe(compileScene({ outing: DESIGN_EXAMPLE, capabilities: ALL }).hash);
  });
});

describe('art direction', () => {
  it('warm cozy and dark neon produce visibly different ground, sky and buildings', () => {
    const cozy = only('amber_refuge').palette;
    const neon = only('neon_city').palette;
    for (const k of ['land', 'sky', 'building3d', 'water'] as const) expect(dE(cozy[k], neon[k]), k).toBeGreaterThan(0.15);
  });

  it('every preset is distinct from every other', () => {
    const palettes = PRESET_IDS.filter((id) => id !== 'neutral').map((id) => [id, only(id).palette] as const);
    for (const [i, [a, pa]] of palettes.entries()) {
      for (const [b, pb] of palettes.slice(i + 1)) {
        const total = (Object.keys(pa) as (keyof typeof pa)[]).reduce((s, k) => s + dE(pa[k], pb[k]), 0);
        expect(total, `${a} vs ${b}`).toBeGreaterThan(0.5);
      }
    }
  });

  it('blends presets continuously: the design example sits between its ingredients', () => {
    const mix = compileScene({ outing: DESIGN_EXAMPLE }).palette;
    const noir = only('noir_nocturne').palette;
    const amber = only('amber_refuge').palette;
    expect(dE(mix.building3d, noir.building3d)).toBeLessThan(dE(mix.building3d, amber.building3d));
    expect(mix.land).not.toBe(noir.land);
  });

  it('a faint early signal is a faint change; it grows with confidence', () => {
    const d = (w: number) => dE(only('amber_refuge', w).palette.building3d, basePalette.building3d);
    expect(d(0.1)).toBeGreaterThan(0);
    expect(d(0.1)).toBeLessThan(d(0.4));
    expect(d(0.4)).toBeLessThan(d(1));
  });

  it('small weight steps are small visual steps (no snapping) for a light scene', () => {
    let prev = only('amber_refuge', 0).palette;
    for (let w = 0.05; w <= 1.0001; w += 0.05) {
      const next = only('amber_refuge', w).palette;
      for (const k of ['building3d', 'sky', 'roadMinor', 'water', 'park'] as const) expect(dE(prev[k], next[k]), `${k} @${w.toFixed(2)}`).toBeLessThan(0.06);
      prev = next;
    }
  });

  it('applies an override on top of the blend', () => {
    const s = compileScene({ outing: DESIGN_EXAMPLE });
    expect(s.resolved['sky_and_horizon.sky_mode']).toBe('purple_twilight');
    expect(s.provenance['sky_and_horizon.sky_mode']).toBe('override');
    expect(s.resolved['lighting_and_shadows.light_color']).toBe('amber');
    expect(s.strengths['lighting_and_shadows.light_color']).toBe(0.55);
  });
});

describe('precedence', () => {
  const account = { tags: { late_night: 1 }, strength: 1 };

  it('current outing beats saved account taste', () => {
    const s = compileScene({ outing: intent([['sunlit_coast', 0.8]]), account });
    expect(s.source).toBe('outing');
    expect(s.presets).toEqual([{ id: 'sunlit_coast', weight: 0.8 }]);
  });

  it('falls back to account taste without a usable outing, then to neutral', () => {
    expect(compileScene({ outing: { garbage: true }, account }).source).toBe('account');
    expect(compileScene({ outing: intent(), account }).source).toBe('account');
    expect(compileScene({ account: { tags: {}, strength: 1 } }).source).toBe('neutral');
  });

  it('accepts the adaptive engine’s current shape: empty presets, account keys as descriptors', () => {
    const s = compileScene({ outing: intent([], { descriptors: ['cozy', 'date_night'] }) });
    expect(s.source).toBe('outing');
    expect(s.presets.map((p) => p.id)).toEqual(['amber_refuge', 'noir_nocturne']);
  });

  it('never lets the model edit navigation safety or camera, even with every capability', () => {
    const s = compileScene({
      outing: intent([['neon_city', 1]], { overrides: [{ key: 'navigation_safe.walk_line', value: 'contrasting_dotted' }, { key: 'camera_and_perspective.reveal_motion', value: 'short_orbit' }] }),
      capabilities: ALL,
    });
    for (const set of SCENE_CATALOG.settings.filter((x) => !x.group.aiSelectable)) {
      expect(s.resolved[set.key]).toBe(set.default);
      expect(s.provenance[set.key]).toBe('locked');
    }
    expect(s.diagnostics.filter((d) => d.code === 'override_locked')).toHaveLength(2);
  });
});

describe('capabilities: never report an unimplemented effect as active', () => {
  it.each(PRESET_IDS)('%s under V0: every non-default resolved value is supported', (id) => {
    const s = only(id);
    for (const set of SCENE_CATALOG.settings) {
      const v = s.resolved[set.key];
      expect(supports(PALETTE_ADAPTER_V0, set.key, v, set.default), `${set.key}=${v}`).toBe(true);
    }
    expect(s.overlays).toEqual([]);
  });

  it('reports dropped requests in `disabled` with the profile that lacks them', () => {
    const s = compileScene({ outing: intent([], { overrides: [{ key: 'building_surfaces.window_pattern', value: 'sparse_warm' }] }) });
    expect(s.resolved['building_surfaces.window_pattern']).toBe('none');
    expect(s.disabled).toContainEqual({ key: 'building_surfaces.window_pattern', value: 'sparse_warm', reason: 'not implemented in palette-adapter-v0' });
  });

  it('light intensity and angle apply only with the proposed v1 adapter', () => {
    const v0 = only('sunlit_coast');
    const v1 = only('sunlit_coast', 1, { capabilities: SCENE_ADAPTER_V1_PROPOSED });
    expect(v0.lighting.intensity).toBe(0.35);
    expect(v0.lighting.position).toEqual([1.4, 295, 40]);
    expect(v1.lighting.intensity).toBe(0.55);
    expect(v1.lighting.position).toEqual([1.2, 300, 15]);
  });

  it('blends light azimuth along the short arc', () => {
    // morning_low is 80°; from the standard 295° the short way is +145° through north, not −215°.
    // With no presets, the override applies at the minimum presence (0.35).
    const s = compileScene({ outing: intent([], { overrides: [{ key: 'lighting_and_shadows.light_angle', value: 'morning_low' }] }), capabilities: SCENE_ADAPTER_V1_PROPOSED });
    expect(s.lighting.position[1]).toBeCloseTo((295 + 0.35 * 145) % 360, 1);
  });
});

describe('constraints', () => {
  it('drops stars under a daylight sky unless stars were asked for explicitly', () => {
    const dayStars = compileScene({
      outing: intent([['sunlit_coast', 1]], { overrides: [{ key: 'sky_and_horizon.sky_mode', value: 'clear_blue' }, { key: 'sky_and_horizon.starfield', value: 'dense' }] }),
      capabilities: ALL,
    });
    expect(dayStars.resolved['sky_and_horizon.starfield']).toBe('off');

    const askedStars = compileScene({ outing: intent([['sunlit_coast', 1]], { overrides: [{ key: 'sky_and_horizon.starfield', value: 'dense' }] }), capabilities: ALL });
    expect(askedStars.resolved['sky_and_horizon.starfield']).toBe('dense');
    expect(askedStars.resolved['sky_and_horizon.sky_mode']).toBe('night_indigo');
  });

  it('keeps one kind of stylized precipitation', () => {
    const s = compileScene({
      outing: intent([], { overrides: [{ key: 'air_and_atmosphere.rain', value: 'light', intensity: 0.6 }, { key: 'air_and_atmosphere.snow', value: 'gentle', intensity: 0.4 }] }),
      capabilities: ALL,
    });
    expect(s.resolved['air_and_atmosphere.rain']).toBe('light');
    expect(s.resolved['air_and_atmosphere.snow']).toBe('off');
  });

  it.each(['route', 'focus'] as const)('while navigating (%s) keeps the palette but drops overlays, ambient motion and decorations', (navigation) => {
    const { registry } = realRegistry();
    const browse = compileScene({ outing: DESIGN_EXAMPLE, capabilities: ALL, assets: registry });
    const nav = compileScene({ outing: DESIGN_EXAMPLE, capabilities: ALL, assets: registry, context: { navigation } });
    expect(browse.overlays.length).toBeGreaterThan(1);
    expect(nav.palette).toEqual(browse.palette);
    expect(nav.darkMode).toBe(browse.darkMode);
    for (const o of nav.overlays) {
      expect(o).toMatchObject({ key: 'air_and_atmosphere.vignette', value: 'soft' });
      expect(o.opacity).toBeLessThanOrEqual(0.35);
    }
    expect(nav.motion.ambient).toBe(false);
    expect(nav.resolved['marker_recommendations.pin_pulse']).toBe('off');
    expect(nav.resolved['lighting_and_shadows.bloom']).toBe('off');
    expect(nav.setPiece).toBeNull();
    expect(nav.diagnostics.find((d) => d.code === 'navigation_legibility')?.detail).toMatch(/palette kept/);
  });

  it('while navigating lifts dim light to a safe level, without disabling the theme', () => {
    const browse = compileScene({ outing: intent([['noir_nocturne', 1]]), capabilities: SCENE_ADAPTER_V1_PROPOSED });
    const nav = compileScene({ outing: intent([['noir_nocturne', 1]]), capabilities: SCENE_ADAPTER_V1_PROPOSED, context: { navigation: 'route' } });
    expect(browse.lighting.intensity).toBe(0.2);
    expect(nav.lighting.intensity).toBe(0.28);
    expect(nav.lighting.color).toBe(browse.lighting.color);
    expect(nav.palette).toEqual(browse.palette);
    expect(nav.source).toBe('outing');
  });

  it('honors reduced motion', () => {
    const s = compileScene({ outing: intent([['neon_city', 1]]), capabilities: ALL, context: { reducedMotion: true } });
    expect(s.motion.transitionMs).toBeLessThanOrEqual(150);
    expect(s.motion.ambient).toBe(false);
    expect(s.resolved['animation_and_morph.particle_motion']).toBe('still');
    expect(s.resolved['marker_recommendations.pin_pulse']).toBe('off');
  });

  it.each(['low', 'medium', 'high'] as const)('keeps effects within the %s performance budget', (performance) => {
    const heavy = compileScene({
      outing: intent([['dream_pastel', 0.5], ['neon_city', 0.5]], {
        overrides: ['rain', 'petals', 'fireflies', 'sparkle', 'dust_motes', 'light_shafts', 'grain', 'vignette', 'lens_glare', 'scanlines']
          .map((k) => ({ key: `air_and_atmosphere.${k}`, value: SCENE_CATALOG.byKey.get(`air_and_atmosphere.${k}`)!.values[1] })),
      }),
      capabilities: ALL,
      context: { performance },
    });
    const cost = SCENE_CATALOG.settings.reduce((n, x) => n + (heavy.resolved[x.key] !== x.default ? COST[x.key] ?? 0 : 0), 0);
    expect(cost).toBeLessThanOrEqual(EFFECT_BUDGET[performance]);
    expect(cost).toBeGreaterThan(EFFECT_BUDGET[performance] - 4); // trimmed, not wiped
    expect(heavy.diagnostics.some((d) => d.code === 'performance_budget')).toBe(true);
  });
});

describe('legibility guard', () => {
  it.each(PRESET_IDS)('%s at full strength keeps labels, pins and water labels readable', (id) => expectLegible(only(id)));

  it('every pair of presets at every strength stays readable', () => {
    const ids = PRESET_IDS.filter((x) => x !== 'neutral');
    for (const [i, a] of ids.entries()) {
      for (const b of ids.slice(i + 1)) {
        for (const w of [0.15, 0.35, 0.5, 0.75, 1]) expectLegible(compileScene({ outing: intent([[a, w * 0.6], [b, w * 0.4]]) }));
      }
    }
  });

  it('dark scenes get light labels', () => {
    const s = only('noir_nocturne');
    expect(hexToLab(s.palette.textPrimary)[0]).toBeGreaterThan(hexToLab(s.palette.land)[0]);
  });
});

describe('assets: only verified IDs reach a scene', () => {
  it('builds a registry from the real manifests: 312 models, 40 layouts', () => {
    const { registry, problems } = realRegistry();
    expect(registry.models.size).toBe(312);
    expect(registry.layouts.size).toBe(40);
    expect(problems).toEqual([]);
    expect(registry.texturesByKey.get('air_and_atmosphere.grain')).toContain('film-grain');
  });

  it('rejects a layout that references a model not in any manifest', () => {
    const m = realManifests() as Record<string, any>;
    const layouts = JSON.parse(JSON.stringify(m.layouts));
    layouts.scenes[0].slots.hero_installation.placements[0].assetId = 'cc0.invented.model';
    const { registry, problems } = buildAssetRegistry({ ...m, layouts } as never);
    expect(registry.layouts.has(layouts.scenes[0].id)).toBe(false);
    expect(problems[0]).toMatch(/unknown model ids cc0\.invented\.model/);
  });

  it('selects a vibe set piece with verified model IDs when a 3D renderer exists', () => {
    const { registry } = realRegistry();
    const s = only('neon_city', 0.8, { capabilities: ALL, assets: registry });
    expect(s.setPiece?.layoutId).toBe('cyberpunk_night');
    for (const id of [...s.setPiece!.heroAssetIds, ...s.setPiece!.accentAssetIds]) expect(registry.models.has(id)).toBe(true);
  });

  it('reports the set piece as disabled on renderers without 3D, and hides it while navigating', () => {
    const { registry } = realRegistry();
    const v0 = only('neon_city', 0.8, { assets: registry });
    expect(v0.setPiece).toBeNull();
    expect(v0.disabled).toContainEqual({ key: 'assets.set_piece', value: 'cyberpunk_night', reason: 'not implemented in palette-adapter-v0' });
    expect(only('neon_city', 0.8, { capabilities: ALL, assets: registry, context: { navigation: 'focus' } }).setPiece).toBeNull();
    expect(only('neon_city', 0.2, { capabilities: ALL, assets: registry }).setPiece).toBeNull();
  });

  it('attaches only manifest SVG IDs to overlays', () => {
    const { registry } = realRegistry();
    const s = only('underground_indie', 1, { capabilities: ALL, assets: registry });
    const grain = s.overlays.find((o) => o.key === 'air_and_atmosphere.grain');
    expect(grain?.textureIds.length).toBeGreaterThan(0);
    for (const o of s.overlays) for (const id of o.textureIds) expect(registry.svg.has(id)).toBe(true);
  });
});

describe('robustness and diffing', () => {
  it('never throws on hostile intents', () => {
    const junk = [42, 'neon', [], { schemaVersion: '1.0.0', sessionVersion: 1, presets: [{ id: 'neon_city', weight: Infinity }], overrides: [{ key: 'x.y', value: '__proto__' }] }];
    for (const outing of junk) expect(() => compileScene({ outing, capabilities: ALL })).not.toThrow();
  });

  it('diffScene finds no change between identical states and names what changed otherwise', () => {
    const a = compileScene({ outing: intent([['amber_refuge', 0.5]]) });
    expect(diffScene(a, compileScene({ outing: intent([['amber_refuge', 0.5]]) })).same).toBe(true);
    const b = compileScene({ outing: intent([['amber_refuge', 0.5]], { overrides: [{ key: 'water_and_coast.water_palette', value: 'turquoise' }] }) });
    const d = diffScene(a, b);
    expect(d.same).toBe(false);
    expect(d.palette).toContain('water');
    expect(d.palette).not.toContain('sky');
    expect(d.resolved).toEqual(['water_and_coast.water_palette']);
  });
});
