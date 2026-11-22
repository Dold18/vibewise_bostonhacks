/**
 * Packs a BuildingAppearance into shader uniform arrays. Pure, so it is unit
 * tested without WebGL. Nothing here knows about themes — only parameters.
 */
import {
  CORNER_STYLES,
  MAX_FACADES,
  MAX_ROOFS,
  ROOF_KINDS,
  SURFACE_KINDS,
  WINDOW_SHAPES,
  type BuildingAppearance,
  type SurfaceMaterial,
} from './contract';

/** Asset ref → texture-array layer (layer 0 is plain white = no texture). */
export type LayerTable = Map<string, number>;

export type UniformValue = { type: '1f'; value: number } | { type: '3fv' | '4fv'; value: Float32Array };

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) return [0.6, 0.6, 0.6];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Every asset ref a config needs, in first-use order. */
export function assetRefs(a: BuildingAppearance): string[] {
  const refs: string[] = [];
  const add = (s: SurfaceMaterial) => {
    if (s.asset && !refs.includes(s.asset)) refs.push(s.asset);
  };
  a.facades.forEach((f) => add(f.wall));
  a.roofs.forEach((r) => add(r.surface));
  return refs;
}

/** Unit vector toward the sun in the renderer frame (x east, y south, z up). */
export function sunDirection(azimuthDeg: number, altitudeDeg: number): [number, number, number] {
  const az = rad(azimuthDeg), alt = rad(altitudeDeg);
  return [Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), Math.sin(alt)];
}

export function uniformValues(a: BuildingAppearance, layers: LayerTable): Record<string, UniformValue> {
  const v4 = (n: number) => new Float32Array(n * 4);
  const v3 = (n: number) => new Float32Array(n * 3);
  const fWallA = v4(MAX_FACADES), fWallB = v4(MAX_FACADES), fWallC = v4(MAX_FACADES);
  const fWinA = v4(MAX_FACADES), fWinB = v4(MAX_FACADES);
  const fGlass = v3(MAX_FACADES), fFrame = v3(MAX_FACADES), fGlow = v3(MAX_FACADES);
  const fTrimA = v4(MAX_FACADES), fTrimB = v4(MAX_FACADES), fTrimC = v4(MAX_FACADES);
  const rA = v4(MAX_ROOFS), rB = v4(MAX_ROOFS), rC = v4(MAX_ROOFS);
  const layerOf = (s: SurfaceMaterial) => (s.asset ? layers.get(s.asset) ?? 0 : 0);

  a.facades.slice(0, MAX_FACADES).forEach((f, i) => {
    const w = f.wall;
    fWallA.set([...hexToRgb(w.color), w.tintStrength], i * 4);
    fWallB.set([layerOf(w), w.textureScale, rad(w.textureRotation), SURFACE_KINDS.indexOf(w.kind)], i * 4);
    fWallC.set([w.roughness, w.reflectivity, w.weathering, 0], i * 4);
    const win = f.windows;
    fWinA.set([WINDOW_SHAPES.indexOf(win.shape), win.floorHeight, win.bayWidth, win.litFraction], i * 4);
    fWinB.set([win.widthRatio, win.heightRatio, win.storefront ? 1 : 0, 0], i * 4);
    fGlass.set(hexToRgb(win.glassColor), i * 3);
    fFrame.set(hexToRgb(win.frameColor), i * 3);
    fGlow.set(hexToRgb(win.glowColor), i * 3);
    const t = f.trim;
    fTrimA.set([...hexToRgb(t.color), CORNER_STYLES.indexOf(t.corners)], i * 4);
    fTrimB.set([t.corniceHeight, t.baseHeight, t.stringCourses ? 1 : 0, t.cornerWidth], i * 4);
    fTrimC.set([t.parapetHeight, 0, 0, 0], i * 4);
  });
  a.roofs.slice(0, MAX_ROOFS).forEach((r, i) => {
    const s = r.surface;
    rA.set([...hexToRgb(s.color), s.tintStrength], i * 4);
    rB.set([layerOf(s), s.textureScale, rad(s.textureRotation), ROOF_KINDS.indexOf(r.kind)], i * 4);
    rC.set([s.roughness, s.reflectivity, s.weathering, 0], i * 4);
  });

  const L = a.lighting;
  return {
    u_fWallA: { type: '4fv', value: fWallA },
    u_fWallB: { type: '4fv', value: fWallB },
    u_fWallC: { type: '4fv', value: fWallC },
    u_fWinA: { type: '4fv', value: fWinA },
    u_fWinB: { type: '4fv', value: fWinB },
    u_fGlass: { type: '3fv', value: fGlass },
    u_fFrame: { type: '3fv', value: fFrame },
    u_fGlowC: { type: '3fv', value: fGlow },
    u_fTrimA: { type: '4fv', value: fTrimA },
    u_fTrimB: { type: '4fv', value: fTrimB },
    u_fTrimC: { type: '4fv', value: fTrimC },
    u_rA: { type: '4fv', value: rA },
    u_rB: { type: '4fv', value: rB },
    u_rC: { type: '4fv', value: rC },
    u_sunDir: { type: '3fv', value: new Float32Array(sunDirection(L.sunAzimuth, L.sunAltitude)) },
    u_sunColor: { type: '3fv', value: new Float32Array(hexToRgb(L.sunColor)) },
    u_ambient: { type: '1f', value: L.ambient },
    u_night: { type: '1f', value: L.night },
    u_glow: { type: '1f', value: L.glowStrength },
    u_sky: { type: '3fv', value: new Float32Array(hexToRgb(L.skyColor)) },
    u_horizon: { type: '3fv', value: new Float32Array(hexToRgb(L.horizonColor)) },
    u_strength: { type: '1f', value: a.strength },
  };
}
