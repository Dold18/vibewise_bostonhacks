import type { AssetRegistry } from './assets';
import type { SceneState } from './state';
import './renderers.css';
import { createSvgCache } from './svg';

/** Only variants with an implemented asset treatment belong here. No optical/volumetric claims. */
export const ATMOSPHERE: Record<string, Record<string, string>> = {
  'air_and_atmosphere.grain': { fine_film: 'film-grain', coarse_film: 'film-grain', analog_noise: 'film-grain', paper_grain: 'paper-grain' },
  'air_and_atmosphere.vignette': Object.fromEntries(['soft', 'cinematic', 'strong', 'warm', 'cool'].map(v => [v, 'vignette'])),
  'air_and_atmosphere.fog_volume': { whisper: 'fog-gradient', light: 'fog-gradient', medium: 'fog-gradient' },
  'air_and_atmosphere.haze_profile': { horizon: 'fog-gradient', edge: 'fog-gradient', ground: 'fog-gradient' },
  'air_and_atmosphere.rain': { drizzle: 'rain-streaks', light: 'rain-streaks', cinematic: 'rain-streaks' },
  'air_and_atmosphere.snow': { few_flakes: 'snow-particles', gentle: 'snow-particles' },
  'air_and_atmosphere.petals': { few: 'petals', slow_fall: 'petals' },
  'air_and_atmosphere.fireflies': { few: 'fireflies', gentle: 'fireflies' },
  'air_and_atmosphere.sparkle': { tiny: 'sparks', magical: 'sparks' },
  'air_and_atmosphere.dust_motes': { subtle: 'fireflies', sunlit: 'fireflies' },
  'air_and_atmosphere.light_shafts': { subtle: 'light-shaft', sunbeams: 'light-shaft', night_beams: 'light-shaft' },
  'air_and_atmosphere.scanlines': { subtle: 'scanlines', retro_monitor: 'scanlines', holographic: 'scanlines' },
  'cinematic_and_artistic.paper_texture': Object.fromEntries(['cream_fiber', 'aged_parchment', 'blueprint_paper', 'grainy_print'].map(v => [v, 'paper-grain'])),
  'cinematic_and_artistic.halftone': { subtle: 'halftone', comic_print: 'halftone', retro_newsprint: 'halftone' },
  'cinematic_and_artistic.analog_aging': { faded_film: 'film-scratches' },
  'cinematic_and_artistic.grid_overlay': { faint_blueprint: 'blueprint-grid', sci_fi: 'neon-circuit', subtle_graph: 'blueprint-grid' },
  'sky_and_horizon.starfield': { few: 'stars-sparse', subtle: 'stars-sparse', dense: 'stars-dense' },
  'lighting_and_shadows.bloom': { subtle: 'glow-amber', dreamy: 'glow-amber', neon: 'glow-cyan', cinematic: 'glow-amber' },
};

export function mountAtmosphere(container: HTMLElement, assets: AssetRegistry) {
  const root = document.createElement('div'); root.className = 'scene-atmosphere'; root.setAttribute('aria-hidden', 'true');
  container.querySelector('canvas')?.after(root);
  const shown = new Map<string, HTMLElement>();
  const svg = createSvgCache(assets), rasters = new Map<string, Promise<string>>();
  const errors: string[] = [];
  const raster = (id: string) => {
    let url = rasters.get(id);
    if (!url) {
      url = svg.load(id).then(data => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; canvas.getContext('2d')!.putImageData(data, 0, 0); return canvas.toDataURL(); });
      rasters.set(id, url);
    }
    return url;
  };
  return {
    render(state: SceneState) {
      root.style.transitionDuration = `${state.motion.transitionMs}ms`;
      const safe = state.context?.navigation !== 'browse' || state.context?.atmosphereEnabled === false;
      root.style.opacity = safe ? '0' : '1';
      root.dataset.motion = String(state.motion.ambient && state.context?.performance !== 'low');
      const wanted = new Set<string>();
      for (const [key, variants] of Object.entries(ATMOSPHERE)) {
        const value = state.resolved[key]; const id = variants[value]; const source = assets.sources?.get(id);
        if (!source || !state.strengths[key]) continue;
        wanted.add(key);
        let el = shown.get(key);
        if (!el) { el = document.createElement('div'); el.className = 'scene-atmosphere-cell'; shown.set(key, el); root.append(el); }
        el.dataset.asset = id;
        const cell = el;
        void raster(id).then(url => { if (cell.dataset.asset === id && root.isConnected) cell.style.backgroundImage = `url("${url}")`; }, error => { errors.push(String(error)); cell.style.opacity = '0'; });
        el.style.backgroundSize = ['vignette', 'fog-gradient', 'light-shaft', 'glow-amber', 'glow-cyan'].includes(id) ? '100% 100%' : '256px 256px';
        if (value === 'coarse_film') el.style.backgroundSize = '384px 384px';
        if (value === 'analog_noise') el.style.backgroundSize = '128px 128px';
        if (value === 'few' || value === 'few_flakes' || value === 'drizzle') el.style.backgroundSize = '512px 512px';
        const variation = value === 'soft' || value === 'whisper' ? 0.55 : value === 'strong' || value === 'medium' ? 1.2 : 1;
        el.style.opacity = String(Math.min(0.32, state.strengths[key]! * variation * (id === 'vignette' ? 0.28 : 0.22)));
        el.style.transitionDuration = `${state.motion.transitionMs}ms`;
      }
      for (const [key, el] of shown) if (!wanted.has(key)) el.style.opacity = '0';
    },
    setMoving(moving: boolean) { root.dataset.camera = moving ? 'moving' : 'still'; },
    stats: () => ({ errors: [...errors], elements: shown.size, active: [...shown.values()].filter(el => Number(el.style.opacity) > 0).map(el => el.dataset.asset) }),
    destroy() { shown.clear(); rasters.clear(); svg.clear(); root.remove(); },
  };
}
