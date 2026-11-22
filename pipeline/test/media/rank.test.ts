import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPhotos, SOURCE_RANK } from '../../src/media/rank.ts';
import type { PhotoCandidate, PhotoSource } from '../../src/media/types.ts';

function c(source: PhotoSource, url: string | null, extra: Partial<PhotoCandidate> = {}): PhotoCandidate {
  return {
    kind: source === 'website' ? 'website' : 'licensed', source,
    matchMethod: source === 'website' ? 'website' : 'name_match', url, mapillaryId: null, pageUrl: null, license: null, credit: 'x', ...extra,
  };
}

test('SOURCE_RANK matches the spec', () => {
  assert.deepEqual(SOURCE_RANK, { upload: 1, osm: 2, wikidata: 2, website: 3, commons: 4, mapillary: 5 });
});

test('a duplicate URL keeps the lower rank', () => {
  const out = rankPhotos([c('commons', 'https://a/1.jpg'), c('website', 'https://a/1.jpg')], new Set());
  assert.equal(out.length, 1);
  assert.equal(out[0]!.rank, 3);
  assert.equal(out[0]!.source, 'website');
});

test('a hidden URL is dropped', () => {
  const out = rankPhotos([c('website', 'https://a/hidden.jpg'), c('website', 'https://a/ok.jpg')], new Set(['https://a/hidden.jpg']));
  assert.deepEqual(out.map((p) => p.url), ['https://a/ok.jpg']);
});

test('at most 5 photos are kept, best ranks first, stable within a rank', () => {
  const cands = [
    c('mapillary', null, { mapillaryId: 'm1' }),
    ...Array.from({ length: 6 }, (_, i) => c('website', `https://a/w${i}.jpg`)),
    c('osm', 'https://a/osm.jpg'),
  ];
  const out = rankPhotos(cands, new Set());
  assert.deepEqual(out.map((p) => p.url), ['https://a/osm.jpg', 'https://a/w0.jpg', 'https://a/w1.jpg', 'https://a/w2.jpg', 'https://a/w3.jpg']);
});

test('Mapillary sorts last and dedupes by image id', () => {
  const out = rankPhotos([
    c('mapillary', null, { mapillaryId: 'm1' }), c('mapillary', null, { mapillaryId: 'm1' }), c('commons', 'https://a/c.jpg'),
  ], new Set());
  assert.deepEqual(out.map((p) => [p.source, p.rank]), [['commons', 4], ['mapillary', 5]]);
});

test('a hidden Mapillary photo is dropped by its image id', () => {
  const out = rankPhotos([c('mapillary', null, { mapillaryId: 'm1' }), c('commons', 'https://a/c.jpg')], new Set(['mapillary:m1']));
  assert.deepEqual(out.map((p) => p.source), ['commons']);
});
