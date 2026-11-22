/**
 * Instanced Three.js rendering inside MapLibre's WebGL context.
 *
 * - One fixed Mercator origin for the engine's lifetime; instances are meters
 *   east/south of it, so they are world-anchored: camera moves change only
 *   the projection matrix, never instance transforms.
 * - One InstancedMesh per (tier, model, glTF primitive): repeated models cost
 *   one draw call per primitive regardless of instance count. Geometry and
 *   materials are shared with the model cache (never cloned).
 * - Newly visible instances grow in from the ground (staggered); reduced
 *   motion places them immediately. No repaint loop runs once settled.
 * - Context loss stops drawing; restoration rebuilds the renderer and lets
 *   Three re-upload the CPU-side buffers.
 */
import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibreMap } from 'maplibre-gl';
import {
  Box3, Camera, Color, DirectionalLight, Euler, Group, HemisphereLight, InstancedMesh, Matrix4, Quaternion, Scene, Vector3, WebGLRenderer,
  type BufferGeometry, type Material, type Mesh, type Object3D,
} from 'three';
import type { Tier } from './catalog';

export interface Prototype {
  readonly parts: ReadonlyArray<{ geometry: BufferGeometry; material: Material | Material[]; matrix: Matrix4 }>;
  /** Materials that glow in dark scenes (lighting families only; cloned, so nothing else changes). */
  readonly glow: readonly Material[];
}

/** Normalize a loaded glTF scene: bottom-centered, longest side = 1. Resources stay shared. */
export function prototypeOf(source: Object3D, glows = false): Prototype {
  source.updateMatrixWorld(true);
  const box = new Box3().setFromObject(source), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) throw new Error('Invalid model dimensions');
  const normalize = new Matrix4().makeScale(1 / longest, 1 / longest, 1 / longest).multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const parts: Array<Prototype['parts'][number]> = [], glow: Material[] = [];
  source.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    // Without an environment map, metallic glTF surfaces render near-black. These materials belong
    // to this engine's own model cache (not shared with the set-piece layer), so soften them in place.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as Material & { metalness?: number; roughness?: number };
      if (typeof std.metalness === 'number' && std.metalness > 0.25) { std.metalness = 0.15; std.roughness = Math.max(std.roughness ?? 0.6, 0.55); }
    }
    let material = mesh.material;
    if (glows) {
      // Lanterns and lamps light up from their own texture colours (no new art).
      const clone = (m: Material) => { const c = m.clone() as Material & { emissive?: Color; emissiveMap?: unknown; map?: unknown; emissiveIntensity?: number }; if (c.emissive) { c.emissive = new Color(0xffffff); c.emissiveMap = c.map ?? null; c.emissiveIntensity = 0; glow.push(c); } return c; };
      material = Array.isArray(material) ? material.map(clone) : clone(material);
    }
    parts.push({ geometry: mesh.geometry, material, matrix: normalize.clone().multiply(mesh.matrixWorld) });
  });
  return { parts, glow };
}

export interface WorldInstance {
  /** Stable identity (survives regeneration of identical placements). */
  readonly key: string;
  readonly assetId: string;
  readonly tier: Tier;
  /** Mercator [0,1] coordinates. */
  readonly mx: number;
  readonly my: number;
  /** Standing height in meters (roof height for rooftop decorations). */
  readonly z: number;
  /** Local-frame facing (radians, x east / y north). */
  readonly facing: number;
  readonly size: number;
  readonly rank: number;
}

interface Batch { readonly meshes: InstancedMesh[]; readonly prototype: Prototype; instances: WorldInstance[]; capacity: number }

export interface DecorLayerOptions {
  readonly id?: string;
  readonly minZoom: Readonly<Record<Tier, number>>;
  /** Below this pitch (2D mode) decorations are hidden to keep the flat map clean. */
  readonly minPitch?: number;
}

export function createDecorLayer(map: MapLibreMap, options: DecorLayerOptions) {
  const id = options.id ?? 'scene-world-decor';
  const scene = new Scene(), camera = new Camera(), root = new Group();
  const hemi = new HemisphereLight(0xffffff, 0x8b93a1, 2.6), sun = new DirectionalLight(0xffffff, 2.6);
  sun.position.set(-30, 60, 20);
  scene.add(hemi, sun, root);
  const batches = new Map<string, Batch>();
  const appear = new Map<string, number>();
  let origin: MercatorCoordinate | null = null, unitScale = 1;
  let renderer: WebGLRenderer | undefined;
  let lost = false, dead = false, reducedMotion = false, animating = false, frames = 0;
  let lastInfo = { calls: 0, triangles: 0 };
  const lastMain = new Matrix4(); let haveMain = false;
  let minZoom = { ...options.minZoom };
  const matrix = new Matrix4(), partMatrix = new Matrix4(), q = new Quaternion(), euler = new Euler(), pos = new Vector3(), scale = new Vector3();
  const REVEAL_MS = 650, STAGGER_MS = 450, EXIT_MS = 650;
  /** Instances that left the scene shrink out instead of vanishing; their models stay resident meanwhile. */
  const exiting = new Map<string, { inst: WorldInstance; start: number }>();
  let liveKeys = new Set<string>();
  let lastSet: [readonly WorldInstance[], ReadonlyMap<string, Prototype>] | null = null;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;

  const ensureOrigin = (mx: number, my: number) => {
    if (origin) return;
    origin = new MercatorCoordinate(mx, my, 0);
    unitScale = origin.meterInMercatorCoordinateUnits();
  };

  const ease = (t: number) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }; // easeOutBack

  function writeMatrices(batch: Batch, now: number) {
    let pending = false;
    batch.instances.forEach((inst, i) => {
      let grow = 1;
      const start = appear.get(inst.key);
      const exit = exiting.get(inst.key);
      if (exit) {
        const t = (now - exit.start) / EXIT_MS;
        grow = t >= 1 ? 0.0001 : Math.max(0.0001, 1 - t * t * (3 - 2 * t));
        if (t < 1) pending = true;
      } else if (start !== undefined) {
        const t = (now - start) / REVEAL_MS;
        if (t >= 1) appear.delete(inst.key); else { grow = Math.max(0.0001, ease(Math.max(0, t))); pending = true; }
      }
      pos.set((inst.mx - origin!.x) / unitScale, inst.z, (inst.my - origin!.y) / unitScale);
      q.setFromEuler(euler.set(0, inst.facing + Math.PI / 2, 0));
      scale.setScalar(inst.size * grow);
      matrix.compose(pos, q, scale);
      batch.prototype.parts.forEach((part, p) => batch.meshes[p]!.setMatrixAt(i, partMatrix.multiplyMatrices(matrix, part.matrix)));
    });
    for (const mesh of batch.meshes) { mesh.count = batch.instances.length; mesh.instanceMatrix.needsUpdate = true; }
    return pending;
  }

  const layer: CustomLayerInterface = {
    id, type: 'custom', renderingMode: '3d',
    onAdd(_map, context) { renderer = new WebGLRenderer({ canvas: map.getCanvas(), context, antialias: true }); renderer.autoClear = false; },
    render(_gl, input) {
      if (lost || dead || !renderer || !origin || !batches.size) return;
      const zoom = map.getZoom(), flat = map.getPitch() < (options.minPitch ?? 12);
      const mercator = (map.getProjection()?.type ?? 'mercator') === 'mercator';
      root.visible = !flat && mercator;
      if (!root.visible) return;
      for (const [key, batch] of batches) {
        const [tier, level] = key.split(':', 2);
        // The style grows extrusions from 0 at z14 to full height at z15: rooftop props appear once roofs are final.
        const visible = zoom >= minZoom[tier as Tier] && (level !== 'roof' || zoom >= 15);
        for (const mesh of batch.meshes) mesh.visible = visible;
      }
      const now = performance.now();
      if (animating) { animating = false; for (const batch of batches.values()) if (writeMatrices(batch, now)) animating = true; }
      const local = new Matrix4().makeTranslation(origin.x, origin.y, origin.z)
        .scale(new Vector3(unitScale, -unitScale, unitScale)).multiply(new Matrix4().makeRotationX(Math.PI / 2));
      lastMain.fromArray(input.defaultProjectionData.mainMatrix as unknown as number[]); haveMain = true;
      camera.projectionMatrix.copy(lastMain).multiply(local);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.resetState(); renderer.render(scene, camera); renderer.resetState();
      lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      frames++;
      if (animating) map.triggerRepaint();
    },
    onRemove() { renderer?.dispose(); renderer = undefined; },
  };

  function ensureLayer() {
    if (dead || !map.isStyleLoaded() || map.getLayer(id)) return;
    // Below labels/symbols so text stays legible above decorations.
    map.addLayer(layer, map.getStyle().layers.find((l) => l.type === 'symbol')?.id);
  }
  const onLost = () => { lost = true; };
  let retry: ReturnType<typeof setTimeout> | undefined;
  const onRestored = () => {
    lost = false;
    // MapLibre drops custom layers on context loss; the GL context object survives but every GPU
    // resource is gone. Re-add as soon as the style accepts layers again (onAdd builds a fresh renderer;
    // Three re-uploads geometry from the CPU-side buffers).
    let attempts = 0;
    const tryAdd = () => {
      if (dead) return;
      ensureLayer();
      if (!map.getLayer(id) && attempts++ < 100) retry = setTimeout(tryAdd, 100);
      else map.triggerRepaint();
    };
    tryAdd();
  };
  const onStyle = () => ensureLayer();
  map.on('webglcontextlost', onLost); map.on('webglcontextrestored', onRestored); map.on('style.load', onStyle); map.on('idle', onStyle);
  ensureLayer();

  return {
    id,
    /** Replace what is drawn. Unchanged keys keep their state; new keys reveal (unless reduced motion). */
    setInstances(current: readonly WorldInstance[], prototypes: ReadonlyMap<string, Prototype>) {
      if (dead) return;
      const now0 = performance.now();
      const newKeys = new Set(current.map((i) => i.key));
      // Leaving instances shrink out (reduced motion: they go at once); a returning key simply stays.
      if (!reducedMotion) for (const b of batches.values()) for (const inst of b.instances) {
        if (liveKeys.has(inst.key) && !newKeys.has(inst.key) && !exiting.has(inst.key) && prototypes.has(inst.assetId)) exiting.set(inst.key, { inst, start: now0 });
      }
      for (const [k, e] of [...exiting]) if (reducedMotion || newKeys.has(k) || now0 - e.start >= EXIT_MS || !prototypes.has(e.inst.assetId)) exiting.delete(k);
      liveKeys = newKeys;
      lastSet = [current, prototypes];
      clearTimeout(exitTimer);
      if (exiting.size) { animating = true; exitTimer = setTimeout(() => { if (!dead && lastSet) this.setInstances(lastSet[0], lastSet[1]); }, EXIT_MS + 40); }
      const instances = exiting.size ? [...current, ...[...exiting.values()].map((e) => e.inst)] : current;
      const first = instances[0];
      if (first) ensureOrigin(first.mx, first.my);
      const previous = new Set<string>();
      for (const b of batches.values()) for (const inst of b.instances) previous.add(inst.key);
      const grouped = new Map<string, WorldInstance[]>();
      for (const inst of instances) {
        if (!prototypes.has(inst.assetId)) continue;
        const key = `${inst.tier}:${inst.z > 0 ? 'roof' : 'ground'}:${inst.assetId}`;
        let list = grouped.get(key); if (!list) grouped.set(key, (list = []));
        list.push(inst);
      }
      for (const [key, batch] of batches) if (!grouped.has(key)) { for (const m of batch.meshes) { root.remove(m); m.dispose(); } batches.delete(key); }
      const now = performance.now();
      for (const [key, list] of grouped) {
        const assetId = key.split(':').slice(2).join(':'), prototype = prototypes.get(assetId)!;
        let batch = batches.get(key);
        if (!batch || batch.capacity < list.length || batch.prototype !== prototype) {
          if (batch) for (const m of batch.meshes) { root.remove(m); m.dispose(); }
          const capacity = Math.max(4, 2 ** Math.ceil(Math.log2(list.length)));
          const meshes = prototype.parts.map((part) => {
            const mesh = new InstancedMesh(part.geometry, part.material, capacity);
            mesh.frustumCulled = false; mesh.name = key;
            root.add(mesh); return mesh;
          });
          batch = { meshes, prototype, instances: list, capacity };
          batches.set(key, batch);
        }
        batch.instances = list;
        for (const inst of list) if (!previous.has(inst.key) && !reducedMotion) { appear.set(inst.key, now + inst.rank * STAGGER_MS); animating = true; }
        writeMatrices(batch, now);
      }
      const live = new Set(instances.map((i) => i.key));
      for (const k of appear.keys()) if (!live.has(k)) appear.delete(k);
      ensureLayer(); map.triggerRepaint();
    },
    setLighting(color: string, intensity: number) {
      const c = new Color(color);
      sun.color.copy(c).lerp(new Color(0xffffff), 0.6); sun.intensity = 2.2 + intensity * 0.8;
      hemi.color.copy(c).lerp(new Color(0xffffff), 0.65);
      map.triggerRepaint();
    },
    /** 0..1 glow for lighting props (dark scenes light up). */
    setGlow(level: number, prototypes: Iterable<Prototype>) {
      for (const p of prototypes) for (const m of p.glow) (m as Material & { emissiveIntensity: number }).emissiveIntensity = level;
      map.triggerRepaint();
    },
    setReducedMotion(value: boolean) { reducedMotion = value; if (value) { appear.clear(); animating = false; for (const b of batches.values()) writeMatrices(b, performance.now()); map.triggerRepaint(); } },
    setMinZoom(value: Readonly<Record<Tier, number>>) { minZoom = { ...value }; map.triggerRepaint(); },
    /**
     * Screen position (CSS px) of a world point at an altitude in meters, using the last rendered
     * camera, so raised (rooftop) objects are located where they are actually drawn. Null before a frame.
     */
    project(mx: number, my: number, meters: number): { x: number; y: number } | null {
      if (!haveMain || !origin) return null;
      const v = new Vector3(mx, my, meters * unitScale).applyMatrix4(lastMain); // applyMatrix4 performs the perspective divide
      const canvas = map.getCanvas();
      if (!Number.isFinite(v.x) || v.z > 1 || v.z < -1) return null;
      return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight };
    },
    /** Mercator origin (for converting placements); null until the first instance. */
    origin: () => origin,
    clear() { clearTimeout(exitTimer); exiting.clear(); liveKeys = new Set(); lastSet = null; for (const b of batches.values()) for (const m of b.meshes) { root.remove(m); m.dispose(); } batches.clear(); appear.clear(); map.triggerRepaint(); },
    stats() {
      let instances = 0; const byTier: Record<string, number> = {};
      for (const [key, b] of batches) { instances += b.instances.length; const t = key.split(':', 1)[0]!; byTier[t] = (byTier[t] ?? 0) + b.instances.length; }
      return { exiting: exiting.size, batches: batches.size, meshes: [...batches.values()].reduce((s, b) => s + b.meshes.length, 0), instances, byTier, frames, lastFrame: lastInfo, animating, revealPending: appear.size, lost, memory: renderer ? { ...renderer.info.memory } : null, layerPresent: !!map.getLayer(id) };
    },
    destroy() {
      dead = true;
      clearTimeout(retry); clearTimeout(exitTimer);
      map.off('webglcontextlost', onLost); map.off('webglcontextrestored', onRestored); map.off('style.load', onStyle); map.off('idle', onStyle);
      for (const b of batches.values()) for (const m of b.meshes) m.dispose();
      batches.clear(); appear.clear();
      if (map.getLayer(id)) map.removeLayer(id);
      scene.clear();
    },
  };
}

export type DecorLayer = ReturnType<typeof createDecorLayer>;
