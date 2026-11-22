import { describe, expect, it } from 'vitest';
import { decodeEvidence, encodeEvidence, themeEvidence, type Theme } from '../evidence';
import { evidenceFor } from '../../../city/composer';

const themes = (text: string, avoid: string[] = []): Theme[] => themeEvidence([{ text, source: 'vibe' }], avoid).map((e) => e.theme);

describe('explicit theme evidence', () => {
  it('derived moods never authorize a theme', () => {
    for (const text of [
      'quiet romantic evening', 'dark moody noir', 'mysterious night out', 'cozy rainy bookstore', 'a winter walk in the snow',
      'jazz and candlelight', 'italian dinner', 'ramen and dumplings', 'bright playful outing', 'something weird lol', 'surprise me',
      'peaceful afternoon in Boston', 'energetic but intimate', 'magical enchanted evening', 'open space to think', 'fun night with friends',
    ]) expect(themes(text), text).toEqual([]);
  });

  it('explicit requests authorize exactly their theme', () => {
    expect(themes('Haunted Boston')).toEqual(['spooky']);
    expect(themes('Christmas in Boston')).toEqual(['winter_holiday']);
    expect(themes('halloween party')).toEqual(['spooky', 'halloween', 'festive']);
    expect(themes('cyberpunk nightlife')).toEqual(['cyberpunk']);
    expect(themes('a sci-fi night')).toEqual(['cyberpunk', 'scifi']);
    expect(themes('neon arcade')).toEqual(['cyberpunk', 'arcade']);
    expect(themes('harbor walk with seafood')).toEqual(['nautical']);
    expect(themes('storybook fairy tale garden')).toEqual(['fantasy']);
  });

  it('negation and avoid lists remove a theme, even when it is mentioned elsewhere', () => {
    expect(themes('a cozy night, nothing spooky')).toEqual([]);
    expect(themes('not christmas please')).toEqual([]);
    expect(themes('haunted pub crawl', ['no ghosts'])).toEqual([]);
  });

  it('records the term and where it came from, and round-trips through SceneContext', () => {
    const list = themeEvidence([{ text: 'quiet bar', source: 'vibe' }, { text: 'maybe something haunted', source: 'answer' }]);
    expect(list).toEqual([{ theme: 'spooky', term: 'haunted', source: 'answer' }]);
    expect(decodeEvidence(encodeEvidence(list))).toEqual(list);
    expect(decodeEvidence(['bogus|x|vibe', 'spooky|ghost|elsewhere'])).toEqual([]);
  });

  it('the city composer reads only the user\'s words: vibe first, then answers, minus avoids', () => {
    expect(evidenceFor({ text: ['Christmas in Boston', 'more lights'], avoid: [] })).toEqual(['winter_holiday|christmas|vibe']);
    expect(evidenceFor({ text: ['cozy evening'], mood: ['haunted'], avoid: [] })).toEqual(['spooky|haunted|answer']);
    expect(evidenceFor({ text: ['haunted harbor'], avoid: ['ghosts'] })).toEqual(['nautical|harbor|vibe']);
    expect(evidenceFor(null)).toEqual([]);
  });
});
