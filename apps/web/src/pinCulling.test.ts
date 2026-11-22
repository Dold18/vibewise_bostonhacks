import { describe, expect, it } from 'vitest';
import { CULL_CLOSENESS, CULL_MAX_ZOOM, cullOrder, cullOverlapping, cullsAtZoom, type PinBox } from './pinCulling';

/** A 28x40 pin standing on (x, y). */
const pin = (x: number, y: number, scale = 1): PinBox => ({ x, y, width: 28 * scale, height: 40 * scale });

describe('cullOverlapping', () => {
  it('keeps pins that do not touch', () => {
    expect(cullOverlapping([pin(0, 100), pin(100, 100), pin(0, 300)], [0, 1, 2])).toEqual([true, true, true]);
  });

  it('only culls pins that are REALLY close: heads mostly stacked', () => {
    expect(CULL_CLOSENESS).toBe(0.35);
    expect(cullOverlapping([pin(0, 100), pin(5, 108)], [0, 1])).toEqual([true, false]);
    expect(cullOverlapping([pin(0, 100), pin(5, 108)], [1, 0])).toEqual([false, true]);
  });

  it('keeps pins that merely overlap', () => {
    expect(cullOverlapping([pin(0, 100), pin(12, 100)], [0, 1])).toEqual([true, true]); // half a head apart
    expect(cullOverlapping([pin(0, 100), pin(0, 120)], [0, 1])).toEqual([true, true]); // one behind the other
    expect(cullOverlapping([pin(0, 100), pin(28, 100)], [0, 1])).toEqual([true, true]); // edge to edge
  });

  it('only checks against pins it kept, so a hidden pin hides nothing', () => {
    // 1 is too close to 0 and is hidden; 2 is too close only to 1, so it stays.
    expect(cullOverlapping([pin(0, 100), pin(6, 100), pin(12, 100)], [0, 1, 2])).toEqual([true, false, true]);
  });

  it('fits more small (far) pins in the same space', () => {
    expect(cullOverlapping([pin(0, 100), pin(6, 100)], [0, 1])).toEqual([true, false]);
    expect(cullOverlapping([pin(0, 100, 0.5), pin(6, 100, 0.5)], [0, 1])).toEqual([true, true]);
  });

  it('leaves pins outside the order visible and out of the contest', () => {
    expect(cullOverlapping([pin(0, 100), pin(3, 100), pin(6, 100)], [0, 2])).toEqual([true, true, false]);
  });
});

describe('cullsAtZoom', () => {
  it('declutters below street level and shows every pin from zoom 17 in', () => {
    expect(CULL_MAX_ZOOM).toBe(17);
    expect(cullsAtZoom(16)).toBe(true);
    expect(cullsAtZoom(16.99)).toBe(true);
    expect(cullsAtZoom(17)).toBe(false);
    expect(cullsAtZoom(19)).toBe(false);
  });
});

describe('cullOrder', () => {
  it('ranks higher scores first', () => {
    expect(cullOrder([1, 1000, 10, 100.5, 1.2])).toEqual([1, 3, 2, 4, 0]);
  });

  it('keeps the original order for equal scores', () => {
    expect(cullOrder([0, 0, 0])).toEqual([0, 1, 2]);
    expect(cullOrder([1, 5, 1, 5])).toEqual([1, 3, 0, 2]);
  });

  it('handles no pins', () => {
    expect(cullOrder([])).toEqual([]);
  });
});
