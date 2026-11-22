import { describe, expect, it } from 'vitest';
import { freeRegion, pinTarget, popupRectAbove, popupRevealShift, type Rect } from '../popupPlacement';

const DESKTOP: Rect = { left: 0, top: 0, right: 1440, bottom: 900 };
const DESKTOP_PANEL: Rect = { left: 12, top: 12, right: 404, bottom: 690 };
const PHONE: Rect = { left: 0, top: 0, right: 390, bottom: 844 };
const PHONE_PEEK: Rect = { left: 12, top: 748, right: 326, bottom: 804 }; // collapsed bottom sheet
const PHONE_SHEET: Rect = { left: 0, top: 186, right: 390, bottom: 844 }; // expanded bottom sheet
const POPUP = { width: 304, height: 230 };
const GAP = 54;

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (a: Rect, b: Rect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
const after = (pin: { x: number; y: number }, shift: { x: number; y: number } | null) => ({ x: pin.x + (shift?.x ?? 0), y: pin.y + (shift?.y ?? 0) });

describe('free map region', () => {
  it('is right of the desktop panel', () => {
    expect(freeRegion(DESKTOP, DESKTOP_PANEL)).toEqual({ left: 416, top: 12, right: 1428, bottom: 888 });
  });

  it('is above a phone bottom sheet, collapsed or expanded', () => {
    expect(freeRegion(PHONE, PHONE_PEEK)).toEqual({ left: 12, top: 12, right: 378, bottom: 736 });
    expect(freeRegion(PHONE, PHONE_SHEET).bottom).toBe(174);
  });

  it('is the whole map (minus margin) without a panel', () => {
    expect(freeRegion(DESKTOP, null)).toEqual({ left: 12, top: 12, right: 1428, bottom: 888 });
  });
});

describe('revealing a popup without touching the panel', () => {
  it('does not move the camera when the popup is already clear', () => {
    expect(popupRevealShift({ x: 900, y: 500 }, POPUP, GAP, DESKTOP, DESKTOP_PANEL)).toBeNull();
  });

  it('pans a pin next to the panel just far enough that its popup clears the panel', () => {
    const pin = { x: 450, y: 500 };
    expect(overlaps(popupRectAbove(pin, POPUP, GAP), DESKTOP_PANEL)).toBe(true);
    const shift = popupRevealShift(pin, POPUP, GAP, DESKTOP, DESKTOP_PANEL)!;
    expect(shift).toEqual({ x: 118, y: 0 });
    expect(overlaps(popupRectAbove(after(pin, shift), POPUP, GAP), DESKTOP_PANEL)).toBe(false);
  });

  it('pans a pin near the top edge down so the popup fits above it', () => {
    const pin = { x: 900, y: 120 };
    const shift = popupRevealShift(pin, POPUP, GAP, DESKTOP, DESKTOP_PANEL)!;
    expect(popupRectAbove(after(pin, shift), POPUP, GAP).top).toBe(12);
  });

  it('on phones keeps the popup above the collapsed sheet', () => {
    const pin = { x: 60, y: 700 }; // near the sheet and the left edge
    const shift = popupRevealShift(pin, POPUP, GAP, PHONE, PHONE_PEEK);
    const rect = popupRectAbove(after(pin, shift), POPUP, GAP);
    expect(overlaps(rect, PHONE_PEEK)).toBe(false);
    expect(inside(rect, { left: 0, top: 0, right: 390, bottom: 844 })).toBe(true);
  });

  it('with an expanded phone sheet too tall to avoid, keeps the whole popup on screen', () => {
    const pin = { x: 195, y: 120 };
    const shift = popupRevealShift(pin, POPUP, GAP, PHONE, PHONE_SHEET);
    const rect = popupRectAbove(after(pin, shift), POPUP, GAP);
    expect(rect.top).toBe(12);
    expect(inside(rect, PHONE)).toBe(true);
  });

  it('never pushes the pin off the bottom of the map', () => {
    const pin = { x: 195, y: 30 };
    const tall = { width: 300, height: 900 };
    const shift = popupRevealShift(pin, tall, GAP, PHONE, null)!;
    expect(pin.y + shift.y).toBeLessThanOrEqual(PHONE.bottom - 12);
  });

  it('on a narrow desktop overlaps the panel only by what does not fit beside it', () => {
    const narrow: Rect = { left: 0, top: 0, right: 700, bottom: 800 };
    const shift = popupRevealShift({ x: 300, y: 500 }, POPUP, GAP, narrow, DESKTOP_PANEL)!;
    const rect = popupRectAbove({ x: 300 + shift.x, y: 500 + shift.y }, POPUP, GAP);
    expect(rect.right).toBe(688);
  });
});

describe('flying to a place', () => {
  it('lands the pin in the free region with its popup clear of the panel', () => {
    const target = pinTarget(POPUP, GAP, DESKTOP, DESKTOP_PANEL);
    expect(target.x).toBe(922);
    const rect = popupRectAbove(target, POPUP, GAP);
    expect(overlaps(rect, DESKTOP_PANEL)).toBe(false);
    expect(inside(rect, DESKTOP)).toBe(true);
  });

  it('on phones lands above the bottom sheet', () => {
    const target = pinTarget(POPUP, GAP, PHONE, PHONE_PEEK);
    expect(target.y).toBeLessThan(PHONE_PEEK.top);
    expect(overlaps(popupRectAbove(target, POPUP, GAP), PHONE_PEEK)).toBe(false);
  });
});
