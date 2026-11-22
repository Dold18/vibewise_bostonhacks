import test from 'node:test';
import assert from 'node:assert/strict';
import { needsWebsiteScan, parseDealsArgs } from '../../src/enrichDeals.ts';
import type { DealPlace } from '../../src/deals/db.ts';

const NOW = new Date('2026-11-21T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const place = (over: Partial<DealPlace> = {}): DealPlace => ({
  id: 1, placeId: 'osm:node/1', name: 'Cafe', lat: 42.35, lng: -71.08, website: 'https://example.com/',
  address: null, osmTags: null, dealsCheckedAt: null, lastSeenAt: null, ...over,
});

test('parseDealsArgs defaults', () => {
  assert.deepEqual(parseDealsArgs([]), { dryRun: false, refresh: false, limit: null, concurrency: 4, only: null });
});

test('parseDealsArgs reads flags', () => {
  assert.deepEqual(
    parseDealsArgs(['--dry-run', '--refresh', '--limit', '50', '--concurrency', '2', '--only', 'website']),
    { dryRun: true, refresh: true, limit: 50, concurrency: 2, only: 'website' },
  );
});

test('parseDealsArgs rejects an unknown --only', () => {
  assert.throws(() => parseDealsArgs(['--only', 'web']), /invalid --only/);
});

test('needsWebsiteScan: never checked', () => assert.equal(needsWebsiteScan(place(), NOW, false), true));
test('needsWebsiteScan: checked 6 days ago', () => assert.equal(needsWebsiteScan(place({ dealsCheckedAt: daysAgo(6) }), NOW, false), false));
test('needsWebsiteScan: checked 8 days ago', () => assert.equal(needsWebsiteScan(place({ dealsCheckedAt: daysAgo(8) }), NOW, false), true));
test('needsWebsiteScan: no website', () => assert.equal(needsWebsiteScan(place({ website: null }), NOW, false), false));
test('needsWebsiteScan: refresh overrides a recent check', () => assert.equal(needsWebsiteScan(place({ dealsCheckedAt: daysAgo(1) }), NOW, true), true));
