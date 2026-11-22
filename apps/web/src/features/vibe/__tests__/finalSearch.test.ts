import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createVibeRouter } from '../../../../server/vibeApi';
import type { CatalogRestaurant } from '../../../../server/catalogIndex';
import { initialPreferences, type InitialPreferences } from '../../../discovery/preferences';
import { pinToPlace } from '../../../catalog';
import { placeIdFor } from '../../navigation/routing';
import { popupDetails } from '../../map/placePopup';
import { createFinalSearch, cuisineFilterFor, filtersFor, resultToPlace, type FinalSearchState } from '../finalSearch';
import { createLiveVibeSession } from '../liveEngine';
import { createProfilePublisher } from '../publisher';
import { guidanceFor } from '../families';
import { MODEL_KEY, type EmbeddingProvider, type GenerationContext, type GenerationProvider, type GenerationResult, type OutingVibeProfile } from '../profile';
import type { SearchResult } from '../searchContract';

const unit = (i: number, j = 1, tilt = 0): number[] => {
  const v = Array<number>(384).fill(0);
  v[i] = Math.sqrt(1 - tilt * tilt);
  if (tilt) v[j] = tilt;
  return v;
};
const prefs = (over: Partial<InitialPreferences> = {}): InitialPreferences => ({ ...initialPreferences(), ...over });
const origin = { label: 'Fixture Station', location: { lat: 42.35, lng: -71.06 }, source: 'local_suggestion' as const };
const budget = (cents: number | null) => ({ choice: 'under_25' as const, maxCentsPerPerson: cents });

describe('filtersFor / cuisineFilterFor', () => {
  it('maps origin, budget and cuisine choices, and sends nothing for unset ones', () => {
    expect(filtersFor(prefs())).toEqual({});
    const f = filtersFor(prefs({ origin, budget: budget(2500), activity: 'food_drinks', cuisines: ['thai', 'korean'] }));
    expect(f).toEqual({ origin: { lat: 42.35, lng: -71.06 }, maxPriceBand: '$$', cuisines: ['thai', 'korean'] });
    expect(filtersFor(prefs({ budget: budget(null) }))).toEqual({}); // "No limit" = no ceiling
  });
  it('expands a panel cuisine into the catalog strings the panel filter already treats as that cuisine', () => {
    expect(cuisineFilterFor(['japanese'])).toEqual(expect.arrayContaining(['japanese', 'sushi', 'ramen']));
  });
  it('sends no cuisine filter for "Other" (it would silently drop untagged-by-us cuisines) or outside Food & drinks', () => {
    expect(cuisineFilterFor(['thai', 'other'])).toBeUndefined();
    expect(cuisineFilterFor([])).toBeUndefined();
    expect(filtersFor(prefs({ activity: 'anything', cuisines: ['thai'] })).cuisines).toBeUndefined();
  });
});

describe('resultToPlace (click-to-route compatibility)', () => {
  const r = (placeId: string): SearchResult => ({
    placeId, name: 'Fixture Noodles', score: 0.9, category: 'restaurant', cuisines: ['thai'], priceBand: '$$', priceSource: 'estimate',
    description: 'd', address: '1 Main St', website: 'example.org', hoursRaw: 'Mo-Su 11:00-22:00', location: { lat: 42.35, lng: -71.06 },
  });
  it('builds the same Place the live pins use (same pinToPlace): bare OSM id, catalog:place_id tag', () => {
    const live = pinToPlace(
      { placeId: 'osm:node/42', placeType: 'restaurants', source: 'osm', sourceId: 'node/42', name: 'Fixture Noodles', kind: 'restaurant', lat: 42.35, lon: -71.06 },
      { address: '1 Main St', website: 'example.org', phone: null, cuisines: ['thai'], hours_raw: 'Mo-Su 11:00-22:00', osm_tags: null, attribution: '', price_band: '$$', price_source: 'estimate', deals: [] },
    );
    expect(resultToPlace(r('osm:node/42'))).toEqual(live);
  });
  it('yields a routable place id for OSM and Foursquare results, so navigateTo gets a placeId', () => {
    expect(placeIdFor(resultToPlace(r('osm:node/42')))).toBe('node/42');
    expect(placeIdFor(resultToPlace(r('fsq:abc123')))).toBe('fsq:abc123');
  });
  it('renders the popup facts a search result carries, with the price labeled as an estimate', () => {
    const d = popupDetails(resultToPlace(r('osm:node/42')));
    expect(d.title).toBe('Fixture Noodles');
    expect(d.details.map((x) => x.kind).sort()).toEqual(['address', 'hours', 'price']);
    expect(d.details.find((x) => x.kind === 'price')!.text).toContain('est.');
  });
});

const profile = (over: Partial<OutingVibeProfile> & { embedding: OutingVibeProfile['embedding'] }): OutingVibeProfile => ({
  schemaVersion: '1.0.0', sessionId: 's1', version: 1, originalInput: { text: 'x', imageCount: 0, imageProcessing: 'not_sent' },
  evidence: [], vibe_so_far: 'x', qualifiers: [], history: [], askedFamilies: [], askedTopics: [], question: null, phase: 'results',
  generation: 'gemini', notice: null, completion: { recommended: true, reason: 'user_request', canContinue: true }, ...over,
} as OutingVibeProfile);
const ready = (vector = unit(0)) => ({ status: 'ready' as const, modelKey: MODEL_KEY, version: 1, vector });
const searchBody = (results: SearchResult[] = []) => ({ modelKey: MODEL_KEY, candidates: results.length, indexed: 5, filtersApplied: [], results });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createFinalSearch state machine', () => {
  const setup = (fetchImpl: typeof fetch, p = prefs()) => {
    const states: FinalSearchState[] = [];
    let current = p;
    const fs = createFinalSearch({ getPrefs: () => current, onState: (s) => states.push(s), fetchImpl });
    return { fs, states, setPrefs: (n: InitialPreferences) => { current = n; } };
  };
  const statuses = (s: FinalSearchState[]) => s.map((x) => x.status);

  it('does nothing while the quiz is still asking questions', () => {
    const f = vi.fn();
    const { fs, states } = setup(f as unknown as typeof fetch);
    fs.evaluate(profile({ phase: 'question', embedding: ready() }));
    fs.evaluate(profile({ phase: 'generating', embedding: ready() }));
    fs.evaluate(null);
    expect(f).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });
  it('calls /api/vibe/search once at results with the existing vector, modelKey, and the panel filters', async () => {
    const f = vi.fn(async () => json(searchBody()));
    const { fs, states } = setup(f as unknown as typeof fetch, prefs({ origin, budget: budget(1500), activity: 'food_drinks', cuisines: ['thai'] }));
    const p = profile({ embedding: ready(unit(3)) });
    fs.evaluate(p); fs.evaluate(p); fs.evaluate({ ...p, embedding: { ...p.embedding } });
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('ready'));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/vibe/search');
    expect(JSON.parse(init.body as string)).toEqual({
      vector: unit(3), modelKey: MODEL_KEY, limit: 30,
      filters: { origin: { lat: 42.35, lng: -71.06 }, maxPriceBand: '$', cuisines: ['thai'] },
    });
    expect(statuses(states)).toEqual(['loading', 'ready']);
  });
  it('waits for a still-pending vector (loading, no call) and then searches', async () => {
    const f = vi.fn(async () => json(searchBody()));
    const { fs, states } = setup(f as unknown as typeof fetch);
    fs.evaluate(profile({ embedding: { status: 'pending', modelKey: MODEL_KEY, version: 1 } }));
    expect(f).not.toHaveBeenCalled();
    expect(statuses(states)).toEqual(['loading']);
    fs.evaluate(profile({ embedding: ready() }));
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('ready'));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('reports an honest error (never a fallback) on HTTP failure, network failure and an unreadable body, then retries on the next publish', async () => {
    let mode: 'http' | 'net' | 'bad' | 'ok' = 'http';
    const f = vi.fn(async () => {
      if (mode === 'net') throw new TypeError('fetch failed');
      if (mode === 'bad') return json({ nope: true });
      if (mode === 'http') return json({ error: 'Catalog search is not configured.' }, 503);
      return json(searchBody());
    });
    const { fs, states } = setup(f as unknown as typeof fetch);
    const p = profile({ embedding: ready() });
    fs.evaluate(p);
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('error'));
    expect(states.at(-1)).toEqual({ status: 'error', message: 'Catalog search is not configured.' });
    mode = 'net'; fs.evaluate(p);
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: 'error', message: 'fetch failed' }));
    mode = 'bad'; fs.evaluate(p);
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: 'error', message: expect.stringContaining('unreadable') }));
    mode = 'ok'; fs.evaluate(p);
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('ready'));
  });
  it('shows an error when the quiz embedding is unavailable, without calling the server', () => {
    const f = vi.fn();
    const { fs, states } = setup(f as unknown as typeof fetch);
    fs.evaluate(profile({ embedding: { status: 'unavailable', modelKey: MODEL_KEY, version: 1, reason: 'Semantic matching is temporarily unavailable.' } }));
    expect(f).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ status: 'error' });
  });
  it('returns to idle (and aborts in flight) when the quiz leaves results or is cleared', async () => {
    let signal: AbortSignal | undefined;
    const f = vi.fn((_u: unknown, init: RequestInit) => new Promise<Response>((_res, rej) => { signal = init.signal as AbortSignal; signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }));
    const { fs, states } = setup(f as unknown as typeof fetch);
    fs.evaluate(profile({ embedding: ready() }));
    expect(statuses(states)).toEqual(['loading']);
    fs.evaluate(profile({ phase: 'question', embedding: ready() }));
    expect(signal!.aborted).toBe(true);
    await Promise.resolve();
    expect(statuses(states)).toEqual(['loading', 'idle']); // no stray error after an abort
    fs.evaluate(profile({ embedding: ready() })); fs.evaluate(null);
    expect(statuses(states).at(-1)).toBe('idle');
  });
  it('re-searches when the panel filters change, but a preference edit never retries a failed search', async () => {
    let fail = false;
    const f = vi.fn(async () => (fail ? json({ error: 'down' }, 503) : json(searchBody())));
    const { fs, states, setPrefs } = setup(f as unknown as typeof fetch);
    const p = profile({ embedding: ready() });
    fs.evaluate(p);
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('ready'));
    fs.evaluate(p, true); // prefs unchanged: deduped
    expect(f).toHaveBeenCalledTimes(1);
    setPrefs(prefs({ budget: budget(1500) })); fs.evaluate(p, true);
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).filters).toEqual({ maxPriceBand: '$' });
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('ready'));
    fail = true; setPrefs(prefs({ budget: budget(4000) })); fs.evaluate(p, true);
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('error'));
    setPrefs(prefs({ budget: budget(6000) })); fs.evaluate(p, true); // typing in the panel must not hammer a failing endpoint
    expect(f).toHaveBeenCalledTimes(3);
  });
});

/* ---- End to end: real quiz session -> real controller -> real Express router + index (fake catalog, embedder, generator) ---- */
const realFetch = globalThis.fetch;
const running: Server[] = [];
afterEach(async () => { for (const s of running.splice(0)) await new Promise<void>((r) => s.close(() => r())); });

const venue = (id: string, over: Partial<CatalogRestaurant>): CatalogRestaurant => ({
  placeId: `osm:node/${id}`, name: `Venue ${id}`, category: 'restaurant', cuisines: [], priceBand: '$$', priceSource: 'estimate',
  description: 'A place.', address: `${id} Main St`, website: null, hoursRaw: null, lat: 42.35, lng: -71.06, embedding: Float32Array.from(unit(0)), ...over,
});
async function boot(rows: CatalogRestaurant[]) {
  const embedder = { embed: vi.fn(async () => ({ modelKey: MODEL_KEY, vector: unit(0) })) };
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.use('/api/vibe', createVibeRouter({ embedder, catalog: { restaurants: async () => rows } }));
  const s = app.listen(0, '127.0.0.1'); running.push(s); await new Promise<void>((r) => s.once('listening', r));
  const addr = s.address(); if (!addr || typeof addr === 'string') throw Error('no server');
  const requests: unknown[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return realFetch(`http://127.0.0.1:${addr.port}/api/vibe/search`, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, requests, embedder };
}
function result(c: GenerationContext, finish: boolean): GenerationResult {
  const g = guidanceFor(c);
  return {
    vibe_so_far: 'A richly atmospheric outing with distinctive details, room for personal choices, and a memorable sense of place, warm lamplight and soft music.',
    qualifiers: [], continuation: finish ? 'finish' : 'refine', reason: 'r',
    nextQuestion: c.history.length >= 10 ? null : { id: `q-${c.version}`, family: g.families[0].id, topic: g.topics[0], cultural: false, prompt: `A mysterious invitation arrives. Which ${g.topics[0]} detail belongs in the story?`,
      options: [{ id: 'a', label: 'Amber room', description: 'Warm lamplight, soft instruments and a tucked-away table for conversation.', preference: 'want' }, { id: 'b', label: 'Open horizon', description: 'Cool sea air, bright movement and an expansive waterfront view to explore.', preference: 'want' }] },
  };
}

describe('end to end: quiz completion -> /api/vibe/search -> routable places', () => {
  const rows = [
    venue('1', { cuisines: ['thai'], priceBand: '$', embedding: Float32Array.from(unit(0)) }),                       // wanted, cheap, closest
    venue('2', { cuisines: ['ramen'], priceBand: '$', embedding: Float32Array.from(unit(0, 1, 0.4)) }),             // wrong cuisine
    venue('3', { cuisines: ['thai'], priceBand: '$$$$', embedding: Float32Array.from(unit(0)) }),                   // too expensive
    venue('4', { cuisines: ['thai'], priceBand: '$', lat: 42.45, embedding: Float32Array.from(unit(0, 1, 0.2)) }), // wanted, cheap, farther
    venue('5', { cuisines: [], priceBand: '$', embedding: Float32Array.from(unit(0)) }),                            // untagged
  ];
  const embedder: EmbeddingProvider = { embed: async () => ({ modelKey: MODEL_KEY, vector: unit(0) }) };

  it('fires one filtered call at the real finished signal, with the quiz vector, and the results are routable', async () => {
    const { fetchImpl, requests, embedder: serverEmbedder } = await boot(rows);
    const publisher = createProfilePublisher();
    const states: FinalSearchState[] = [];
    const fs = createFinalSearch({
      getPrefs: () => prefs({ origin, budget: budget(1500), activity: 'food_drinks', cuisines: ['thai'] }),
      onState: (s) => states.push(s), fetchImpl,
    });
    publisher.subscribe((p) => fs.evaluate(p));
    const generator: GenerationProvider = { generate: async (c) => result(c, c.history.length >= 3) };
    const session = createLiveVibeSession(generator, embedder, publisher);
    session.start('A cozy rainy evening, not crowded', 0, 'e2e');
    const settle = () => vi.waitFor(() => { const s = session.getSnapshot(); expect(s?.generation).not.toBe('pending'); expect(s?.embedding.status).toBe('ready'); });
    await settle();
    for (let i = 0; i < 3; i++) {
      expect(session.getSnapshot()!.phase).toBe('question');
      expect(requests).toHaveLength(0); // never during the quiz
      session.answer({ kind: 'choice', optionId: 'a' });
      await settle();
    }
    // The quiz finished on its own (enough detail, three informative answers): that is the trigger.
    expect(session.getSnapshot()!.phase).toBe('results');
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('ready'));
    expect(requests).toHaveLength(1);
    const sent = requests[0] as { vector: number[]; modelKey: string; filters: unknown };
    expect(sent.modelKey).toBe(MODEL_KEY);
    expect(sent.vector).toEqual(session.getSnapshot()!.embedding.vector);
    expect(sent.filters).toEqual({ origin: { lat: 42.35, lng: -71.06 }, maxPriceBand: '$', cuisines: ['thai'] });
    expect(serverEmbedder.embed).not.toHaveBeenCalled(); // the quiz vector was reused, nothing re-embedded

    const done = states.at(-1) as Extract<FinalSearchState, { status: 'ready' }>;
    expect(done.response.filtersApplied).toEqual(['price', 'cuisine']);
    expect(done.places.map((p) => p.name)).toEqual(['Venue 1', 'Venue 4']); // thai + $ only, best match first
    expect(done.response.results[1]!.distanceMeters).toBeGreaterThan(10_000); // origin only annotates distance
    // Click-to-route inputs: the place id the planner receives, and the popup content.
    expect(done.places.map(placeIdFor)).toEqual(['node/1', 'node/4']);
    expect(popupDetails(done.places[0]!).details.some((d) => d.kind === 'price' && d.text.includes('est.'))).toBe(true);

    // Leaving results (Continue Refining) hands control back to the live ranking.
    session.continueRefining();
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('idle'));
  });

  it('"Show My Matches" before the vector is ready waits for it, then searches once', async () => {
    const { fetchImpl, requests } = await boot(rows);
    const publisher = createProfilePublisher();
    const states: FinalSearchState[] = [];
    const fs = createFinalSearch({ getPrefs: () => prefs(), onState: (s) => states.push(s), fetchImpl });
    publisher.subscribe((p) => fs.evaluate(p));
    const session = createLiveVibeSession({ generate: async (c) => result(c, false) }, embedder, publisher);
    session.start('A lively night out', 0, 'e2e2');
    await vi.waitFor(() => expect(session.getSnapshot()?.phase).toBe('question'));
    session.showMatches();
    await vi.waitFor(() => expect(states.at(-1)!.status).toBe('ready'));
    expect(requests).toHaveLength(1);
    expect((states.at(-1) as Extract<FinalSearchState, { status: 'ready' }>).places).toHaveLength(5);
  });
});
