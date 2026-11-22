/**
 * Transition bridge for the asset renderers that predate the city engine
 * (scene/runtime.ts: atmosphere.ts, materials.ts, models.ts).
 *
 * They keep drawing exactly the keys no city renderer has claimed yet. The
 * moment a workstream renderer claims a key (or `set_piece_3d`), the legacy
 * path stops drawing it; if that renderer is retired, the key falls back to
 * the legacy path. Nothing is drawn twice and nothing regresses meanwhile.
 *
 * Delete this file (and scene/runtime.ts) once every legacy key is claimed.
 */
import type { SceneFeature } from '../scene/capabilities';
import type { SceneKey } from '../scene/catalog';
import type { SceneState } from '../scene/state';

/** `state` with every claimed key's strength removed (legacy renderers skip zero-strength keys). */
export function residualState(state: SceneState, claims: { readonly keys: ReadonlySet<SceneKey>; readonly features: ReadonlySet<SceneFeature> }): SceneState {
  if (!claims.keys.size && !claims.features.has('set_piece_3d')) return state;
  const strengths = Object.fromEntries(Object.entries(state.strengths).filter(([key]) => !claims.keys.has(key)));
  return Object.freeze({ ...state, strengths, setPiece: claims.features.has('set_piece_3d') ? null : state.setPiece });
}
