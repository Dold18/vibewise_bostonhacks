/**
 * The vibe vocabulary v1 (docs/DATA_MODEL.md §3) and validation for scores
 * coming from any producer (Vibe Engine, dev hook). Same keys and bounds as
 * the database's `is_valid_vibe_scores` check.
 */

export const VIBE_KEYS = [
  'cozy',
  'lively',
  'upscale',
  'divey',
  'aesthetic',
  'quiet',
  'date_night',
  'group_friendly',
  'late_night',
  'outdoor',
] as const;
export type VibeKey = (typeof VIBE_KEYS)[number];

/** A vibe reading: any subset of the vocabulary, each value in [0, 1]. */
export type VibeScores = Partial<Record<VibeKey, number>>;

export const VIBE_VOCAB_VERSION = 1;

export const VIBE_LABELS: Record<VibeKey, string> = {
  cozy: 'Cozy',
  lively: 'Lively',
  upscale: 'Upscale',
  divey: 'Divey',
  aesthetic: 'Aesthetic',
  quiet: 'Quiet',
  date_night: 'Date night',
  group_friendly: 'Group friendly',
  late_night: 'Late night',
  outdoor: 'Outdoor',
};

/** Where a reading came from. `dev` is sample data from the dev-only hook. */
export const VIBE_SOURCES = ['quiz', 'text', 'image', 'song', 'place', 'dev'] as const;
export type VibeSource = (typeof VIBE_SOURCES)[number];

const KEYS = new Set<string>(VIBE_KEYS);

/**
 * Clean untrusted scores: unknown keys and non-finite or non-number values are
 * dropped, the rest clamped to [0, 1]. Null when nothing usable is left.
 */
export function normalizeScores(input: unknown): VibeScores | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: VibeScores = {};
  for (const [key, value] of Object.entries(input)) {
    if (!KEYS.has(key) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key as VibeKey] = Math.min(1, Math.max(0, value));
  }
  return Object.keys(out).length > 0 ? out : null;
}
