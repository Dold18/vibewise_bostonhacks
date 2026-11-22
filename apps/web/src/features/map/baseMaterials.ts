/**
 * Base-map ground materials: real texture rendering with MapLibre `fill-pattern`.
 *
 * Each material is a *detail* texture: light/dark luminance variation stored
 * in alpha (white or black pixels, never color). It is drawn as its own
 * pattern layer directly above the palette-colored base layer, so:
 *  - the base color still comes from the palette (and every Scene Composer
 *    scene), with its normal transitions; the texture only adds grain;
 *  - the base style (mapStyle.ts) is unchanged when textures are unavailable,
 *    disabled, or still loading (the fallback is the plain palette fill).
 *
 * Only four small textures load, lazily after the map is idle. Sources are the
 * repository's original scene assets (public/scene-assets), referenced by id.
 *
 * Not supported on purpose: textured 3D facades. `fill-extrusion-pattern`
 * replaces the extrusion color (losing scene palettes), puts the same image on
 * roofs and walls, tiles at a fixed screen scale and streaks on walls at close
 * zoom (browser spike, docs/qa/visual-identity). Buildings use palette-derived
 * OSM material tones instead (mapStyle.ts).
 */
import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';

export type MaterialSurface = 'water' | 'park' | 'urban' | 'plaza';

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
  { surface: 'urban', source: { asset: 'concrete-pores', kind: 'v1', pixelRatio: 2 }, over: ['landuse-urban'], opacity: 0.4 },
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
  const images = new Map<MaterialSurface, ImageData>();
  const errors: string[] = [];
  let destroyed = false;
  let manifestPromise: Promise<AtlasManifest> | null = null;
  const manifest = () => (manifestPromise ??= fetch(`${ROOT}/v2/manifest.json`).then((r) => r.json() as Promise<AtlasManifest>));

  const layerIds = () => specs.flatMap((s) => s.over.map((b) => overlayId(s.surface, b)));

  function install(spec: SurfaceSpec) {
    const data = images.get(spec.surface);
    // The style object exists once loaded; isStyleLoaded() is also false while
    // tiles stream in, which is not a reason to skip installing a layer.
    if (!data || destroyed || !map.getStyle()?.layers) return;
    if (!map.hasImage(imageId(spec.surface))) map.addImage(imageId(spec.surface), data, { pixelRatio: spec.source.pixelRatio });
    const order = map.getStyle().layers.map((l) => l.id);
    for (const baseId of spec.over) {
      const base = map.getStyle().layers.find((l) => l.id === baseId);
      const id = overlayId(spec.surface, baseId);
      if (!base || map.getLayer(id)) continue;
      const layer = overlayLayer(spec, base, strength);
      if (!layer) continue;
      const next = order[order.indexOf(baseId) + 1];
      map.addLayer(layer, next && map.getLayer(next) ? next : undefined);
    }
    sync();
  }

  function sync() {
    for (const spec of specs) {
      for (const baseId of spec.over) {
        const id = overlayId(spec.surface, baseId);
        if (!map.getLayer(id)) continue;
        map.setLayoutProperty(id, 'visibility', enabled && !off.has(spec.surface) ? 'visible' : 'none');
        map.setPaintProperty(id, 'fill-opacity', spec.opacity * strength);
      }
    }
  }

  async function load() {
    for (const spec of specs) {
      if (destroyed) return;
      try {
        images.set(spec.surface, await rasterize(spec.source, manifest));
        install(spec);
      } catch (error) {
        errors.push(String(error)); // the palette fill remains: a missing texture is only less detail
      }
    }
  }

  const reinstall = () => specs.forEach(install);
  map.on('style.load', reinstall);
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
    stats: () => ({ loaded: [...images.keys()], layers: layerIds().filter((id) => !!map.getLayer(id)), errors: [...errors], enabled, strength }),
    destroy() {
      destroyed = true;
      map.off('style.load', reinstall);
      for (const id of layerIds()) if (map.getLayer(id)) map.removeLayer(id);
      for (const s of specs) if (map.hasImage(imageId(s.surface))) map.removeImage(imageId(s.surface));
    },
  };
}
