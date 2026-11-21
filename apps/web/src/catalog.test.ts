import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category } from './osm';
import { nearestByCategory, parsePoint, pinToPlace, toPin, type CatalogDetails, type CatalogPin } from './catalog';

const cat = (id: string) => CATEGORIES.find((c) => c.id === id) as Category;
const CENTER = { lat: 42.3555, lon: -71.0636 };

/** Hex EWKB for SRID=4326;POINT(lng lat), little-endian, as PostgREST returns a geography column. */
function ewkb(lng: number, lat: number): string {
  const buf = new DataView(new ArrayBuffer(25));
  buf.setUint8(0, 1);
  buf.setUint32(1, 0x20000001, true);
  buf.setUint32(5, 4326, true);
  buf.setFloat64(9, lng, true);
  buf.setFloat64(17, lat, true);
  return [...new Uint8Array(buf.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function pin(overrides: Partial<CatalogPin> = {}): CatalogPin {
  return {
    placeId: 'osm:node/1',
    source: 'osm',
    sourceId: 'node/1',
    name: 'Tatte Bakery',
    category: 'cafe',
    lat: 42.3555,
    lon: -71.0636,
    ...overrides,
  };
}

const DETAILS: CatalogDetails = {
  address: '1 Main St, Boston 02108',
  website: 'https://tatte.example',
  phone: '617-555-0100',
  cuisines: ['coffee_shop'],
  hours_raw: 'Mo-Su 07:00-19:00',
  osm_tags: { amenity: 'cafe' },
  attribution: '© OpenStreetMap contributors (ODbL)',
};

describe('parsePoint', () => {
  it('reads a hex EWKB point (what PostgREST returns for geography)', () => {
    expect(parsePoint(ewkb(-71.0636, 42.3555))).toEqual({ lat: 42.3555, lon: -71.0636 });
  });
  it('reads a GeoJSON point', () => {
    expect(parsePoint({ type: 'Point', coordinates: [-71.06, 42.35] })).toEqual({ lat: 42.35, lon: -71.06 });
  });
  it('rejects junk, non-points and (0,0)', () => {
    expect(parsePoint('zz')).toBeNull();
    expect(parsePoint(null)).toBeNull();
    expect(parsePoint({ type: 'LineString', coordinates: [] })).toBeNull();
    expect(parsePoint(ewkb(0, 0))).toBeNull();
  });
});

describe('toPin', () => {
  it('keeps the catalog id and decoded location for each place', () => {
    expect(
      toPin({ place_id: 'osm:node/1', source: 'osm', source_id: 'node/1', name: 'Tatte Bakery', category: 'cafe', location: ewkb(-71.0636, 42.3555) }),
    ).toEqual(pin());
  });
  it('drops rows without a usable location', () => {
    expect(toPin({ place_id: 'x', source: 'osm', source_id: 'node/9', name: 'X', category: 'cafe', location: 'bad' })).toBeNull();
  });
});

describe('pinToPlace', () => {
  it('maps a pin plus its details onto the card fields', () => {
    expect(pinToPlace(pin(), DETAILS)).toEqual({
      id: 'node/1',
      name: 'Tatte Bakery',
      lat: 42.3555,
      lon: -71.0636,
      category: 'Coffee shop cafe',
      tags: {
        'catalog:place_id': 'osm:node/1',
        'catalog:source': 'osm',
        display_name: '1 Main St, Boston 02108',
        website: 'https://tatte.example',
        phone: '617-555-0100',
        opening_hours: 'Mo-Su 07:00-19:00',
        'catalog:attribution': '© OpenStreetMap contributors (ODbL)',
      },
    });
  });
  it('without details, shows name and type only and invents nothing', () => {
    const place = pinToPlace(pin());
    expect(place.category).toBe('Cafe');
    expect(place.tags).toEqual({ 'catalog:place_id': 'osm:node/1', 'catalog:source': 'osm' });
  });
  it('leaves unknown detail fields out', () => {
    const place = pinToPlace(pin(), { ...DETAILS, address: null, website: null, phone: null, hours_raw: null, cuisines: [], osm_tags: null });
    expect(Object.keys(place.tags).sort()).toEqual(['catalog:attribution', 'catalog:place_id', 'catalog:source']);
  });
  it('keeps the Foursquare id for Foursquare-only places', () => {
    const place = pinToPlace(pin({ placeId: 'fsq:abc', source: 'foursquare', sourceId: 'abc' }), { ...DETAILS, attribution: 'Foursquare OS Places (Apache 2.0)' });
    expect(place.id).toBe('fsq:abc');
    expect(place.tags['catalog:attribution']).toBe('Foursquare OS Places (Apache 2.0)');
  });
});

describe('nearestByCategory', () => {
  const near = pin({ placeId: 'osm:node/1', name: 'Near', lat: 42.3556 });
  const far = pin({ placeId: 'osm:node/2', name: 'Far', lat: 42.36 });
  const outside = pin({ placeId: 'osm:node/3', name: 'Outside', lat: 42.38 });
  const bar = pin({ placeId: 'osm:node/4', name: 'Bar', category: 'nightlife' });

  it('keeps pins within the radius, nearest first, per map category', () => {
    const result = nearestByCategory([far, outside, near, bar], [cat('coffee'), cat('bars')], CENTER, 1000, 10);
    expect(result.map((r) => [r.categoryId, r.pin.name])).toEqual([
      ['coffee', 'Near'],
      ['coffee', 'Far'],
      ['bars', 'Bar'],
    ]);
  });
  it('caps each category at the per-category limit', () => {
    expect(nearestByCategory([far, near], [cat('coffee')], CENTER, 1000, 1).map((r) => r.pin.name)).toEqual(['Near']);
  });
  it('ignores map categories the catalog does not hold', () => {
    expect(nearestByCategory([near], [cat('parks')], CENTER, 1000, 10)).toEqual([]);
  });
});
