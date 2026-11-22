import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';
import type { SceneState } from './state';
import type { createSvgCache } from './svg';

/** Pattern decals on actual vector geometry; no simulated physical reflectivity. */
export const MATERIALS: Record<string, Record<string, string>> = {
  'roads_and_ground.street_material': { aged_asphalt: 'pavement.coarse_asphalt.warm', wet_asphalt: 'asphalt-grit', stone: 'stone_concrete.granite_blocks.warm', cobblestone_illustration: 'pavement.rounded_cobbles.warm', paper_texture: 'paper-grain' },
  'roads_and_ground.wet_sheen': { subtle: 'wet-sheen', moderate: 'wet-sheen', rainy_night: 'wet-sheen' },
  'building_surfaces.facade_look': { brick_illustration: 'brick_masonry.running_bond.warm', stone_blocks: 'stone-blocks', glass_grid: 'glass_metal.window_grid.cool', wood_slats: 'timber.vertical_wood.warm', smooth_cement: 'concrete-pores', paper_cutout: 'paper-grain' },
  'building_surfaces.window_pattern': { sparse_warm: 'windows-amber', randomized_warm: 'windows-amber', office_cool: 'windows-ice', full_grid: 'facade-glass-grid', neon_accent: 'windows-ice' },
  'water_and_coast.water_texture': { gentle_ripples: 'water_surface.subtle_ripples.cool', fine_lines: 'water-ripples' },
  'water_and_coast.water_reflectivity': { soft_sheen: 'water-shimmer', moon_streak: 'water_surface.moon_shimmer.nocturnal' },
};

export function mountMaterials(map: MapLibreMap, svg: ReturnType<typeof createSvgCache>) {
  let destroyed = false, revision = 0;
  let latest: SceneState | null = null;
  const layers = new Set<string>(), images = new Set<string>();
  const extrusionOpacities = new Map<string, number>();
  const pitchFactor = () => Math.min(1, Math.max(0, map.getPitch() / 40));
  const onPitch = () => { for (const [id, opacity] of extrusionOpacities) if (map.getLayer(id)) map.setPaintProperty(id, 'fill-extrusion-opacity', opacity * pitchFactor()); };
  const errors: string[] = [];
  async function render(state: SceneState) {
    latest = state; const rev = ++revision;
    if (!map.getLayer('water')) return;
    for (const id of layers) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    if (state.context?.navigation !== 'browse' || state.context?.materialsEnabled === false) return;
    const originals = map.getStyle().layers.filter(l => !l.id.startsWith('scene-'));
    for (const [key, variants] of Object.entries(MATERIALS)) {
      const assetId = variants[state.resolved[key]];
      if (!assetId || !state.strengths[key]) continue;
      const imageId = `scene-${assetId}`;
      try {
        if (!map.hasImage(imageId)) {
          const data = await svg.load(assetId);
          if (destroyed || rev !== revision) return;
          if (!map.hasImage(imageId)) map.addImage(imageId, data, { pixelRatio: 2 });
          images.add(imageId);
        }
        for (const original of originals) {
          const road = key.startsWith('roads_') && original.type === 'line' && 'source-layer' in original && original['source-layer'] === 'transportation' && !original.id.endsWith('casing') && original.id !== 'rail';
          const building = key.startsWith('building_') && original.type === 'fill-extrusion' && original.id === 'building-3d';
          const water = key.startsWith('water_') && original.id === 'water';
          if (!road && !building && !water) continue;
          const id = `scene-material-${key}-${original.id}`;
          const type = original.type as 'line' | 'fill' | 'fill-extrusion';
          const baseOpacity = Math.min(building ? 0.25 : 0.2, state.strengths[key]! * 0.2);
          if (building) extrusionOpacities.set(id, baseOpacity);
          const opacity = baseOpacity * (building ? pitchFactor() : 1);
          if (!map.getLayer(id)) {
            const clone = structuredClone(original) as LayerSpecification;
            clone.id = id;
            // Pattern colors do not need the palette's six height bands: one overlay per treatment.
            if (clone.type === 'fill-extrusion') clone.filter = ['!', ['has', 'hide_3d']];
            clone.paint = { ...original.paint, [`${type}-pattern`]: imageId, [`${type}-opacity`]: opacity };
            const next = building ? originals.find(l => l.type === 'symbol')?.id : originals[originals.indexOf(original) + 1]?.id;
            map.addLayer(clone, next); layers.add(id);
          } else {
            map.setPaintProperty(id, `${type}-pattern`, imageId);
            map.setPaintProperty(id, `${type}-opacity`, opacity);
            map.setLayoutProperty(id, 'visibility', 'visible');
          }
        }
      } catch (e) { errors.push(String(e)); }
    }
  }
  const restore = () => { if (latest) void render(latest); };
  map.on('style.load', restore); map.on('pitch', onPitch);
  return {
    render: (state: SceneState) => { void render(state); },
    stats: () => ({ layers: [...layers].filter(id => !!map.getLayer(id)), images: images.size, assetIds: [...images].map(id => id.slice(6)), active: [...layers].filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none'), errors: [...errors] }),
    destroy() {
      destroyed = true; revision++; map.off('style.load', restore); map.off('pitch', onPitch);
      for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of images) if (map.hasImage(id)) map.removeImage(id);
      layers.clear(); images.clear(); extrusionOpacities.clear();
    },
  };
}
