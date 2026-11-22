import { safePinAppearance, type Ranking } from '../vibe/adapters';
import type { FocusMode } from './focusMode';
import { markerVisible } from './markerVisibility';

/** Semantic presentation is subordinate to focus visibility and selected endpoints. */
export function semanticMarkerState(
  ranking: Ranking | null,
  id: string,
  mode: FocusMode,
  relevantIds: readonly string[],
  showAll = false,
) {
  const appearance = safePinAppearance(ranking, id, relevantIds.includes(id) ? 'search' : mode, showAll);
  return {
    scale: appearance.scale,
    visible: markerVisible(mode, 'discovery', id, relevantIds) && !appearance.hidden,
  };
}
