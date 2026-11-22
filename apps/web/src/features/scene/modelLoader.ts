import { Box3, Group, Material, Mesh, Texture, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetRegistry } from './assets';

export function disposeObject(root: Object3D) {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(node => { const mesh = node as Mesh; if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(m); for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}

/** Per-composition cache: deduplicates concurrent requests; retains at most the current layout's assets. */
export function createModelLoader(assets: AssetRegistry) {
  const loader = new GLTFLoader(), cache = new Map<string, Promise<Object3D>>();
  let dead = false, loads = 0;
  return {
    load(id: string) {
      const hit = cache.get(id); if (hit) return hit;
      const uri = assets.models.has(id) ? assets.sources?.get(id)?.uri : null;
      if (!uri || dead) return Promise.reject(new Error(`Model unavailable: ${id}`));
      loads++;
      const promise = loader.loadAsync(uri).then(gltf => {
        if (dead || cache.get(id) !== promise) { disposeObject(gltf.scene); throw new Error('Model request retired'); }
        return gltf.scene;
      }).catch(error => { if (cache.get(id) === promise) cache.delete(id); throw error; });
      cache.set(id, promise); return promise;
    },
    retain(ids: Set<string>) {
      for (const [id, promise] of cache) if (!ids.has(id)) { cache.delete(id); void promise.then(disposeObject, () => {}); }
    },
    stats: () => ({ cached: cache.size, loads }),
    destroy() { dead = true; for (const p of cache.values()) void p.then(disposeObject, () => {}); cache.clear(); },
  };
}

/** glTF Y-up, centered on the ground; original material/texture resources remain shared. */
export function groundModel(source: Object3D, maxMeters: number) {
  const model = source.clone(true), box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
  const dimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(dimension) || dimension <= 0) throw new Error('Invalid model dimensions');
  const scale = maxMeters / dimension; model.scale.multiplyScalar(scale);
  const scaled = new Box3().setFromObject(model), center = scaled.getCenter(new Vector3());
  model.position.add(new Vector3(-center.x, -scaled.min.y, -center.z));
  const anchor = new Group(); anchor.add(model); return anchor;
}
