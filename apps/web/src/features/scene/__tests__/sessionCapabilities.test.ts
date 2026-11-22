import { describe, expect, it } from 'vitest';
import { MAP_RENDERER_V1, SCENE_ADAPTER_V1 } from '../capabilities';
import { createSceneSession, type SceneUpdate } from '../session';
import { intent } from './fixtures';

const RAIN = { key: 'air_and_atmosphere.rain', value: 'drizzle', intensity: 0.7 };
const withRain = Object.freeze({
  id: 'with-rain',
  values: new Map([...MAP_RENDERER_V1.values, ['air_and_atmosphere.rain', new Set(['drizzle'])]]),
  features: MAP_RENDERER_V1.features,
});

describe('SceneSession.setCapabilities', () => {
  it('recompiles against the new profile without serving looks cached under the old one', () => {
    const session = createSceneSession({ capabilities: withRain });
    const updates: SceneUpdate[] = [];
    session.subscribe((u) => updates.push(u));
    session.submit('s', 1, intent([['noir_nocturne', 0.5]], { overrides: [RAIN] }));
    expect(session.getState().resolved['air_and_atmosphere.rain']).toBe('drizzle');

    session.setCapabilities(MAP_RENDERER_V1); // the rain renderer was retired
    expect(session.getState().resolved['air_and_atmosphere.rain']).toBe('off');
    expect(session.getState().capabilityProfile).toBe(MAP_RENDERER_V1.id);
    expect(updates.at(-1)!.reason).toBe('context');

    session.setCapabilities(withRain); // and came back
    expect(session.getState().resolved['air_and_atmosphere.rain']).toBe('drizzle');
  });

  it('is a no-op for the same profile and after destroy', () => {
    const session = createSceneSession({ capabilities: SCENE_ADAPTER_V1 });
    const before = session.stats().compiles;
    session.setCapabilities(SCENE_ADAPTER_V1);
    expect(session.stats().compiles).toBe(before);
    session.destroy();
    expect(() => session.setCapabilities(MAP_RENDERER_V1)).not.toThrow();
  });
});
