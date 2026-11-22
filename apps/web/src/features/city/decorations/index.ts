/**
 * Workstream: PROCEDURAL DECORATIONS (Chat 4), connected at City Changer integration.
 *
 * Adapter from `CityPlan.sections.decorations` to the world decoration engine
 * (features/scene/decor): imported 3D models placed only on verified safe
 * surfaces of the real map (sidewalk furniture zones, plazas, parks,
 * waterfronts, flat rooftops), clear of roads, rails, intersections, water,
 * routes and destination pins, instanced in one MapLibre custom layer.
 *
 * - Themed from the policy-applied scene view (preset anchors plus compiled
 *   aesthetic values, see decor/themes.ts); hidden in route/focus navigation,
 *   in 2D and when installations are toggled off.
 * - Claims the `set_piece_3d` feature: the compiler's late-stage set piece is
 *   re-sited by this engine (legacy models.ts stops drawing it).
 * - Three.js and the models load lazily on the first themed frame; phones
 *   (`low` tier, no model budget) never load them.
 * - Decorations are fictional: they never imply a real venue feature.
 */
import type { SceneState } from '../../scene/state';
import type { WorldDecor } from '../../scene/decor';
import type { CityHostOptions, CityRenderer, RendererContext } from '../contracts';

export function createDecorationRenderer(host: CityHostOptions): CityRenderer<'decorations'> & { decor(): WorldDecor | null } {
  const enabled = host.decorations !== false;
  let ctx: RendererContext | null = null;
  let decor: WorldDecor | null = null;
  let loading: Promise<void> | null = null;
  let latest: SceneState | null = null;
  let seed: number | null = null;
  let disposed = false;

  const ensure = () => {
    const map = ctx?.map;
    if (decor || loading || !map || disposed) return;
    loading = Promise.all([import('../../scene/decor'), import('../../scene/registry')])
      .then(([{ mountRuntimeDecor }, { runtimeAssets }]) => {
        if (disposed) return;
        decor = mountRuntimeDecor(map, runtimeAssets, {
          // Placement is a pure function of (world seed, theme, map data): same seed, same city.
          config: seed === null ? undefined : { seed: `city-${seed}` },
          exclusions: host.exclusions ? () => host.exclusions!() : undefined,
          onError: (e) => ctx?.reportError(e),
        });
        decor.render(latest);
      })
      .catch((e) => ctx?.reportError(e))
      .finally(() => {
        loading = null;
      });
  };

  return {
    id: 'decorations',
    section: 'decorations',
    capabilities: enabled ? { features: ['set_piece_3d'] } : {},
    init(c) {
      ctx = c;
    },
    update({ section, env, scene, transition }) {
      if (!enabled) return;
      const off = transition.reason === 'release' || env.budget.modelInstances <= 0;
      latest = off ? null : scene;
      const reseeded = seed !== null && seed !== env.seed;
      seed = env.seed;
      if (decor) {
        if (reseeded) decor.configure({ seed: `city-${env.seed}` });
        decor.render(latest);
        return;
      }
      // Load the engine only once the vibe has something to place (and never while navigating).
      if (!off && env.mode.navigation === 'browse' && (section.enabled || scene.presets.some((p) => p.id !== 'neutral' && p.weight > 0) || hasAesthetic(scene) || (scene.context?.themeEvidence?.length ?? 0) > 0)) ensure();
    },
    contextRestored() {
      // Placement is deterministic, so a fresh engine rebuilds the same decorations from the re-delivered frame.
      const dead = decor;
      decor = null;
      try {
        dead?.destroy();
      } catch {
        /* its layer is already gone */
      }
    },
    // decor.stats() is a QA probe (it projects every instance); usage stays O(1).
    usage: () => ({ customLayers: decor ? 1 : 0 }),
    decor: () => decor,
    dispose() {
      disposed = true;
      decor?.destroy();
      decor = null;
    },
  };
}

/** Any non-default value that the decoration themes read (decor/themes.ts VALUE_MOTIFS). */
function hasAesthetic(scene: SceneState): boolean {
  return Object.values(scene.strengths).some((v) => v > 0.15);
}
