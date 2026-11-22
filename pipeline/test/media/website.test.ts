import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractPage, scrapeWebsite } from '../../src/media/website.ts';
import type { FetchResult, PoliteFetcher } from '../../src/media/http.ts';
import type { EnrichPlace } from '../../src/media/types.ts';

const FIX = path.join(import.meta.dirname, 'fixtures');
const HOME = fs.readFileSync(path.join(FIX, 'home.html'), 'utf8');
const ABOUT = fs.readFileSync(path.join(FIX, 'about.html'), 'utf8');
const PAGE = 'https://example.com/';

const PLACE: EnrichPlace = { id: 1, placeId: 'osm:node/1', name: 'Example Cafe', lat: 42.35, lng: -71.08, website: 'https://www.example.com/', address: null, osmTags: null };

function fakeHttp(pages: Record<string, FetchResult>): PoliteFetcher {
  return {
    async getBytes() { throw new Error('not used'); },
    async getText(url) { return pages[url] ?? { ok: false, reason: 'http', detail: `HTTP 404 from ${url}` }; },
    async getJson() { throw new Error('not used'); },
  };
}
const ok = (url: string, body: string): FetchResult => ({ ok: true, url, contentType: 'text/html', body });

test('og:image comes first, then JSON-LD images, then qualifying <img>', () => {
  const { images } = extractPage(HOME, PAGE);
  assert.deepEqual(images.slice(0, 3), ['https://example.com/og/front.jpg', 'https://example.com/ld/one.jpg', 'https://example.com/ld/two.jpg']);
});

test('relative and protocol-relative image URLs resolve to https', () => {
  const { images } = extractPage(HOME, PAGE);
  assert.ok(images.includes('https://example.com/img/room.jpg'));
  assert.ok(images.includes('https://cdn.example.com/a.jpg'));
});

test('http, logo, svg, data: and small images are dropped', () => {
  const { images } = extractPage(HOME, PAGE);
  for (const bad of ['insecure.jpg', 'logo.png', 'a.svg', 'data:', 'small.jpg', 'nosize.jpg']) {
    assert.equal(images.some((u) => u.includes(bad)), false, bad);
  }
});

test('an <img> with a srcset width of 800w or more is kept', () => {
  const { images } = extractPage(HOME, PAGE);
  assert.ok(images.includes('https://example.com/img/srcset-default.jpg'));
});

test('images are deduplicated', () => {
  const html = '<meta property="og:image" content="/a.jpg"><img src="/a.jpg" width="900" height="900">';
  assert.deepEqual(extractPage(html, PAGE).images, ['https://example.com/a.jpg']);
});

test('text drops script, style, nav, header, footer and noscript', () => {
  const { text } = extractPage(HOME, PAGE);
  assert.ok(text.includes('Exposed brick, warm lights and long tables.'));
  for (const bad of ['script text', 'nav words', 'Header text', 'Footer text', 'noscript text', 'color:red']) {
    assert.equal(text.includes(bad), false, bad);
  }
});

test('description prefers the meta description', () => {
  assert.equal(extractPage(HOME, PAGE).description, 'A cozy candlelit cafe in Back Bay.');
});

test('description falls back to JSON-LD', () => {
  const html = '<script type="application/ld+json">{"description":"From LD"}</script>';
  assert.equal(extractPage(html, PAGE).description, 'From LD');
});

test('aboutUrl is the first same-origin about link', () => {
  assert.equal(extractPage(HOME, PAGE).aboutUrl, 'https://example.com/about-us');
});

test('scrapeWebsite builds a capped input from description and about text, and website photos', async () => {
  const long = `<main><p>${'word '.repeat(2000)}</p></main>`;
  const http = fakeHttp({
    'https://www.example.com/': ok('https://example.com/', HOME),
    'https://example.com/about-us': ok('https://example.com/about-us', ABOUT.replace('</main>', `${long}</main>`)),
  });
  const r = await scrapeWebsite(PLACE, http);
  assert.equal(r.failure, null);
  assert.ok(r.input);
  assert.equal(r.input.source, 'website');
  assert.equal(r.input.sourceUrl, 'https://www.example.com/');
  assert.ok(r.input.content.startsWith('A cozy candlelit cafe in Back Bay.'));
  assert.ok(r.input.content.includes('live jazz on Thursdays'));
  assert.ok(r.input.content.length <= 4000);
  assert.ok(r.photos.length <= 5 && r.photos.length > 0);
  const p = r.photos[0]!;
  assert.deepEqual({ kind: p.kind, source: p.source, matchMethod: p.matchMethod, credit: p.credit, license: p.license },
    { kind: 'website', source: 'website', matchMethod: 'website', credit: 'example.com', license: null });
  assert.equal(p.pageUrl, 'https://example.com/');
  assert.ok(r.photos.some((x) => x.url === 'https://example.com/img/jazz.jpg' && x.pageUrl === 'https://example.com/about-us'));
});

test('scrapeWebsite on a robots-blocked site returns nothing but the failure', async () => {
  const http = fakeHttp({ 'https://www.example.com/': { ok: false, reason: 'robots', detail: 'disallowed' } });
  const r = await scrapeWebsite(PLACE, http);
  assert.deepEqual(r.photos, []);
  assert.equal(r.input, null);
  assert.equal(r.failure?.ok === false && r.failure.reason, 'robots');
});

test('scrapeWebsite without a website does nothing', async () => {
  const r = await scrapeWebsite({ ...PLACE, website: null }, fakeHttp({}));
  assert.deepEqual(r, { photos: [], input: null, failure: null });
});

test('scrapeWebsite adds https:// to a bare domain', async () => {
  const http = fakeHttp({ 'https://example.com/': ok('https://example.com/', '<main><p>Hello there.</p></main>') });
  const r = await scrapeWebsite({ ...PLACE, website: 'example.com' }, http);
  assert.equal(r.input?.content, 'Hello there.');
});

test('images whose URL declares a size under 400 px, blurred placeholders, avatars and app icons are dropped', () => {
  const html = [
    '<img src="https://static.wixstatic.com/media/a.jpg/v1/fill/w_147,h_98,al_c,blur_2/a.jpg" width="900" height="600">',
    '<img src="https://static.wixstatic.com/media/b.jpg/v1/fill/w_1200,h_800,al_c,blur_2/b.jpg" width="900" height="600">',
    '<img src="https://a.mktgcdn.com/p/x/512x62.webp" width="900" height="600">',
    '<img src="https://cdn.test/img.jpg?w=300&h=200" width="900" height="600">',
    '<img src="https://secure.gravatar.com/avatar/abc?s=96" width="900" height="600">',
    '<img src="https://x.test/brands/dun/android-chrome-512x512.png" width="900" height="600">',
    '<img src="https://x.test/apple-touch-icon-1024.png" width="900" height="600">',
    '<img src="https://images.getbento.com/a/room.jpg?w=1200&h=600" width="900" height="600">',
    '<img src="https://storyblok.test/f/1440x602/hero.png" width="900" height="600">',
  ].join('');
  assert.deepEqual(extractPage(html, PAGE).images, [
    'https://images.getbento.com/a/room.jpg?w=1200&h=600',
    'https://storyblok.test/f/1440x602/hero.png',
  ]);
});

test('a website on a review, social or delivery platform is not scraped', async () => {
  for (const site of ['https://www.tripadvisor.com/Restaurant_Review-x', 'https://facebook.com/x', 'https://www.doordash.com/store/x', 'https://linktr.ee/x', 'https://www.yelp.com/biz/x']) {
    let fetched = false;
    const http: PoliteFetcher = { async getBytes() { throw new Error('not used'); }, async getText() { fetched = true; return ok(site, HOME); }, async getJson() { throw new Error('x'); } };
    const r = await scrapeWebsite({ ...PLACE, website: site }, http);
    assert.equal(fetched, false, site);
    assert.equal(r.failure?.ok === false && r.failure.reason, 'third_party', site);
  }
});

test('a website that redirects to a third-party platform is dropped', async () => {
  const http = fakeHttp({ 'https://www.example.com/': ok('https://www.facebook.com/examplecafe', HOME) });
  const r = await scrapeWebsite(PLACE, http);
  assert.deepEqual(r.photos, []);
  assert.equal(r.input, null);
  assert.equal(r.failure?.ok === false && r.failure.reason, 'third_party');
});
