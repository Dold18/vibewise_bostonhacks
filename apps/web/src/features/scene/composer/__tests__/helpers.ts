/** Deterministic property-test generators and shared fixtures for the composer. */
import { realManifests, realRegistry } from '../../__tests__/fixtures';
import { buildAssetTagIndex } from '../decor';
import { prng } from '../random';
import { TIMES_OF_DAY, type CompositionSignals } from '../signals';

export const VOCAB = {
  mood: ['cozy', 'calm', 'moody', 'romantic', 'playful', 'whimsical', 'mysterious', 'spooky', 'electric', 'elegant', 'gritty', 'nostalgic', 'futuristic', 'minimal', 'ornate', 'misty', 'sunny', 'rainy', 'quiet', 'lively', 'dreamy', 'bookish', 'rustic', 'festive'],
  aesthetic: ['neon', 'storybook', 'watercolor', 'noir', 'cinematic', 'brutalist', 'pastel', 'comic', 'pixel art', 'vintage', 'gilded', 'cottage', 'industrial', 'synthwave'],
  music: ['jazz', 'lofi', 'classical', 'folk', 'punk', 'techno', 'synthwave', 'soul', 'ambient', 'indie', 'disco', 'hip hop', 'salsa', 'metal'],
  cuisine: ['noodle soup', 'pastry', 'dessert', 'cocktails', 'brewery', 'oysters', 'bbq', 'vegan', 'street food', 'tasting menu', 'diner', 'tea', 'italian', 'sushi'],
  experience: ['date night', 'study', 'wander', 'celebrate', 'catch up with friends', 'people watch', 'unwind'],
} as const;

const pickN = <T>(next: () => number, items: readonly T[], max: number): T[] => {
  const n = Math.floor(next() * (max + 1));
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const v = items[Math.floor(next() * items.length)];
    if (!out.includes(v)) out.push(v);
  }
  return out;
};

/** A reproducible random combination of inputs (most combinations were never authored by anyone). */
export function randomSignals(seed: string, i: number): CompositionSignals {
  const next = prng(seed, `signals-${i}`);
  const s: CompositionSignals = {
    mood: pickN(next, VOCAB.mood, 3),
    aesthetic: pickN(next, VOCAB.aesthetic, 2),
    music: pickN(next, VOCAB.music, 1),
    cuisine: pickN(next, VOCAB.cuisine, 1),
    experience: pickN(next, VOCAB.experience, 1),
    timeOfDay: next() < 0.6 ? TIMES_OF_DAY[Math.floor(next() * TIMES_OF_DAY.length)] : null,
    energy: next() < 0.5 ? Math.round(next() * 100) / 100 : null,
    social: next() < 0.3 ? Math.round(next() * 100) / 100 : null,
    progression: { answers: Math.floor(next() * 11) },
  };
  return s;
}

/** Combinations guaranteed to say something the lexicon understands. */
export function sweep(n: number, seed = 'sweep'): CompositionSignals[] {
  const out: CompositionSignals[] = [];
  for (let i = 0; out.length < n; i++) {
    const s = randomSignals(seed, i);
    const words = [...(s.mood ?? []), ...(s.aesthetic ?? []), ...(s.music ?? [])];
    if (words.length) out.push(s);
  }
  return out;
}

export const assetIndex = () => buildAssetTagIndex(realManifests());
export const registry = () => realRegistry().registry;

/** Slot → component, the structural fingerprint of a world. */
export const fingerprint = (c: { picks: readonly { slot: string; component: string }[] }) => c.picks.map((p) => `${p.slot}:${p.component}`).join('|');
export const slotDiff = (a: { picks: readonly { component: string }[] }, b: { picks: readonly { component: string }[] }) =>
  a.picks.reduce((n, p, i) => n + (p.component !== b.picks[i].component ? 1 : 0), 0);
