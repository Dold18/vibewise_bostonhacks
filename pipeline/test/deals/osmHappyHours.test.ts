import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHoursSubset, osmHappyHourDeal } from '../../src/deals/osmHappyHours.ts';

test('parses a weekday range', () => {
  assert.deepEqual(parseOpeningHoursSubset('Mo-Fr 16:00-18:00'), [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '18:00' }]);
});
test('parses day lists and multiple time ranges', () => {
  assert.deepEqual(parseOpeningHoursSubset('Mo,We 16:00-18:00,22:00-24:00'), [
    { days: [1, 3], start: '16:00', end: '18:00' },
    { days: [1, 3], start: '22:00', end: '24:00' },
  ]);
});
test('parses multiple rules in order', () => {
  assert.deepEqual(parseOpeningHoursSubset('Mo-Th 16:00-19:00; Fr 15:00-18:00'), [
    { days: [1, 2, 3, 4], start: '16:00', end: '19:00' },
    { days: [5], start: '15:00', end: '18:00' },
  ]);
});
test('wraps Sa-Su', () => {
  assert.deepEqual(parseOpeningHoursSubset('Sa-Su 12:00-15:00'), [{ days: [6, 0], start: '12:00', end: '15:00' }]);
});
test('rejects anything outside the subset', () => {
  assert.equal(parseOpeningHoursSubset('Mo-Fr 16:00-18:00; PH off'), null);
  assert.equal(parseOpeningHoursSubset('sunset-22:00'), null);
  assert.equal(parseOpeningHoursSubset('Mo-Fr 16:00-18:00 "drinks only"'), null);
});
test('osmHappyHourDeal is scheduled when parsed, unconfirmed otherwise', () => {
  const d = osmHappyHourDeal('Mo-Fr 16:00-18:00', '2026-11-01T12:00:00Z');
  assert.equal(d.checkedAt, '2026-11-01T12:00:00Z');
  assert.equal(d.timing, 'scheduled');
  assert.equal(d.kind, 'special');
  assert.equal(d.title, 'Happy hour');
  assert.equal(d.source, 'osm');
  assert.equal(d.sourceUrl, null);
  assert.equal(d.quote, 'Mo-Fr 16:00-18:00');
  const u = osmHappyHourDeal('sunset-22:00', '2026-11-01T12:00:00Z');
  assert.equal(u.timing, 'unconfirmed');
  assert.equal(u.schedule, null);
  assert.equal(osmHappyHourDeal('x'.repeat(300), 'z').quote?.length, 200);
});
