import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createVibeRouter } from '../../../../server/vibeApi';
import {
  createSupabaseCatalog, parsePoint, rankRestaurants, rowToRestaurant, straightLineMeters,
  type CatalogProvider, type CatalogRestaurant, type RestaurantRow,
} from '../../../../server/catalogIndex';
import { AVOID_WEIGHT, MODEL_KEY, preferenceScore, type OutingVibeProfile } from '../profile';
import { rankCandidates } from '../adapters';
import { budgetToMaxPriceBand, parseSearchRequest } from '../searchContract';

/** A unit vector pointing mostly along axis `i`, with `tilt` toward axis `j`. */
const unit = (i: number, j = 1, tilt = 0): number[] => {
  const v = Array<number>(384).fill(0);
  v[i] = Math.sqrt(1 - tilt * tilt);
  if (tilt) v[j] = tilt;
  return v;
};

const restaurant = (over: Partial<CatalogRestaurant> & { id: string; vec?: number[] }): CatalogRestaurant => ({
  placeId: over.id, name: `Place ${over.id}`, category: 'restaurant', cuisines: [], priceBand: '$$', priceSource: 'estimate',
  description: 'A place.', address: null, website: null, hoursRaw: null, lat: 42.35, lng: -71.06,
  embedding: Float32Array.from(over.vec ?? unit(0)), ...over,
});

/** A restaurant row as PostgREST returns it. `band` is the stored price_band. */
const dbRow = (id: number, band: string | null = '$', axis = id % 300, name = `P${id}`) => ({
  place_id: `osm:node/${id}`, name, category: 'restaurant', cuisines: [], price_band: band, price_source: band === 'unknown' ? null : 'estimate',
  description: 'd', address: null, website: null, hours_raw: null,
  location: { type: 'Point', coordinates: [-71.06, 42.35] }, embedding: JSON.stringify(unit(axis)),
});

describe('parseSearchRequest', () => {
  const vec = unit(0);
  it('accepts text, trims it, and applies defaults', () => {
    const r = parseSearchRequest({ text: '  cozy ramen  ' });
    expect(r).toEqual({ ok: true, value: { query: { kind: 'text', text: 'cozy ramen' }, filters: {}, limit: 20 } });
  });
  it('accepts a vector with the exact model key and normalizes it', () => {
    const r = parseSearchRequest({ vector: vec.map((v) => v * 3), modelKey: MODEL_KEY });
    expect(r.ok && r.value.query.kind === 'vector' && Math.hypot(...r.value.query.vector)).toBeCloseTo(1, 6);
  });
  it('requires exactly one of text or vector', () => {
    expect(parseSearchRequest({}).ok).toBe(false);
    expect(parseSearchRequest({ text: 'a', vector: vec, modelKey: MODEL_KEY }).ok).toBe(false);
  });
  it('rejects bad text, wrong model key, wrong dimension and non-finite vectors', () => {
    expect(parseSearchRequest({ text: '   ' }).ok).toBe(false);
    expect(parseSearchRequest({ text: 'x'.repeat(8001) }).ok).toBe(false);
    expect(parseSearchRequest({ vector: vec, modelKey: 'other' }).ok).toBe(false);
    expect(parseSearchRequest({ vector: vec.slice(1), modelKey: MODEL_KEY }).ok).toBe(false);
    expect(parseSearchRequest({ vector: [...vec.slice(1), Number.NaN], modelKey: MODEL_KEY }).ok).toBe(false);
  });
  it('validates filters and limit', () => {
    const ok = parseSearchRequest({ text: 'a', filters: { maxPriceBand: '$$', origin: { lat: 42.3, lng: -71 }, maxDistanceMeters: 800 }, limit: 5 });
    expect(ok.ok && ok.value.filters).toEqual({ maxPriceBand: '$$', origin: { lat: 42.3, lng: -71 }, maxDistanceMeters: 800 });
    for (const bad of [
      { maxPriceBand: '$$$$$' }, { maxPriceBand: 2 }, { origin: { lat: 91, lng: 0 } },
      { origin: { lat: 'x', lng: 0 } }, { maxDistanceMeters: 500 }, // radius without origin
      { origin: { lat: 42, lng: -71 }, maxDistanceMeters: -1 }, { origin: { lat: 42, lng: -71 }, maxDistanceMeters: 1e9 },
    ]) expect(parseSearchRequest({ text: 'a', filters: bad }).ok, JSON.stringify(bad)).toBe(false);
    for (const limit of [0, 51, 2.5, '5']) expect(parseSearchRequest({ text: 'a', limit }).ok).toBe(false);
    expect(parseSearchRequest({ text: 'a', filters: 'nope' }).ok).toBe(false);
  });
  it('accepts a cuisine filter, normalizing case, spaces and hyphens and dropping duplicates', () => {
    const r = parseSearchRequest({ text: 'a', filters: { cuisines: ['Dim Sum', ' dim_sum ', 'THAI', 'tex-mex'] } });
    expect(r.ok && r.value.filters).toEqual({ cuisines: ['dim_sum', 'thai', 'tex_mex'] });
  });
  it('rejects malformed cuisine filters', () => {
    for (const bad of [[], 'thai', [''], ['  '], [5], ['x'.repeat(41)], Array.from({ length: 41 }, (_, i) => `c${i}`), null, { 0: 'thai' }]) {
      expect(parseSearchRequest({ text: 'a', filters: { cuisines: bad } }).ok, JSON.stringify(bad)?.slice(0, 40)).toBe(false);
    }
  });
  it('has no unknown-price option: a caller-supplied includeUnknownPrice is ignored, never copied into the filters', () => {
    for (const filters of [{ includeUnknownPrice: true }, { maxPriceBand: '$', includeUnknownPrice: true }, { includeUnknownPrice: 'yes' }]) {
      const r = parseSearchRequest({ text: 'a', filters });
      expect(r.ok, JSON.stringify(filters)).toBe(true);
      expect(r.ok && 'includeUnknownPrice' in r.value.filters).toBe(false);
    }
  });
  it('maps the discovery budgets to a price ceiling', () => {
    expect([1500, 2500, 4000, 6000].map(budgetToMaxPriceBand)).toEqual(['$', '$$', '$$$', '$$$$']);
    expect(budgetToMaxPriceBand(null)).toBeUndefined();
  });
});

describe('parsePoint', () => {
  const hex = (lng: number, lat: number, srid = true) => {
    const buf = Buffer.alloc(srid ? 25 : 21);
    buf.writeUInt8(1, 0);
    buf.writeUInt32LE(srid ? 0x20000001 : 1, 1);
    let o = 5;
    if (srid) { buf.writeUInt32LE(4326, 5); o = 9; }
    buf.writeDoubleLE(lng, o); buf.writeDoubleLE(lat, o + 8);
    return buf.toString('hex');
  };
  it('decodes hex EWKB with and without SRID, and GeoJSON', () => {
    expect(parsePoint(hex(-71.0589, 42.3601))).toEqual({ lat: 42.3601, lng: -71.0589 });
    expect(parsePoint(hex(-71.0589, 42.3601, false))).toEqual({ lat: 42.3601, lng: -71.0589 });
    expect(parsePoint({ type: 'Point', coordinates: [-71.1, 42.4] })).toEqual({ lat: 42.4, lng: -71.1 });
  });
  it('returns null for junk and for (0,0)', () => {
    for (const v of [null, 'xyz', '00', hex(0, 0), { type: 'Polygon' }, 5]) expect(parsePoint(v)).toBeNull();
  });
});

describe('rowToRestaurant', () => {
  const row = (over: Partial<RestaurantRow> = {}): RestaurantRow => ({
    place_id: 'osm:node/1', name: 'Noodle House', category: 'restaurant', cuisines: ['ramen'], price_band: '$$',
    price_source: 'estimate', description: 'Cozy ramen.', address: '1 Main St', website: null, hours_raw: 'Mo-Su 11:00-22:00',
    location: { type: 'Point', coordinates: [-71.06, 42.35] }, embedding: JSON.stringify(unit(3)), ...over,
  });
  it('builds an entry from a valid row (embedding arrives as a JSON string)', () => {
    const r = rowToRestaurant(row())!;
    expect(r).toMatchObject({ placeId: 'osm:node/1', priceBand: '$$', priceSource: 'estimate', hoursRaw: 'Mo-Su 11:00-22:00', lat: 42.35, lng: -71.06 });
    expect(r.embedding.length).toBe(384);
  });
  it('skips rows that cannot be searched honestly', () => {
    expect(rowToRestaurant(row({ embedding: null }))).toBeNull();
    expect(rowToRestaurant(row({ embedding: JSON.stringify(unit(0).slice(1)) }))).toBeNull(); // wrong dimension
    expect(rowToRestaurant(row({ embedding: JSON.stringify(unit(0).map((v) => v * 2)) }))).toBeNull(); // not normalized
    expect(rowToRestaurant(row({ embedding: '[not json' }))).toBeNull();
    expect(rowToRestaurant(row({ description: null }))).toBeNull();
    expect(rowToRestaurant(row({ location: null }))).toBeNull();
  });
  it('keeps each real price band', () => {
    for (const band of ['$', '$$', '$$$', '$$$$']) expect(rowToRestaurant(row({ price_band: band }))?.priceBand).toBe(band);
  });
  it('excludes any row without a known price band: unknown, null, missing, blank or garbage', () => {
    for (const band of ['unknown', null, undefined, '', ' ', 'free', '$$$$$', 'UNKNOWN', 4]) {
      expect(rowToRestaurant(row({ price_band: band })), String(band)).toBeNull();
    }
  });
});

describe('rankRestaurants', () => {
  const q = unit(0);
  const rows = [
    restaurant({ id: 'a', vec: unit(0), priceBand: '$$$$' }),            // best match, expensive
    restaurant({ id: 'b', vec: unit(0, 1, 0.5), priceBand: '$' }),       // good match, cheap
    restaurant({ id: 'd', vec: unit(1), priceBand: '$$', lat: 42.40 }),  // poor match, far north
  ];
  const f = (over = {}) => ({ ...over });
  it('ranks by cosine similarity, highest first, with scores', () => {
    const r = rankRestaurants(rows, q, f(), 10);
    expect(r.results.map((x) => x.placeId)).toEqual(['a', 'b', 'd']);
    expect(r.results[0]!.score).toBe(1);
    expect(r.results[1]!.score).toBeCloseTo(Math.sqrt(0.75), 3);
    expect(r.filtersApplied).toEqual([]);
  });
  it('price ceiling removes pricier places even when they match best', () => {
    const keep = rankRestaurants(rows, q, f({ maxPriceBand: '$$' }), 10);
    expect(keep.results.map((x) => x.placeId)).toEqual(['b', 'd']);
    expect(keep.filtersApplied).toEqual(['price']);
    expect(keep.candidates).toBe(2);
  });
  it('distance filter is straight-line; distanceMeters appears only with an origin', () => {
    const origin = { lat: 42.35, lng: -71.06 };
    const near = rankRestaurants(rows, q, f({ origin, maxDistanceMeters: 1000 }), 10);
    expect(near.results.map((x) => x.placeId)).toEqual(['a', 'b']); // d is ~5.5 km north
    expect(near.filtersApplied).toEqual(['distance']);
    expect(near.results.every((x) => x.distanceMeters === 0)).toBe(true);
    const only = rankRestaurants(rows, q, f({ origin }), 10);
    expect(only.candidates).toBe(3);
    expect(only.results.find((x) => x.placeId === 'd')!.distanceMeters).toBeGreaterThan(5000);
    expect(rankRestaurants(rows, q, f(), 10).results[0]).not.toHaveProperty('distanceMeters');
  });
  it('filters combine, apply the limit after counting candidates, and break ties by id', () => {
    const tie = [restaurant({ id: 'z' }), restaurant({ id: 'y' }), restaurant({ id: 'x' })];
    const r = rankRestaurants(tie, q, f(), 2);
    expect(r.candidates).toBe(3);
    expect(r.results.map((x) => x.placeId)).toEqual(['x', 'y']);
    expect(rankRestaurants(rows, q, f({ maxPriceBand: '$$$', origin: { lat: 42.35, lng: -71.06 }, maxDistanceMeters: 1000 }), 10).filtersApplied).toEqual(['price', 'distance']);
  });
  it('cuisine filter keeps only places tagged with a wanted cuisine, even when others match better', () => {
    const tagged = [
      restaurant({ id: 'a', vec: unit(0), cuisines: ['pizza'] }),                    // best match, wrong cuisine
      restaurant({ id: 'b', vec: unit(0, 1, 0.5), cuisines: ['Dim_Sum', 'thai'] }),  // good match, wanted (case differs)
      restaurant({ id: 'c', vec: unit(1), cuisines: ['thai'] }),                     // poor match, wanted
      restaurant({ id: 'd', vec: unit(0), cuisines: [] }),                           // best match, untagged
    ];
    const r = rankRestaurants(tagged, q, f({ cuisines: ['dim sum', 'THAI'] }), 10);
    expect(r.results.map((x) => x.placeId)).toEqual(['b', 'c']);
    expect(r.candidates).toBe(2);
    expect(r.filtersApplied).toEqual(['cuisine']);
    expect(rankRestaurants(tagged, q, f({ cuisines: ['korean'] }), 10).results).toEqual([]);
  });
  it('cuisine combines with price and distance as hard filters before ranking', () => {
    const tagged = [
      restaurant({ id: 'a', vec: unit(0), cuisines: ['thai'], priceBand: '$$$$' }),
      restaurant({ id: 'b', vec: unit(0, 1, 0.5), cuisines: ['thai'], priceBand: '$' }),
      restaurant({ id: 'c', vec: unit(1), cuisines: ['thai'], priceBand: '$', lat: 42.40 }),
      restaurant({ id: 'd', vec: unit(0), cuisines: ['pizza'], priceBand: '$' }),
    ];
    const r = rankRestaurants(tagged, q, f({ cuisines: ['thai'], maxPriceBand: '$$', origin: { lat: 42.35, lng: -71.06 }, maxDistanceMeters: 1000 }), 10);
    expect(r.results.map((x) => x.placeId)).toEqual(['b']);
    expect(r.filtersApplied).toEqual(['price', 'distance', 'cuisine']);
  });
  it('haversine is about right', () => {
    expect(straightLineMeters({ lat: 42.35, lng: -71.06 }, { lat: 42.36, lng: -71.06 })).toBeGreaterThan(1100);
    expect(straightLineMeters({ lat: 42.35, lng: -71.06 }, { lat: 42.36, lng: -71.06 })).toBeLessThan(1120);
  });
});

/** The real fetch, kept before any test stubs the global: the tests call their own local server with it. */
const realFetch = globalThis.fetch;
const running: Server[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const s of running.splice(0)) await new Promise<void>((r) => s.close(() => r())); });

async function server(opts: { catalog?: CatalogProvider | null; embedFails?: boolean } = {}) {
  const embedder = { embed: vi.fn(async () => { if (opts.embedFails) throw new Error('down'); return { modelKey: MODEL_KEY, vector: unit(0) }; }) };
  const rows = [restaurant({ id: 'a', vec: unit(0), priceBand: '$' }), restaurant({ id: 'b', vec: unit(1), priceBand: '$$$' })];
  const catalog = opts.catalog === undefined ? { restaurants: vi.fn(async () => rows) } : opts.catalog;
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.use('/api/vibe', createVibeRouter({ embedder, ...(catalog ? { catalog } : {}) }));
  const s = app.listen(0, '127.0.0.1'); running.push(s); await new Promise<void>((r) => s.once('listening', r));
  const addr = s.address(); if (!addr || typeof addr === 'string') throw Error('no server');
  const post = (body: unknown) => realFetch(`http://127.0.0.1:${addr.port}/api/vibe/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { post, embedder, catalog };
}

describe('POST /api/vibe/search', () => {
  it('embeds text with the pinned model, ranks the catalog and returns render-ready fields', async () => {
    const s = await server();
    const res = await s.post({ text: 'a cozy rainy night', limit: 5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(s.embedder.embed).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ modelKey: MODEL_KEY, candidates: 2, indexed: 2, filtersApplied: [] });
    expect(body.results[0]).toMatchObject({ placeId: 'a', name: 'Place a', score: 1, priceBand: '$', priceSource: 'estimate', description: 'A place.', location: { lat: 42.35, lng: -71.06 } });
    expect(Object.keys(body.results[0]).sort()).toEqual(['address', 'category', 'cuisines', 'description', 'hoursRaw', 'location', 'name', 'placeId', 'priceBand', 'priceSource', 'score', 'website']);
  });
  it('never returns an unknown-price restaurant, in any scenario, and the caller cannot opt back in', async () => {
    // Real database-shaped rows through the real index. The unknown-price rows are the BEST matches (axis 0 = the query),
    // so they would rank first if anything let them through.
    const db = [
      dbRow(1, 'unknown', 0, 'Janet Hair Braiding'), dbRow(2, null, 0, 'Null Price Fitness'), dbRow(3, '', 0, 'Blank Price Cafe'),
      dbRow(4, '$', 1, 'Cheap Eats'), dbRow(5, '$$', 2, 'Mid Bistro'), dbRow(6, '$$$$', 3, 'Fancy Place'),
    ];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get('offset') ?? 0);
      return new Response(JSON.stringify(db.slice(offset, offset + 500)), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const catalog = createSupabaseCatalog({ url: 'https://example.supabase.co', key: 'TEST-FIXTURE-NOT-A-KEY' });
    const s = await server({ catalog });
    const origin = { lat: 42.35, lng: -71.06 };
    const scenarios: Array<[string, Record<string, unknown>]> = [
      ['vibe-only, no filters at all', { text: 'x' }],
      ['empty filters object', { text: 'x', filters: {} }],
      ['price filter present', { text: 'x', filters: { maxPriceBand: '$$$$' } }],
      ['distance-only search', { text: 'x', filters: { origin, maxDistanceMeters: 5000 } }],
      ['origin only (distance shown, no radius)', { text: 'x', filters: { origin } }],
      ['price + distance', { text: 'x', filters: { maxPriceBand: '$$', origin, maxDistanceMeters: 5000 } }],
      ['vector query path', { vector: unit(0), modelKey: MODEL_KEY }],
      ['caller sends includeUnknownPrice: true, no price filter', { text: 'x', filters: { includeUnknownPrice: true } }],
      ['caller sends includeUnknownPrice: true with a price filter', { text: 'x', filters: { maxPriceBand: '$$$$', includeUnknownPrice: true } }],
    ];
    for (const [label, body] of scenarios) {
      const res = await s.post({ ...body, limit: 50 });
      expect(res.status, label).toBe(200);
      const json = await res.json();
      const names = (json.results as Array<{ name: string; priceBand: string }>).map((r) => r.name);
      expect(json.indexed, label).toBe(3); // only the three rows with a real band are in the index at all
      expect(names.length, label).toBeGreaterThan(0);
      expect(names.some((n) => /Janet|Null Price|Blank Price/.test(n)), label).toBe(false);
      expect((json.results as Array<{ priceBand: string }>).every((r) => ['$', '$$', '$$$', '$$$$'].includes(r.priceBand)), label).toBe(true);
    }
  });
  it('applies filters and reports them', async () => {
    const s = await server();
    const body = await (await s.post({ text: 'x', filters: { maxPriceBand: '$$' } })).json();
    expect(body.filtersApplied).toEqual(['price']);
    expect(body.results.map((r: { placeId: string }) => r.placeId)).toEqual(['a']);
  });
  it('applies a cuisine filter through the route and reports it', async () => {
    const rows = [
      restaurant({ id: 'a', vec: unit(0), cuisines: ['pizza'] }),
      restaurant({ id: 'b', vec: unit(1), cuisines: ['Thai'] }),
    ];
    const s = await server({ catalog: { restaurants: async () => rows } });
    const body = await (await s.post({ vector: unit(0), modelKey: MODEL_KEY, filters: { cuisines: ['thai'] } })).json();
    expect(body.filtersApplied).toEqual(['cuisine']);
    expect(body.results.map((r: { placeId: string }) => r.placeId)).toEqual(['b']);
    expect((await s.post({ text: 'x', filters: { cuisines: [] } })).status).toBe(400);
  });
  it('skips embedding when the caller sends a vector with the right model key', async () => {
    const s = await server();
    const res = await s.post({ vector: unit(1), modelKey: MODEL_KEY });
    expect(res.status).toBe(200);
    expect(s.embedder.embed).not.toHaveBeenCalled();
    expect((await res.json()).results[0].placeId).toBe('b');
  });
  it('rejects bad requests before touching MiniLM or the catalog', async () => {
    const s = await server();
    for (const body of [{}, { text: '' }, { vector: unit(0), modelKey: 'other-model' }, { text: 'a', filters: { maxPriceBand: 'free' } }, { text: 'a', limit: 500 }]) {
      expect((await s.post(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(s.embedder.embed).not.toHaveBeenCalled();
    expect((s.catalog as { restaurants: ReturnType<typeof vi.fn> }).restaurants).not.toHaveBeenCalled();
  });
  it('returns 503 when MiniLM or the catalog fails, and when no catalog is configured', async () => {
    expect((await (await server({ embedFails: true })).post({ text: 'a' })).status).toBe(503);
    const broken = await server({ catalog: { restaurants: async () => { throw new Error('db down'); } } });
    const res = await broken.post({ text: 'a' });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('db down'); // no internals leaked
    vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', ''); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VIBENTA_ENV_FILE', '/nonexistent/.env');
    const none = await server({ catalog: null });
    const noneRes = await none.post({ text: 'a' });
    expect(noneRes.status).toBe(503);
    expect((await noneRes.json()).error).toBe('Catalog search is not configured.');
    vi.unstubAllEnvs();
  });
  it('an empty SUPABASE_* line (a copied template) falls back to the VITE_SUPABASE_* pair', async () => {
    vi.stubEnv('VIBENTA_ENV_FILE', '/nonexistent/.env');
    vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:9'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_only');
    const s = await server({ catalog: null });
    const res = await s.post({ vector: unit(0), modelKey: MODEL_KEY });
    // Configured (it tried the fallback project, which refuses the connection), not "not configured".
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Search unavailable. Please retry.');
    vi.unstubAllEnvs();
  }, 20_000); // supabase-js retries a refused connection for about 7 s
});

describe('createSupabaseCatalog', () => {
  it('pages through embedded rows, caches within the TTL, and serves stale data if a refresh fails', async () => {
    let clock = 0; let fail = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (fail) return new Response('{}', { status: 500 });
      const range = new URL(String(input)).searchParams;
      const offset = Number(range.get('offset') ?? 0);
      const all = [1, 2, 3, 4, 5].map((i) => dbRow(i));
      return new Response(JSON.stringify(all.slice(offset, offset + 2)), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const catalog = createSupabaseCatalog({ url: 'https://example.supabase.co/rest/v1/', key: 'TEST-FIXTURE-NOT-A-KEY', ttlMs: 1000, pageSize: 2, now: () => clock });
    const ac = new AbortController();
    expect((await catalog.restaurants(ac.signal)).length).toBe(5);
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBe(3); // 2 + 2 + 1
    clock = 500; await catalog.restaurants(ac.signal);
    expect(fetchMock.mock.calls.length).toBe(calls); // cached
    clock = 2000; fail = true;
    expect((await catalog.restaurants(ac.signal)).length).toBe(5); // stale index keeps serving
  });
  it('leaves unknown-price rows out of the index itself', async () => {
    const db = [dbRow(1, '$'), dbRow(2, 'unknown'), dbRow(3, null), dbRow(4, '$$$')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(db), { status: 200, headers: { 'content-type': 'application/json' } })));
    const catalog = createSupabaseCatalog({ url: 'https://example.supabase.co', key: 'TEST-FIXTURE-NOT-A-KEY' });
    const rows = await catalog.restaurants(new AbortController().signal);
    expect(rows.map((r) => r.placeId)).toEqual(['osm:node/1', 'osm:node/4']);
  });
});

describe('exclusions (negativeVector) in the final search', () => {
  const q = unit(0, 3, 0.2);
  const avoid = unit(1);
  const rows = [
    restaurant({ id: 'bar', vec: unit(0, 1, 0.6), category: 'bar' }),   // closest to the query, but like the exclusion
    restaurant({ id: 'cafe', vec: unit(0, 2, 0.7), category: 'cafe' }), // a bit further, nothing like the exclusion
    restaurant({ id: 'pricey', vec: unit(0), priceBand: '$$$$' }),      // best match, over budget
  ];
  it('parses an optional exclusion vector with the same model key, normalized, and omits it when absent', () => {
    const r = parseSearchRequest({ vector: q, negativeVector: avoid.map((v) => v * 4), modelKey: MODEL_KEY });
    expect(r.ok && r.value.negativeVector && Math.hypot(...r.value.negativeVector)).toBeCloseTo(1, 6);
    const none = parseSearchRequest({ vector: q, modelKey: MODEL_KEY });
    expect(none.ok && 'negativeVector' in none.value).toBe(false);
  });
  it('rejects an exclusion vector with the wrong model key or shape', () => {
    expect(parseSearchRequest({ vector: q, negativeVector: avoid, modelKey: 'other-model' }).ok).toBe(false);
    expect(parseSearchRequest({ text: 'quiet dinner', negativeVector: avoid }).ok).toBe(false);
    expect(parseSearchRequest({ vector: q, negativeVector: avoid.slice(1), modelKey: MODEL_KEY }).ok).toBe(false);
  });
  it('lowers places like the exclusion with the shared policy, after the hard filters still apply', () => {
    const plain = rankRestaurants(rows, q, { maxPriceBand: '$$' }, 10);
    expect(plain.results.map((r) => r.placeId)).toEqual(['bar', 'cafe']);
    expect(plain.exclusionApplied).toBe(false);
    const avoided = rankRestaurants(rows, q, { maxPriceBand: '$$' }, 10, avoid);
    expect(avoided.results.map((r) => r.placeId)).toEqual(['cafe', 'bar']);
    expect(avoided.exclusionApplied).toBe(true);
    const cosQ = Math.sqrt(0.96) * 0.8, cosAvoid = 0.6;
    expect(avoided.results[1]!.score).toBeCloseTo(preferenceScore(cosQ, cosAvoid), 3);
    expect(avoided.results[1]!.score).toBeCloseTo(cosQ - AVOID_WEIGHT * cosAvoid, 3);
  });
  it('scores exactly like the live map ranking for the same quiz vectors and places', () => {
    const p = {
      sessionId: 's', version: 2,
      embedding: { status: 'ready', modelKey: MODEL_KEY, version: 2, vector: q, negativeVector: avoid },
    } as unknown as OutingVibeProfile;
    const live = rankCandidates(p, rows.slice(0, 2).map((r) => ({
      id: r.placeId, location: { lat: r.lat, lng: r.lng }, embedding: [...r.embedding], modelKey: MODEL_KEY, eligible: true, provenance: 'catalog' as const,
    })));
    const final = rankRestaurants(rows.slice(0, 2), q, {}, 10, avoid);
    expect(final.results.map((r) => r.placeId)).toEqual(live.all.map((r) => r.id));
    final.results.forEach((r, i) => expect(r.score).toBeCloseTo(live.all[i]!.score, 4));
  });
  it('the route applies a sent exclusion and reports it', async () => {
    const s = await server();
    const query = unit(0, 1, 0.6); // 'a' (axis 0) beats 'b' (axis 1) on its own
    const plain = await (await s.post({ vector: query, modelKey: MODEL_KEY })).json();
    expect(plain.results.map((r: { placeId: string }) => r.placeId)).toEqual(['a', 'b']);
    expect(plain.exclusionApplied).toBe(false);
    const res = await s.post({ vector: query, negativeVector: unit(0), modelKey: MODEL_KEY });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exclusionApplied).toBe(true);
    expect(body.results.map((r: { placeId: string }) => r.placeId)).toEqual(['b', 'a']);
  });
});
