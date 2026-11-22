/**
 * Deterministic, no-model routes into the compiler (design §4: the map must not
 * depend on a successful LLM response).
 *
 * - descriptors ("moody", "rain-lit", or the account vibe keys the adaptive
 *   engine currently emits) → weighted presets;
 * - saved account taste (`VibeKey` scores + strength) → weighted presets.
 *
 * These only choose an art direction. They are never venue-ranking features.
 */
import type { VibeKey } from '../account/vibes';
import type { WeightedPreset } from './intent';
import type { ScenePresetId } from './presets';

type Pull = Partial<Record<ScenePresetId, number>>;

/** Account vibe vocabulary → art direction. */
export const VIBE_KEY_PRESETS: Readonly<Record<VibeKey, Pull>> = {
  cozy: { amber_refuge: 1 },
  lively: { neon_city: 0.6, sunlit_coast: 0.4 },
  upscale: { noir_jazz: 0.5, minimal_modern: 0.5 },
  divey: { underground_indie: 1 },
  aesthetic: { dream_pastel: 0.6, retro_atlas: 0.4 },
  quiet: { woodland_story: 0.5, minimal_modern: 0.5 },
  date_night: { noir_jazz: 0.55, amber_refuge: 0.45 },
  group_friendly: { sunlit_coast: 0.5, retro_atlas: 0.5 },
  late_night: { neon_city: 0.6, noir_jazz: 0.4 },
  outdoor: { sunlit_coast: 0.6, woodland_story: 0.4 },
};

/** Word stems (matched at word starts) → art direction. Order is irrelevant; matching is set-based. */
const WORDS: ReadonlyArray<readonly [RegExp, Pull]> = [
  [/^(cozy|cosy|snug|hygge|warm|amber|lamp|candle|fireside|bookish|book|refuge|comfort)/, { amber_refuge: 1 }],
  [/^(noir|jazz|smoky|moody|midnight|speakeasy|velvet|cinematic|intimate|sultry)/, { noir_jazz: 1 }],
  [/^(neon|cyber|electric|synth|arcade|glow|futur|rave$|club|rain$|rainy$|raining$|rainlit$)/, { neon_city: 1 }],
  [/^(dream|pastel|whimsi|ethereal|soft|fairy|magic|romantic|blush)/, { dream_pastel: 1 }],
  [/^(sun|bright|airy$|beach|coast|harbor|harbour|waterfront|sea$|seaside|breez|summer|picnic)/, { sunlit_coast: 1 }],
  [/^(wood|forest|garden|green|leaf|leafy|nature|storybook|calm|peace|tranquil|cottage)/, { woodland_story: 1 }],
  [/^(indie|underground|gritty|grunge|punk|raw$|dive$|dives$|divey$|zine|basement|diy$)/, { underground_indie: 1 }],
  [/^(retro|vintage|nostalg|antique|historic|old$|olde$|classic|atlas|heritage)/, { retro_atlas: 1 }],
  [/^(minimal|modern|sleek|clean|contemporary|crisp|gallery|architect)/, { minimal_modern: 1 }],
];

/** How present a descriptor-only scene is (the adaptive engine uses 0.6 for its preview too). */
export const DESCRIPTOR_PRESENCE = 0.6;

function topPresets(pulls: Map<ScenePresetId, number>, presence: number, max = 3): WeightedPreset[] {
  const ranked = [...pulls].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
  const total = ranked.reduce((s, [, w]) => s + w, 0);
  if (total <= 0 || presence <= 0) return [];
  return ranked.map(([id, w]) => ({ id, weight: Math.round((w / total) * Math.min(1, presence) * 1000) / 1000 }));
}

function add(into: Map<ScenePresetId, number>, pull: Pull, scale: number) {
  for (const [id, w] of Object.entries(pull) as [ScenePresetId, number][]) into.set(id, (into.get(id) ?? 0) + w * scale);
}

const VIBE_KEYS = new Set(Object.keys(VIBE_KEY_PRESETS));

/** Descriptors → up to three presets whose weights sum to `presence`. Unknown words are ignored. */
export function presetsFromDescriptors(descriptors: readonly string[], presence = DESCRIPTOR_PRESENCE): WeightedPreset[] {
  const pulls = new Map<ScenePresetId, number>();
  for (const d of descriptors) {
    const phrase = d.toLowerCase().trim();
    if (VIBE_KEYS.has(phrase)) {
      add(pulls, VIBE_KEY_PRESETS[phrase as VibeKey], 1);
      continue;
    }
    // Each preset counts once per descriptor, however many of its words appear.
    const hit = new Map<ScenePresetId, number>();
    for (const word of phrase.split(/[^a-z]+/).filter(Boolean)) {
      for (const [stem, pull] of WORDS) if (stem.test(word)) for (const [id, w] of Object.entries(pull)) hit.set(id as ScenePresetId, w);
    }
    for (const [id, w] of hit) pulls.set(id, (pulls.get(id) ?? 0) + w);
  }
  return topPresets(pulls, presence);
}

/** Saved account taste (as vibeTheme's ThemeTarget: tags + strength) → presets. */
export function presetsFromVibeTags(tags: Partial<Record<VibeKey, number>>, strength: number): WeightedPreset[] {
  const pulls = new Map<ScenePresetId, number>();
  for (const [key, score] of Object.entries(tags) as [VibeKey, number][]) {
    if (!VIBE_KEYS.has(key) || !Number.isFinite(score) || score <= 0) continue;
    add(pulls, VIBE_KEY_PRESETS[key], Math.min(1, score));
  }
  // Like vibeTheme's blend: a weak top vibe gives a faint scene, whatever the strength.
  const top = Math.max(0, ...Object.values(tags).filter((v): v is number => Number.isFinite(v)).map((v) => Math.min(1, v)));
  return topPresets(pulls, (Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0) * top);
}
