/**
 * Smooth evolution between atmosphere targets. Retargeting mid-transition
 * starts from the value currently on screen, so rapid quiz answers never jump.
 * Time is injected (performance.now in the renderer, numbers in tests).
 */
import { lerpParams, paramsEqual, type AtmosphereParams } from './params';

/** Cubic ease-in-out: no velocity jump at either end. */
export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface ParamTween {
  /** Start moving toward `target` from whatever is shown at `now`. */
  retarget(target: AtmosphereParams, durationMs: number, now: number): void;
  /** Value at `now`; `done` once the target is reached. */
  sample(now: number): { params: AtmosphereParams; done: boolean };
  target(): AtmosphereParams;
}

export function createTween(initial: AtmosphereParams): ParamTween {
  let from = initial;
  let to = initial;
  let start = 0;
  let duration = 0;

  const at = (now: number) => {
    if (duration <= 0 || now >= start + duration) return { params: to, done: true };
    return { params: lerpParams(from, to, ease((now - start) / duration)), done: false };
  };

  return {
    retarget(target, durationMs, now) {
      if (paramsEqual(target, to)) return;
      from = at(now).params;
      to = target;
      start = now;
      duration = Math.max(0, durationMs);
    },
    sample: at,
    target: () => to,
  };
}
