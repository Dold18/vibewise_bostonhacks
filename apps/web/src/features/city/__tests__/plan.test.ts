import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { previewAllCapabilities } from '../../scene/capabilities';
import { SCENE_CATALOG } from '../../scene/catalog';
import { PRESET_IDS } from '../../scene/presets';
import { createAssetResolver } from '../assets';
import { allocateBudget, clampBudget, RESOURCE_KEYS, TIER_BUDGETS } from '../budget';
import { SECTION_IDS, type CityPlan, type CityPlanner } from '../contracts';
import { baselinePlanner, enforcePolicy, NAVIGATION_POLICY } from '../plan';
import { sectionOf } from '../routing';
import { fakeImage, runtimeAssets, scene } from './helpers';

const ALL = previewAllCapabilities(SCENE_CATALOG);
const assets = createAssetResolver(runtimeAssets, { loadImage: fakeImage });
const planOf = (state: ReturnType<typeof scene>, planner: CityPlanner = baselinePlanner) => enforcePolicy(planner({ state, assets }), state, assets);
const allTreatments = (p: CityPlan) => SECTION_IDS.flatMap((s) => Object.values(p.sections[s].treatments));

describe('composition, not themes', () => {
  it('one blended vibe produces treatments in all four sections at once', () => {
    const p = planOf(scene(ALL, [['noir_nocturne', 0.5], ['neon_city', 0.3], ['woodland_story', 0.2]]));
    for (const s of SECTION_IDS) expect(Object.keys(p.sections[s].treatments).length, s).toBeGreaterThan(0);
  });

  it('intensity is continuous in the input weight', () => {
    const at = (w: number) => planOf(scene(ALL, [['noir_nocturne', w]]));
    const lo = at(0.3), hi = at(0.9);
    const shared = Object.keys(lo.sections.atmosphere.treatments).filter((k) => k in hi.sections.atmosphere.treatments);
    expect(shared.length).toBeGreaterThan(0);
    for (const k of shared) expect(hi.sections.atmosphere.treatments[k]!.intensity).toBeGreaterThan(lo.sections.atmosphere.treatments[k]!.intensity);
  });

  it('different mixtures of the same presets are different cities', () => {
    const hashes = new Set<string>();
    const ids = PRESET_IDS.filter((p) => p !== 'neutral');
    for (const a of ids) for (const b of ids) if (a < b) for (const w of [0.25, 0.5, 0.75]) hashes.add(planOf(scene(ALL, [[a, w], [b, 1 - w]])).hash);
    expect(hashes.size).toBe(((ids.length * (ids.length - 1)) / 2) * 3);
  });

  it('every treatment sits in the section that owns its key', () => {
    const p = planOf(scene(ALL, [['retro_atlas', 0.6], ['dream_pastel', 0.4]]));
    for (const s of SECTION_IDS) for (const t of Object.values(p.sections[s].treatments)) expect(sectionOf(t.key)).toBe(s);
  });
});

describe('determinism and seeds', () => {
  it('same state and seed ⇒ identical plan; another seed ⇒ same look, different variation', () => {
    const s1 = scene(ALL, [['sunlit_coast', 0.7]], [], { variationSeed: 1 });
    expect(planOf(s1).hash).toBe(planOf(scene(ALL, [['sunlit_coast', 0.7]], [], { variationSeed: 1 })).hash);
    const s2 = scene(ALL, [['sunlit_coast', 0.7]], [], { variationSeed: 2 });
    const [a, b] = [planOf(s1), planOf(s2)];
    expect(a.hash).not.toBe(b.hash);
    const strip = (p: CityPlan) => allTreatments(p).map(({ key, style, intensity }) => [key, style, intensity]);
    expect(strip(a)).toEqual(strip(b));
    expect(a.sections.buildings.variation.seed).not.toBe(b.sections.buildings.variation.seed);
    expect(new Set(allTreatments(a).map((t) => t.seed)).size).toBe(allTreatments(a).length);
  });

  it('no Math.random or Date.now in the plan, planner or engine code', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); } else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.random|Date\.now/);
  });
});

describe('enforcePolicy: whoever plans, these hold', () => {
  const rogue: CityPlanner = (input) => {
    const p = baselinePlanner(input);
    const glow = { key: 'building_surfaces.window_glow', style: 'warm_high', intensity: 7, scale: 99, tint: 'red', assets: [{ id: 'not-in-any-manifest', kind: 'svg', uri: 'https://example.com/x.svg' }], seed: -5 } as const;
    return {
      ...p,
      seed: 999,
      budget: { ...p.budget, decorations: { ...p.budget.decorations, modelInstances: 10_000 } },
      sections: {
        ...p.sections,
        buildings: { ...p.sections.buildings, enabled: true, treatments: { window_glow: glow, rain: { ...glow, key: 'air_and_atmosphere.rain' } } },
        decorations: { ...p.sections.decorations, enabled: true, setPiece: { layoutId: 'fantasy_market', hero: [{ id: 'nope', kind: 'model', uri: '/scene-assets/x.glb' }], accent: [] } },
        atmosphere: { ...p.sections.atmosphere, enabled: true, treatments: { ...p.sections.atmosphere.treatments, vignette: { ...glow, key: 'air_and_atmosphere.vignette', style: 'strong', intensity: 1, assets: [] } } },
      },
    };
  };

  it('clamps ranges, drops foreign keys and non-manifest assets, keeps the authoritative seed and budget', () => {
    const state = scene(ALL, [['noir_nocturne', 0.8]], [], { variationSeed: 5 });
    const p = planOf(state, rogue);
    const glow = p.sections.buildings.treatments.window_glow!;
    expect(glow).toMatchObject({ intensity: 1, scale: 4, tint: null, assets: [] });
    expect(glow.seed).toBeGreaterThanOrEqual(0);
    expect(p.sections.buildings.treatments.rain).toBeUndefined();
    expect(p.seed).toBe(5);
    expect(p.sections.decorations.setPiece).toEqual({ layoutId: 'fantasy_market', hero: [], accent: [] });
    expect(p.notes.some((n) => n.includes('not-in-any-manifest'))).toBe(true);
    for (const r of RESOURCE_KEYS) expect(SECTION_IDS.reduce((a, s) => a + p.budget[s][r], 0)).toBeLessThanOrEqual(TIER_BUDGETS[p.tier][r]);
  });

  it('navigation: materials kept (compiler rule "palette kept"), decorations off, only a soft vignette, no ambient motion', () => {
    const browse = planOf(scene(ALL, [['noir_nocturne', 0.8]]), rogue);
    const p = planOf(scene(ALL, [['noir_nocturne', 0.8]], [], { navigation: 'route' }), rogue);
    // Buildings and streets keep their treatments; their renderers calm them from env.mode.navigation.
    expect(p.sections.buildings.treatments).toEqual(browse.sections.buildings.treatments);
    expect(p.sections.streets.treatments).toEqual(browse.sections.streets.treatments);
    expect(p.mode.navigation).toBe('route');
    expect(p.sections.decorations).toMatchObject({ enabled: false, setPiece: null });
    expect(Object.keys(p.sections.atmosphere.treatments)).toEqual(['vignette']);
    expect(p.sections.atmosphere.treatments.vignette!.intensity).toBeLessThanOrEqual(NAVIGATION_POLICY.atmosphereCap);
    expect(p.mode.ambientMotion).toBe(false);
  });

  it('reduced motion and the low tier stop ambient motion; toggles disable their sections', () => {
    expect(planOf(scene(ALL, [['dream_pastel', 1]], [], { reducedMotion: true })).mode.ambientMotion).toBe(false);
    expect(planOf(scene(ALL, [['dream_pastel', 1]], [], { performance: 'low' })).mode.ambientMotion).toBe(false);
    const off = planOf(scene(ALL, [['dream_pastel', 1]], [], { atmosphereEnabled: false, materialsEnabled: false }));
    expect([off.sections.atmosphere.enabled, off.sections.buildings.enabled, off.sections.streets.enabled]).toEqual([false, false, false]);
  });

  it('every asset in a plan is a local manifest file', () => {
    const p = planOf(scene(ALL, [['noir_nocturne', 0.4], ['retro_atlas', 0.3], ['dream_pastel', 0.3]]));
    const refs = allTreatments(p).flatMap((t) => t.assets);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r.uri.startsWith('/scene-assets/')).toBe(true);
      expect(existsSync(new URL(`../../../../public${r.uri}`, import.meta.url))).toBe(true);
    }
  });
});

describe('budgets', () => {
  it('allocations never exceed the tier totals and low tier gets no 3D', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const b = allocateBudget(tier);
      for (const r of RESOURCE_KEYS) expect(SECTION_IDS.reduce((a, s) => a + b[s][r], 0)).toBeLessThanOrEqual(TIER_BUDGETS[tier][r]);
    }
    expect(allocateBudget('low').decorations.modelInstances).toBe(0);
    const greedy = clampBudget('medium', { ...allocateBudget('medium'), atmosphere: { ...allocateBudget('medium').atmosphere, particles: 99_999 } });
    expect(SECTION_IDS.reduce((a, s) => a + greedy[s].particles, 0)).toBeLessThanOrEqual(TIER_BUDGETS.medium.particles);
  });
});

describe('asset resolver', () => {
  it('resolves manifest IDs only, and finds models by manifest tags', () => {
    expect(assets.resolve('film-grain')).toMatchObject({ kind: 'svg', uri: '/scene-assets/v1/film-grain.svg' });
    expect(assets.resolve('kaykit.city-builder-bits.bench')).toMatchObject({ kind: 'model' });
    expect(assets.resolve('../../etc/passwd')).toBeNull();
    const street = assets.modelsTagged(['street']);
    expect(street.length).toBeGreaterThan(0);
    expect(street.every((r) => r.kind === 'model' && runtimeAssets.modelTags!.get(r.id)!.includes('street'))).toBe(true);
  });
});
