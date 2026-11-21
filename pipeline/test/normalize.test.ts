import test from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, nameSimilarity } from '../src/normalize.ts';
import { metersBetween, toEwkt } from '../src/geo.ts';

test('nameKey folds accents, &, leading "the", punctuation, whitespace', () => {
  assert.equal(nameKey('Café  Nero'), 'cafe nero');
  assert.equal(nameKey('The Friendly Toast'), 'friendly toast');
  assert.equal(nameKey('Joe’s Pizza & Subs!'), 'joes pizza and subs');
  assert.equal(nameKey('Theater Café'), 'theater cafe');   // "the" only as a whole leading word
});
test('nameKey of a name with no letters or digits is empty', () => {
  assert.equal(nameKey('The'), '');
  assert.equal(nameKey('&'), 'and');   // & becomes a word
  assert.equal(nameKey('!!!'), '');
});
test('nameSimilarity is token Jaccard and 0 for empty keys', () => {
  assert.equal(nameSimilarity('Tatte Bakery & Cafe', 'Tatte Bakery and Café'), 1);
  assert.equal(nameSimilarity('Tatte Bakery', 'Tatte Bakery Cafe'), 2 / 3);
  assert.equal(nameSimilarity('!!!', '!!!'), 0);
});
test('metersBetween and toEwkt', () => {
  assert.ok(Math.abs(metersBetween({ lat: 42.35, lng: -71.06 }, { lat: 42.351, lng: -71.06 }) - 111.2) < 1);
  assert.equal(toEwkt(42.35, -71.06), 'SRID=4326;POINT(-71.06 42.35)');
});
