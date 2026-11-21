import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICE_SYSTEM_PROMPT, candidateFilter, needsRetry, parseEstimates, planWrites, toPromptPlace,
  type PriceAnswer, type PriceCandidate,
} from '../src/price.ts';

const c = (id: number, price_source: 'estimate' | null = null): PriceCandidate =>
  ({ id, name: 'x', category: 'restaurant', cuisines: [], osm_tags: null, price_source });

test('toPromptPlace keeps name, category, cuisines and amenity only', () => {
  assert.deepEqual(
    toPromptPlace({ id: 7, name: 'Tatte', category: 'cafe', cuisines: null, osm_tags: { amenity: 'cafe', wifi: 'yes' }, price_source: null }),
    { id: '7', name: 'Tatte', category: 'cafe', cuisines: [], amenity: 'cafe' });
});

test('toPromptPlace omits amenity when OSM has none', () => {
  assert.deepEqual(
    toPromptPlace({ id: 8, name: 'Pho Pasteur', category: 'restaurant', cuisines: ['vietnamese'], osm_tags: null, price_source: null }),
    { id: '8', name: 'Pho Pasteur', category: 'restaurant', cuisines: ['vietnamese'] });
});

test('candidateFilter never selects menu rows', () => {
  assert.equal(candidateFilter(false), 'price_source.is.null');
  assert.equal(candidateFilter(true), 'price_source.is.null,price_source.eq.estimate');
});

test('parseEstimates keeps only batch ids and valid bands, first wins', () => {
  const r = parseEstimates(JSON.stringify([
    { id: '1', band: '$' }, { id: '1', band: '$$$$' }, { id: '2', band: 'unknown' }, { id: '99', band: '$$' },
  ]), ['1', '2', '3']);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.answers], [['1', '$'], ['2', 'unknown']]);
});

test('accepts numeric ids', () => {
  assert.deepEqual([...parseEstimates('[{"id":5,"band":"$$"}]', ['5']).answers], [['5', '$$']]);
  assert.deepEqual([...parseEstimates('[{"id":" 6 ","band":"$"}]', ['6']).answers], [['6', '$']]);
});

test('treats non-enum bands as missing', () => {
  assert.equal(parseEstimates('[{"id":"1","band":"$$ "},{"id":"2","band":"moderate"},{"id":"3"}]', ['1', '2', '3']).answers.size, 0);
});

test('parseEstimates reports truncated or non-array JSON as not ok', () => {
  assert.equal(parseEstimates('[{"id":"1","band":"$"', ['1']).ok, false);
  assert.equal(parseEstimates('{"id":"1"}', ['1']).ok, false);
  assert.equal(parseEstimates('[null, 3]', ['1']).ok, true);
});

test('needsRetry when not ok or more than half missing', () => {
  const answers = new Map<string, PriceAnswer>([['1', '$']]);
  assert.equal(needsRetry({ ok: true, answers }, 2), false);
  assert.equal(needsRetry({ ok: true, answers }, 3), true);
  assert.equal(needsRetry({ ok: false, answers: new Map() }, 1), true);
});

test('planWrites groups bands, resets stale estimates on unknown, skips missing', () => {
  const plan = planWrites([c(1), c(2), c(3), c(4, 'estimate'), c(5), c(6, 'estimate')],
    new Map<string, PriceAnswer>([['1', '$'], ['2', '$'], ['3', 'unknown'], ['4', 'unknown'], ['6', '$$$']]));
  assert.deepEqual(plan.bands, { '$': [1, 2], '$$': [], '$$$': [6], '$$$$': [] });
  assert.deepEqual(plan.reset, [4]);
});

test('system prompt states the per-person cut-offs and allows unknown', () => {
  for (const s of ['$15', '$25', '$40', 'per person', 'unknown']) assert.ok(PRICE_SYSTEM_PROMPT.includes(s), s);
});
