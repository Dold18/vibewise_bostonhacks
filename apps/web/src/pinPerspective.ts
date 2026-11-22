/**
 * Perspective sizing for map pins in the tilted (2.5D) view.
 *
 * MapLibre draws DOM markers at a fixed pixel size no matter how far away
 * they are, so tilted pins near the horizon look as big as the ones at your
 * feet. This works out how much smaller (or larger) a pin should be, compared
 * to a pin at the screen center, from where it sits on screen.
 *
 * Pinhole camera looking at flat ground with pitch θ (0 = straight down) and
 * focal length f in pixels. A ground point drawn dy pixels below the center
 * is seen along a ray α = atan(dy / f) off the view axis. Its depth compared
 * to the center's is cosθ·cosα / cos(θ − α), so its apparent size is
 *
 *   cos(θ − α) / (cosθ · cosα) = 1 + tanθ · tanα = 1 + tanθ · dy / f
 *
 * which is exactly 1 at the center and everywhere when the map is flat.
 */

/** Smallest a pin gets near the horizon, so far pins stay visible and clickable. */
export const PIN_SCALE_MIN = 0.4;
/** Largest a pin gets at the bottom of the screen, so near pins don't swamp the view. */
export const PIN_SCALE_MAX = 1.2;

/**
 * Pins resize in steps this big rather than continuously. Writing a new size
 * to every pin on every camera frame forces the browser to restyle and
 * repaint all of them and dropped the moving map from 60 to ~25 fps; in
 * 0.05 steps (1-2 px on a 40 px pin) most frames change nothing.
 */
export const PIN_SCALE_STEP = 0.05;

/** `scale` rounded to PIN_SCALE_STEP, as the string written to --pin-distance. */
export function quantizeScale(scale: number): string {
  return (Math.round(scale / PIN_SCALE_STEP) * PIN_SCALE_STEP).toFixed(2);
}

/** Focal length in pixels for a viewport `heightPx` tall with vertical FOV `fovDeg`. */
export function focalLengthPx(heightPx: number, fovDeg: number): number {
  return heightPx / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Size of a pin whose ground point is `dyPx` below the screen center
 * (negative = above, i.e. farther away), relative to a pin at the center.
 */
export function perspectiveScale(dyPx: number, pitchDeg: number, focalPx: number): number {
  const scale = 1 + Math.tan((pitchDeg * Math.PI) / 180) * (dyPx / focalPx);
  return Math.min(PIN_SCALE_MAX, Math.max(PIN_SCALE_MIN, scale));
}
