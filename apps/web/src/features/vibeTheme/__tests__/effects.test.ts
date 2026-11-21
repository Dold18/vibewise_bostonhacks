import { describe, expect, it } from 'vitest';
import { VIBE_KEYS, type VibeKey } from '../../account/vibes';
import { EFFECT_VIBES, effectLayers } from '../effects';

const tagsOf = (scores: Partial<Record<VibeKey, number>>) =>
  ({ ...Object.fromEntries(VIBE_KEYS.map((k) => [k, 0])), ...scores }) as Record<VibeKey, number>;

describe('effectLayers', () => {
  it('shows at most two vibes, strongest first, opacity = score × strength', () => {
    expect(EFFECT_VIBES).toBe(2);
    expect(effectLayers(tagsOf({ cozy: 0.9, quiet: 0.6, outdoor: 0.5 }), 0.5)).toEqual([
      { key: 'cozy', opacity: 0.45 },
      { key: 'quiet', opacity: 0.3 },
    ]);
  });

  it('rounds opacity to two decimals', () => {
    expect(effectLayers(tagsOf({ lively: 0.777 }), 1)).toEqual([{ key: 'lively', opacity: 0.78 }]);
  });

  it('is empty when no vibe reaches the threshold or strength is 0', () => {
    expect(effectLayers(tagsOf({ cozy: 0.2 }), 1)).toEqual([]);
    expect(effectLayers(tagsOf({ cozy: 0.9 }), 0)).toEqual([]);
  });
});
