import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES, matchesSelector, placesNearAny, type Category } from './osm';

const cat = (id: string) => CATEGORIES.find((c) => c.id === id) as Category;
const CENTER = { lat: 42.3555, lon: -71.0636 };

describe('matchesSelector', () => {
  it('matches each existing category selector against its own tags only', () => {
    const samples: Record<string, Record<string, string>> = {
      restaurants: { amenity: 'restaurant' },
      coffee: { amenity: 'cafe' },
      bars: { amenity: 'pub' },
      parks: { leisure: 'park' },
      museums: { tourism: 'gallery' },
      landmarks: { tourism: 'viewpoint' },
      entertainment: { amenity: 'cinema' },
    };
    for (const category of CATEGORIES) {
      for (const [id, tags] of Object.entries(samples)) {
        expect(matchesSelector(tags, category.selector), `${category.id} vs ${id}`).toBe(category.id === id);
      }
    }
  });

  it('treats regex selectors as anchored patterns and needs every filter to match', () => {
    expect(matchesSelector({ amenity: 'barbecue' }, '["amenity"~"^(bar|pub)$"]')).toBe(false);
    expect(matchesSelector({ amenity: 'cafe' }, '["amenity"="cafe"]["cuisine"="coffee_shop"]')).toBe(false);
    expect(matchesSelector({ amenity: 'cafe' }, 'not a selector')).toBe(false);
  });
});

describe('placesNearAny', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (elements: unknown[]) =>
    vi.fn(async () => new Response(JSON.stringify({ elements }), { status: 200 }));

  it('sends one request with a query and output limit per category', async () => {
    const fetchMock = respond([]);
    vi.stubGlobal('fetch', fetchMock);
    await placesNearAny([cat('restaurants'), cat('parks')], CENTER, 800, undefined, 25);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    const query = body.get('data')!;
    expect(query.match(/out center tags 25;/g)).toHaveLength(2);
    expect(query).toContain('nwr["amenity"="restaurant"]["name"](around:800,42.3555,-71.0636)');
    expect(query).toContain('nwr["leisure"="park"]["name"]');
  });

  it('labels each result with its category, dedupes, and skips unnamed or unplaceable elements', async () => {
    vi.stubGlobal(
      'fetch',
      respond([
        { type: 'node', id: 1, lat: 42.35, lon: -71.06, tags: { name: 'Cafe A', amenity: 'cafe' } },
        { type: 'way', id: 2, center: { lat: 42.36, lon: -71.07 }, tags: { name: 'Park B', leisure: 'park' } },
        { type: 'node', id: 1, lat: 42.35, lon: -71.06, tags: { name: 'Cafe A', amenity: 'cafe' } },
        { type: 'node', id: 3, lat: 42.35, lon: -71.06, tags: { amenity: 'cafe' } },
        { type: 'way', id: 4, tags: { name: 'No position', leisure: 'park' } },
      ]),
    );
    const result = await placesNearAny([cat('coffee'), cat('parks')], CENTER, 800);
    expect(result.map((r) => [r.place.id, r.categoryId])).toEqual([
      ['node/1', 'coffee'],
      ['way/2', 'parks'],
    ]);
    expect(result[1].place).toMatchObject({ lat: 42.36, lon: -71.07, name: 'Park B' });
  });

  it('makes no request for an empty category list', async () => {
    const fetchMock = respond([]);
    vi.stubGlobal('fetch', fetchMock);
    expect(await placesNearAny([], CENTER, 800)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tries the next mirror on failure and rejects when every mirror fails', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(placesNearAny([cat('coffee')], CENTER, 800)).rejects.toThrow(/Overpass 429/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops immediately, without trying other mirrors, when the caller aborts', async () => {
    const abort = new AbortController();
    const fetchMock = vi.fn(async () => {
      abort.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(placesNearAny([cat('coffee')], CENTER, 800, abort.signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
