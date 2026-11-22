/**
 * Scene → interface accent bridge.
 *
 * The Vibenta interface keeps its identity (shapes, type, icons, Carbon
 * surfaces) on every scene. Only a few supporting details follow the city:
 * the wordmark's print pass, starburst motifs and the Quick Tools offset read
 * `--vx-scene-accent`, and `data-scene-tone` lets edges strengthen on a dark
 * map. Nothing here touches the map; it only reads compiled scene state.
 */
import { basePalette, type Palette } from '../mapStyle';
import { hexToLab, labToHex } from '../features/scene/color';

export interface SceneAccentState {
  readonly palette: Palette;
  readonly ui?: { readonly accent: string | null };
}

export interface SceneAccentSource {
  getState(): SceneAccentState;
  subscribe(listener: (update: { state: SceneAccentState }) => void): () => void;
}

/** A vivid, legible-on-Carbon version of a color: keep its hue, set lightness and chroma. */
export function vivid(hex: string): string {
  const [, a, b] = hexToLab(hex);
  const chroma = Math.hypot(a, b);
  if (chroma < 0.02) return '#f3eee3'; // a grey sky has no hue to borrow: paper
  const k = Math.min(0.17, Math.max(0.12, chroma * 2.2)) / chroma;
  return labToHex([0.76, a * k, b * k]);
}

/**
 * The accent the interface should use for a scene, or null for the neutral
 * map (the identity's own coral). An explicit scene UI accent wins; otherwise
 * the hue comes from the scene's compiled sky.
 */
export function sceneAccent(state: SceneAccentState): string | null {
  if (state.ui?.accent) return vivid(state.ui.accent);
  if (state.palette.sky.toLowerCase() === basePalette.sky.toLowerCase()) return null;
  return vivid(state.palette.sky);
}

export const sceneTone = (state: SceneAccentState): 'light' | 'dark' => (hexToLab(state.palette.land)[0] < 0.5 ? 'dark' : 'light');

export function connectSceneAccent(source: SceneAccentSource, root: HTMLElement = document.documentElement): () => void {
  const apply = (state: SceneAccentState) => {
    const accent = sceneAccent(state);
    if (accent) root.style.setProperty('--vx-scene-accent', accent);
    else root.style.removeProperty('--vx-scene-accent');
    root.dataset.sceneTone = sceneTone(state);
  };
  apply(source.getState());
  return source.subscribe((update) => apply(update.state));
}
