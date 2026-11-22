import { describe, expect, it } from 'vitest';
import { focalLengthPx, perspectiveScale, PIN_SCALE_MAX, PIN_SCALE_MIN, PIN_SCALE_STEP, quantizeScale } from './pinPerspective';

describe('perspectiveScale', () => {
  const f = focalLengthPx(800, 36.87); // MapLibre's default vertical FOV

  it('is 1 at the screen center', () => {
    expect(perspectiveScale(0, 60, f)).toBe(1);
  });

  it('is 1 everywhere when the map is flat', () => {
    expect(perspectiveScale(-300, 0, f)).toBe(1);
    expect(perspectiveScale(300, 0, f)).toBe(1);
  });

  it('shrinks pins above the center (farther away) when tilted', () => {
    const s = perspectiveScale(-200, 60, f);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(PIN_SCALE_MIN);
  });

  it('shrinks more the farther up the screen, and with more tilt', () => {
    expect(perspectiveScale(-250, 60, f)).toBeLessThan(perspectiveScale(-100, 60, f));
    expect(perspectiveScale(-100, 70, f)).toBeLessThan(perspectiveScale(-100, 30, f));
  });

  it('matches the pinhole-camera ratio of distances to the ground', () => {
    // Pitch 45°, a point a quarter of the focal length above center:
    // 1 + tan(45°) * (-0.25) = 0.75.
    expect(perspectiveScale(-f / 4, 45, f)).toBeCloseTo(0.75, 6);
  });

  it('clamps near the horizon and close to the camera', () => {
    expect(perspectiveScale(-10_000, 75, f)).toBe(PIN_SCALE_MIN);
    expect(perspectiveScale(10_000, 75, f)).toBe(PIN_SCALE_MAX);
  });
});

describe('quantizeScale', () => {
  it('rounds to the nearest step as a stable string', () => {
    expect(PIN_SCALE_STEP).toBe(0.05);
    expect(quantizeScale(0.524)).toBe('0.50');
    expect(quantizeScale(0.526)).toBe('0.55');
    expect(quantizeScale(1)).toBe('1.00');
  });

  it('gives the same string for small camera movements, so nothing is rewritten', () => {
    expect(quantizeScale(0.731)).toBe(quantizeScale(0.744));
  });
});

describe('focalLengthPx', () => {
  it('puts the top edge of the viewport at half the FOV', () => {
    expect(focalLengthPx(800, 90)).toBeCloseTo(400, 6);
  });
});
