import { describe, expect, it } from 'vitest';
import { CAMERA_KEYS, cameraStep, isTypingTarget, PAN_PX_PER_S, PITCH_DEG_PER_S, ROTATE_DEG_PER_S, ZOOM_PER_S } from './keyboardCamera';

const step = (codes: string[], dt = 1) => cameraStep(new Set(codes), dt);

describe('cameraStep', () => {
  it('does nothing with no keys held', () => {
    expect(step([])).toEqual({ panX: 0, panY: 0, bearing: 0, pitch: 0, zoom: 0 });
  });

  it('moves with WASD in screen directions (W = forward, up the screen)', () => {
    expect(step(['KeyW'])).toMatchObject({ panX: 0, panY: -PAN_PX_PER_S });
    expect(step(['KeyS'])).toMatchObject({ panX: 0, panY: PAN_PX_PER_S });
    expect(step(['KeyA'])).toMatchObject({ panX: -PAN_PX_PER_S, panY: 0 });
    expect(step(['KeyD'])).toMatchObject({ panX: PAN_PX_PER_S, panY: 0 });
  });

  it('keeps diagonal movement at the same speed', () => {
    const { panX, panY } = step(['KeyW', 'KeyD']);
    expect(Math.hypot(panX, panY)).toBeCloseTo(PAN_PX_PER_S, 6);
  });

  it('turns with left/right arrows and tilts with up/down', () => {
    expect(step(['ArrowLeft'])).toMatchObject({ bearing: -ROTATE_DEG_PER_S, pitch: 0 });
    expect(step(['ArrowRight'])).toMatchObject({ bearing: ROTATE_DEG_PER_S, pitch: 0 });
    expect(step(['ArrowUp'])).toMatchObject({ bearing: 0, pitch: PITCH_DEG_PER_S });
    expect(step(['ArrowDown'])).toMatchObject({ bearing: 0, pitch: -PITCH_DEG_PER_S });
  });

  it('zooms with +/- (main row or numpad) while held', () => {
    expect(step(['Equal'])).toMatchObject({ zoom: ZOOM_PER_S });
    expect(step(['NumpadAdd'])).toMatchObject({ zoom: ZOOM_PER_S });
    expect(step(['Minus'])).toMatchObject({ zoom: -ZOOM_PER_S });
    expect(step(['Equal', 'NumpadAdd'], 0.5)).toMatchObject({ zoom: ZOOM_PER_S / 2 });
  });

  it('cancels opposite keys', () => {
    expect(step(['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus'])).toEqual({ panX: 0, panY: 0, bearing: 0, pitch: 0, zoom: 0 });
  });

  it('scales by elapsed time', () => {
    expect(step(['KeyW', 'ArrowRight'], 0.5)).toMatchObject({ panY: -PAN_PX_PER_S / 2, bearing: ROTATE_DEG_PER_S / 2 });
  });

  it('lists every key it handles', () => {
    for (const code of CAMERA_KEYS) expect(step([code])).not.toEqual({ panX: 0, panY: 0, bearing: 0, pitch: 0, zoom: 0 });
  });
});

describe('isTypingTarget', () => {
  it('treats text fields, selects and editable content as typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('lets keys through from the map, buttons and the page', () => {
    expect(isTypingTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
