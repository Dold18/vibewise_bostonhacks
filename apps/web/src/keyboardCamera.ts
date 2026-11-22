/**
 * Keyboard camera controls, game style: WASD moves across the map in screen
 * directions (W = forward, toward the top of the screen, so it follows the
 * camera's heading), Left/Right arrows turn the camera, Up/Down tilt it and
 * +/- zoom. Zoom is a held key like the rest (not MapLibre's zoomIn ease),
 * because the per-frame camera update would cancel an ease after one frame.
 *
 * Keys are matched by `KeyboardEvent.code` (physical position), so WASD sits
 * in the same place on AZERTY and other layouts. Movement is continuous while
 * a key is held: main.ts calls `cameraStep` every animation frame.
 */

/** Pan speed in screen pixels per second. */
export const PAN_PX_PER_S = 600;
/** Turn speed in degrees of bearing per second. */
export const ROTATE_DEG_PER_S = 90;
/** Tilt speed in degrees of pitch per second. */
export const PITCH_DEG_PER_S = 45;
/** Zoom speed in zoom levels per second. */
export const ZOOM_PER_S = 2;

const ZOOM_IN_KEYS = ['Equal', 'NumpadAdd'];
const ZOOM_OUT_KEYS = ['Minus', 'NumpadSubtract'];

export const CAMERA_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  ...ZOOM_IN_KEYS,
  ...ZOOM_OUT_KEYS,
]);

/** Camera change for one frame: pan in screen pixels, bearing and pitch in degrees, zoom in levels. */
export interface CameraStep {
  panX: number;
  panY: number;
  bearing: number;
  pitch: number;
  zoom: number;
}

/** How far to move the camera after `dtSeconds` with the keys in `held` down. */
export function cameraStep(held: ReadonlySet<string>, dtSeconds: number): CameraStep {
  const axis = (neg: string, pos: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  const x = axis('KeyA', 'KeyD');
  const y = axis('KeyW', 'KeyS');
  const len = Math.hypot(x, y) || 1; // diagonals no faster than straight lines
  const pan = (PAN_PX_PER_S * dtSeconds) / len;
  return {
    panX: x * pan,
    panY: y * pan,
    bearing: axis('ArrowLeft', 'ArrowRight') * ROTATE_DEG_PER_S * dtSeconds,
    pitch: axis('ArrowDown', 'ArrowUp') * PITCH_DEG_PER_S * dtSeconds,
    zoom: (anyHeld(held, ZOOM_IN_KEYS) - anyHeld(held, ZOOM_OUT_KEYS)) * ZOOM_PER_S * dtSeconds,
  };
}

const anyHeld = (held: ReadonlySet<string>, codes: string[]) => (codes.some((c) => held.has(c)) ? 1 : 0);

/** Whether keys pressed on `target` are meant for a form control rather than the map. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
