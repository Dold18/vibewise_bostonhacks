/** Map atmosphere follows the quiz's accepted interpretation through the Scene Composer's
 * existing, documented input: an optional, untrusted `sceneIntent` on the published profile
 * (see features/scene/profiles.ts). The Composer validates it and keeps ownership of rendering.
 * This is art direction only. It never changes venue ranking, pin prominence or geography. */
import { intentFromProfile, presenceFor } from '../../scene/profiles.ts';
import { SCENE_SCHEMA_VERSION, type SceneIntent } from '../../scene/intent.ts';
import type { ScenePresetId } from '../../scene/presets.ts';
import type { OutingVibeProfile } from '../profile.ts';
import { presentationOf } from './presentation.ts';
import type { Mood } from './types.ts';

type Mix = readonly (readonly [ScenePresetId, number])[];
export const MOOD_PRESETS: Record<Mood, Mix> = {
  neon_noir: [['neon_city', 0.7], ['noir_nocturne', 0.3]],
  candlelit_gothic: [['noir_nocturne', 0.6], ['amber_refuge', 0.4]],
  warm_amber: [['amber_refuge', 1]],
  sunlit: [['sunlit_coast', 1]],
  // A party is not inherently neon: lead with the underground/retro presets.
  electric_party: [['underground_indie', 0.5], ['retro_atlas', 0.3], ['neon_city', 0.2]],
  misty_blue: [['noir_nocturne', 0.5], ['minimal_modern', 0.5]],
  dreamy_pastel: [['dream_pastel', 1]],
  deep_forest: [['woodland_story', 1]],
  retro_film: [['retro_atlas', 1]],
  starlit: [['noir_nocturne', 0.5], ['dream_pastel', 0.5]],
};

/** The interpretation's mood once at least one answer has been committed; previews never count. */
export function acceptedMood(p: Pick<OutingVibeProfile, 'history' | 'question'>): Mood | undefined {
  if (!p.history.length) return;
  const q = p.question && presentationOf(p.question) ? p.question : [...p.history].reverse().map((a) => a.question).find((x) => presentationOf(x));
  return q ? presentationOf(q)!.mood : undefined;
}

/** Built with the Scene Composer's own SceneIntent type; the Scene Session still sanitizes it as untrusted input. */
export function sceneIntentFor(p: OutingVibeProfile): SceneIntent | undefined {
  const mood = acceptedMood(p);
  if (!mood) return undefined;
  const fallback = intentFromProfile(p);
  const presence = presenceFor(p.history.length);
  const weights = new Map<ScenePresetId, number>();
  for (const [id, w] of MOOD_PRESETS[mood]) weights.set(id, (weights.get(id) ?? 0) + w * 0.65);
  const fallbackTotal = fallback.presets.reduce((s, x) => s + x.weight, 0) || 1;
  for (const x of fallback.presets) weights.set(x.id, (weights.get(x.id) ?? 0) + (x.weight / fallbackTotal) * 0.35);
  const top = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const total = top.reduce((s, [, w]) => s + w, 0);
  return {
    schemaVersion: SCENE_SCHEMA_VERSION, sessionVersion: p.version,
    presets: top.map(([id, w]) => ({ id, weight: Math.round((w / total) * presence * 1000) / 1000 })),
    descriptors: fallback.descriptors, overrides: [],
  };
}
