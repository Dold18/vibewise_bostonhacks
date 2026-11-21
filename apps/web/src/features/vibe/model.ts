/**
 * Headless vibe-preference model v0.
 *
 * These are preferences for this outing, not personality traits. Their evidence
 * strengths are heuristic priorities, never calibrated probabilities.
 */
export const VIBE_AXES = [
  'energy',
  'social',
  'setting',
  'lighting',
  'aesthetic',
  'formality',
  'outing',
] as const;

export type VibeAxis = (typeof VIBE_AXES)[number];
export type EvidenceSource = 'text' | 'quiz' | 'unset';

export interface AxisEstimate {
  /** -1 = first endpoint of the axis, +1 = second, 0 = no evidence/preference. */
  value: number;
  /** 0..1 heuristic evidence strength, not a statistical confidence. */
  strength: number;
  source: EvidenceSource;
  /** Words/phrases supporting text evidence; never exposed as verified venue attributes. */
  evidence: string[];
  /** Opposing clues found in the same description; a question can resolve these. */
  conflicted: boolean;
  /** Explicitly indifferent, as opposed to having insufficient information. */
  neutral: boolean;
}

export type VibeEstimates = Record<VibeAxis, AxisEstimate>;

const TEXT_HINTS: Record<VibeAxis, { low: readonly string[]; high: readonly string[] }> = {
  energy: {
    low: ['calm', 'peaceful', 'low-key', 'low key', 'chill', 'laid-back', 'laid back', 'relaxing', 'mellow'],
    high: ['energetic', 'electric', 'buzzing', 'high-energy', 'upbeat', 'exciting', 'lively', 'pulsing', 'vibrant'],
  },
  social: {
    low: ['intimate', 'private', 'uncrowded', 'secluded', 'one-on-one', 'small group', 'quiet enough to talk'],
    high: ['bustling', 'crowded', 'crowds', 'social', 'packed', 'busy', 'party atmosphere', 'lots of people'],
  },
  setting: {
    low: ['indoor', 'indoors', 'inside', 'interior', 'tucked away'],
    high: ['outdoor', 'outdoors', 'outside', 'open air', 'waterfront', 'park', 'trees', 'fresh air', 'beach'],
  },
  lighting: {
    low: ['dim', 'dark', 'low-lit', 'low lighting', 'low light', 'candlelit', 'candlelight', 'moody lighting'],
    high: ['bright', 'sunny', 'sunlight', 'sunshine', 'well-lit', 'well lit', 'natural light', 'airy'],
  },
  aesthetic: {
    low: ['vintage', 'nostalgic', 'historic', 'retro', 'antique', 'old-fashioned', 'old fashioned', 'cobblestone'],
    high: ['modern', 'futuristic', 'sleek', 'minimalist', 'contemporary', 'clean lines', 'high-tech'],
  },
  formality: {
    low: ['casual', 'unpretentious', 'relaxed dress', 'informal', 'not fancy', 'low-maintenance'],
    high: ['upscale', 'fancy', 'formal', 'elegant', 'luxurious', 'luxury', 'sophisticated', 'high-end'],
  },
  outing: {
    low: ['unhurried', 'stay awhile', 'sit and talk', 'slow-paced', 'slow paced', 'stroll', 'lingering'],
    high: ['adventurous', 'adventure', 'explore', 'exploring', 'spontaneous', 'active', 'interactive', 'games', 'thrilling'],
  },
};

export const emptyAxis = (): AxisEstimate => ({
  value: 0, strength: 0, source: 'unset', evidence: [], conflicted: false, neutral: false,
});

export function emptyVibeEstimates(): VibeEstimates {
  return Object.fromEntries(VIBE_AXES.map(axis => [axis, emptyAxis()])) as VibeEstimates;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns word-bounded phrase hits without treating 'social' as part of 'antisocial'. */
function findPhraseHits(text: string, phrase: string): { at: number; text: string }[] {
  const pattern = new RegExp(`(^|[^a-z])(${escapeRegExp(phrase)})(?=$|[^a-z])`, 'g');
  return Array.from(text.matchAll(pattern), match => ({
    at: (match.index ?? 0) + match[1].length,
    text: match[2],
  }));
}

/**
 * Conservative local negation. Handles 'not fancy', 'not too crowded',
 * 'avoid crowds', and 'without loud music'. Beyond this small grammar we
 * deliberately refrain from claiming general language understanding.
 */
function isNegated(text: string, at: number): boolean {
  const lead = text.slice(Math.max(0, at - 40), at);
  const clause = lead.split(/[,.!?;:\n]/).at(-1) ?? '';
  return /\b(?:not|no|avoid|avoiding|without|rather than|don't want|do not want)\s+(?:(?:too|very|much|a|an|the|super|really)\s+){0,2}$/.test(clause);
}

export function inferTextVibe(input: string): VibeEstimates {
  const text = input.toLowerCase().replace(/[’‘]/g, "'").slice(0, 2000);
  const result = emptyVibeEstimates();

  for (const axis of VIBE_AXES) {
    const signals: Array<{ direction: -1 | 1; label: string }> = [];
    for (const [side, words] of [
      [-1, TEXT_HINTS[axis].low],
      [1, TEXT_HINTS[axis].high],
    ] as const) {
      for (const word of words) {
        // 'not fancy' is handled by the regular fancy rule (negated).
        if (word.startsWith('not ')) continue;
        for (const hit of findPhraseHits(text, word)) {
          signals.push({ direction: (isNegated(text, hit.at) ? -side : side) as -1 | 1, label: hit.text });
        }
      }
    }
    if (!signals.length) continue;
    const balance = signals.reduce((sum, sig) => sum + sig.direction, 0) / signals.length;
    const conflicted = signals.some(s => s.direction === -1) && signals.some(s => s.direction === 1);
    result[axis] = {
      value: balance,
      // Opposing evidence should trigger clarification, not false certainty.
      strength: Math.min(0.8, signals.length * 0.28) * Math.abs(balance),
      source: 'text',
      evidence: [...new Set(signals.map(sig => sig.label))],
      conflicted,
      neutral: false,
    };
  }

  return result;
}

export function normalizedAxisTags(axes: VibeEstimates): Partial<Record<VibeAxis, number>> {
  const tags: Partial<Record<VibeAxis, number>> = {};
  for (const axis of VIBE_AXES) {
    const estimate = axes[axis];
    if (estimate.strength <= 0 || estimate.neutral) continue;
    tags[axis] = Math.max(0, Math.min(1, (estimate.value + 1) / 2));
  }
  return tags;
}
