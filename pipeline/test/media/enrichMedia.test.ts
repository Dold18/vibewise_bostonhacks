import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichPlace, parseMediaArgs, summarizeMedia, type EnrichContext, type PlaceResult } from '../../src/enrichMedia.ts';
import type { EnrichPlace, PhotoCandidate } from '../../src/media/types.ts';

const PLACE: EnrichPlace = {
  id: 7, placeId: 'osm:node/7', name: 'Bukowski Tavern', lat: 42.3478, lng: -71.0845, website: 'https://bukowski.test/', address: null,
  osmTags: { name: 'Bukowski Tavern', amenity: 'bar', outdoor_seating: 'no', live_music: 'yes', wikidata: 'Q1' },
};
const photo = (source: PhotoCandidate['source'], url: string): PhotoCandidate => ({
  kind: source === 'website' ? 'website' : 'licensed', source, matchMethod: source === 'website' ? 'website' : 'osm_tag',
  url, mapillaryId: null, pageUrl: null, license: null, credit: 'x',
});

function ctx(over: Partial<EnrichContext> = {}): EnrichContext {
  return {
    website: async () => ({ photos: [photo('website', 'https://bukowski.test/a.jpg')], input: { source: 'website', content: 'Dark and loud.', sourceUrl: 'https://bukowski.test/' }, failure: null }),
    linked: async () => ({ photos: [photo('osm', 'https://upload.wikimedia.org/a.jpg')], wikidata: { enwikiTitle: 'Bukowski Tavern' } }),
    geosearch: async () => [],
    wikipedia: async () => ({ text: 'A bar in Back Bay.', url: 'https://en.wikipedia.org/wiki/Bukowski_Tavern' }),
    listings: [{ name: 'Bukowski Tavern', lat: 42.3478, lng: -71.0845, content: 'Huge beer list.', pageTitle: 'Boston/Back Bay' }],
    licenses: [],
    mapillary: null,
    hiddenUrls: async () => new Set(),
    studentReviews: async () => [],
    ...over,
  };
}

test('parseMediaArgs defaults and flags', () => {
  assert.deepEqual(parseMediaArgs([]), { dryRun: false, refresh: false, limit: null, concurrency: 4, tiers: [1, 2, 3] });
  assert.deepEqual(parseMediaArgs(['--dry-run', '--refresh', '--limit', '50', '--concurrency', '2', '--tiers', '1,2']),
    { dryRun: true, refresh: true, limit: 50, concurrency: 2, tiers: [1, 2] });
  assert.throws(() => parseMediaArgs(['--tiers', '4']), /tiers/);
  assert.throws(() => parseMediaArgs(['--limit', 'x']), /limit/);
});

test('one failing source is recorded and the rest still return', async () => {
  const r = await enrichPlace(PLACE, ctx({ geosearch: async () => { throw new Error('commons down'); } }));
  assert.deepEqual(r.errors, ['geosearch: commons down']);
  assert.deepEqual(r.photos.map((p) => p.source), ['osm', 'website']);
  assert.ok(r.inputs.some((i) => i.source === 'website'));
});

test('the osm_tags input leaves out name, amenity and link tags', async () => {
  const r = await enrichPlace(PLACE, ctx());
  const osm = r.inputs.find((i) => i.source === 'osm_tags')!;
  assert.equal(osm.content, 'outdoor_seating=no; live_music=yes');
  assert.equal(osm.sourceUrl, 'https://www.openstreetmap.org/node/7');
});

test('the wiki input combines Wikipedia and Wikivoyage', async () => {
  const r = await enrichPlace(PLACE, ctx());
  const wiki = r.inputs.find((i) => i.source === 'wiki')!;
  assert.equal(wiki.content, 'Wikipedia: A bar in Back Bay.\n\nWikivoyage: Huge beer list.');
  assert.equal(wiki.sourceUrl, 'https://en.wikipedia.org/wiki/Bukowski_Tavern');
});

test('student reviews appear only when they exist, joined by a separator', async () => {
  const none = await enrichPlace(PLACE, ctx());
  assert.equal(none.inputs.some((i) => i.source === 'student_reviews'), false);
  const some = await enrichPlace(PLACE, ctx({ studentReviews: async () => ['Great for groups.', 'Too loud to talk.'] }));
  assert.equal(some.inputs.find((i) => i.source === 'student_reviews')!.content, 'Great for groups.\n---\nToo loud to talk.');
});

test('a hidden URL never comes back', async () => {
  const r = await enrichPlace(PLACE, ctx({ hiddenUrls: async () => new Set(['https://bukowski.test/a.jpg']) }));
  assert.deepEqual(r.photos.map((p) => p.url), ['https://upload.wikimedia.org/a.jpg']);
});

test('a website failure is reported by reason', async () => {
  const r = await enrichPlace(PLACE, ctx({ website: async () => ({ photos: [], input: null, failure: { ok: false, reason: 'robots', detail: 'x' } }) }));
  assert.equal(r.websiteFailure, 'robots');
  assert.equal(r.inputs.some((i) => i.source === 'website'), false);
});

test('mapillary runs only when configured', async () => {
  const mp: PhotoCandidate = { ...photo('mapillary', ''), url: null, mapillaryId: 'm1' };
  const r = await enrichPlace(PLACE, ctx({ mapillary: async () => mp }));
  assert.equal(r.photos.at(-1)!.source, 'mapillary');
});

test('summarizeMedia reports coverage per source', () => {
  const results: PlaceResult[] = [
    { photos: [{ ...photo('website', 'a'), rank: 3 }, { ...photo('osm', 'b'), rank: 2 }], inputs: [{ source: 'website', content: 'x', sourceUrl: null }], websiteFailure: null, errors: [] },
    { photos: [], inputs: [], websiteFailure: 'robots', errors: ['wikivoyage: boom'] },
  ];
  assert.equal(summarizeMedia(results, 3), [
    'Places processed: 2',
    'Places skipped (tier filter): 3',
    'Places with at least one photo: 1',
    'Photos by source: osm 1, wikidata 0, website 1, commons 0, mapillary 0',
    'Vibe inputs by source: website 1, wiki 0, osm_tags 0, city_licenses 0, student_reviews 0',
    'Website failures: robots 1',
    'Places with errors: 1',
  ].join('\n'));
});
