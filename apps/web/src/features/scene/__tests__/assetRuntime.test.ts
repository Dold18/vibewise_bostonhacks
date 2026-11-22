import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { Box3, BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { runtimeAssets, registryProblems } from '../registry';
import { assetCapabilities } from '../runtime';
import { compileScene } from '../compile';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createModelLoader, groundModel, disposeObject } from '../modelLoader';
import { intent } from './fixtures';

describe('manifest-backed render pipeline', () => {
  it('retains every imported model URL and atlas crop with real local bytes', () => {
    expect(registryProblems).toEqual([]);
    expect(runtimeAssets.models.size).toBe(312);
    expect(runtimeAssets.svg.size).toBe(257);
    for (const id of [...runtimeAssets.models, ...runtimeAssets.svg]) {
      const source = runtimeAssets.sources!.get(id)!;
      expect(source).toBeDefined();
      expect(existsSync(new URL(`../../../../public${source.uri}`, import.meta.url))).toBe(true);
    }
    expect(runtimeAssets.sources!.get('pavement.coarse_asphalt.warm')!.rect).toHaveLength(4);
  });
  it('reveals all six requested actual layouts late and preserves activation gates', () => {
    const compile = (id: string, progress: number, explicit: boolean) => compileScene({ assets: runtimeAssets, capabilities: assetCapabilities(true), outing: intent([['noir_nocturne', 1]]), context: { previewLayout: id, discoveryProgress: progress, explicitSelection: explicit } });
    for (const id of ['haunted_street', 'cyberpunk_night', 'italian_romantic', 'japanese_ramen_noir', 'folk_acoustic_cafe', 'fantasy_market']) {
      expect(compile(id, .2, true).setPiece).toBeNull();
      expect(compile(id, 1, true).setPiece?.layoutId).toBe(id);
    }
    expect(compile('italian_romantic', 1, false).setPiece).toBeNull();
    expect(compile('hanukkah_observance', 1, true).setPiece).toBeNull();
  });
  it('keeps unreviewed 3D unavailable in production and clips unimplemented optics', () => {
    const state = compileScene({ assets: runtimeAssets, capabilities: assetCapabilities(false), outing: intent([['neon_city', 1]], { overrides: [{ key: 'air_and_atmosphere.distortion', value: 'holographic_warp' }] }) });
    expect(state.setPiece).toBeNull();
    expect(state.disabled.some(d => d.key === 'air_and_atmosphere.distortion')).toBe(true);
    expect(state.overlays.some(o => o.key === 'air_and_atmosphere.scanlines' && o.textureIds.includes('scanlines'))).toBe(true);
    expect(state.resolved['roads_and_ground.wet_sheen']).toBe('rainy_night');
  });
  it('keeps the pastel haze, petals and diffuse glow together within the medium budget', () => {
    const s = compileScene({ assets: runtimeAssets, capabilities: assetCapabilities(false), outing: intent([['dream_pastel', 1]]) });
    expect(s.resolved['air_and_atmosphere.fog_volume']).toBe('whisper');
    expect(s.resolved['air_and_atmosphere.petals']).toBe('few');
    expect(s.resolved['lighting_and_shadows.bloom']).toBe('dreamy');
  });
  it('navigation suppresses placements and reduced motion keeps static assets', () => {
    const common = { assets: runtimeAssets, capabilities: assetCapabilities(true), outing: intent([['dream_pastel', 1]]) };
    expect(compileScene({ ...common, context: { navigation: 'route', previewLayout: 'fantasy_market', discoveryProgress: 1 } }).setPiece).toBeNull();
    const still = compileScene({ ...common, context: { reducedMotion: true } });
    expect(still.motion.ambient).toBe(false);
    expect(still.motion.transitionMs).toBeLessThanOrEqual(150);
  });
  it('normalizes off-center models to meters and ground contact without mutating source', () => {
    const source = new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial()); source.position.set(3, 5, 7);
    const grounded = groundModel(source, 12), box = new Box3().setFromObject(grounded), size = box.getSize(new Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(12);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.getCenter(new Vector3()).x).toBeCloseTo(0);
    expect(source.position.toArray()).toEqual([3, 5, 7]);
    disposeObject(source);
  });
  it('deduplicates lazy model requests and disposes retired GPU resources exactly once', async () => {
    const source = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    const dispose = vi.spyOn(source.geometry, 'dispose');
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue({ scene: source } as unknown as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    const loader = createModelLoader(runtimeAssets), id = [...runtimeAssets.models][0]!;
    try {
      const first = loader.load(id), second = loader.load(id);
      expect(first).toBe(second);
      expect(await first).toBe(source);
      expect(await loader.load(id)).toBe(source);
      expect(load).toHaveBeenCalledTimes(1);
      loader.retain(new Set()); await Promise.resolve();
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(loader.stats().cached).toBe(0);
      await expect(loader.load('unknown-model')).rejects.toThrow('unavailable');
    } finally { loader.destroy(); load.mockRestore(); }
  });
  it('retires a model still loading without allowing stale resources to mount', async () => {
    const source = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    const dispose = vi.spyOn(source.geometry, 'dispose');
    type Loaded = Awaited<ReturnType<GLTFLoader['loadAsync']>>;
    let finish!: (gltf: Loaded) => void;
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const loader = createModelLoader(runtimeAssets);
    try {
      const pending = loader.load([...runtimeAssets.models][0]!);
      const rejected = expect(pending).rejects.toThrow('retired');
      loader.retain(new Set());
      finish({ scene: source } as unknown as Loaded);
      await rejected;
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(loader.stats().cached).toBe(0);
    } finally { loader.destroy(); load.mockRestore(); }
  });

});
