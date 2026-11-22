/**
 * Keeps the map's look in step with the account: a signed-in user with map
 * effects on and some vibe history gets the blended palette and effects;
 * everyone else gets the plain map.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { basePalette, type Palette } from '../../mapStyle';
import type { AccountState, AccountStore } from '../account/session';
import { normalizeScores, VIBE_KEYS, type VibeKey, type VibeScores } from '../account/vibes';
import { applyPalette } from './apply';
import { blendPalette } from './blend';
import { effectLayers, mountEffects } from './effects';

export interface ThemeTarget {
  tags: Record<VibeKey, number>;
  strength: number;
}

/** What the map should look like for this account state; null = the plain map. */
export function themeFor(state: AccountState): ThemeTarget | null {
  if (state.status !== 'signed_in' || !state.profile.effectsEnabled || state.events.length === 0) return null;
  if (state.taste.strength <= 0) return null;
  return { tags: state.taste.profile.tags, strength: state.taste.strength };
}

export interface ThemeController {
  /** Theme the map from sample scores without saving anything (dev tool). Cleared by the next account change. */
  preview(scores: VibeScores, strength: number): void;
  destroy(): void;
}

export function startThemeController(map: MapLibreMap, store: AccountStore): ThemeController {
  const effects = mountEffects(map.getCanvasContainer());
  let current: Palette = basePalette;
  let target: ThemeTarget | null = themeFor(store.getState());
  let ready = false;

  function render() {
    if (!ready) return;
    const blend = target ? blendPalette(basePalette, target.tags, target.strength) : null;
    const next = blend?.palette ?? basePalette;
    applyPalette(map, current, next);
    current = next;
    // Effects follow the taste itself, not the contrast-limited palette
    // strength, so a vibe can show before it's strong enough to recolor.
    effects.render(target ? effectLayers(target.tags, target.strength) : [], blend?.darkMode ?? false);
  }

  const onLoad = () => {
    ready = true;
    render();
  };
  if (map.isStyleLoaded()) onLoad();
  else map.once('load', onLoad);

  const unsubscribe = store.subscribe((state) => {
    target = themeFor(state);
    render();
  });

  return {
    preview(scores, strength) {
      const clean = normalizeScores(scores);
      target =
        clean && strength > 0
          ? { tags: Object.fromEntries(VIBE_KEYS.map((k) => [k, clean[k] ?? 0])) as Record<VibeKey, number>, strength: Math.min(1, strength) }
          : null;
      render();
    },
    destroy() {
      unsubscribe();
      map.off('load', onLoad);
      if (ready) applyPalette(map, current, basePalette);
      effects.destroy();
    },
  };
}
