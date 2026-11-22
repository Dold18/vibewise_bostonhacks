/**
 * Decoration catalog: which imported models may decorate the open city, as
 * what, where, at what size and for which motifs.
 *
 * Models are classified by reusable *family rules* over manifest IDs/tags and
 * measured geometry (data/asset-metrics.v1.json), not per-scene code. A model
 * no rule accepts is never scattered (it can still appear in an authored hero
 * layout). Deliberately excluded: buildings, vehicles, traffic signals,
 * hydrants and other props that could be mistaken for real infrastructure,
 * interior-only fixtures, tiny utensils/ingredients and landscape-scale terrain.
 *
 * Gates (see AGENTS.md "honest data", PR #33 activation rules):
 * - `context`: cuisine/music/culture-specific props need verified or explicit
 *   context; aesthetic presets alone never unlock them.
 * - `seasonal`: winter-holiday props need an explicit seasonal context.
 * - `observance`: religious observance items need an explicit opt-in and an
 *   explicit context; they are never scattered from a vibe.
 */
import type { Surface } from './surfaces';
import type { AssetTheme, Theme } from './evidence';

export const MOTIFS = ['nocturne', 'neon', 'storybook', 'woodland', 'coastal', 'retro_urban', 'cozy', 'playful', 'modern', 'market', 'scifi', 'winter'] as const;
export type Motif = (typeof MOTIFS)[number];
export type MotifWeights = Partial<Record<Motif, number>>;

export type Tier = 'micro' | 'secondary' | 'hero';
export type Gate = 'always' | 'context' | 'seasonal' | 'observance';

export type Family =
  | 'light' | 'small_light' | 'festoon' | 'tree' | 'shrub' | 'flower' | 'rock' | 'bench' | 'parasol' | 'goods'
  | 'stall' | 'stage' | 'sculpture' | 'creature' | 'game' | 'mast' | 'landmark' | 'boat' | 'grave';

interface FamilySpec {
  readonly tier: Exclude<Tier, 'hero'>;
  /** Longest-dimension size range in meters (log-uniform). */
  readonly size: readonly [number, number];
  readonly surfaces: readonly Surface[];
  /** Fraction of the horizontal half-extent that must clear roads/paths (trunks, posts). */
  readonly base: number;
  /** Rhythmic street lining (promenades). */
  readonly linear?: boolean;
  /** Can anchor a vignette cluster. */
  readonly anchor?: boolean;
  /** Natural groves in parks. */
  readonly grove?: boolean;
  /** At most this many per decoration cell. */
  readonly perCell?: number;
}

/**
 * Sizes are stylized: a "secondary" decoration must read at a pitched z16
 * downtown view (≈1–2 m/px), so it is sized like a street tree or a public
 * artwork, never like a building.
 */
export const FAMILIES: Readonly<Record<Family, FamilySpec>> = {
  light: { tier: 'secondary', size: [8, 12], surfaces: ['sidewalk', 'path_edge', 'plaza', 'waterfront', 'rooftop'], base: 0.3, linear: true },
  festoon: { tier: 'secondary', size: [10, 14], surfaces: ['plaza', 'park', 'path_edge', 'waterfront', 'rooftop'], base: 1, anchor: true, perCell: 2 },
  tree: { tier: 'secondary', size: [11, 18], surfaces: ['park', 'sidewalk', 'path_edge', 'plaza', 'waterfront'], base: 0.18, linear: true, grove: true },
  stall: { tier: 'secondary', size: [7, 10], surfaces: ['plaza', 'park', 'waterfront'], base: 0.9, anchor: true, perCell: 2 },
  stage: { tier: 'secondary', size: [11, 15], surfaces: ['plaza', 'park'], base: 0.9, anchor: true, perCell: 1 },
  sculpture: { tier: 'secondary', size: [6.5, 10], surfaces: ['plaza', 'park', 'sidewalk', 'waterfront', 'path_edge', 'rooftop'], base: 0.85, anchor: true },
  creature: { tier: 'secondary', size: [9, 13], surfaces: ['plaza', 'park', 'waterfront', 'path_edge', 'rooftop'], base: 0.8, anchor: true, perCell: 2 },
  game: { tier: 'secondary', size: [5.5, 8], surfaces: ['plaza', 'park', 'sidewalk', 'waterfront'], base: 0.9, anchor: true, perCell: 3 },
  mast: { tier: 'secondary', size: [9, 13], surfaces: ['sidewalk', 'plaza', 'park', 'waterfront', 'path_edge', 'rooftop'], base: 0.35, linear: true, anchor: true },
  landmark: { tier: 'secondary', size: [12, 18], surfaces: ['park', 'plaza'], base: 0.9, anchor: true, perCell: 1 },
  boat: { tier: 'secondary', size: [7, 10], surfaces: ['waterfront'], base: 0.9, anchor: true, perCell: 2 },
  small_light: { tier: 'micro', size: [1.8, 3.4], surfaces: ['sidewalk', 'park', 'path_edge', 'plaza', 'waterfront', 'rooftop'], base: 0.6 },
  shrub: { tier: 'micro', size: [2, 3.6], surfaces: ['park', 'sidewalk', 'path_edge', 'plaza', 'rooftop'], base: 0.7, grove: true },
  flower: { tier: 'micro', size: [1.3, 2.6], surfaces: ['park', 'sidewalk', 'path_edge', 'plaza', 'waterfront', 'rooftop'], base: 0.7, grove: true },
  rock: { tier: 'micro', size: [1.6, 3.4], surfaces: ['park', 'path_edge', 'waterfront', 'plaza'], base: 0.8, grove: true },
  bench: { tier: 'micro', size: [2.4, 3.4], surfaces: ['sidewalk', 'path_edge', 'plaza', 'waterfront'], base: 0.8 },
  // Café parasols belong to plazas, terraces and the waterfront, not on park lawns.
  parasol: { tier: 'micro', size: [3.4, 5], surfaces: ['plaza', 'waterfront', 'rooftop'], base: 0.35 },
  goods: { tier: 'micro', size: [1.4, 2.6], surfaces: ['plaza', 'park', 'sidewalk', 'waterfront'], base: 0.85 },
  grave: { tier: 'micro', size: [1.4, 2.6], surfaces: ['park', 'path_edge', 'plaza'], base: 0.85 },
};

interface Rule {
  readonly match: RegExp;
  readonly family: Family;
  readonly motifs: MotifWeights;
  readonly gate?: Gate;
  /** Explicit context tokens that unlock a `context`/`observance` gate. */
  readonly context?: readonly string[];
}

const R = (match: RegExp, family: Family, motifs: MotifWeights, extra: Partial<Pick<Rule, 'gate' | 'context'>> = {}): Rule => ({ match, family, motifs, ...extra });

/** First matching rule wins. IDs refer to manifest models; patterns, not hard-coded scenes. */
export const RULES: readonly Rule[] = [
  // Excluded outright (could read as real infrastructure or as venue/building features).
  // building_*, car_*, trafficlight, firehydrant, dumpster, watertower, wall_*, door, cables… have no rule.

  // Observance / seasonal / culture-specific (gated).
  R(/hanukkah_menorah|kwanzaa_kinara/, 'sculpture', { winter: 0.2 }, { gate: 'observance', context: ['hanukkah', 'kwanzaa'] }),
  R(/kenney-holiday-kit\.(tree_decorated)$/, 'tree', { winter: 1 }, { gate: 'seasonal' }),
  R(/kenney-holiday-kit\.(snowman_hat|reindeer|gingerbread_man)$/, 'sculpture', { winter: 1, playful: 0.3 }, { gate: 'seasonal' }),
  R(/sushirestaurantkit\.(decoration_bamboo|decoration_light|environment_arch)$/, 'light', { cozy: 0.3 }, { gate: 'context', context: ['japanese'] }),
  R(/sushirestaurantkit\.food_(ramen|udon|salmon_roll|ebi_nigiri|onigiri|dango|gyoza|tamago_nigiri|maguro_nigiri)$/, 'sculpture', { playful: 0.3 }, { gate: 'context', context: ['japanese'] }),
  R(/kenney-food-kit\.(pizza|pizza_box)$|junkfood\.pizza$/, 'sculpture', { playful: 0.3 }, { gate: 'context', context: ['italian'] }),
  R(/kenney-food-kit\.taco$/, 'sculpture', { playful: 0.3 }, { gate: 'context', context: ['mexican'] }),
  R(/kenney-food-kit\.tajine$/, 'sculpture', { cozy: 0.3 }, { gate: 'context', context: ['north_african'] }),
  R(/kenney-food-kit\.(dim_sum|steamer)$/, 'sculpture', { cozy: 0.3 }, { gate: 'context', context: ['chinese'] }),
  R(/kenney-food-kit\.(croissant|loaf_baguette)$/, 'sculpture', { cozy: 0.3 }, { gate: 'context', context: ['french_bakery'] }),
  R(/kenney-food-kit\.(cup_coffee|frappe)$|junkfood\.milkshake$/, 'sculpture', { cozy: 0.4, playful: 0.4 }, { gate: 'context', context: ['cafe'] }),
  R(/kenney-furniture-kit\.(speaker|radio)$|the-base-mesh\.(computer_speaker|guitar_stand)$/, 'sculpture', { retro_urban: 0.3 }, { gate: 'context', context: ['music'] }),

  // Lighting.
  R(/city-builder-bits\.streetlight$/, 'light', { retro_urban: 0.8, modern: 0.7, cozy: 0.2 }),
  R(/kenney-fantasy-town-kit\.lantern$/, 'light', { storybook: 1, cozy: 0.9, woodland: 0.4, market: 0.3 }),
  R(/kenney-graveyard-kit\.lightpost_single$/, 'light', { nocturne: 1, cozy: 0.3, storybook: 0.2 }),
  R(/kenney-retro-urban-kit\.detail_light_double$/, 'light', { retro_urban: 1, modern: 0.4, neon: 0.3 }),
  R(/cyberpunkgamekit\.light_square$/, 'light', { neon: 1, scifi: 0.4 }),
  R(/furniture-bits\.lamp_standing$/, 'light', { cozy: 0.9, retro_urban: 0.3, playful: 0.2 }),
  R(/space-base-bits\.lights$/, 'light', { scifi: 0.9, neon: 0.5 }),
  R(/kenney-graveyard-kit\.lantern_candle$|halloween-bits\.candle_triple$/, 'small_light', { nocturne: 1, cozy: 0.5 }),
  R(/halloween-bits\.lantern_hanging$|kenney-holiday-kit\.lantern_hanging$/, 'small_light', { cozy: 0.8, storybook: 0.5, nocturne: 0.4, market: 0.3 }),
  R(/furniture-bits\.lamp_table$/, 'small_light', { cozy: 0.7 }),
  R(/kenney-holiday-kit\.lights_colored$/, 'festoon', { market: 1, playful: 0.6, cozy: 0.6, retro_urban: 0.4 }),

  // Trees and planting.
  R(/kenney-nature-kit\.tree_oak$/, 'tree', { woodland: 1, modern: 0.6, storybook: 0.4, cozy: 0.3 }),
  R(/kenney-nature-kit\.tree_palm$|kenney-pirate-kit\.palm_detailed_straight$/, 'tree', { coastal: 1, playful: 0.2 }),
  R(/kenney-retro-urban-kit\.tree_park_large$/, 'tree', { modern: 1, retro_urban: 0.8, woodland: 0.5 }),
  R(/kenney-fantasy-town-kit\.tree_crooked$/, 'tree', { storybook: 1, woodland: 0.5, nocturne: 0.3 }),
  R(/kenney-graveyard-kit\.pine_crooked$|halloween-bits\.tree_dead_(large|medium)$/, 'tree', { nocturne: 1 }),
  R(/halloween-bits\.tree_pine_orange_large$/, 'tree', { woodland: 0.6, nocturne: 0.6, cozy: 0.3 }),
  R(/medieval-nature\.tree_single_[AB]$/, 'tree', { woodland: 1, storybook: 0.8 }),
  R(/sushirestaurantkit\.decoration_sakura_tree$/, 'tree', { playful: 0.6, woodland: 0.3 }),
  R(/city-builder-bits\.bush$/, 'shrub', { modern: 0.8, retro_urban: 0.6, woodland: 0.4 }),
  R(/kenney-nature-kit\.plant_bush_detailed$/, 'shrub', { woodland: 1, modern: 0.5, storybook: 0.4 }),
  R(/kenney-fantasy-town-kit\.hedge_gate$/, 'shrub', { storybook: 0.8, cozy: 0.3 }),
  R(/sushirestaurantkit\.decoration_plant1$/, 'shrub', { modern: 0.5, cozy: 0.3 }),
  R(/furniture-bits\.cactus_medium_A$/, 'shrub', { coastal: 0.4, playful: 0.4 }),
  R(/kenney-nature-kit\.flower_(purple|red)_a$/, 'flower', { woodland: 0.8, playful: 0.8, storybook: 0.6, cozy: 0.5, modern: 0.3 }),
  R(/kenney-nature-kit\.mushroom_red_group$/, 'flower', { storybook: 0.9, woodland: 0.7, playful: 0.6 }),
  R(/medieval-nature\.rock_single_[ABC]$/, 'rock', { woodland: 0.8, storybook: 0.6, coastal: 0.3 }),

  // Street furniture and market dressing.
  R(/city-builder-bits\.bench$|kenney-retro-urban-kit\.detail_bench$/, 'bench', { retro_urban: 0.9, modern: 0.7, cozy: 0.3 }),
  R(/kenney-city-kit-commercial\.detail_parasol_[ab]$/, 'parasol', { modern: 1, coastal: 0.8, cozy: 0.4, playful: 0.4 }),
  R(/medieval-props\.(barrel|crate_A_big|crate_B_small|crate_open|sack|wheelbarrow|bucket_water)$/, 'goods', { market: 1, storybook: 0.8, woodland: 0.3 }),
  R(/restaurant-bits\.crate_(carrots|cheese|tomatoes|lettuce|onions|potatoes)$|kenney-mini-market\.display_fruit$/, 'goods', { market: 0.9, cozy: 0.3 }),
  R(/kenney-pirate-kit\.(chest|bottle_large)$/, 'goods', { coastal: 0.9, playful: 0.3 }),
  R(/kenney-fantasy-town-kit\.stall$/, 'stall', { market: 1, storybook: 0.8, cozy: 0.5 }),
  R(/medieval-props\.tent$/, 'stall', { market: 0.8, storybook: 0.6, woodland: 0.3 }),
  R(/medieval-buildings\.building_stage_[ABC]$/, 'stage', { market: 0.8, storybook: 0.6, playful: 0.3 }),

  // Themed sculptures and characters (clearly fictional, whimsical scale).
  R(/kenney-graveyard-kit\.character_ghost$/, 'creature', { nocturne: 1, playful: 0.4 }),
  R(/kenney-graveyard-kit\.pumpkin_carved$|halloween-bits\.pumpkin_(orange|yellow)_jackolantern$/, 'sculpture', { nocturne: 0.8, playful: 0.5, cozy: 0.2 }),
  R(/halloween-bits\.(gravestone|post_skull|fence_gate)$|kenney-graveyard-kit\.iron_fence_border_gate$/, 'grave', { nocturne: 0.9 }),
  R(/halloween-bits\.arch_gate$/, 'sculpture', { nocturne: 0.8 }),
  R(/kenney-graveyard-kit\.crypt_large$|halloween-bits\.crypt$/, 'landmark', { nocturne: 1 }),
  R(/junkfood\.(cupcake|donut|icecream|cake)$|kenney-food-kit\.cupcake$/, 'sculpture', { playful: 1, cozy: 0.2 }),
  R(/kenney-mini-arcade\.(arcade_machine|claw_machine|prize_wheel|basketball_game)$/, 'game', { playful: 0.9, neon: 0.6, retro_urban: 0.3 }),
  R(/cyberpunkgamekit\.antenna_[12]$/, 'mast', { neon: 1, scifi: 0.5 }),
  R(/cyberpunkgamekit\.computer$/, 'sculpture', { neon: 0.7, scifi: 0.5 }),
  R(/space-base-bits\.(structure_tall|lander_A)$/, 'landmark', { scifi: 1, neon: 0.4 }),
  R(/space-base-bits\.(windturbine_low|solarpanel|drill_structure)$/, 'sculpture', { scifi: 0.8, modern: 0.3 }),
  R(/kenney-pirate-kit\.flag_pennant$/, 'mast', { coastal: 1, market: 0.5, playful: 0.3 }),
  R(/kenney-pirate-kit\.mast_ropes$/, 'mast', { coastal: 0.8 }),
  R(/kenney-pirate-kit\.boat_row_small$/, 'boat', { coastal: 1, cozy: 0.2 }),
  R(/kenney-fantasy-town-kit\.fountain_round$/, 'landmark', { storybook: 1, cozy: 0.5, modern: 0.3, playful: 0.3 }),
  R(/kenney-fantasy-town-kit\.(windmill)$/, 'landmark', { storybook: 1, woodland: 0.6 }),
  R(/kenney-fantasy-town-kit\.wall_arch$/, 'sculpture', { storybook: 0.7, cozy: 0.4 }),
];

/**
 * What a model *means*, independent of its motifs (how it looks). Only `neutral` details may
 * appear without evidence; every other theme needs the user's explicit words (evidence.ts);
 * `never` (unclassified) is not scattered at all. Context-gated cultural props stay `neutral`
 * here because their verified-context gate already decides. First match wins.
 */
const MODEL_THEMES: ReadonlyArray<readonly [RegExp, readonly AssetTheme[]]> = [
  [/kenney-holiday-kit\.lights_colored$/, ['winter_holiday', 'festive']],
  [/kenney-holiday-kit\.|hanukkah_menorah|kwanzaa_kinara/, ['winter_holiday']],
  [/(halloween-bits|kenney-graveyard-kit)\.pumpkin/, ['halloween']],
  [/halloween-bits\.|kenney-graveyard-kit\./, ['spooky']],
  [/cyberpunkgamekit\./, ['cyberpunk']],
  [/space-base-bits\./, ['scifi']],
  [/kenney-pirate-kit\.palm|kenney-nature-kit\.tree_palm$/, ['tropical', 'nautical']],
  [/kenney-pirate-kit\./, ['nautical']],
  [/kenney-fantasy-town-kit\.lantern$/, ['neutral']],
  [/kenney-fantasy-town-kit\.stall$|medieval-props\.tent$|medieval-buildings\.building_stage_/, ['market', 'festive', 'fantasy']],
  [/medieval-props\.(barrel|crate|sack|wheelbarrow|bucket)/, ['market', 'fantasy']],
  [/kenney-fantasy-town-kit\.|medieval-props\.|medieval-buildings\.|kenney-nature-kit\.mushroom/, ['fantasy']],
  [/restaurant-bits\.crate_|kenney-mini-market\./, ['market']],
  [/kenney-mini-arcade\./, ['arcade']],
  [/quaternius-junkfood\.(cupcake|donut|icecream|cake)$|kenney-food-kit\.cupcake$/, ['sweets']],
  [/sushirestaurantkit\.decoration_sakura_tree$/, ['blossom']],
  [/sushirestaurantkit\.decoration_plant1$/, ['domestic']],
  [/furniture-bits\.cactus/, ['desert']],
  [/sushirestaurantkit\.|kenney-food-kit\.|quaternius-junkfood\.|the-base-mesh\.|kenney-furniture-kit\.(speaker|radio)$/, ['neutral']],
  [/furniture-bits\.lamp_|kenney-furniture-kit\./, ['domestic']],
  [/city-builder-bits\.|kenney-retro-urban-kit\.|kenney-nature-kit\.|medieval-nature\.|kenney-city-kit-commercial\./, ['neutral']],
];

export function themesOfModel(id: string): readonly AssetTheme[] {
  return MODEL_THEMES.find(([re]) => re.test(id))?.[1] ?? ['never'];
}

/** Neutral needs nothing; `never` never passes; any other theme needs matching evidence. */
export function themeAllowed(themes: readonly AssetTheme[], allowed: ReadonlySet<Theme>): boolean {
  return themes.includes('neutral') || themes.some((t) => t !== 'never' && allowed.has(t as Theme));
}

export interface AssetMetrics { readonly w: number; readonly h: number; readonly d: number; readonly tris: number; readonly prims: number }

export interface DecorAsset {
  readonly id: string;
  readonly family: Family;
  readonly tier: Exclude<Tier, 'hero'>;
  readonly motifs: MotifWeights;
  readonly gate: Gate;
  readonly context: readonly string[];
  /** Semantic themes (any one authorizes it); see MODEL_THEMES. */
  readonly themes: readonly AssetTheme[];
  readonly metrics: AssetMetrics;
  /** Horizontal half-extent per meter of longest dimension. */
  readonly radiusRatio: number;
}

/** Per-instance limits: decorations must stay cheap enough to repeat. */
export const MAX_TRIS = { micro: 2500, secondary: 3000 } as const;
export const MAX_PRIMS = 8;

export interface CatalogInput {
  readonly modelIds: Iterable<string>;
  readonly metrics: Readonly<Record<string, AssetMetrics>>;
}

export interface DecorCatalog {
  readonly assets: ReadonlyMap<string, DecorAsset>;
  /** Model IDs a rule matched but that were rejected (reason), for QA reports. */
  readonly rejected: ReadonlyMap<string, string>;
}

export function buildDecorCatalog(input: CatalogInput): DecorCatalog {
  const assets = new Map<string, DecorAsset>(), rejected = new Map<string, string>();
  for (const id of input.modelIds) {
    const rule = RULES.find((r) => r.match.test(id));
    if (!rule) continue;
    const metrics = input.metrics[id];
    const spec = FAMILIES[rule.family];
    if (!metrics) { rejected.set(id, 'no measured geometry'); continue; }
    if (metrics.tris > MAX_TRIS[spec.tier]) { rejected.set(id, `${metrics.tris} triangles exceeds ${spec.tier} budget`); continue; }
    if (metrics.prims > MAX_PRIMS) { rejected.set(id, `${metrics.prims} primitives exceeds ${MAX_PRIMS}`); continue; }
    assets.set(id, Object.freeze({
      id, family: rule.family, tier: spec.tier, motifs: rule.motifs, gate: rule.gate ?? 'always', context: rule.context ?? [], themes: themesOfModel(id), metrics,
      radiusRatio: Math.max(metrics.w, metrics.d) / 2,
    }));
  }
  return { assets, rejected };
}

export interface GateContext {
  /** Explicit, user-confirmed or venue-verified context tokens (e.g. 'japanese', 'music'). */
  readonly explicitContext: ReadonlySet<string>;
  readonly seasonal: boolean;
  readonly observanceOptIn: boolean;
  /** Model IDs already activated by a verified set piece (compiler-gated). */
  readonly activatedIds: ReadonlySet<string>;
  /** Themes the user explicitly asked for (evidence.ts). Derived visual values never add one. */
  readonly themes: ReadonlySet<Theme>;
}

export function gateAllows(asset: DecorAsset, ctx: GateContext): boolean {
  // A staged set piece was itself authorized (themes.ts: evidence, or the compiler's verified context).
  if (ctx.activatedIds.has(asset.id) && asset.gate !== 'observance') return true;
  // Meaning first: no motif, preset anchor or seed can bring in a theme nobody asked for.
  // Observance items keep their own, stricter gate (explicit opt-in plus explicit context).
  if (asset.gate !== 'observance' && !themeAllowed(asset.themes, ctx.themes)) return false;
  switch (asset.gate) {
    case 'always': return true;
    case 'seasonal': return ctx.seasonal;
    case 'context': return asset.context.some((c) => ctx.explicitContext.has(c));
    case 'observance': return ctx.observanceOptIn && asset.context.some((c) => ctx.explicitContext.has(c));
  }
}

/** Relevance of an asset to the active motif mix (0 = unrelated). */
export function relevance(asset: DecorAsset, motifs: MotifWeights): number {
  let score = 0;
  for (const m of MOTIFS) score += (motifs[m] ?? 0) * (asset.motifs[m] ?? 0);
  // Context-unlocked props carry little aesthetic weight; give them presence when unlocked.
  if (asset.gate !== 'always' && score < 0.25) score = 0.25;
  return score;
}
