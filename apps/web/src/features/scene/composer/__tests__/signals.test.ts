import { describe, expect, it } from 'vitest';
import { confidenceFor, interpretSignals, tokenize } from '../signals';

describe('interpretSignals', () => {
  it('returns a neutral interpretation for nothing, garbage, or unknown words', () => {
    for (const raw of [null, undefined, {}, { mood: [42, null] }, { mood: ['qwertyuiop'] }] as unknown[]) {
      const i = interpretSignals(raw as never);
      expect(i.presence).toBe(0);
      expect(i.boldness).toBe(0);
      expect(Object.values(i.style).every((v) => v === 0)).toBe(true);
    }
    expect(interpretSignals({ mood: ['qwertyuiop'] }).ignored).toContain('qwertyuiop');
  });

  it('maps any combination into the style space', () => {
    const i = interpretSignals({ mood: ['cozy'], music: ['synthwave'], timeOfDay: 'night' });
    expect(i.style.warmth).toBeGreaterThan(0);
    expect(i.style.luminance).toBeLessThan(-0.5);
    expect(i.style.chroma).toBeGreaterThan(0);
    expect(i.hints.neon).toBeGreaterThan(0);
    expect(i.hints.night).toBeGreaterThan(0);
  });

  it('recognizes national cuisines and observances but infers no style or decoration from them', () => {
    const i = interpretSignals({ cuisine: ['italian', 'sushi'], mood: ['hanukkah', 'christmas'], text: ['a lunar new year dinner'] });
    expect(i.presence).toBe(0);
    expect(Object.keys(i.hints)).toEqual([]);
    expect(i.culturalTerms).toEqual(expect.arrayContaining(['italian', 'sushi', 'hanukkah', 'christmas', 'lunar_new_year']));
  });

  it('reads dish words as a dining mode, never as a culture', () => {
    const soup = interpretSignals({ cuisine: ['noodle soup'] });
    expect(soup.style.warmth).toBeGreaterThan(0);
    expect(soup.style.moisture).toBeGreaterThan(0);
    expect(soup.culturalTerms).toEqual([]);
  });

  it('treats negated and avoided words as things to avoid', () => {
    const negated = interpretSignals({ text: ['somewhere fun but not too neon'] });
    expect(negated.avoidTags.neon).toBeGreaterThan(0);
    expect(negated.hints.neon).toBeUndefined();
    const avoided = interpretSignals({ mood: ['cozy'], avoid: ['rain'] });
    expect(avoided.avoidTags.rain).toBeGreaterThan(0);
    expect(avoided.style.moisture).toBeLessThan(0);
  });

  it('keeps only model-editable explicit requests with documented values', () => {
    const i = interpretSignals({
      explicit: [
        { key: 'air_and_atmosphere.snow', value: 'gentle', intensity: 3 },
        { key: 'camera_and_perspective.pitch_preference', value: 'deep_3d' },
        { key: 'navigation_safe.route_treatment', value: 'high_contrast_leg_colors' },
        { key: 'air_and_atmosphere.rain', value: 'acid' },
        { key: 'air_and_atmosphere.snow', value: 'dense' },
      ],
    });
    expect(i.explicit).toEqual([{ key: 'air_and_atmosphere.snow', value: 'gentle', intensity: 1 }]);
    expect(i.ignored.length).toBe(3);
  });

  it('grows confidence with answers, and lets an explicit confidence win', () => {
    expect(confidenceFor({ answers: 0 })).toBe(0);
    expect(confidenceFor({ answers: 4 })).toBeGreaterThan(confidenceFor({ answers: 2 }));
    expect(confidenceFor({ answers: 10 })).toBeGreaterThan(0.9);
    expect(confidenceFor({ answers: 1, confidence: 0.8 })).toBe(0.8);
    expect(confidenceFor(null)).toBe(0.5);
    const early = interpretSignals({ mood: ['cozy'], progression: { answers: 0 } });
    const late = interpretSignals({ mood: ['cozy'], progression: { answers: 10 } });
    expect(late.presence).toBeGreaterThan(early.presence);
    expect(late.boldness).toBeGreaterThan(early.boldness);
    expect(late.presence).toBeLessThanOrEqual(0.85);
  });

  it('joins known phrases before matching', () => {
    expect(tokenize('Hip-hop & lo-fi after dark')).toEqual(['hip_hop', 'and', 'lo_fi', 'after_dark']);
  });

  it('only keeps verified-looking venue context and never invents an observance', () => {
    const i = interpretSignals({ mood: ['cozy'], venue: { placeId: 'p1', verified: true, cuisines: ['Ramen'], seasonal: 'monsoon' as never } });
    expect(i.venue).toEqual({ placeId: 'p1', verified: true, cuisines: ['ramen'], music: [], seasonal: null, observanceOptIn: null });
    expect(interpretSignals({ venue: { placeId: '' } as never }).venue).toBeNull();
  });
});
