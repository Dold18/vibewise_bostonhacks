import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commonsFiles, geosearchPhotos, isAllowedLicense, isDistinctiveName, linkedPhotos, nameMatches, wikipediaExtract,
} from '../../src/media/wikimedia.ts';
import type { PoliteFetcher } from '../../src/media/http.ts';
import type { EnrichPlace } from '../../src/media/types.ts';

const PLACE: EnrichPlace = { id: 1, placeId: 'osm:node/1', name: 'Tatte Bakery', lat: 42.357, lng: -71.07, website: null, address: null, osmTags: null };

interface FileSpec { license: string; artist?: string; categories?: string[] }

/** A fake Wikimedia: `files` keyed by "File:Name.jpg". Records every URL requested. */
function fakeWiki(opts: { files?: Record<string, FileSpec>; geosearch?: string[]; wikidata?: Record<string, unknown>; extract?: string }) {
  const urls: string[] = [];
  const http: PoliteFetcher = {
    async getText() { throw new Error('not used'); },
    async getJson<T>(url: string): Promise<T> {
      urls.push(url);
      const u = new URL(url);
      const p = u.searchParams;
      if (u.host === 'www.wikidata.org') return { entities: opts.wikidata ?? {} } as T;
      if (u.host === 'en.wikipedia.org') {
        return { query: { pages: [{ title: p.get('titles'), extract: opts.extract ?? '' }] } } as T;
      }
      if (p.get('list') === 'geosearch') {
        return { query: { geosearch: (opts.geosearch ?? []).map((title) => ({ title })) } } as T;
      }
      const titles = (p.get('titles') ?? '').split('|').filter(Boolean);
      const pages = titles.map((title) => {
        const f = opts.files?.[title];
        if (!f) return { title, missing: true };
        return {
          title,
          imageinfo: [{
            thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}/1024px.jpg`,
            descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
            extmetadata: { LicenseShortName: { value: f.license }, ...(f.artist ? { Artist: { value: f.artist } } : {}) },
          }],
          categories: (f.categories ?? []).map((c) => ({ title: `Category:${c}` })),
        };
      });
      return { query: { pages } } as T;
    },
  };
  return { http, urls };
}

test('license allowlist accepts CC0, PD, CC BY and CC BY-SA, and rejects NC and ND', () => {
  for (const l of ['CC BY-SA 4.0', 'CC0', 'Public domain', 'CC BY 2.0', 'CC BY-SA 3.0 de', 'PD-self']) assert.equal(isAllowedLicense(l), true, l);
  for (const l of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 3.0', 'All rights reserved', 'GFDL', '']) assert.equal(isAllowedLicense(l), false, l);
});

test('isDistinctiveName needs two tokens or one long token', () => {
  assert.equal(isDistinctiveName('Cafe'), false);
  assert.equal(isDistinctiveName('Pizza'), false);
  assert.equal(isDistinctiveName('Tatte Bakery'), true);
  assert.equal(isDistinctiveName("Mamaleh's"), true);
});

test('nameMatches requires a distinctive name contained in the haystack', () => {
  assert.equal(nameMatches('File:Tatte Bakery Beacon Hill.jpg', 'Tatte Bakery'), true);
  assert.equal(nameMatches('File:Cafe sign.jpg', 'Cafe'), false);
  assert.equal(nameMatches('File:Beacon Hill street.jpg', 'Tatte Bakery'), false);
});

test('commonsFiles keeps allowed licenses and strips HTML from the credit', async () => {
  const { http } = fakeWiki({ files: {
    'File:A.jpg': { license: 'CC BY-SA 4.0', artist: '<a href="//x">Jane &amp; Co</a>' },
    'File:B.jpg': { license: 'CC BY-NC 2.0' },
    'File:C.jpg': { license: 'CC0' },
  } });
  const out = await commonsFiles(['File:A.jpg', 'File:B.jpg', 'File:C.jpg', 'File:Missing.jpg'], http);
  assert.deepEqual([...out.keys()].sort(), ['File:A.jpg', 'File:C.jpg']);
  assert.equal(out.get('File:A.jpg')!.credit, 'Jane & Co');
  assert.equal(out.get('File:A.jpg')!.license, 'CC BY-SA 4.0');
  assert.equal(out.get('File:C.jpg')!.credit, 'Wikimedia Commons');
});

test('commonsFiles batches at most 50 titles per request', async () => {
  const titles = Array.from({ length: 120 }, (_, i) => `File:F${i}.jpg`);
  const { http, urls } = fakeWiki({});
  await commonsFiles(titles, http);
  assert.equal(urls.length, 3);
});

test('linkedPhotos reads OSM wikimedia_commons and Wikidata P18', async () => {
  const { http } = fakeWiki({
    files: { 'File:A.jpg': { license: 'CC BY 4.0' }, 'File:B.jpg': { license: 'CC0' } },
    wikidata: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: 'B.jpg' } } }] }, sitelinks: { enwiki: { title: 'Tatte' } } } },
  });
  const r = await linkedPhotos({ ...PLACE, osmTags: { wikimedia_commons: 'File:A.jpg', wikidata: 'Q1' } }, http);
  assert.deepEqual(r.photos.map((p) => [p.source, p.matchMethod, p.kind]), [['osm', 'osm_tag', 'licensed'], ['wikidata', 'wikidata', 'licensed']]);
  assert.equal(r.wikidata?.enwikiTitle, 'Tatte');
});

test('linkedPhotos reads a Commons upload URL in the OSM image tag', async () => {
  const { http } = fakeWiki({ files: { 'File:Shop front.jpg': { license: 'CC BY-SA 3.0' } } });
  const r = await linkedPhotos({ ...PLACE, osmTags: { image: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Shop_front.jpg' } }, http);
  assert.equal(r.photos.length, 1);
  assert.equal(r.photos[0]!.source, 'osm');
});

test('linkedPhotos ignores Category: values and non-Commons image URLs', async () => {
  const { http, urls } = fakeWiki({});
  const r = await linkedPhotos({ ...PLACE, osmTags: { wikimedia_commons: 'Category:Tatte', image: 'https://example.com/x.jpg' } }, http);
  assert.deepEqual(r.photos, []);
  assert.equal(r.wikidata, null);
  assert.equal(urls.length, 0);
});

test('geosearchPhotos keeps only name-matching, allowed-license files', async () => {
  const { http } = fakeWiki({
    geosearch: ['File:Unrelated street.jpg', 'File:Tatte Bakery interior.jpg', 'File:Tatte Bakery NC.jpg', 'File:Corner.jpg'],
    files: {
      'File:Unrelated street.jpg': { license: 'CC0' },
      'File:Tatte Bakery interior.jpg': { license: 'CC BY-SA 4.0' },
      'File:Tatte Bakery NC.jpg': { license: 'CC BY-NC 2.0' },
      'File:Corner.jpg': { license: 'CC0', categories: ['Tatte Bakery and Cafe'] },
    },
  });
  const photos = await geosearchPhotos(PLACE, http);
  assert.deepEqual(photos.map((p) => p.pageUrl?.includes('interior') || p.pageUrl?.includes('Corner')), [true, true]);
  assert.ok(photos.every((p) => p.source === 'commons' && p.matchMethod === 'name_match'));
});

test('geosearchPhotos skips the search entirely for a generic name', async () => {
  const { http, urls } = fakeWiki({ geosearch: ['File:Cafe.jpg'] });
  assert.deepEqual(await geosearchPhotos({ ...PLACE, name: 'Cafe' }, http), []);
  assert.equal(urls.length, 0);
});

test('geosearch asks for files within 50 m', async () => {
  const { http, urls } = fakeWiki({ geosearch: [] });
  await geosearchPhotos(PLACE, http);
  const p = new URL(urls[0]!).searchParams;
  assert.equal(p.get('gsradius'), '50');
  assert.equal(p.get('gsnamespace'), '6');
  assert.equal(p.get('gscoord'), '42.357|-71.07');
});

test('wikipediaExtract returns the intro text and article URL', async () => {
  const { http } = fakeWiki({ extract: 'A bakery chain.' });
  assert.deepEqual(await wikipediaExtract('Tatte Bakery', http), { text: 'A bakery chain.', url: 'https://en.wikipedia.org/wiki/Tatte_Bakery' });
});

test('wikipediaExtract returns null for an empty extract', async () => {
  const { http } = fakeWiki({ extract: '' });
  assert.equal(await wikipediaExtract('Nothing', http), null);
});
