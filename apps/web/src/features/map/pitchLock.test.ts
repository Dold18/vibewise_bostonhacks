import { describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { createPitchLock } from './pitchLock';
function fakeMap() {
  let pitch = 60, bearing = -20, max = 75;
  const events = new Map<string, () => void>();
  const handler = () => ({ isEnabled: () => true, disable: vi.fn(), enable: vi.fn(), disableRotation: vi.fn(), enableRotation: vi.fn() });
  const map = { getPitch: () => pitch, getBearing: () => bearing, getMaxPitch: () => max,
    setMaxPitch: vi.fn((n: number) => { max = n; pitch = Math.min(n, pitch); }),
    easeTo: vi.fn((o: {pitch: number; bearing: number}) => { pitch = Math.min(o.pitch, max); bearing = o.bearing; }),
    on: (e: string, f: () => void) => events.set(e, f), off: vi.fn(),
    dragRotate: handler(), touchPitch: handler(), touchZoomRotate: handler(), keyboard: handler(),
  };
  return { map, events, asMap: map as unknown as MapLibreMap };
}
describe('navigation pitch lock', () => {
  it('locks all pitch gestures, preserves zoom/pan handlers, and restores the camera', () => {
    const f = fakeMap(), change = vi.fn(), lock = createPitchLock(f.asMap, { onChange: change });
    lock.lock(); lock.lock(); f.events.get('moveend')!();
    expect(f.map.getPitch()).toBe(0); expect(f.map.getMaxPitch()).toBe(0);
    expect(f.map.dragRotate.disable).toHaveBeenCalledOnce(); expect(f.map.touchPitch.disable).toHaveBeenCalledOnce();
    expect(f.map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce(); expect(f.map.keyboard.disableRotation).toHaveBeenCalledOnce();
    lock.unlock(); lock.unlock();
    expect(f.map.getPitch()).toBe(60); expect(f.map.getBearing()).toBe(-20); expect(f.map.getMaxPitch()).toBe(75);
    expect(f.map.keyboard.enableRotation).toHaveBeenCalledOnce(); expect(change.mock.calls).toEqual([[true], [false]]);
  });
  it('honors reduced motion', () => {
    const f = fakeMap(), lock = createPitchLock(f.asMap, { reducedMotion: true }); lock.lock();
    expect(f.map.easeTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0, duration: 0 });
  });
});
