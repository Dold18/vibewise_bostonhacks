/**
 * Development attach for visual QA on the live Boston map, without touching
 * shared runtime files:
 *
 *   const { attachWorldDecor } = await import('/src/features/scene/decor/dev.ts');
 *   await attachWorldDecor({ density: 1, seed: 'demo-a' });
 *   vibentaDecor.configure({ seed: 'demo-b' }); vibentaDecor.stats();
 *
 * It follows the real Scene Session (`window.vibentaScene`, dev builds only)
 * and keeps decorations clear of the DOM destination pins.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { SceneState } from '../state';
import type { DecorConfigInput } from './config';
import type { Exclusion } from './engine';
import { DENSITY_PRESETS, mountRuntimeDecor } from './index';

interface SceneHookLike {
  readonly map: unknown;
  readonly session: { getState(): SceneState; subscribe(listener: (update: { state: SceneState }) => void): () => void };
}

/** Destination pins are DOM markers; their bottom-center is the pin's ground point. */
export function pinExclusions(map: MapLibreMap): () => Exclusion[] {
  return () => {
    const box = map.getContainer().getBoundingClientRect();
    return [...map.getContainer().querySelectorAll<HTMLElement>('.maplibregl-marker')].flatMap((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return [];
      const p = map.unproject([r.left + r.width / 2 - box.left, r.bottom - box.top]);
      return [{ lng: p.lng, lat: p.lat }];
    });
  };
}

function sessionSeed() {
  try {
    const existing = sessionStorage.getItem('vibenta.decorSeed');
    if (existing) return existing;
    const seed = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('vibenta.decorSeed', seed);
    return seed;
  } catch { return 'vibenta-session'; }
}

export async function attachWorldDecor(config: DecorConfigInput & { label?: boolean } = {}) {
  const hook = (window as unknown as { vibentaScene?: SceneHookLike }).vibentaScene;
  if (!hook) throw new Error('vibentaScene dev hook not found (dev build required)');
  const existing = (window as unknown as { vibentaDecor?: { detach(): void } }).vibentaDecor;
  existing?.detach();
  const map = hook.map as MapLibreMap;
  const { runtimeAssets } = await import('../registry');
  const { label = true, ...rest } = config;
  const decor = mountRuntimeDecor(map, runtimeAssets, { config: { seed: sessionSeed(), ...rest }, exclusions: pinExclusions(map), onError: (e) => console.warn('[decor]', e) });
  decor.render(hook.session.getState());
  const off = hook.session.subscribe(({ state }) => decor.render(state));
  const observer = new MutationObserver(() => decor.invalidate());
  observer.observe(map.getContainer(), { childList: true, subtree: false });
  observer.observe(map.getCanvasContainer(), { childList: true });

  let badge: HTMLElement | null = null;
  const updateBadge = () => {
    if (!badge) return;
    const c = decor.config();
    badge.textContent = `Fictional decorations · seed ${c.seed} · density ${c.density} · clustering ${c.clustering}`;
  };
  if (label) {
    badge = document.createElement('div');
    badge.className = 'scene-decor-label';
    Object.assign(badge.style, { position: 'absolute', right: '12px', bottom: '28px', zIndex: '5', pointerEvents: 'none', font: '12px system-ui, sans-serif', padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,255,255,.88)', color: '#1f2937' });
    map.getContainer().append(badge);
    updateBadge();
  }

  const api = {
    decor,
    configure(input: DecorConfigInput) { decor.configure(input); updateBadge(); },
    density(level: keyof typeof DENSITY_PRESETS | number) { api.configure({ density: typeof level === 'number' ? level : DENSITY_PRESETS[level] }); },
    stats: () => decor.stats(),
    refresh: () => decor.refresh(),
    detach() { off(); observer.disconnect(); badge?.remove(); decor.destroy(); delete (window as unknown as { vibentaDecor?: unknown }).vibentaDecor; },
  };
  Object.assign(window, { vibentaDecor: api });
  return api;
}
