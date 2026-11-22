import test from 'node:test';
import assert from 'node:assert/strict';
import { scanWebsite } from '../../src/deals/website.ts';
import type { FetchResult, PoliteFetcher } from '../../src/media/http.ts';
import type { EnrichPlace } from '../../src/media/types.ts';

const HOME = 'https://example.com/';
const NOW = '2026-11-21T12:00:00.000Z';
const PLACE: EnrichPlace = { id: 1, placeId: 'osm:node/1', name: 'Example Cafe', lat: 42.35, lng: -71.08, website: 'https://example.com/', address: null, osmTags: null };

function fakeHttp(pages: Record<string, FetchResult>): { http: PoliteFetcher; requested: string[] } {
  const requested: string[] = [];
  const http: PoliteFetcher = {
    async getBytes() { throw new Error('not used'); },
    async getText(url) { requested.push(url); return pages[url] ?? { ok: false, reason: 'http', detail: `HTTP 404 from ${url}` }; },
    async getJson() { throw new Error('not used'); },
  };
  return { http, requested };
}
const ok = (url: string, body: string): FetchResult => ({ ok: true, url, contentType: 'text/html', body });
const links = '<a href="/specials">Specials</a><a href="/happy-hour">Happy hour</a><a href="/student-deals">Students</a><a href="https://other.example/specials">Other</a>';

test('fetches only the first two same-origin deal links, never another host', async () => {
  const { http, requested } = fakeHttp({
    [HOME]: ok(HOME, `<body>${links}</body>`),
    'https://example.com/specials': ok('https://example.com/specials', '<body><p>Welcome</p></body>'),
    'https://example.com/happy-hour': ok('https://example.com/happy-hour', '<body><p>Welcome</p></body>'),
  });
  const r = await scanWebsite(PLACE, http, NOW);
  assert.equal(r.outcome, 'ok');
  assert.deepEqual(requested, [HOME, 'https://example.com/specials', 'https://example.com/happy-hour']);
});

test('a cross-host link is skipped and does not use up a slot', async () => {
  const { http, requested } = fakeHttp({
    [HOME]: ok(HOME, '<body><a href="https://other.example/specials">Other</a><a href="/specials">S</a></body>'),
    'https://example.com/specials': ok('https://example.com/specials', '<body></body>'),
  });
  await scanWebsite(PLACE, http, NOW);
  assert.deepEqual(requested, [HOME, 'https://example.com/specials']);
});

test('a timeout on a linked page is transient', async () => {
  const { http } = fakeHttp({
    [HOME]: ok(HOME, `<body>${links}</body>`),
    'https://example.com/specials': { ok: false, reason: 'timeout', detail: 'slow' },
  });
  assert.equal((await scanWebsite(PLACE, http, NOW)).outcome, 'transient');
});

test('a network failure on the home page is transient', async () => {
  const { http } = fakeHttp({ [HOME]: { ok: false, reason: 'network', detail: 'ECONNRESET' } });
  assert.equal((await scanWebsite(PLACE, http, NOW)).outcome, 'transient');
});

test('a home page blocked by robots is permanent', async () => {
  const { http } = fakeHttp({ [HOME]: { ok: false, reason: 'robots', detail: 'disallowed' } });
  assert.equal((await scanWebsite(PLACE, http, NOW)).outcome, 'permanent');
});

test('a third-party website is permanent and nothing is fetched', async () => {
  const { http, requested } = fakeHttp({});
  const r = await scanWebsite({ ...PLACE, website: 'https://www.facebook.com/x' }, http, NOW);
  assert.equal(r.outcome, 'permanent');
  assert.deepEqual(requested, []);
});

test('a redirect to a third-party host is permanent', async () => {
  const { http } = fakeHttp({ [HOME]: ok('https://www.yelp.com/biz/x', '<body></body>') });
  assert.equal((await scanWebsite(PLACE, http, NOW)).outcome, 'permanent');
});

test('an invalid website URL is permanent', async () => {
  const { http } = fakeHttp({});
  assert.equal((await scanWebsite({ ...PLACE, website: 'http://' }, http, NOW)).outcome, 'permanent');
});

test('a linked page failing with http is skipped; the home deal keeps the home sourceUrl', async () => {
  const { http } = fakeHttp({
    [HOME]: ok(HOME, '<body><a href="/specials">Specials</a><p>10% off with student ID</p></body>'),
    'https://example.com/specials': { ok: false, reason: 'http', detail: 'HTTP 404' },
  });
  const r = await scanWebsite(PLACE, http, NOW);
  assert.ok(r.outcome === 'ok');
  assert.equal(r.deals.length, 1);
  assert.equal(r.deals[0]!.sourceUrl, HOME);
});

test('each deal carries the page it was found on', async () => {
  const { http } = fakeHttp({
    [HOME]: ok(HOME, '<body><a href="/specials">Specials</a><p>10% off with student ID</p></body>'),
    'https://example.com/specials': ok('https://example.com/specials', '<body><p>Free fries for students with college ID</p></body>'),
  });
  const r = await scanWebsite(PLACE, http, NOW);
  assert.ok(r.outcome === 'ok');
  assert.equal(r.deals.find((d) => /10%/.test(d.title))!.sourceUrl, HOME);
  assert.equal(r.deals.find((d) => /fries/i.test(d.title))!.sourceUrl, 'https://example.com/specials');
});

test('a linked page that redirects off-origin is ignored', async () => {
  const { http } = fakeHttp({
    [HOME]: ok(HOME, '<body><a href="/specials">Specials</a></body>'),
    'https://example.com/specials': ok('https://www.yelp.com/biz/x', '<body><p>10% off with student ID</p></body>'),
  });
  const r = await scanWebsite(PLACE, http, NOW);
  assert.ok(r.outcome === 'ok');
  assert.equal(r.deals.length, 0);
});

for (const status of [503, 429]) {
  test(`home HTTP ${status} is transient`, async () => {
    const { http } = fakeHttp({ [HOME]: { ok: false, reason: 'http', detail: `HTTP ${status} from ${HOME}` } });
    assert.equal((await scanWebsite(PLACE, http, NOW)).outcome, 'transient');
  });
}

test('home HTTP 404 stays permanent', async () => {
  const { http } = fakeHttp({ [HOME]: { ok: false, reason: 'http', detail: `HTTP 404 from ${HOME}` } });
  assert.equal((await scanWebsite(PLACE, http, NOW)).outcome, 'permanent');
});

test('a linked page with HTTP 500 is transient', async () => {
  const { http } = fakeHttp({
    [HOME]: ok(HOME, '<body><a href="/specials">Specials</a></body>'),
    'https://example.com/specials': { ok: false, reason: 'http', detail: 'HTTP 500 from https://example.com/specials' },
  });
  assert.equal((await scanWebsite(PLACE, http, NOW)).outcome, 'transient');
});
