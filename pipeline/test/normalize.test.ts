import test from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, nameSimilarity, osmCategory, fsqCategory, osmCuisines, fsqCuisines, osmAddress, fsqAddress, pickOsmTags } from '../src/normalize.ts';
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
test('osmCategory maps every allowed amenity', () => {
  assert.equal(osmCategory('cafe'), 'cafe');
  for (const a of ['bar', 'pub']) assert.equal(osmCategory(a), 'nightlife');
  for (const a of ['restaurant', 'fast_food', 'ice_cream', 'food_court']) assert.equal(osmCategory(a), 'restaurant');
  assert.equal(osmCategory('bank'), null);
});
test('fsqCategory uses the second segment exactly, never substrings', () => {
  const dd = (s: string) => `Dining and Drinking > ${s}`;
  assert.equal(fsqCategory(dd('Restaurant > Steakhouse')), 'restaurant');
  assert.equal(fsqCategory(dd('Restaurant > BBQ Joint')), 'restaurant');
  assert.equal(fsqCategory(dd('Restaurant > Japanese Restaurant > Sushi Restaurant')), 'restaurant');
  assert.equal(fsqCategory(dd('Bar > Cocktail Bar')), 'nightlife');
  assert.equal(fsqCategory(dd('Cafe, Coffee, and Tea House > Coffee Shop')), 'cafe');
  assert.equal(fsqCategory(dd('Bakery')), 'restaurant');
  assert.equal(fsqCategory('Retail > Grocery Store'), null);
});
test('osmCuisines splits, trims and snake_cases messy values', () => {
  assert.deepEqual(osmCuisines({ cuisine: 'Pizza; Italian ;;' }), ['pizza', 'italian']);
  assert.deepEqual(osmCuisines({ cuisine: 'ice cream;ice_cream' }), ['ice_cream']);
  assert.deepEqual(osmCuisines({}), []);
});
test('fsqCuisines takes the deepest segment under Restaurant', () => {
  assert.deepEqual(fsqCuisines([
    'Dining and Drinking > Restaurant > Asian Restaurant > Japanese Restaurant',
    'Dining and Drinking > Restaurant > Pizzeria',
    'Dining and Drinking > Restaurant',
    'Dining and Drinking > Bar > Cocktail Bar',
  ]), ['japanese', 'pizzeria']);
});
test('addresses format from available parts, else null', () => {
  assert.equal(osmAddress({ 'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'Boston', 'addr:postcode': '02115' }), '12 Main St, Boston 02115');
  assert.equal(osmAddress({ 'addr:street': 'Main St' }), 'Main St');
  assert.equal(osmAddress({}), null);
  assert.equal(fsqAddress({ address: '12 Main St', locality: 'Boston', postcode: '02115' }), '12 Main St, Boston 02115');
  assert.equal(fsqAddress({ address: null, locality: null, postcode: null }), null);
});
test('pickOsmTags keeps only vibe-relevant keys', () => {
  assert.deepEqual(pickOsmTags({ amenity: 'cafe', outdoor_seating: 'yes', 'diet:vegan': 'yes', name: 'X', 'addr:street': 'Y' }),
    { amenity: 'cafe', outdoor_seating: 'yes', 'diet:vegan': 'yes' });
});

test('pickOsmTags keeps photo-link and vibe tags', () => {
  const out = pickOsmTags({ name: 'X', wikidata: 'Q1', wikimedia_commons: 'File:A.jpg', image: 'https://x/y.jpg', live_music: 'yes', smoking: 'no', brand: 'B' });
  assert.deepEqual(out, { wikidata: 'Q1', wikimedia_commons: 'File:A.jpg', image: 'https://x/y.jpg', live_music: 'yes', smoking: 'no' });
});

test('pickOsmTags keeps happy_hours', () => {
  assert.deepEqual(pickOsmTags({ happy_hours: 'Mo-Fr 16:00-18:00', foo: 'x' }), { happy_hours: 'Mo-Fr 16:00-18:00' });
});
