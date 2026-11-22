/**
 * Explicit thematic evidence for decorations.
 *
 * A decoration that carries a theme (a ghost, a decorated tree, a pirate flag)
 * may appear only when the user's own words or accepted answers ask for that
 * theme. Derived visual values (a dark grade, a night sky, amber lamps, a
 * preset anchor) never authorize a theme: they only rank assets that are
 * already eligible. Genuinely neutral details (park trees, shrubs, benches,
 * street lamps) need no evidence.
 *
 * Evidence is computed by the host from the composer's input signals and
 * carried in `SceneContext.themeEvidence`, so it is hashed, cached and
 * restored by undo exactly like the scene it belongs to.
 */

export const THEMES = [
  'spooky', 'halloween', 'winter_holiday', 'festive', 'cyberpunk', 'scifi', 'nautical', 'tropical',
  'fantasy', 'market', 'arcade', 'sweets', 'blossom', 'desert', 'domestic',
] as const;
export type Theme = (typeof THEMES)[number];
/** `neutral`: needs no evidence. `never`: unclassified, so never scattered. */
export type AssetTheme = Theme | 'neutral' | 'never';

/** Where the words came from. */
export type EvidenceSource = 'vibe' | 'answer' | 'request';

export interface ThemeEvidence {
  readonly theme: Theme;
  readonly term: string;
  readonly source: EvidenceSource;
}

/**
 * Words that explicitly ask for a theme. Deliberately narrow: "dark", "mysterious",
 * "cozy", "winter", "romantic", "neon night", "playful" and cuisine words are not here.
 */
const THEME_WORDS: Readonly<Record<Theme, RegExp>> = {
  spooky: /\b(haunt(ed|ing|s)?|ghosts?|ghostly|spooky|spookiest|eerie|creepy|gothic|supernatural|paranormal|graveyards?|cemeter(y|ies)|zombies?|vampires?|witch(es|y)?)\b/g,
  halloween: /\b(halloween|jack[- ]?o[- ]?lanterns?|pumpkins?|trick[- ]or[- ]treat(ing)?)\b/g,
  winter_holiday: /\b(christmas|xmas|holiday season|the holidays|holidays|holiday|santa|yule(tide)?|winter wonderland|snowm[ae]n|gingerbread)\b/g,
  festive: /\b(party|parties|celebrat(e|ion|ing)|festive|festival|carnival|birthday|fiesta|gala|string lights|fairy lights)\b/g,
  cyberpunk: /\b(cyberpunk|cyber|neon|synthwave|vaporwave|retrowave|outrun|blade runner)\b/g,
  scifi: /\b(sci[- ]?fi|science fiction|outer space|space ?ships?|spaceport|space age|futuristic|robots?|aliens?|galactic)\b/g,
  nautical: /\b(harbou?r|nautical|pirates?|seaside|waterfront|pier|maritime|sailing|sailboats?|boats?|lighthouses?|fishing|seafood|docks?)\b/g,
  tropical: /\b(tropical|tropics|palm trees?|palms?|tiki|island|beach(y|es)?)\b/g,
  fantasy: /\b(fairy ?tales?|fairies|storybook|fantasy|medieval|castles?|knights?|dragons?|renaissance)\b/g,
  market: /\b(markets?|bazaar|street food|food hall|food trucks?|stalls?|farmers'? market|flea market|fair)\b/g,
  arcade: /\b(arcades?|video games?|gaming|pinball|pixel|claw machines?|retro games?)\b/g,
  sweets: /\b(desserts?|sweets|cakes?|cupcakes?|donuts?|doughnuts?|ice cream|gelato|candy)\b/g,
  blossom: /\b(cherry blossoms?|blossoms?|sakura)\b/g,
  desert: /\b(desert|cactus|cacti|southwest(ern)?)\b/g,
  domestic: /\b(living room|lamp ?lit|lamplight|homey|homely)\b/g,
};

/** Asking for one theme explicitly includes another. */
const IMPLIES: Partial<Record<Theme, readonly Theme[]>> = { halloween: ['spooky'], scifi: ['cyberpunk'] };

const NEGATORS = new Set(['not', 'no', 'without', 'avoid', 'never', 'nothing', 'less', 'non', 'dont', "don't", 'hate', 'skip', 'except', 'minus']);

/**
 * Themes the user explicitly asked for. `avoid` texts (and negated mentions such as
 * "nothing spooky") remove a theme even if it is mentioned elsewhere.
 */
export function themeEvidence(inputs: ReadonlyArray<{ readonly text: string; readonly source: EvidenceSource }>, avoid: readonly string[] = []): ThemeEvidence[] {
  const found = new Map<Theme, ThemeEvidence>();
  const blocked = new Set<Theme>();
  const scan = (text: string, onHit: (theme: Theme, term: string, negated: boolean) => void) => {
    const lower = text.toLowerCase().replace(/[’']/g, "'");
    for (const theme of THEMES) {
      for (const m of lower.matchAll(THEME_WORDS[theme])) {
        const before = lower.slice(0, m.index).split(/[^a-z']+/).filter(Boolean).slice(-2);
        onHit(theme, m[0], before.some((w) => NEGATORS.has(w)));
      }
    }
  };
  for (const a of avoid) scan(a, (theme) => blocked.add(theme));
  for (const input of inputs) {
    scan(input.text, (theme, term, negated) => {
      if (negated) { blocked.add(theme); return; }
      for (const t of [theme, ...(IMPLIES[theme] ?? [])]) if (!found.has(t)) found.set(t, { theme: t, term, source: input.source });
    });
  }
  for (const t of blocked) found.delete(t);
  return THEMES.filter((t) => found.has(t)).map((t) => found.get(t)!);
}

/** `theme|term|source` strings for SceneContext (plain, hashable, stable order). */
export const encodeEvidence = (list: readonly ThemeEvidence[]): string[] => list.map((e) => `${e.theme}|${e.term}|${e.source}`);
export function decodeEvidence(encoded: readonly string[] | undefined): ThemeEvidence[] {
  const out: ThemeEvidence[] = [];
  for (const s of encoded ?? []) {
    const [theme, term, source] = s.split('|');
    if ((THEMES as readonly string[]).includes(theme!) && term && (source === 'vibe' || source === 'answer' || source === 'request')) out.push({ theme: theme as Theme, term, source });
  }
  return out;
}
