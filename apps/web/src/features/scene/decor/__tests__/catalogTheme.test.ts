import { describe, expect, it } from 'vitest';
import { gateAllows, relevance, type GateContext } from '../catalog';
import { deriveTheme } from '../themes';
import { catalog, LAYOUT_CONTEXT, runtimeAssets } from './fixtures';
import type { SceneState } from '../../state';

const noGates: GateContext = { explicitContext: new Set(), seasonal: false, observanceOptIn: false, activatedIds: new Set(), themes: new Set() };
const state = (presets: Array<[string, number]>, context: Partial<NonNullable<SceneState['context']>> = {}, setPiece: SceneState['setPiece'] = null) =>
  ({ source: 'outing', presets: presets.map(([id, weight]) => ({ id, weight })), context: { navigation: 'browse', reducedMotion: false, performance: 'medium', ...context }, setPiece, lighting: { color: '#fff', intensity: 1, position: [0, 0, 0] } }) as unknown as SceneState;

describe('decoration catalog', () => {
  it('classifies a broad, reusable subset of the 312 imported models', () => {
    expect(runtimeAssets.models.size).toBe(312);
    expect(catalog.assets.size).toBeGreaterThan(80);
    const families = new Set([...catalog.assets.values()].map((a) => a.family));
    expect(families.size).toBeGreaterThanOrEqual(15);
  });

  it('never scatters buildings, vehicles or real-infrastructure lookalikes', () => {
    for (const id of catalog.assets.keys()) expect(id).not.toMatch(/building_[a-h]|skyscraper|car_|spacetruck|trafficlight|firehydrant|dumpster|watertower|wall_a_window|door$/i);
  });

  it('enforces per-instance complexity budgets', () => {
    expect(catalog.assets.has('cc0.the-base-mesh.acoustic_guitar')).toBe(false);
    for (const a of catalog.assets.values()) { expect(a.metrics.prims).toBeLessThanOrEqual(8); expect(a.metrics.tris).toBeLessThanOrEqual(7000); }
  });

  it('gates observance, seasonal and cultural/cuisine props', () => {
    const menorah = catalog.assets.get('cc0.kenney-holiday-kit.hanukkah_menorah')!;
    const snowman = catalog.assets.get('cc0.kenney-holiday-kit.snowman_hat')!;
    const onigiri = catalog.assets.get('cc0.quaternius-sushirestaurantkit.food_onigiri')!;
    expect(gateAllows(menorah, noGates)).toBe(false);
    expect(gateAllows(menorah, { ...noGates, observanceOptIn: true })).toBe(false); // opt-in alone is not context
    expect(gateAllows(menorah, { ...noGates, observanceOptIn: true, explicitContext: new Set(['hanukkah']) })).toBe(true);
    expect(gateAllows(menorah, { ...noGates, activatedIds: new Set([menorah.id]) })).toBe(false);
    expect(gateAllows(snowman, noGates)).toBe(false);
    expect(gateAllows(snowman, { ...noGates, seasonal: true })).toBe(false); // the season alone is not a holiday request
    expect(gateAllows(snowman, { ...noGates, seasonal: true, themes: new Set(['winter_holiday']) })).toBe(true);
    expect(gateAllows(onigiri, noGates)).toBe(false);
    expect(gateAllows(onigiri, { ...noGates, explicitContext: new Set(['japanese']) })).toBe(true);
    expect(gateAllows(onigiri, { ...noGates, activatedIds: new Set([onigiri.id]) })).toBe(true); // verified set piece
  });

  it('scores relevance by motif', () => {
    const ghost = catalog.assets.get('cc0.kenney-graveyard-kit.character_ghost')!;
    expect(relevance(ghost, { nocturne: 1 })).toBeGreaterThan(relevance(ghost, { coastal: 1 }));
    expect(relevance(ghost, { coastal: 1 })).toBe(0);
  });
});

describe('scene → decoration theme', () => {
  it('derives motifs and strength from preset weights and discovery progress', () => {
    const early = deriveTheme(state([['noir_nocturne', 0.3]], { discoveryProgress: 0.2 }), runtimeAssets, {}, LAYOUT_CONTEXT);
    const late = deriveTheme(state([['noir_nocturne', 1]], { discoveryProgress: 1 }), runtimeAssets, {}, LAYOUT_CONTEXT);
    expect(late.motifs.nocturne).toBe(1);
    expect(late.strength).toBeGreaterThan(early.strength);
    expect(deriveTheme(state([['neutral', 1]]), runtimeAssets).strength).toBe(0);
  });

  it('offers a vibe-selected hero layout only for an explicitly requested theme, never cuisine/observance ones', () => {
    // A dark/noir or neon anchor alone (derived from "jazz", "night", "romantic"...) stages nothing.
    expect(deriveTheme(state([['noir_nocturne', 1]], { discoveryProgress: 1 }), runtimeAssets, {}, LAYOUT_CONTEXT).heroLayouts).toEqual([]);
    expect(deriveTheme(state([['neon_city', 1]], { discoveryProgress: 1 }), runtimeAssets, {}, LAYOUT_CONTEXT).heroLayouts).toEqual([]);
    const haunted = deriveTheme(state([['noir_nocturne', 1]], { discoveryProgress: 1, themeEvidence: ['spooky|haunted|vibe'] }), runtimeAssets, {}, LAYOUT_CONTEXT);
    expect(haunted.heroLayouts).toEqual(expect.arrayContaining(['haunted_street']));
    for (const id of haunted.heroLayouts) expect(runtimeAssets.layouts.get(id)!.activation).toBe('vibe_selected');
    expect(haunted.evidence).toEqual([{ theme: 'spooky', term: 'haunted', source: 'vibe' }]);
    const neon = deriveTheme(state([['neon_city', 1]], { discoveryProgress: 1, themeEvidence: ['cyberpunk|cyberpunk|vibe'] }), runtimeAssets, {}, LAYOUT_CONTEXT);
    expect(neon.heroLayouts).toContain('cyberpunk_night');
    expect(neon.gates.explicitContext.size).toBe(0);
  });

  it('stages the winter festive layout only for the user\'s own holiday words, never observances', () => {
    const winterOnly = deriveTheme(state([['amber_refuge', 1]], { discoveryProgress: 1 }), runtimeAssets, {}, LAYOUT_CONTEXT);
    expect(winterOnly.heroLayouts).not.toContain('winter_festive');
    const xmas = deriveTheme(state([['amber_refuge', 1]], { discoveryProgress: 1, themeEvidence: ['winter_holiday|christmas|vibe'] }), runtimeAssets, {}, LAYOUT_CONTEXT);
    expect(xmas.heroLayouts).toContain('winter_festive');
    expect(xmas.gates.seasonal).toBe(true);
    expect(xmas.heroLayouts.some((id) => /hanukkah|kwanzaa/.test(id))).toBe(false);
  });

  it('still honours evidence when the outing has no style words (empty intent ⇒ neutral source)', () => {
    const xmas = { ...state([], { discoveryProgress: 1, themeEvidence: ['winter_holiday|christmas|vibe'] }), source: 'neutral' } as SceneState;
    expect(deriveTheme(xmas, runtimeAssets, {}, LAYOUT_CONTEXT).gates.themes.has('winter_holiday')).toBe(true);
  });

  it('hero layouts follow the whole mood: no spooky installation for a pastel dream', () => {
    const pastel = deriveTheme(state([['dream_pastel', 1]], { discoveryProgress: 1, themeEvidence: ['fantasy|storybook|vibe'] }), runtimeAssets, {}, LAYOUT_CONTEXT);
    expect(pastel.heroLayouts).toContain('fantasy_market'); // the compiler's own preset → set-piece mapping, now asked for
    expect(pastel.heroLayouts.filter((id) => id.startsWith('haunted'))).toEqual([]);
    expect(deriveTheme(state([['dream_pastel', 1]], { discoveryProgress: 1 }), runtimeAssets, {}, LAYOUT_CONTEXT).heroLayouts).toEqual([]);
  });

  it('includes the compiler-verified set piece and unlocks exactly its assets', () => {
    const sp = { layoutId: 'italian_romantic', heroAssetIds: ['cc0.kenney-food-kit.pizza'], accentAssetIds: [] };
    const t = deriveTheme(state([['amber_refuge', 1]], { discoveryProgress: 1 }, sp), runtimeAssets, {}, LAYOUT_CONTEXT);
    expect(t.heroLayouts[0]).toBe('italian_romantic');
    expect(t.gates.activatedIds.has('cc0.kenney-food-kit.pizza')).toBe(true);
  });

  it('hides while navigating or when 3D is switched off', () => {
    expect(deriveTheme(state([['neon_city', 1]], { navigation: 'route' }), runtimeAssets).hidden).toBe(true);
    expect(deriveTheme(state([['neon_city', 1]], { installationsEnabled: false }), runtimeAssets).hidden).toBe(true);
  });

  it('quantizes so tiny weight drift keeps the same cache key', () => {
    const a = deriveTheme(state([['neon_city', 0.81]], { discoveryProgress: 0.9 }), runtimeAssets);
    const b = deriveTheme(state([['neon_city', 0.82]], { discoveryProgress: 0.9 }), runtimeAssets);
    expect(a.key).toBe(b.key);
  });
});
