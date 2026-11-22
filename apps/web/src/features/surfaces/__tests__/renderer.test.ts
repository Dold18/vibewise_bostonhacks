import { describe, expect, it, vi } from 'vitest';
import { MAP_RENDERER_V1 } from '../../scene';
import { basePalette, buildMapStyle } from '../../../mapStyle';
import { withSurfaceCapabilities } from '../capabilities';
import { connectSurfaces } from '../connect';
import { SURFACE_LAYER_IDS } from '../layers';
import { mountSurfaces, type SurfaceMap } from '../renderer';
import { scene } from './fixtures';

function fakeMap(loaded = true) {
  const layers = buildMapStyle(basePalette).layers.map((l) => ({ id: l.id, type: l.type as string }));
  const images = new Map<string, { width: number; height: number }>();
  const listeners: Record<string, Array<() => void>> = {};
  const calls = { addLayer: 0, removeLayer: 0, addImage: 0, updateImage: 0, setPaint: [] as Array<[string, string, unknown]> };
  const map: SurfaceMap & { fire(t: string): void; layers: typeof layers; calls: typeof calls } = {
    layers,
    calls,
    isStyleLoaded: () => loaded,
    once: (t, fn) => { (listeners[t] ??= []).push(fn); },
    on: (t, fn) => { (listeners[t] ??= []).push(fn); },
    off: (t, fn) => { listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn); },
    fire: (t) => { for (const f of [...(listeners[t] ?? [])]) f(); },
    getStyle: () => ({ layers }),
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (layer: never, before?: string) => {
      calls.addLayer++;
      const l = layer as { id: string; type: string };
      const i = before ? layers.findIndex((x) => x.id === before) : layers.length;
      layers.splice(i < 0 ? layers.length : i, 0, { id: l.id, type: l.type });
    },
    removeLayer: (id) => { calls.removeLayer++; layers.splice(layers.findIndex((l) => l.id === id), 1); },
    hasImage: (id) => images.has(id),
    addImage: (id, img) => { calls.addImage++; images.set(id, { width: img.width, height: img.height }); },
    updateImage: (id, img) => {
      calls.updateImage++;
      const old = images.get(id)!;
      if (old.width !== img.width || old.height !== img.height) throw new Error(`size mismatch ${id}`);
    },
    removeImage: (id) => { images.delete(id); },
    setPaintProperty: (layer, prop, value) => { calls.setPaint.push([layer, prop, value]); },
  };
  return map;
}

const sync = { schedule: (fn: () => void) => fn(), delay: (fn: () => void) => fn() };

describe('surface renderer', () => {
  it('installs every slot and layer once, each directly above its anchor', () => {
    const map = fakeMap();
    mountSurfaces(map, sync);
    expect(map.calls.addLayer).toBe(SURFACE_LAYER_IDS.length);
    const ids = map.layers.map((l) => l.id);
    expect(ids.indexOf('ws-road-minor')).toBe(ids.indexOf('road-minor') + 1);
    expect(ids.indexOf('ws-ground')).toBe(ids.indexOf('background') + 1);
    expect(ids.indexOf('ws-lamps')).toBeLessThan(ids.indexOf('rail'));
    expect(Math.max(...SURFACE_LAYER_IDS.map((id) => ids.indexOf(id)))).toBeLessThan(ids.indexOf('water-label'));
  });

  it('waits for the style to load', () => {
    const map = fakeMap(false);
    mountSurfaces(map, sync);
    expect(map.calls.addLayer).toBe(0);
    map.fire('load');
    expect(map.calls.addLayer).toBe(SURFACE_LAYER_IDS.length);
  });

  it('a neutral scene paints nothing and keeps every surface transparent', () => {
    const map = fakeMap();
    const r = mountSurfaces(map, sync);
    r.setScene(scene([['neutral', 1]]));
    r.flush();
    expect(map.calls.updateImage).toBe(0);
    expect(map.calls.setPaint.filter(([, p]) => p.endsWith('opacity')).every(([, , v]) => v === 0)).toBe(true);
  });

  it('switches worlds with in-place image updates and paint only: no new layers, no pattern changes', () => {
    const map = fakeMap();
    const r = mountSurfaces(map, sync);
    const layersAfterInstall = map.calls.addLayer;
    for (const w of ['amber_refuge', 'neon_city', 'woodland_story', 'underground_indie'] as const) {
      r.setScene(scene([[w, 1]]));
      r.flush();
    }
    expect(map.calls.addLayer).toBe(layersAfterInstall);
    expect(map.calls.removeLayer).toBe(0);
    expect(map.calls.updateImage).toBeGreaterThan(20);
    expect(map.calls.setPaint.some(([, p]) => p.endsWith('-pattern'))).toBe(false);
  });

  it('fades layers out before swapping a visible material, then back in', () => {
    const map = fakeMap();
    const delayed: Array<() => void> = [];
    // A fixed clock: the swap waits for the dip however long painting takes on a loaded machine.
    const r = mountSurfaces(map, { schedule: (fn) => fn(), delay: (fn) => delayed.push(fn), now: () => 0 });
    r.setScene(scene([['amber_refuge', 1]]));
    r.flush();
    delayed.splice(0).forEach((fn) => fn());
    const updates = map.calls.updateImage;
    map.calls.setPaint.length = 0;
    r.setScene(scene([['neon_city', 1]]));
    const fadeOut = map.calls.setPaint.find(([l, p]) => l === 'ws-road-minor' && p === 'line-opacity');
    expect(fadeOut?.[2]).toBe(0);
    expect(map.calls.updateImage).toBe(updates); // pixels swap only after the fade
    delayed.forEach((fn) => fn());
    expect(map.calls.updateImage).toBeGreaterThan(updates);
    const fadeIn = map.calls.setPaint.filter(([l, p]) => l === 'ws-road-minor' && p === 'line-opacity').at(-1);
    expect(fadeIn?.[2]).not.toBe(0);
  });

  it('repeating the same scene does nothing', () => {
    const map = fakeMap();
    const r = mountSurfaces(map, sync);
    r.setScene(scene([['noir_nocturne', 1]]));
    r.flush();
    const before = { ...map.calls, setPaint: map.calls.setPaint.length };
    r.setScene(scene([['noir_nocturne', 1]]));
    r.flush();
    expect(map.calls.updateImage).toBe(before.updateImage);
    expect(map.calls.setPaint.length).toBe(before.setPaint);
  });

  it('navigation calms surfaces with paint only, and restores them afterwards', () => {
    const map = fakeMap();
    const r = mountSurfaces(map, sync);
    r.setScene(scene([['noir_nocturne', 1]]));
    r.flush();
    const browse = r.recipe();
    const images = map.calls.updateImage;
    r.setNavigation('route');
    r.flush();
    expect(r.recipe().lamps.intensity).toBe(0);
    expect(r.recipe().roads.intensity).toBeCloseTo(browse.roads.intensity * 0.5, 3);
    expect(map.calls.updateImage).toBe(images);
    r.setNavigation(false);
    r.flush();
    expect(r.recipe()).toEqual(browse);
  });

  it('re-installs if the style is replaced, and cleans up on destroy', () => {
    const map = fakeMap();
    const r = mountSurfaces(map, sync);
    for (const id of SURFACE_LAYER_IDS) map.layers.splice(map.layers.findIndex((l) => l.id === id), 1);
    map.fire('styledata');
    expect(SURFACE_LAYER_IDS.every((id) => map.getLayer(id))).toBe(true);
    r.destroy();
    expect(SURFACE_LAYER_IDS.some((id) => map.getLayer(id))).toBe(false);
  });

  it('follows a scene session through connectSurfaces', () => {
    const map = fakeMap();
    const r = mountSurfaces(map, sync);
    let listener: ((u: { state: ReturnType<typeof scene> }) => void) | null = null;
    const off = vi.fn();
    connectSurfaces(r, { getState: () => scene([['neutral', 1]]), subscribe: (l) => { listener = l; return off; } });
    expect(r.recipe().presence).toBe(0);
    listener!({ state: scene([['retro_atlas', 1]]) });
    // retro_atlas now carries an explicit street_material (cobblestone_illustration, added with the
    // scene-asset presets); explicit values win over inference, so its streets are cobbles.
    expect(r.recipe().roads.minor).toBe('cobbles');
  });
});

describe('surface capabilities', () => {
  it('extend the live profile so the compiler keeps surface values instead of disabling them', () => {
    const o = [{ key: 'roads_and_ground.street_material', value: 'cobblestone_illustration' }];
    const live = scene([['neutral', 1]], o, MAP_RENDERER_V1);
    expect(live.resolved['roads_and_ground.street_material']).not.toBe('cobblestone_illustration');
    expect(live.disabled.some((d) => d.key === 'roads_and_ground.street_material')).toBe(true);
    const withSurfaces = scene([['neutral', 1]], o, withSurfaceCapabilities(MAP_RENDERER_V1));
    expect(withSurfaces.resolved['roads_and_ground.street_material']).toBe('cobblestone_illustration');
    // Everything the live map already rendered is still supported.
    for (const [k, v] of MAP_RENDERER_V1.values) for (const x of v) expect(withSurfaceCapabilities(MAP_RENDERER_V1).values.get(k)?.has(x)).toBe(true);
  });
});

describe('transitions on the shared scene clock', () => {
  it('paints every changed texture off-screen, dips their layers, swaps them while hidden, then rises', () => {
    const map = fakeMap();
    const frames: Array<() => void> = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let t = 0;
    const r = mountSurfaces(map, { schedule: (fn) => void frames.push(fn), delay: (fn, ms) => void timers.push({ fn, ms }), now: () => t, frameBudgetMs: 0 });
    const drain = () => { while (frames.length) frames.shift()!(); };
    r.setScene(scene([['amber_refuge', 1]]), { transitionMs: 800 });
    drain();
    for (const x of timers.splice(0)) x.fn();
    const first = map.calls.updateImage;
    expect(first).toBeGreaterThan(1);

    r.setScene(scene([['neon_city', 1]]), { transitionMs: 800 });
    const dipped = map.calls.setPaint.filter(([, prop, v]) => /opacity$/.test(prop) && v === 0).length;
    expect(dipped).toBeGreaterThan(0); // layers showing changed textures fade first
    frames.shift()!(); // one texture painted (budget 0): nothing reaches the map yet
    expect(map.calls.updateImage).toBe(first);
    drain();
    expect(map.calls.updateImage).toBe(first); // all painted, still waiting for the bottom of the dip
    const swap = timers.splice(0);
    expect(swap).toHaveLength(1);
    expect(swap[0]!.ms).toBeGreaterThan(0);
    expect(swap[0]!.ms).toBeLessThanOrEqual(320);
    t += swap[0]!.ms;
    const risesBefore = map.calls.setPaint.length;
    swap[0]!.fn();
    // Uploads may span frames (budget 0 here) but layers rise only after the last one.
    const risen = () => map.calls.setPaint.slice(risesBefore).some(([, prop, v]) => /opacity$/.test(prop) && typeof v !== 'number' || (typeof v === 'number' && v > 0 && /opacity$/.test(prop)));
    expect(risen()).toBe(false);
    drain();
    expect(map.calls.updateImage - first).toBeGreaterThan(1);
    expect(risen()).toBe(true);
  });

  it('a newer scene discards a pending swap; reduced motion (0 ms) swaps without a dip', () => {
    const map = fakeMap();
    const timers: Array<() => void> = [];
    const r = mountSurfaces(map, { schedule: (fn) => fn(), delay: (fn) => void timers.push(fn), now: () => 0 });
    r.setScene(scene([['amber_refuge', 1]]), { transitionMs: 800 });
    for (const f of timers.splice(0)) f();
    const base = map.calls.updateImage;
    r.setScene(scene([['neon_city', 1]]), { transitionMs: 800 });
    const stale = timers.splice(0);
    r.setScene(scene([['woodland_story', 1]]), { transitionMs: 0 });
    const afterInstant = map.calls.updateImage;
    expect(afterInstant).toBeGreaterThan(base); // instant: swapped at once
    for (const f of stale) f(); // the superseded swap does nothing
    expect(map.calls.updateImage).toBe(afterInstant);
  });
});
