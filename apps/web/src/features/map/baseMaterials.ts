/**
 * Base-map ground materials: real texture rendering with MapLibre `fill-pattern`.
 *
 * Each material is a *detail* texture: light/dark luminance variation stored
 * in alpha (white or black pixels, never color). It is drawn as its own
 * pattern layer directly above the palette-colored base layer (part of the
 * base style, see withMaterialOverlays), so:
 *  - the base color still comes from the palette (and every Scene Composer
 *    scene), with its normal transitions; the texture only adds grain;
 *  - when textures are unavailable, disabled or still loading, a transparent
 *    placeholder image keeps the plain palette fill (the fallback);
 *  - a scene sets grain strength declaratively (SceneStyle.materialStrength).
 *
 * Only three small textures load, lazily after the map is idle. Sources are the
 * repository's original scene assets (public/scene-assets), referenced by id.
 *
 * Not supported on purpose: textured 3D facades. `fill-extrusion-pattern`
 * replaces the extrusion color (losing scene palettes), puts the same image on
 * roofs and walls, tiles at a fixed screen scale and streaks on walls at close
 * zoom (browser spike, docs/qa/visual-identity). No urban-ground texture: the
 * only candidate (v1/concrete-pores) is a flat grey wash with sub-pixel dots, so
 * it tinted districts without adding visible grain. Buildings use palette-derived
 * OSM material tones instead (mapStyle.ts).
 */
import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';

export type MaterialSurface = 'water' | 'park' | 'plaza';

export interface MaterialSource {
  /** Asset id from public/scene-assets (v1 file stem or v2 atlas asset id). */
  readonly asset: string;
  /** v1: a standalone transparent 256 px tile; v2: a cell of a 4×4 atlas (opaque, converted to detail). */
  readonly kind: 'v1' | 'v2-atlas-cell';
  /** Device pixels per CSS pixel when registered: larger = finer grain on screen. */
  readonly pixelRatio: number;
}

export interface SurfaceSpec {
  readonly surface: MaterialSurface;
  readonly source: MaterialSource;
  /** Base layers (from mapStyle.ts) this texture overlays; same source layer and filter. */
  readonly over: readonly string[];
  /** Overlay opacity at full strength. */
  readonly opacity: number;
}

export const BASE_MATERIALS: readonly SurfaceSpec[] = [
  { surface: 'water', source: { asset: 'water-shimmer', kind: 'v1', pixelRatio: 2 }, over: ['water'], opacity: 0.8 },
  { surface: 'park', source: { asset: 'nature_ground.short_grass.warm', kind: 'v2-atlas-cell', pixelRatio: 3 }, over: ['park', 'landcover-grass'], opacity: 0.5 },
  { surface: 'plaza', source: { asset: 'cobblestone-hatch', kind: 'v1', pixelRatio: 2.5 }, over: ['transport-area'], opacity: 0.32 },
];

const ROOT = '/scene-assets';
export const overlayId = (surface: MaterialSurface, base: string) => `vx-material-${surface}-${base}`;
export const imageId = (surface: MaterialSurface) => `vx-material-${surface}`;

/**
 * Turn an opaque texture into neutral detail: pixels lighter than the tile's
 * mean become white, darker become black, with alpha ∝ the difference. The
 * result adds grain to any base color without tinting it.
 */
export function toDetail(rgba: Uint8ClampedArray, gain = 4): Uint8ClampedArray {
  const n = rgba.length / 4;
  const lum = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const l = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    lum[i] = l;
    mean += l;
  }
  mean /= n || 1;
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < n; i++) {
    const d = lum[i] - mean;
    const v = d > 0 ? 255 : 0;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = Math.min(255, Math.round(Math.abs(d) * gain * 255));
  }
  return out;
}

/** The overlay layer for one base layer: same source, source layer and filter, pattern paint only. */
export function overlayLayer(spec: SurfaceSpec, base: LayerSpecification, strength: number): LayerSpecification | null {
  if (base.type !== 'fill' || !('source' in base)) return null;
  const layer: LayerSpecification = {
    id: overlayId(spec.surface, base.id),
    type: 'fill',
    source: base.source,
    'source-layer': base['source-layer'],
    paint: {
      'fill-pattern': imageId(spec.surface),
      'fill-opacity': spec.opacity * strength,
      // Grain is detail, not information: fade it out before it can alias when zoomed out.
      'fill-antialias': false,
    },
  } as LayerSpecification;
  if (base.filter) (layer as { filter?: unknown }).filter = base.filter;
  if (base.minzoom !== undefined) layer.minzoom = Math.max(base.minzoom, 12);
  else layer.minzoom = 12;
  return layer;
}

interface AtlasManifest {
  readonly assets: readonly { id: string; atlas: string; rect: [number, number, number, number] }[];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`texture failed to load: ${url}`));
    img.src = url;
  });
}

async function rasterize(source: MaterialSource, manifest: () => Promise<AtlasManifest>): Promise<ImageData> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2D canvas unavailable');
  if (source.kind === 'v1') {
    g.drawImage(await loadImage(`${ROOT}/v1/${source.asset}.svg`), 0, 0, 256, 256);
    return g.getImageData(0, 0, 256, 256);
  }
  const entry = (await manifest()).assets.find((a) => a.id === source.asset);
  if (!entry) throw new Error(`unknown atlas asset: ${source.asset}`);
  const [x, y, w, h] = entry.rect;
  g.drawImage(await loadImage(`${ROOT}/v2/${entry.atlas}`), x, y, w, h, 0, 0, 256, 256);
  const data = g.getImageData(0, 0, 256, 256);
  return new ImageData(toDetail(data.data) as Uint8ClampedArray<ArrayBuffer>, 256, 256);
}

/**
 * Insert each material's overlay right after its base layer. Used by
 * mapStyle.buildMapStyle, so the layer list is fixed from the first frame
 * and never changes at runtime (previews and scenes can compare styles).
 */
export function withMaterialOverlays(layers: LayerSpecification[], strength = 1, specs: readonly SurfaceSpec[] = BASE_MATERIALS): LayerSpecification[] {
  const out: LayerSpecification[] = [];
  for (const layer of layers) {
    out.push(layer);
    for (const spec of specs) {
      if (!spec.over.includes(layer.id)) continue;
      const overlay = overlayLayer(spec, layer, strength);
      if (overlay) out.push(overlay);
    }
  }
  return out;
}

export interface BaseMaterials {
  /** Show or hide every material overlay (the palette fills remain). */
  setEnabled(enabled: boolean): void;
  /** Scale every overlay's opacity, 0–1 (a scene may soften or remove grain). */
  setStrength(strength: number): void;
  /** Turn one surface's texture on or off. */
  setSurface(surface: MaterialSurface, enabled: boolean): void;
  stats(): { loaded: MaterialSurface[]; layers: string[]; errors: string[]; enabled: boolean; strength: number };
  destroy(): void;
}

export interface BaseMaterialsOptions {
  readonly specs?: readonly SurfaceSpec[];
  readonly enabled?: boolean;
  readonly strength?: number;
  /** When to start loading (default: first map idle, then browser idle time). */
  readonly schedule?: (start: () => void) => void;
}

export function mountBaseMaterials(map: MapLibreMap, options: BaseMaterialsOptions = {}): BaseMaterials {
  const specs = options.specs ?? BASE_MATERIALS;
  let enabled = options.enabled ?? true;
  let strength = options.strength ?? 1;
  const off = new Set<MaterialSurface>();
  const loaded = new Set<MaterialSurface>();
  const errors: string[] = [];
  let destroyed = false;
  let manifestPromise: Promise<AtlasManifest> | null = null;
  const manifest = () => (manifestPromise ??= fetch(`${ROOT}/v2/manifest.json`).then((r) => r.json() as Promise<AtlasManifest>));
  const layerIds = () => specs.flatMap((s) => s.over.map((b) => overlayId(s.surface, b)));
  const bySurfaceImage = new Map(specs.map((s) => [imageId(s.surface), s]));

  // The overlays are in the base style; until a texture arrives they draw a
  // transparent placeholder (the plain palette fill shows through).
  const placeholder = () => ({ width: 256, height: 256, data: new Uint8Array(256 * 256 * 4) });
  const onMissing = (e: { id: string }) => {
    const spec = bySurfaceImage.get(e.id);
    if (spec && !map.hasImage(e.id)) map.addImage(e.id, placeholder(), { pixelRatio: spec.source.pixelRatio });
  };
  map.on('styleimagemissing', onMissing);
  // Pre-register when the style is ready, so the first tiles never miss.
  const preregister = () => specs.forEach((s) => onMissing({ id: imageId(s.surface) }));
  if (map.isStyleLoaded()) preregister();
  else map.once('load', preregister);

  function sync() {
    for (const spec of specs) {
      for (const baseId of spec.over) {
        const id = overlayId(spec.surface, baseId);
        if (!map.getLayer(id)) continue;
        map.setLayoutProperty(id, 'visibility', enabled && !off.has(spec.surface) ? 'visible' : 'none');
        if (options.strength !== undefined || strength !== 1) map.setPaintProperty(id, 'fill-opacity', spec.opacity * strength);
      }
    }
  }

  async function load() {
    for (const spec of specs) {
      if (destroyed) return;
      try {
        const data = await rasterize(spec.source, manifest);
        if (destroyed) return;
        const id = imageId(spec.surface);
        if (map.hasImage(id)) map.updateImage(id, data);
        else map.addImage(id, data, { pixelRatio: spec.source.pixelRatio });
        loaded.add(spec.surface);
        map.triggerRepaint();
      } catch (error) {
        errors.push(String(error)); // the palette fill remains: a missing texture is only less detail
      }
    }
  }

  const schedule =
    options.schedule ??
    ((start: () => void) => {
      const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 2000 }) : setTimeout(cb, 200));
      map.once('idle', () => idle(start));
    });
  schedule(() => void load());

  return {
    setEnabled(next) {
      enabled = next;
      sync();
    },
    setStrength(next) {
      strength = Math.max(0, Math.min(1, next));
      sync();
    },
    setSurface(surface, on) {
      if (on) off.delete(surface);
      else off.add(surface);
      sync();
    },
    stats: () => ({ loaded: [...loaded], layers: layerIds().filter((id) => !!map.getLayer(id)), errors: [...errors], enabled, strength }),
    destroy() {
      destroyed = true;
      map.off('styleimagemissing', onMissing);
      map.off('load', preregister);
      enabled = false;
      sync();
    },
  };
}
