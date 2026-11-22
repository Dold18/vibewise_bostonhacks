import { compileScene, MAP_RENDERER_V1, PRESET_IDS, type ScenePresetId } from '../../scene';
import type { SceneState } from '../../scene/state';
import { withSurfaceCapabilities } from '../capabilities';

export const SURFACE_PROFILE = withSurfaceCapabilities(MAP_RENDERER_V1);

/** A compiled scene for presets (+ optional overrides), rendered with the surface capabilities. */
export function scene(
  presets: Array<[ScenePresetId, number]>,
  overrides: Array<{ key: string; value: string; strength?: number }> = [],
  capabilities = SURFACE_PROFILE,
): SceneState {
  return compileScene({
    outing: {
      schemaVersion: '1.0.0',
      sessionVersion: 1,
      presets: presets.map(([id, weight]) => ({ id, weight })),
      descriptors: [],
      overrides: overrides.map((o) => ({ strength: 1, ...o })),
    } as never,
    capabilities,
  });
}

export const WORLDS = PRESET_IDS.filter((id) => id !== 'neutral');
