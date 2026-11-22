/**
 * Decoration resolution: abstract decor intent → verified asset IDs and
 * placement parameters, under the asset library's activation rules.
 *
 * - Vibe-driven families draw only from models whose tags carry no cuisine,
 *   culture, observance, seasonal or venue-feature meaning.
 * - Cuisine/music-specific layouts (`explicit_or_verified_context`) need a
 *   *verified* selected venue whose facts name every specific word of the
 *   layout's context ("Japanese ramen" needs both). Seasonal layouts need a
 *   verified seasonal venue fact; observance layouts need the user's explicit
 *   opt-in. Nothing here infers them from mood or preference.
 * - Decorations are fictional, never occlude routes or pins, and are hidden
 *   while navigating (the ratified navigation policy).
 */
import type { SceneKey } from '../catalog';
import type { SceneContext, SceneState, SetPiece } from '../state';
import type { DecorIntent } from './compose';
import { shuffled } from './random';
import type { VenueContext } from './signals';

export interface AssetTagIndex {
  /** Verified model ID → its manifest tags. */
  readonly models: ReadonlyMap<string, readonly string[]>;
  readonly layouts: ReadonlyMap<string, { readonly id: string; readonly activation: string; readonly context: string }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown, field: string): unknown[] => (isObj(v) && Array.isArray(v[field]) ? v[field] : []);

/** Reads the same manifests as buildAssetRegistry (public/scene-assets), keeping tags and layout contexts. */
export function buildAssetTagIndex(manifests: { readonly kaykit: unknown; readonly modelibr: unknown; readonly layouts: unknown }): AssetTagIndex {
  const models = new Map<string, readonly string[]>();
  for (const m of [...list(manifests.kaykit, 'models'), ...list(manifests.modelibr, 'models')]) {
    if (isObj(m) && typeof m.id === 'string') models.set(m.id, Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : []);
  }
  const layouts = new Map<string, { id: string; activation: string; context: string }>();
  for (const s of list(manifests.layouts, 'scenes')) {
    if (isObj(s) && typeof s.id === 'string' && typeof s.activation === 'string') layouts.set(s.id, { id: s.id, activation: s.activation, context: String(s.context ?? '') });
  }
  return { models, layouts };
}

/** Abstract family → manifest tags that qualify a model. */
export const FAMILY_TAGS: Readonly<Record<string, readonly string[]>> = {
  streetscape: ['urban', 'street', 'urban_streetscape', 'city'],
  cafe_terrace: ['cafe', 'cozy'],
  lounge: ['lounge', 'music_venue_lounge', 'nightlife'],
  greenery: ['nature', 'foliage_or_nature', 'outdoors', 'landscape'],
  lighting_accents: ['lighting_accent', 'warm_lighting', 'candlelight', 'warm_ambience'],
  storybook: ['storybook', 'fantasy', 'rustic'],
  futurist: ['futuristic', 'sci_fi', 'space', 'cyberpunk', 'cyberpunk_adjacent'],
  market_festival: ['market', 'playful'],
  coastal: ['coastal', 'nautical'],
  arcade: ['arcade', 'games'],
  haunted: ['haunted', 'gothic', 'mystery'],
};

/** Tags that make a model ineligible for vibe-driven decoration. */
export const RESTRICTED_TAGS = new Set([
  'japanese_food', 'sushi', 'ramen_or_izakaya', 'italian_food', 'chinese_food', 'mexican_food', 'north_african_food', 'french_bakery',
  'dim_sum', 'tajine', 'taco', 'pizza', 'japanese', 'asian_dining', 'american', 'hanukkah_explicit_only', 'kwanzaa_explicit_only',
  'seasonal', 'festive', 'halloween', 'venue_setpiece', 'source_base_mesh_not_styled',
]);

const GENERIC_CONTEXT_WORDS = new Set(['food', 'dining', 'music', 'listening', 'lounge', 'room', 'counter', 'set', 'corner', 'parlor', 'stalls', 'cafe', 'holiday']);
const words = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);

export interface ContextualInstallation {
  readonly layoutId: string;
  readonly activation: string;
  readonly placeId: string;
  /** Which verified fact or explicit opt-in activated it. */
  readonly basis: string;
  /** False when the renderer has no 3D layer: eligible, but not drawn. */
  readonly rendered: boolean;
}

/** A context-specific layout, only from verified venue facts or explicit opt-in. */
export function contextualInstallation(
  venue: VenueContext | null, index: AssetTagIndex | null, seed: string, has3d: boolean,
): ContextualInstallation | null {
  if (!venue || !index) return null;
  const facts = new Set([...(venue.cuisines ?? []), ...(venue.music ?? [])].flatMap(words));
  const candidates: Array<{ id: string; activation: string; basis: string; specificity: number }> = [];
  for (const layout of index.layouts.values()) {
    if (layout.activation === 'explicit_holiday_request_only') {
      const name = layout.id.split('_')[0];
      if (venue.observanceOptIn && words(venue.observanceOptIn).includes(name)) candidates.push({ id: layout.id, activation: layout.activation, basis: `explicit opt-in: ${name}`, specificity: 10 });
      continue;
    }
    if (!venue.verified) continue;
    if (layout.activation === 'explicit_or_verified_seasonal_context') {
      if (venue.seasonal && layout.id.startsWith(venue.seasonal)) candidates.push({ id: layout.id, activation: layout.activation, basis: `verified seasonal: ${venue.seasonal}`, specificity: 1 });
      continue;
    }
    if (layout.activation !== 'explicit_or_verified_context') continue;
    const specific = words(layout.context).filter((w) => !GENERIC_CONTEXT_WORDS.has(w));
    if (specific.length && specific.every((w) => facts.has(w))) {
      candidates.push({ id: layout.id, activation: layout.activation, basis: `verified venue facts: ${specific.join(' ')}`, specificity: specific.length });
    }
  }
  if (!candidates.length) return null;
  const top = Math.max(...candidates.map((c) => c.specificity));
  const best = shuffled(candidates.filter((c) => c.specificity === top).sort((a, b) => (a.id < b.id ? -1 : 1)), seed, 'contextual')[0];
  return { layoutId: best.id, activation: best.activation, placeId: venue.placeId, basis: best.basis, rendered: has3d };
}

export interface DecorPlan {
  readonly visible: boolean;
  readonly hiddenReason: string | null;
  readonly families: readonly { readonly id: string; readonly weight: number; readonly assetIds: readonly string[] }[];
  /** Vibe set piece chosen by the compiler (source of truth). */
  readonly setPiece: SetPiece | null;
  readonly contextual: ContextualInstallation | null;
  readonly maxInstances: number;
  readonly distribution: DecorIntent['distribution'];
  readonly anchor: DecorIntent['anchor'];
  readonly placement: {
    readonly radiusMeters: number;
    readonly minSpacingMeters: number;
    /** Never place over these. */
    readonly avoid: readonly string[];
    /** Deterministic placement seed for renderers. */
    readonly seed: string;
  };
  readonly motion: DecorIntent['motion'];
  /** Overlay textures the compiler attached (verified SVG IDs). */
  readonly overlayKeys: readonly SceneKey[];
}

export function resolveDecor(
  intent: DecorIntent, state: SceneState, context: SceneContext, seed: string, venue: VenueContext | null,
  index: AssetTagIndex | null, has3d: boolean,
): DecorPlan {
  const navigating = context.navigation !== 'browse';
  const families = intent.families.map((f) => {
    const wanted = new Set(FAMILY_TAGS[f.id] ?? []);
    const ids = index
      ? [...index.models.entries()]
          .filter(([, tags]) => tags.some((t) => wanted.has(t)) && !tags.some((t) => RESTRICTED_TAGS.has(t)))
          .map(([id]) => id)
          .sort()
      : [];
    return { id: f.id, weight: f.weight, assetIds: shuffled(ids, seed, `family:${f.id}`).slice(0, 6) };
  });
  const maxInstances = navigating ? 0 : Math.round(intent.density * 24);
  return {
    visible: !navigating && maxInstances > 0,
    hiddenReason: navigating ? `hidden while ${context.navigation} is shown (navigation policy)` : maxInstances === 0 ? 'density 0 (no signal yet, or low confidence)' : null,
    families,
    setPiece: state.setPiece,
    contextual: navigating ? null : contextualInstallation(venue, index, seed, has3d),
    maxInstances,
    distribution: intent.distribution,
    anchor: intent.anchor,
    placement: {
      radiusMeters: intent.distribution === 'clustered' ? 120 : intent.distribution === 'ring_around_focus' ? 220 : 400,
      minSpacingMeters: intent.distribution === 'clustered' ? 18 : 40,
      avoid: ['route_corridor', 'transit_stops', 'recommendation_pins', 'labels', 'selected_destination'],
      seed: `${seed}:decor`,
    },
    motion: context.reducedMotion ? 'static' : intent.motion,
    overlayKeys: state.overlays.map((o) => o.key),
  };
}
