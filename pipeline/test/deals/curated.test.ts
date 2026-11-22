import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCurated } from '../../src/deals/curated.ts';

const ids = new Map([['osm:node/1', 11]]);
const base = { place_id: 'osm:node/1', kind: 'student', title: '10% off with student ID', source_url: 'https://example.com/d', checked_on: '2026-11-21' };

test('student entry without schedule is any_time', () => {
  const r = validateCurated([base], ids);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0]!.timing, 'any_time');
  assert.equal(r.rows[0]!.schedule, null);
  assert.equal(r.rows[0]!.restaurantId, 11);
  assert.equal(r.rows[0]!.source, 'curated');
  assert.equal(r.rows[0]!.quote, null);
});

test('special without schedule is unconfirmed', () => {
  const r = validateCurated([{ ...base, kind: 'special' }], ids);
  assert.equal(r.rows[0]!.timing, 'unconfirmed');
});

test('explicit unconfirmed is honored for student', () => {
  const r = validateCurated([{ ...base, timing: 'unconfirmed' }], ids);
  assert.equal(r.rows[0]!.timing, 'unconfirmed');
});

test('schedule gives scheduled', () => {
  const r = validateCurated([{ ...base, kind: 'special', schedule: [{ days: [1, 2], start: '16:00', end: '24:00' }] }], ids);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0]!.timing, 'scheduled');
});

test('bad days name the index', () => {
  for (const days of [[], [7]]) {
    const r = validateCurated([base, { ...base, schedule: [{ days, start: '16:00', end: '18:00' }] }], ids);
    assert.equal(r.rows.length, 1);
    assert.match(r.errors[0]!, /entry 1/);
  }
});

test('bad times, long title, schedule with unconfirmed are errors', () => {
  const bad = [
    { ...base, schedule: [{ days: [1], start: '25:00', end: '26:00' }] },
    { ...base, schedule: [{ days: [1], start: '16:00', end: '24:30' }] },
    { ...base, title: 'x'.repeat(121) },
    { ...base, schedule: [{ days: [1], start: '16:00', end: '18:00' }], timing: 'unconfirmed' },
    { ...base, kind: 'drink' },
  ];
  const r = validateCurated(bad, ids);
  assert.equal(r.rows.length, 0);
  assert.equal(r.errors.length, bad.length);
});

test('unknown place_id gives an error and no row', () => {
  const r = validateCurated([{ ...base, place_id: 'osm:node/999' }], ids);
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0]!, /entry 0.*place_id/);
});

test('missing source_url is an error', () => {
  const { source_url: _omit, ...rest } = base;
  const r = validateCurated([rest], ids);
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0]!, /source_url/);
});

test('non-array input is an error', () => {
  assert.equal(validateCurated({}, ids).errors.length, 1);
});

test('checkedAt is noon Boston time with the right offset', () => {
  assert.equal(validateCurated([base], ids).rows[0]!.checkedAt, '2026-11-21T12:00:00-05:00');
  assert.equal(validateCurated([{ ...base, checked_on: '2026-07-01' }], ids).rows[0]!.checkedAt, '2026-07-01T12:00:00-04:00');
  assert.equal(validateCurated([{ ...base, checked_on: '2026-02-30' }], ids).errors.length, 1);
});

test('committed deals.curated.json is empty', () => {
  const raw = JSON.parse(readFileSync(new URL('../../deals.curated.json', import.meta.url), 'utf8'));
  assert.deepEqual(raw, []);
});

test('F5: a window whose start equals its end is rejected; 00:00-24:00 is accepted', () => {
  const bad = validateCurated([{ ...base, kind: 'special', schedule: [{ days: [1], start: '16:00', end: '16:00' }] }], ids);
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.errors.length, 1);
  const ok = validateCurated([{ ...base, kind: 'special', schedule: [{ days: [1], start: '00:00', end: '24:00' }] }], ids);
  assert.deepEqual(ok.errors, []);
});

test('F11: a checked_on after today (Boston) is rejected', () => {
  const now = new Date('2026-11-21T17:00:00Z');
  const future = validateCurated([{ ...base, checked_on: '2099-01-01' }], ids, now);
  assert.equal(future.rows.length, 0);
  assert.equal(future.errors.length, 1);
  assert.deepEqual(validateCurated([{ ...base, checked_on: '2026-11-21' }], ids, now).errors, []);
  assert.equal(validateCurated([{ ...base, checked_on: '2026-11-22' }], ids, now).rows.length, 0);
});
