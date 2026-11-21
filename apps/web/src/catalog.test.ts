import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category } from './osm';
import { nearestByCategory, parsePoint, rowToPlace, type CatalogRow } from './catalog';

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

function row(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    place_id: 'osm:node/1',
    source: 'osm',
    source_id: 'node/1',
    name: 'Tatte Bakery',
    location: ewkb(-71.0636, 42.3555),
    address: '1 Main St, Boston 02108',
    website: 'https://tatte.example',
    phone: '617-555-0100',
    category: 'cafe',
    cuisines: ['coffee_shop'],
    hours_raw: 'Mo-Su 07:00-19:00',
    osm_tags: { amenity: 'cafe' },
    attribution: '© OpenStreetMap contributors (ODbL)',
    ...overrides,
  };
}

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

describe('rowToPlace', () => {
  it('maps a catalog row onto the card fields', () => {
    expect(rowToPlace(row())).toEqual({
      id: 'node/1',
      name: 'Tatte Bakery',
      lat: 42.3555,
      lon: -71.0636,
      category: 'Coffee shop cafe',
      tags: {
        display_name: '1 Main St, Boston 02108',
        website: 'https://tatte.example',
        phone: '617-555-0100',
        opening_hours: 'Mo-Su 07:00-19:00',
        'catalog:source': 'osm',
        'catalog:attribution': '© OpenStreetMap contributors (ODbL)',
      },
    });
  });
  it('leaves unknown fields out instead of inventing them', () => {
    const place = rowToPlace(row({ address: null, website: null, phone: null, hours_raw: null, cuisines: [], osm_tags: null }));
    expect(place?.tags).toEqual({ 'catalog:source': 'osm', 'catalog:attribution': '© OpenStreetMap contributors (ODbL)' });
    expect(place?.category).toBe('Cafe');
  });
  it('keeps the Foursquare id for Foursquare-only rows', () => {
    const place = rowToPlace(row({ place_id: 'fsq:abc', source: 'foursquare', source_id: 'abc', attribution: 'Foursquare OS Places (Apache 2.0)' }));
    expect(place?.id).toBe('fsq:abc');
    expect(place?.tags['catalog:attribution']).toBe('Foursquare OS Places (Apache 2.0)');
  });
  it('drops rows without a usable location', () => {
    expect(rowToPlace(row({ location: 'bad' }))).toBeNull();
  });
});

describe('nearestByCategory', () => {
  const near = row({ place_id: 'osm:node/1', source_id: 'node/1', name: 'Near', location: ewkb(-71.0636, 42.3556) });
  const far = row({ place_id: 'osm:node/2', source_id: 'node/2', name: 'Far', location: ewkb(-71.0636, 42.3600) });
  const outside = row({ place_id: 'osm:node/3', source_id: 'node/3', name: 'Outside', location: ewkb(-71.0636, 42.3800) });
  const bar = row({ place_id: 'osm:node/4', source_id: 'node/4', name: 'Bar', category: 'nightlife', location: ewkb(-71.0636, 42.3555) });

  it('keeps places within the radius, nearest first, per map category', () => {
    const result = nearestByCategory([far, outside, near, bar], [cat('coffee'), cat('bars')], CENTER, 1000, 10);
    expect(result.map((r) => [r.categoryId, r.place.name])).toEqual([
      ['coffee', 'Near'],
      ['coffee', 'Far'],
      ['bars', 'Bar'],
    ]);
  });
  it('caps each category at the per-category limit', () => {
    expect(nearestByCategory([far, near], [cat('coffee')], CENTER, 1000, 1).map((r) => r.place.name)).toEqual(['Near']);
  });
  it('ignores map categories the catalog does not hold', () => {
    expect(nearestByCategory([near], [cat('parks')], CENTER, 1000, 10)).toEqual([]);
  });
});
