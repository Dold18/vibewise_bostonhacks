/** Test helpers: recording renderers and real-pipeline scene states. */
import { vi } from 'vitest';
import { compileScene } from '../../scene/compile';
import { runtimeAssets } from '../../scene/registry';
import type { CapabilityProfile } from '../../scene/capabilities';
import type { SceneContext } from '../../scene/state';
import { intent } from '../../scene/__tests__/fixtures';
import type { ScenePresetId } from '../../scene/presets';
import type { CityRenderer, RenderFrame, RendererCapabilities, SectionId } from '../contracts';

export { runtimeAssets, intent };

/** A renderer that records every frame it receives and nothing else. */
export function recorder<S extends SectionId>(id: string, section: S, values: RendererCapabilities['values'] = {}, extra: Partial<CityRenderer<S>> = {}) {
  const frames: RenderFrame<S>[] = [];
  const dispose = vi.fn();
  const renderer: CityRenderer<S> = { id, section, capabilities: { values }, update: (f) => void frames.push(f), dispose, ...extra };
  return { renderer, frames, dispose, last: () => frames[frames.length - 1]! };
}

/** No DOM in tests: images "decode" to an empty 1×1. */
export const fakeImage = () => Promise.resolve({ width: 1, height: 1, data: new Uint8ClampedArray(4) } as unknown as ImageData);

type Override = { key: string; value: string; intensity?: number };

/** A real compiled SceneState (sanitize → presets → rules → capability clip → guard). */
export function scene(capabilities: CapabilityProfile, presets: Array<[ScenePresetId, number]>, overrides: Override[] = [], context: Partial<SceneContext> = {}) {
  return compileScene({ capabilities, assets: runtimeAssets, outing: intent(presets, { overrides }), context: { variationSeed: 7, ...context } });
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
