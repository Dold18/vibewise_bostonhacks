/**
 * On-map vibe effects: a CSS-only layer above the map canvas and below the
 * pins. It never takes pointer events and freezes for reduced motion
 * (effects.css). Only the user's top two vibes show.
 */
import { topVibesOf } from '../account/taste';
import type { VibeKey } from '../account/vibes';
import './effects.css';

export const EFFECT_VIBES = 2;

export interface EffectLayer {
  key: VibeKey;
  opacity: number;
}

/** The top EFFECT_VIBES vibes, each at opacity score × strength (2 decimals). */
export function effectLayers(tags: Record<VibeKey, number>, strength: number): EffectLayer[] {
  if (strength <= 0) return [];
  return topVibesOf(tags)
    .slice(0, EFFECT_VIBES)
    .map(({ key, score }) => ({ key, opacity: Math.round(score * strength * 100) / 100 }));
}

export interface EffectsHandle {
  render(layers: EffectLayer[], darkMode: boolean): void;
  destroy(): void;
}

/**
 * Mount the effects layer in the map's canvas container, right after the
 * canvas, so markers (appended later in the same container) draw above it.
 */
export function mountEffects(canvasContainer: HTMLElement): EffectsHandle {
  const root = document.createElement('div');
  root.className = 'vibe-effects';
  root.setAttribute('aria-hidden', 'true');
  const canvas = canvasContainer.querySelector('canvas');
  if (canvas) canvas.after(root);
  else canvasContainer.prepend(root);

  const shown = new Map<VibeKey, HTMLElement>();

  return {
    render(layers, darkMode) {
      document.body.classList.toggle('vibe-dark', darkMode);
      const wanted = new Set(layers.map((l) => l.key));
      for (const [key, el] of shown) {
        if (wanted.has(key)) continue;
        // Fade out, then remove; a re-render before then simply reuses it.
        el.style.opacity = '0';
        el.addEventListener('transitionend', () => el.style.opacity === '0' && el.remove(), { once: true });
        shown.delete(key);
      }
      for (const { key, opacity } of layers) {
        let el = shown.get(key) ?? (root.querySelector(`.vibe-effect--${key}`) as HTMLElement | null);
        if (!el) {
          el = document.createElement('div');
          el.className = `vibe-effect vibe-effect--${key}`;
          el.style.opacity = '0';
          root.append(el);
          void el.offsetWidth; // start the fade-in from 0
        }
        shown.set(key, el);
        el.style.opacity = String(opacity);
      }
    },
    destroy() {
      document.body.classList.remove('vibe-dark');
      root.remove();
      shown.clear();
    },
  };
}
