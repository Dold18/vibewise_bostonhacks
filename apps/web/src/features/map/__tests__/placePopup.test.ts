import { describe, expect, it } from 'vitest';
import type { Place } from '../../../osm';
import { popupDetails, POPUP_OFFSETS, safeHttpUrl } from '../placePopup';

/** Development fixture shaped like an Overpass place (not a real venue). */
const cafe: Place = {
  id: 'node/123',
  name: 'Fixture Cafe',
  lat: 42.3555,
  lon: -71.0636,
  category: 'Cafe',
  tags: {
    amenity: 'cafe',
    'addr:housenumber': '1',
    'addr:street': 'Fixture Street',
    'addr:city': 'Boston',
    opening_hours: 'Mo-Fr 07:00-17:00',
    phone: '+1 617 555 0100',
    website: 'example.org/cafe',
  },
};

describe('popup details', () => {
  it('shows only facts from the place record, in order', () => {
    expect(popupDetails(cafe)).toEqual({
      title: 'Fixture Cafe',
      category: 'Cafe',
      details: [
        { kind: 'address', text: '1 Fixture Street, Boston' },
        { kind: 'hours', text: 'Mo-Fr 07:00-17:00' },
        { kind: 'phone', text: '+1 617 555 0100' },
      ],
      website: 'https://example.org/cafe',
      osmUrl: 'https://www.openstreetmap.org/node/123',
    });
  });

  it('never includes distance, travel time or route fields', () => {
    const keys = JSON.stringify(popupDetails(cafe)).toLowerCase();
    for (const word of ['distance', 'duration', 'minutes', 'route', 'walk', 'meters']) expect(keys).not.toContain(word);
  });

  it('omits missing details instead of guessing', () => {
    const tile: Place = { id: 'tile/42.355500,-71.063600', name: 'Tile Cafe', lat: 42.3555, lon: -71.0636, category: 'Cafe', tags: {} };
    const d = popupDetails(tile);
    expect(d.details).toEqual([]);
    expect(d.website).toBeUndefined();
    expect(d.osmUrl).toContain('mlat=42.3555');
  });

  it('falls back to the search display name for the address', () => {
    const searched: Place = { ...cafe, tags: { display_name: 'Fixture Cafe, Boston, MA' } };
    expect(popupDetails(searched).details).toEqual([{ kind: 'address', text: 'Fixture Cafe, Boston, MA' }]);
  });

  it('only links http(s) websites', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('ftp://example.org')).toBeUndefined();
    expect(safeHttpUrl('http://example.org')).toBe('http://example.org/');
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});

describe('popup anchoring offsets', () => {
  it('places the popup above the selected pin when anchored at its bottom', () => {
    const bottom = (POPUP_OFFSETS as Record<string, [number, number]>).bottom;
    // Selected pin: 40 px tall × 1.3 scale = 52 px; the popup tip sits just above it.
    expect(bottom[1]).toBeLessThanOrEqual(-52);
  });

  it('defines an offset for every anchor MapLibre may choose', () => {
    const anchors = ['center', 'top', 'top-left', 'top-right', 'bottom', 'bottom-left', 'bottom-right', 'left', 'right'];
    expect(Object.keys(POPUP_OFFSETS as object).sort()).toEqual(anchors.sort());
  });
});
