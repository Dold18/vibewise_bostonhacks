import { MercatorCoordinate, type Map as MapLibreMap, type CustomLayerInterface } from 'maplibre-gl';
import { AmbientLight, Camera, DirectionalLight, Group, Matrix4, Scene, Vector3, WebGLRenderer } from 'three';
import type { AssetRegistry } from './assets';
import type { SceneState } from './state';
import { createModelLoader, groundModel } from './modelLoader';
import { INSTALLATION_UNIT_METERS as UNIT, STAGING_CANDIDATES } from './placement';

export function mountModels(map: MapLibreMap, assets: AssetRegistry) {
  const loader = createModelLoader(assets), world = new Scene(), camera = new Camera();
  const light = new DirectionalLight(0xffffff, 2.5); light.position.set(20, 50, 30); world.add(light, new AmbientLight(0xffffff, 2));
  let renderer: WebGLRenderer | undefined, latest: SceneState | null = null, dead = false, lost = false;
  let revision = 0, currentId: string | null = null, group: Group | null = null, anchor: MercatorCoordinate | null = null;
  let start = 0, exiting = false, duration = 600, rendered = 0;
  const errors: string[] = [];
  let placementChecks: unknown[] = [];
  const layer: CustomLayerInterface = {
    id: 'scene-installation', type: 'custom', renderingMode: '3d',
    onAdd(_map, gl) { renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true }); renderer.autoClear = false; },
    render(_gl, input) {
      if (lost || !renderer || !group || !anchor || !latest) return;
      const screen = map.project(anchor.toLngLat());
      group.visible = screen.x > 430 && screen.x < map.getCanvas().clientWidth - 260 && screen.y > 120 && screen.y < map.getCanvas().clientHeight - 90 && latest.context?.navigation === 'browse' && map.getZoom() >= 15 && map.getPitch() >= 15 && (map.getProjection()?.type ?? 'mercator') === 'mercator';
      const elapsed = Math.min(1, (performance.now() - start) / Math.max(1, duration));
      const scale = exiting ? 1 - elapsed : elapsed;
      group.scale.setScalar(Math.max(0.0001, scale));
      const unit = anchor.meterInMercatorCoordinateUnits();
      const local = new Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z)
        .scale(new Vector3(unit, -unit, unit)).multiply(new Matrix4().makeRotationX(Math.PI / 2));
      camera.projectionMatrix.fromArray(input.defaultProjectionData.mainMatrix).multiply(local);
      renderer.resetState(); renderer.render(world, camera); renderer.resetState(); rendered++;
      if (elapsed < 1) map.triggerRepaint();
      else if (exiting) { world.remove(group); group = null; loader.retain(new Set()); if (latest) void update(latest); }
    },
    onRemove() { renderer?.dispose(); renderer = undefined; },
  };
  function safeAnchor(layoutId: string) {
    if (map.getZoom() < 15 || map.getPitch() < 15 || !map.isStyleLoaded()) return null;
    placementChecks = [];
    const layers = map.getStyle().layers;
    const parks = layers.filter(l => l.id === 'park' || l.id === 'landcover-grass').map(l => l.id);
    const hazards = layers.filter(l => l.id === 'building' || (!l.id.startsWith('scene-') && l.type === 'line' && 'source-layer' in l && l['source-layer'] === 'transportation')).map(l => l.id);
    for (const [lng, lat] of STAGING_CANDIDATES) {
      const corners = [[lng - .00045, lat - .0003], [lng + .00045, lat + .0003], [lng, lat]] as [number, number][];
      const pixels = corners.map(c => map.project(c));
      if (pixels.some(p => p.x < 0 || p.x > map.getCanvas().clientWidth || p.y < 0 || p.y > map.getCanvas().clientHeight)) continue;
      const parkHits = pixels.map(p => map.queryRenderedFeatures(p, { layers: parks }).length);
      placementChecks.push({ lng, lat, pixels: pixels.map(p => [p.x, p.y]), parkHits });
      if (!parks.length || !parkHits.every(Boolean)) continue;
      const center = pixels[2]!;
      const hits = hazards.length ? map.queryRenderedFeatures([[center.x - 22, center.y - 22], [center.x + 22, center.y + 22]], { layers: hazards }).map(f => f.layer.id) : [];
      placementChecks.push({ hazards: hits });
      if (hits.length) continue;
      const layout = assets.layouts.get(layoutId);
      const footprintClear = Object.values(layout?.slots ?? {}).every(slot => slot.placements.every(p => {
        const x = (slot.center[0]! + p.position[0]!) * UNIT;
        const z = (slot.center[2]! + p.position[2]!) * UNIT;
        const r = p.targetMaxDimension * UNIT * .72;
        const degreeX = 1 / (111320 * Math.cos(lat * Math.PI / 180));
        const points = [[lng + (x-r)*degreeX, lat - (z-r)/111320], [lng + (x+r)*degreeX, lat - (z+r)/111320]] as [number, number][];
        const projected = points.map(pt => map.project(pt));
        return projected.every(pt => pt.x > 430 && pt.x < map.getCanvas().clientWidth - 260 && pt.y > 120 && pt.y < map.getCanvas().clientHeight - 90 && map.queryRenderedFeatures(pt, { layers: parks }).length) &&
          !map.queryRenderedFeatures([[Math.min(...projected.map(pt => pt.x)), Math.min(...projected.map(pt => pt.y))], [Math.max(...projected.map(pt => pt.x)), Math.max(...projected.map(pt => pt.y))]], { layers: hazards }).length;
      }));
      placementChecks.push({ footprintClear });
      if (!footprintClear) continue;
      return MercatorCoordinate.fromLngLat([lng, lat], 0);
    }
    return null;
  }
  async function update(state: SceneState) {
    latest = state;
    const id = state.setPiece?.layoutId ?? null;
    if (id === currentId) { if (group) map.triggerRepaint(); return; }
    if (group && !exiting) { currentId = null; exiting = true; start = performance.now(); duration = state.context?.reducedMotion ? 1 : 450; map.triggerRepaint(); return; }
    if (exiting && group) return;
    currentId = id; const rev = ++revision;
    if (!id || lost || dead) { loader.retain(new Set()); return; }
    anchor = safeAnchor(id);
    if (!anchor) { currentId = null; return; }
    const layout = assets.layouts.get(id); if (!layout?.slots) return;
    const placements = Object.entries(layout.slots).filter(([slot]) => state.context?.performance !== 'low' || slot === 'hero_installation')
      .flatMap(([, slot]) => slot.placements.map(p => ({ ...p, center: slot.center })));
    const ids = new Set(placements.map(p => p.assetId)); loader.retain(ids);
    try {
      const sources = await Promise.all(placements.map(p => loader.load(p.assetId)));
      if (dead || lost || rev !== revision || latest?.setPiece?.layoutId !== id) return;
      const next = new Group();
      placements.forEach((p, i) => {
        const object = groundModel(sources[i]!, p.targetMaxDimension * UNIT);
        object.rotation.y = p.yawDegrees * Math.PI / 180;
        object.position.set((p.center[0]! + p.position[0]!) * UNIT, p.position[1]! * UNIT, (p.center[2]! + p.position[2]!) * UNIT);
        next.add(object);
      });
      group = next; world.add(next); exiting = false; start = performance.now(); duration = state.context?.reducedMotion ? 1 : 700; map.triggerRepaint();
    } catch (error) { errors.push(String(error)); currentId = null; loader.retain(new Set()); }
  }
  function ensure() { if (!dead && map.isStyleLoaded() && !map.getLayer(layer.id)) map.addLayer(layer, map.getStyle().layers.find(l => l.type === 'symbol')?.id); }
  const moved = () => {
    if (!latest) return;
    // Keep a geographic anchor through pan/rotate; hide if the staging area leaves the safe viewport.
    if (anchor && group) { const p = map.project(anchor.toLngLat()); group.visible = p.x > 250 && p.x < map.getCanvas().clientWidth - 250 && p.y > 100 && p.y < map.getCanvas().clientHeight - 80; }
    if (!group) void update(latest);
  };
  const onLost = () => { lost = true; revision++; };
  const onRestored = () => { lost = false; if (group) world.remove(group); group = null; currentId = null; exiting = false; ensure(); if (latest) void update(latest); };
  const restoreStyle = () => { ensure(); if (latest && !group && !currentId && !errors.length) void update(latest); };
  map.on('idle', restoreStyle); map.on('style.load', restoreStyle); map.on('moveend', moved); map.on('webglcontextlost', onLost); map.on('webglcontextrestored', onRestored); ensure();
  return {
    render: (state: SceneState) => { ensure(); void update(state); },
    stats: () => ({ ...loader.stats(), placementChecks, layout: currentId, placed: !!group, anchor: anchor?.toLngLat(), objects: group?.children.length ?? 0, rendered, errors: [...errors], memory: renderer?.info.memory, draw: renderer?.info.render, visible: group?.visible ?? false }),
    destroy() { dead = true; revision++; map.off('idle', restoreStyle); map.off('style.load', restoreStyle); map.off('moveend', moved); map.off('webglcontextlost', onLost); map.off('webglcontextrestored', onRestored); if (map.getLayer(layer.id)) map.removeLayer(layer.id); loader.destroy(); world.clear(); group = null; currentId = null; anchor = null; },
  };
}
