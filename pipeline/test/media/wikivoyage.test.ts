import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadListings, matchListing, parseListings, type Listing } from '../../src/media/wikivoyage.ts';
import type { PoliteFetcher } from '../../src/media/http.ts';
import type { EnrichPlace } from '../../src/media/types.ts';

const PLACE: EnrichPlace = { id: 1, placeId: 'osm:node/1', name: 'Bukowski Tavern', lat: 42.3478, lng: -71.0845, website: null, address: null, osmTags: null };
const L = (o: Partial<Listing>): Listing => ({ name: 'Bukowski Tavern', lat: null, lng: null, content: 'c', pageTitle: 'Boston/Back Bay', ...o });

test('parseListings handles nested templates and links', () => {
  const wt = `== Drink ==
* {{drink | name=Bukowski Tavern | alt= | url= | lat=42.3478 | long=-71.0845 | phone={{phone|+1 617}} | content=A dark, loud bar near [[Back Bay|the Back Bay]] with ''lots'' of [[beer]]. }}
* {{Eat|name=Other Place|content=Quiet.}}
* {{marker|name=Not a listing}}`;
  const out = parseListings(wt, 'Boston/Back Bay');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { name: 'Bukowski Tavern', lat: 42.3478, lng: -71.0845, content: 'A dark, loud bar near the Back Bay with lots of beer.', pageTitle: 'Boston/Back Bay' });
  assert.equal(out[1]!.name, 'Other Place');
  assert.equal(out[1]!.lat, null);
});

test('a listing with the right name 150 m away is rejected; 60 m away it matches', () => {
  const far = L({ lat: 42.3478 + 150 / 111_000, lng: -71.0845 });
  const near = L({ lat: 42.3478 + 60 / 111_000, lng: -71.0845 });
  assert.equal(matchListing(PLACE, [far]), null);
  assert.equal(matchListing(PLACE, [near]), near);
});

test('a nearby listing with a different name does not match', () => {
  assert.equal(matchListing(PLACE, [L({ name: 'Sonsie', lat: 42.3478, lng: -71.0845 })]), null);
});

test('a coordinate-less listing matches on exact name when it is the only one', () => {
  const only = L({});
  assert.equal(matchListing(PLACE, [only]), only);
});

test('two coordinate-less listings with the same name do not match', () => {
  assert.equal(matchListing(PLACE, [L({ pageTitle: 'A' }), L({ pageTitle: 'B' })]), null);
});

test('a generic name never matches without coordinates', () => {
  assert.equal(matchListing({ ...PLACE, name: 'Cafe' }, [L({ name: 'Cafe' })]), null);
});

test('loadListings reads Boston subpages plus the fixed pages, and caches them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wv-'));
  const urls: string[] = [];
  const http: PoliteFetcher = {
    async getText() { throw new Error('not used'); },
    async getJson<T>(url: string): Promise<T> {
      urls.push(url);
      const p = new URL(url).searchParams;
      if (p.get('list') === 'allpages') return { query: { allpages: [{ title: 'Boston/Back Bay' }] } } as T;
      const page = p.get('page')!;
      return { parse: { title: page, wikitext: page === 'Boston/Back Bay' ? '{{drink|name=Bukowski Tavern|content=Loud.}}' : '' } } as T;
    },
  };
  const first = await loadListings(http, { cacheDir: dir, refresh: false });
  assert.deepEqual(first.map((l) => l.name), ['Bukowski Tavern']);
  const pages = urls.map((u) => new URL(u).searchParams.get('page')).filter(Boolean);
  assert.deepEqual(pages.sort(), ['Boston', 'Boston/Back Bay', 'Brookline', 'Cambridge (Massachusetts)', 'Somerville']);
  const n = urls.length;
  const second = await loadListings(http, { cacheDir: dir, refresh: false });
  assert.equal(urls.length, n);
  assert.deepEqual(second, first);
});

test('a name-only match is refused when several places share the name (chains)', () => {
  const only = L({});
  assert.equal(matchListing(PLACE, [only], { sameNamePlaces: 3 }), null);
  assert.equal(matchListing(PLACE, [only], { sameNamePlaces: 1 }), only);
});
