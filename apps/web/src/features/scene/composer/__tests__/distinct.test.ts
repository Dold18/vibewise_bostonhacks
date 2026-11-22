import { describe, expect, it } from 'vitest';
import { composeWorld } from '../compose';
import { interpretSignals } from '../signals';

const world = (text: string, seed = '424242') => composeWorld({ text: [text], progression: { answers: 6 } }, seed);
const values = (text: string) => new Set(world(text).assignments.map((a) => `${a.key}=${a.value}`));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((x) => b.has(x)).length;
  return shared / (a.size + b.size - shared);
};

const VIBES = [
  'nostalgic warm jazz evening', 'futuristic synthwave arcade', 'haunted but romantic', 'peaceful botanical afternoon',
  'bright playful outing', 'cozy rainy bookstore atmosphere', 'dark cinematic noir', 'energetic but intimate', 'ramen and dumplings',
];

describe('vocabulary coverage', () => {
  it('recognizes everyday words for energy, time of day, weather, colour, activity and texture', () => {
    const words = `energetic energy exciting thrilling dynamic buzzy sultry sexy steamy dark dim dramatic quirky bohemian edgy psychedelic chaotic
      earthy lush tropical hot humid cold windy colorful vivid muted faded monochrome glossy sparkly glitter dancing club karaoke concert
      hiking picnic rooftop morning sunrise afternoon noon sunset dusk twilight euphoric uplifting sleepy lazy nerdy adventurous festive drinks`.split(/\s+/);
    const missing = words.filter((w) => !interpretSignals({ text: [w] }).recognized.length);
    expect(missing).toEqual([]);
  });

  it('keeps contrasting qualities on independent axes ("energetic but intimate" is both)', () => {
    const s = interpretSignals({ text: ['energetic but intimate'] }).style;
    expect(s.energy).toBeGreaterThan(0.3);
    expect(s.intimacy).toBeGreaterThan(0.3);
    expect(interpretSignals({ text: ['calm and intimate'] }).style.energy).toBeLessThan(-0.3);
  });

  it('reads time of day and weather from free text as hints', () => {
    expect(interpretSignals({ text: ['picnic at sunset'] }).hints.dusk).toBeGreaterThan(0.5);
    expect(interpretSignals({ text: ['a crisp morning walk'] }).hints.morning).toBeGreaterThan(0.5);
    expect(interpretSignals({ text: ['hot humid afternoon'] }).hints.summer).toBeGreaterThan(0.3);
  });

  it('still never styles a national cuisine: only the dish mode counts', () => {
    const i = interpretSignals({ text: ['ramen and dumplings'] });
    expect(i.culturalTerms).toContain('ramen');
    expect(i.recognized.map((r) => r.entry)).toEqual(['steam']);
    expect(interpretSignals({ text: ['ramen'] }).recognized).toEqual([]);
  });
});

describe('world distinctness', () => {
  it('composes clearly different worlds for the acceptance vibes', () => {
    const sets = VIBES.map(values);
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      const s = jaccard(sets[i]!, sets[j]!);
      max = Math.max(max, s);
      sum += s;
      n++;
    }
    // Measured: max 0.41, mean 0.164 (before the vocabulary and energy-axis fixes: 0.61 and 0.185).
    expect(max).toBeLessThanOrEqual(0.45);
    expect(sum / n).toBeLessThanOrEqual(0.18);
  });

  it('lets energy change the drawn world, not only the style point', () => {
    const picks = (t: string) => new Map(world(t).picks.map((p) => [p.slot, p.component]));
    const calm = picks('calm cozy wine bar');
    const lively = picks('energetic lively wine bar');
    const differing = [...calm].filter(([slot, c]) => lively.get(slot) !== c).map(([slot]) => slot);
    expect(differing.length).toBeGreaterThanOrEqual(4);
  });
});
