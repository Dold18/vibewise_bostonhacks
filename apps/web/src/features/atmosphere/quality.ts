/**
 * Device-aware quality: a starting tier from what the browser reports, then a
 * runtime governor that steps down (never silently up) when animated frames
 * miss their budget. Pure: the environment and frame times are injected.
 */
import type { Quality } from './compose';

export interface DeviceInfo {
  readonly hardwareConcurrency?: number;
  /** navigator.deviceMemory (GB, Chromium only). */
  readonly deviceMemory?: number;
  readonly devicePixelRatio?: number;
  /** navigator.connection.saveData */
  readonly saveData?: boolean;
  /** Coarse pointer / touch-first device. */
  readonly mobile?: boolean;
  /** CSS-pixel viewport area. */
  readonly viewportArea?: number;
}

export function detectQuality(d: DeviceInfo): { quality: Quality; reasons: string[] } {
  const reasons: string[] = [];
  const cores = d.hardwareConcurrency ?? 4;
  const memory = d.deviceMemory ?? 8;
  const dpr = d.devicePixelRatio ?? 1;
  const pixels = (d.viewportArea ?? 1280 * 800) * dpr * dpr;
  if (d.saveData) return { quality: 'low', reasons: ['data saver on'] };
  let score = 0;
  if (cores >= 8) score++, reasons.push(`${cores} cores`);
  else if (cores <= 2) score--, reasons.push(`${cores} cores`);
  if (memory >= 8) score++, reasons.push(`${memory} GB`);
  else if (memory <= 2) score -= 2, reasons.push(`${memory} GB`);
  if (d.mobile) score--, reasons.push('mobile');
  // Fill-rate is what full-screen passes pay for.
  if (pixels > 7_000_000) score--, reasons.push(`${(pixels / 1e6).toFixed(1)} MP drawing buffer`);
  return { quality: score >= 2 ? 'high' : score <= -1 ? 'low' : 'medium', reasons };
}

export function readDevice(): DeviceInfo {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const w = typeof window !== 'undefined' ? window : undefined;
  return {
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    devicePixelRatio: w?.devicePixelRatio,
    saveData: nav.connection?.saveData,
    mobile: w?.matchMedia?.('(pointer: coarse)').matches ?? false,
    viewportArea: w ? w.innerWidth * w.innerHeight : undefined,
  };
}

/** Scene Composer performance context for the same device (drives its effect budget). */
export const performanceTier = (q: Quality): 'low' | 'medium' | 'high' => q;

const DOWN: Record<Quality, Quality | null> = { high: 'medium', medium: 'low', low: null };

export interface FrameGovernor {
  /** Record one animated frame interval (ms) at a target fps. Returns a new tier when it should change. */
  record(intervalMs: number, targetFps: number): Quality | null;
  readonly quality: Quality;
  readonly history: readonly string[];
}

/**
 * Steps down when the 80th-percentile animated frame interval over a window
 * exceeds 1.6× the target interval (sustained jank, not a one-off GC pause).
 */
export function createGovernor(initial: Quality, windowSize = 90): FrameGovernor {
  let quality = initial;
  let samples: number[] = [];
  const history: string[] = [];
  return {
    get quality() {
      return quality;
    },
    history,
    record(intervalMs, targetFps) {
      if (!(intervalMs > 0) || targetFps <= 0) return null;
      samples.push(intervalMs);
      if (samples.length < windowSize) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      const p80 = sorted[Math.floor(sorted.length * 0.8)];
      samples = [];
      const budget = 1000 / targetFps;
      const next = DOWN[quality];
      if (p80 > budget * 1.6 && next) {
        history.push(`${quality}→${next}: p80 frame ${p80.toFixed(1)} ms > ${(budget * 1.6).toFixed(1)} ms`);
        quality = next;
        return quality;
      }
      return null;
    },
  };
}
