/**
 * A user's vibe taste, derived from their recorded vibe history.
 *
 * Recent readings count more: an event's weight halves every HALF_LIFE_DAYS.
 * A vibe's taste is its weighted mean over *all* events, a missing key
 * counting as 0, so a vibe that keeps coming up beats one rare strong score.
 * `strength` says how much history there is to go on, from 0 (none) to 1.
 */
import { VIBE_KEYS, type VibeKey, type VibeScores, type VibeSource } from './vibes';

export const HALF_LIFE_DAYS = 14;
/** Total event weight at which the theme reaches full strength (~5 recent readings). */
export const FULL_STRENGTH_WEIGHT = 5;
export const TOP_VIBE_THRESHOLD = 0.35;
export const MAX_TOP_VIBES = 3;

const DAY_MS = 86_400_000;

export interface VibeEvent {
  id: number;
  /** ISO 8601. */
  createdAt: string;
  source: VibeSource;
  scores: VibeScores;
  placeId: string | null;
}

export interface Taste {
  /**
   * `Pick<VibeProfile, 'userId' | 'tags'>` from docs/CONTRACTS.md. The theme
   * reads only `tags`, so the Vibe workstream can replace how it's derived.
   */
  profile: { userId: string; tags: Record<VibeKey, number> };
  strength: number;
  topVibes: { key: VibeKey; score: number }[];
  /** True when sample (`dev`) readings contributed. */
  hasSample: boolean;
}

export function computeTaste(userId: string, events: VibeEvent[], now: Date, opts: { includeDev: boolean }): Taste {
  const sums = Object.fromEntries(VIBE_KEYS.map((k) => [k, 0])) as Record<VibeKey, number>;
  let totalWeight = 0;
  let hasSample = false;
  for (const e of events) {
    if (e.source === 'dev' && !opts.includeDev) continue;
    const ageDays = Math.max(0, (now.getTime() - Date.parse(e.createdAt)) / DAY_MS);
    const weight = 0.5 ** (ageDays / HALF_LIFE_DAYS);
    if (!Number.isFinite(weight)) continue; // unparseable timestamp
    totalWeight += weight;
    if (e.source === 'dev') hasSample = true;
    for (const key of VIBE_KEYS) sums[key] += weight * (e.scores[key] ?? 0);
  }
  const tags = Object.fromEntries(
    VIBE_KEYS.map((k) => [k, totalWeight > 0 ? sums[k] / totalWeight : 0]),
  ) as Record<VibeKey, number>;
  return {
    profile: { userId, tags },
    strength: Math.min(1, totalWeight / FULL_STRENGTH_WEIGHT),
    topVibes: topVibesOf(tags),
    hasSample,
  };
}

/** Vibes at or above the threshold, strongest first (ties in vocabulary order), at most MAX_TOP_VIBES. */
export function topVibesOf(tags: Record<VibeKey, number>): { key: VibeKey; score: number }[] {
  return VIBE_KEYS.map((key) => ({ key, score: tags[key] ?? 0 }))
    .filter((v) => v.score >= TOP_VIBE_THRESHOLD)
    .sort((a, b) => b.score - a.score) // stable: ties keep vocabulary order
    .slice(0, MAX_TOP_VIBES);
}
