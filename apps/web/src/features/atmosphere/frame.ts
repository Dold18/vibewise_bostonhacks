/** Per-frame state shared by the atmosphere's GL layers, and their counters. */
import type { AtmospherePlan } from './compose';
import type { RGB } from './params';

export interface FrameState {
  /** Composed plan with the tweened parameters for this frame. */
  readonly plan: AtmospherePlan;
  /** Animation clock in seconds, already scaled by `motion` (frozen at 0 motion). */
  readonly time: number;
  /** 0 daylight … 1 night. */
  readonly darkness: number;
  /** MapLibre light azimuth (degrees, viewport-anchored: 0 = top of screen, clockwise). */
  readonly lightAzimuth: number;
  readonly lightIntensity: number;
  readonly lightColor: RGB;
}

export interface LayerStats {
  worldFrames: number;
  gradeFrames: number;
  /** CPU time spent issuing GL commands (not GPU execution time). */
  worldCpuMs: number;
  gradeCpuMs: number;
  drawCalls: number;
  /** Live GPU memory owned by the atmosphere (bytes, estimated from allocations). */
  bufferBytes: number;
  textureBytes: number;
  framebufferBytes: number;
  /** GL resource (re)allocations over the lifetime of the renderer. */
  allocations: number;
  texturesLoaded: string[];
  fogSigma: number;
  bloomPasses: number;
}

export const newStats = (): LayerStats => ({
  worldFrames: 0, gradeFrames: 0, worldCpuMs: 0, gradeCpuMs: 0, drawCalls: 0,
  bufferBytes: 0, textureBytes: 0, framebufferBytes: 0, allocations: 0, texturesLoaded: [], fogSigma: 0, bloomPasses: 0,
});
