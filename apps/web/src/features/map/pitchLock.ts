import type { Map as MapLibreMap } from 'maplibre-gl';
/** Keeps panning/zooming enabled; rotation and pitch return to their previous state on exit. */
export function createPitchLock(map: MapLibreMap, options: { reducedMotion?: boolean; onChange?(locked: boolean): void } = {}) {
  let locked = false;
  let previous = { pitch: 0, bearing: 0, maxPitch: 75, drag: true, touch: true };
  const settle = () => { if (locked && map.getMaxPitch() !== 0) map.setMaxPitch(0); };
  map.on('moveend', settle);
  return {
    isLocked: () => locked,
    lock() {
      if (locked) return;
      previous = { pitch: map.getPitch(), bearing: map.getBearing(), maxPitch: map.getMaxPitch(), drag: map.dragRotate.isEnabled(), touch: map.touchPitch.isEnabled() };
      locked = true;
      map.dragRotate.disable(); map.touchPitch.disable(); map.touchZoomRotate.disableRotation(); map.keyboard.disableRotation();
      options.onChange?.(true);
      map.easeTo({ pitch: 0, bearing: 0, duration: options.reducedMotion ? 0 : 450 });
      if (options.reducedMotion || map.getPitch() === 0) settle();
    },
    unlock() {
      if (!locked) return;
      locked = false;
      map.setMaxPitch(previous.maxPitch);
      if (previous.drag) map.dragRotate.enable();
      if (previous.touch) map.touchPitch.enable();
      map.touchZoomRotate.enableRotation(); map.keyboard.enableRotation();
      options.onChange?.(false);
      map.easeTo({ pitch: previous.pitch, bearing: previous.bearing, duration: options.reducedMotion ? 0 : 450 });
    },
    destroy() { map.off('moveend', settle); },
  };
}
