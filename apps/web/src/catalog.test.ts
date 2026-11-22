import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from './deals';
import { CATEGORIES, type Category } from './osm';
import { DEALS_EMBED, semanticCandidatesWith, dealsByPlace, emptyCategories, noteIndex, resetIndexForTests, fetchDetailsForPins, fetchDetailsWith, isCatalogCategory, getCachedDetails, nearestByCategory, resetDealsEmbedForTests, parsePoint, pinToPlace, toPin, type CatalogDetails, type CatalogPin, priceLabel } from './catalog';

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
    placeType: 'restaurants',
    kind: 'cafe',
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
  price_band: 'unknown',
  price_source: null,
  deals: [],
};

const DEAL: Deal = {
  kind: 'student',
  title: '10% off with student ID',
  timing: 'any_time',
  schedule: null,
  source: 'curated',
  sourceUrl: null,
  checkedAt: '2026-11-01T00:00:00Z',
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
      toPin({ place_id: 'osm:node/1', place_type: 'restaurants', source: 'osm', source_id: 'node/1', name: 'Tatte Bakery', kind: 'cafe', location: ewkb(-71.0636, 42.3555) }),
    ).toEqual(pin());
  });
  it('drops rows without a usable location', () => {
    expect(toPin({ place_id: 'x', place_type: 'restaurants', source: 'osm', source_id: 'node/9', name: 'X', kind: 'cafe', location: 'bad' })).toBeNull();
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
        'catalog:price_band': 'unknown',
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
    expect(Object.keys(place.tags).sort()).toEqual(['catalog:attribution', 'catalog:place_id', 'catalog:price_band', 'catalog:source']);
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
  const bar = pin({ placeId: 'osm:node/4', name: 'Bar', kind: 'nightlife' });

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
  it('matches the layer place type as well as the kind', () => {
    const other = pin({ placeId: 'osm:node/5', name: 'Other', placeType: 'entertainment', kind: 'cafe' });
    expect(nearestByCategory([other, near], [cat('coffee')], CENTER, 1000, 10).map((r) => r.pin.name)).toEqual(['Near']);
  });
  it('gives priority places the capped slots first, then lists the kept pins nearest first', () => {
    const mid = pin({ placeId: 'osm:node/6', name: 'Mid', lat: 42.358 });
    const priority = (p: CatalogPin) => p.name === 'Far';
    expect(nearestByCategory([far, mid, near], [cat('coffee')], CENTER, 1000, 2, priority).map((r) => r.pin.name)).toEqual(['Near', 'Far']);
  });
  it('never pulls a priority place in from outside the radius', () => {
    const priority = (p: CatalogPin) => p.name === 'Outside';
    expect(nearestByCategory([outside, near], [cat('coffee')], CENTER, 1000, 10, priority).map((r) => r.pin.name)).toEqual(['Near']);
  });
});

describe('dealsByPlace', () => {
  const row = (placeId: string | null, title: string) => ({
    kind: 'student', title, timing: 'any_time', schedule: null, source: 'website',
    source_url: 'https://example.com', checked_at: '2026-11-21T00:00:00Z', places: placeId ? { place_id: placeId } : null,
  });
  it('groups valid deal rows by catalog place id', () => {
    const map = dealsByPlace([row('osm:node/1', 'A'), row('osm:node/1', 'B'), row('fsq:x', 'C')]);
    expect(map.get('osm:node/1')?.map((d) => d.title)).toEqual(['A', 'B']);
    expect(map.get('fsq:x')?.map((d) => d.title)).toEqual(['C']);
  });
  it('drops rows without a place and rows that fail validation', () => {
    const map = dealsByPlace([row(null, 'No place'), { ...row('osm:node/1', 'Bad'), kind: 'coupon' }, 'junk']);
    expect(map.size).toBe(0);
  });
  it('returns an empty map for non-array input', () => {
    expect(dealsByPlace(null).size).toBe(0);
  });
});

describe('isCatalogCategory', () => {
  it('backs the food and non-food layers', () => {
    for (const id of ['coffee', 'museums', 'parks', 'landmarks', 'entertainment']) expect(isCatalogCategory(cat(id)), id).toBe(true);
  });
});

describe('price on the card', () => {
  it('labels estimates, menu prices and unknown', () => {
    expect(priceLabel('$$', 'estimate')).toBe('$$ (est.)');
    expect(priceLabel('$$$$', 'menu')).toBe('$$$$');
    expect(priceLabel('unknown', undefined)).toBe('Price unknown');
    expect(priceLabel(undefined, undefined)).toBe('Price unknown');
    expect(priceLabel('$$$$$', 'estimate')).toBe('Price unknown');
    expect(priceLabel('$', undefined)).toBe('Price unknown'); // a band with no source is not trusted
  });

  it('puts price into tags from details', () => {
    const p = pinToPlace(pin(), { ...DETAILS, price_band: '$', price_source: 'estimate' });
    expect(p.tags['catalog:price_band']).toBe('$');
    expect(p.tags['catalog:price_source']).toBe('estimate');
  });

  it('keeps unknown price as a tag without a source', () => {
    const p = pinToPlace(pin(), DETAILS);
    expect(p.tags['catalog:price_band']).toBe('unknown');
    expect(p.tags['catalog:price_source']).toBeUndefined();
  });

  it('omits price tags without details', () => {
    expect(pinToPlace(pin()).tags['catalog:price_band']).toBeUndefined();
  });
});

describe('deals on places', () => {
  it('puts non-empty deals on the place', () => {
    expect(pinToPlace(pin(), { ...DETAILS, deals: [DEAL] }).deals).toEqual([DEAL]);
  });
  it('leaves deals undefined when there are none', () => {
    expect(pinToPlace(pin(), DETAILS).deals).toBeUndefined();
    expect(pinToPlace(pin()).deals).toBeUndefined();
  });
});

describe('fetchDetailsWith', () => {
  beforeEach(resetDealsEmbedForTests);
  const baseRow = (id: string) => ({ place_id: id, address: null, website: null, phone: null, cuisines: null, hours_raw: null, osm_tags: null, attribution: 'x', price_band: 'unknown', price_source: null });

  it('requests the deals embed and parses embedded rows, dropping malformed ones', async () => {
    const query = vi.fn(async (_columns: string, ids: string[]) => ({
      data: ids.map((id) => ({
        ...baseRow(id),
        places: { place_deals: [{ kind: 'student', title: 'T', timing: 'any_time', schedule: null, source: 'curated', source_url: null, checked_at: '2026-11-01T00:00:00Z' }, { junk: true }] },
      })),
      error: null,
    }));
    await fetchDetailsWith(query, ['ok:1']);
    expect(query.mock.calls[0][0].endsWith(`, ${DEALS_EMBED}`)).toBe(true);
    expect(getCachedDetails('ok:1')?.deals).toHaveLength(1);
  });

  it('retries without the embed once, warns once, and skips the embed afterwards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const query = vi.fn(async (columns: string, ids: string[]) =>
      columns.includes('place_deals')
        ? { data: null, error: { message: 'relation place_deals does not exist' } }
        : { data: ids.map(baseRow), error: null },
    );
    await fetchDetailsWith(query, ['fb:1']);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('place_deals');
    expect(query.mock.calls[1][0]).not.toContain('place_deals');
    expect(getCachedDetails('fb:1')?.deals).toEqual([]);

    await fetchDetailsWith(query, ['fb:2']);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).not.toContain('place_deals');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[catalog] deals unavailable:');
    warn.mockRestore();
  });

  it('keeps the embed enabled and does not warn when the plain retry fails too (outage)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const query = vi.fn(async (_columns: string, _ids: string[]) => ({ data: null, error: { message: 'boom' } }));
    await expect(fetchDetailsWith(query, ['bad:1'])).rejects.toThrow('boom');
    expect(query).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    await expect(fetchDetailsWith(query, ['bad:1'])).rejects.toThrow('boom');
    expect(query.mock.calls[2][0]).toContain('place_deals');
    warn.mockRestore();
  });
});

describe('non-food places', () => {
  beforeEach(resetDealsEmbedForTests);
  const museum = pin({ placeId: 'osm:node/9', placeType: 'museums', kind: 'art_museum', name: 'MFA' });
  const details = (extra: Partial<CatalogDetails>): CatalogDetails => ({ address: null, website: null, phone: null, hours_raw: null, osm_tags: null, attribution: 'x', deals: [], ...extra });

  it('labels a museum by its kind, keeps the website and sets no price tags', () => {
    const place = pinToPlace(museum, details({ kind: 'art_museum', website: 'https://x' } as Partial<CatalogDetails>));
    expect(place.category).toBe('Art museum');
    expect(place.tags.website).toBe('https://x');
    expect(place.tags['catalog:price_band']).toBeUndefined();
    expect(place.tags['catalog:price_source']).toBeUndefined();
  });

  it('queries one table per place type for a mixed list', async () => {
    const calls: string[] = [];
    const queryFor = (table: string) => async (columns: string, ids: string[]) => {
      calls.push(`${table}:${columns.split(',')[0]}:${ids.join('|')}`);
      return { data: ids.map((id) => ({ place_id: id, attribution: 'x' })), error: null };
    };
    await fetchDetailsForPins(queryFor, [
      pin({ placeId: 'r:1', placeType: 'restaurants' }),
      pin({ placeId: 'p:1', placeType: 'parks' }),
      pin({ placeId: 'r:2', placeType: 'restaurants' }),
    ]);
    expect(calls).toEqual(['restaurants:place_id:r:1|r:2', 'parks:place_id:p:1']);
  });
});

describe('per-type fallback', () => {
  beforeEach(resetIndexForTests);
  const food = pin({ placeId: 'r:1', placeType: 'restaurants' });
  const museumPin = pin({ placeId: 'm:1', placeType: 'museums', kind: 'museum' });

  it('hands a type with no pins back to the non-catalog path once the index is known', () => {
    expect(isCatalogCategory(cat('museums'))).toBe(true); // index not loaded yet
    noteIndex([food]);
    expect(isCatalogCategory(cat('museums'))).toBe(false);
    expect(isCatalogCategory(cat('parks'))).toBe(false);
    expect(isCatalogCategory(cat('coffee'))).toBe(true);
    expect(emptyCategories([food], [cat('coffee'), cat('museums')]).map((c) => c.id)).toEqual(['museums']);
  });

  it('serves a type from the catalog when the index has pins for it', () => {
    noteIndex([food, museumPin]);
    expect(isCatalogCategory(cat('museums'))).toBe(true);
    expect(emptyCategories([food, museumPin], [cat('coffee'), cat('museums')])).toEqual([]);
  });
});

describe('semanticCandidatesWith', () => {
  const vec = (x: number) => { const v = new Array(384).fill(0); v[0] = x; v[1] = Math.sqrt(1 - x * x); return v; };
  const place = (id: string, placeId: string, lat = 42.35, lon = -71.06) =>
    ({ id, name: id, lat, lon, category: 'x', tags: { 'catalog:place_id': placeId } });

  it('reads vectors from catalog_places, so museums and parks get candidates as well as restaurants', async () => {
    const tables: string[] = [];
    const query = vi.fn(async (table: string, ids: string[]) => {
      tables.push(table);
      return { data: ids.map((place_id) => ({ place_id, embedding: JSON.stringify(vec(0.6)) })), error: null };
    });
    const out = await semanticCandidatesWith(query, [place('node/1', 'osm:node/1'), place('way/2', 'osm:way/2')]);
    expect(tables).toEqual(['catalog_places']);
    expect(out.map((c) => c.id)).toEqual(['node/1', 'way/2']);
    expect(out[0]!.provenance).toBe('catalog');
    expect(out[0]!.location).toEqual({ lat: 42.35, lng: -71.06 });
  });

  it('skips places without a catalog id or without a vector, and drops malformed vectors', async () => {
    const query = vi.fn(async (_t: string, ids: string[]) => ({
      data: ids.map((place_id) => ({ place_id, embedding: place_id === 'osm:node/1' ? null : place_id === 'osm:node/2' ? '[1,2]' : vec(0.8) })),
      error: null,
    }));
    const noId = { id: 'tile/1', name: 't', lat: 0, lon: 0, category: 'x', tags: {} };
    const out = await semanticCandidatesWith(query, [noId, place('node/1', 'osm:node/1'), place('node/2', 'osm:node/2'), place('node/3', 'osm:node/3')]);
    expect(query).toHaveBeenCalledWith('catalog_places', ['osm:node/1', 'osm:node/2', 'osm:node/3']);
    expect(out.map((c) => c.id)).toEqual(['node/3']);
  });

  it('asks in chunks of 100 ids and throws when the catalog cannot answer', async () => {
    const places = Array.from({ length: 150 }, (_, i) => place(`node/${i}`, `osm:node/${i}`));
    const query = vi.fn(async (_table: string, _ids: string[]) => ({ data: [], error: null }));
    await semanticCandidatesWith(query, places);
    expect(query.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([100, 50]);
    await expect(semanticCandidatesWith(async () => ({ data: null, error: { message: 'x' } }), places)).rejects.toThrow('Catalog vectors unavailable');
  });
});
