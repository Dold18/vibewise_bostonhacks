import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTimingWords, parseSchedule, timingFor } from '../../src/deals/schedule.ts';

const w = (days: number[], start: string, end: string) => ({ days, start, end });
const WEEKDAYS = [1, 2, 3, 4, 5];

test('Mon–Fri with en dash and shared pm', () => {
  assert.deepEqual(parseSchedule('Happy Hour Mon–Fri 4–6pm'), [w(WEEKDAYS, '16:00', '18:00')]);
});
test('Monday through Friday 4pm-6pm', () => {
  assert.deepEqual(parseSchedule('Monday through Friday 4pm-6pm'), [w(WEEKDAYS, '16:00', '18:00')]);
});
test('Weekdays with minutes and spaced pm', () => {
  assert.deepEqual(parseSchedule('Weekdays 4:30-6:30 pm'), [w(WEEKDAYS, '16:30', '18:30')]);
});
test('Tuesdays 11-2pm crosses noon', () => {
  assert.deepEqual(parseSchedule('Tuesdays 11-2pm'), [w([2], '11:00', '14:00')]);
});
test('Fri & Sat 10pm-1am runs past midnight', () => {
  assert.deepEqual(parseSchedule('Fri & Sat 10pm-1am'), [w([5, 6], '22:00', '01:00')]);
});
test('Daily 24-hour clock', () => {
  assert.deepEqual(parseSchedule('Daily 16:00-18:00'), [w([0, 1, 2, 3, 4, 5, 6], '16:00', '18:00')]);
});
test('noon with day after the time', () => {
  assert.deepEqual(parseSchedule('noon-3pm Sundays'), [w([0], '12:00', '15:00')]);
});
test('day range wraps the week', () => {
  assert.deepEqual(parseSchedule('Fri-Mon 5-7pm'), [w([5, 6, 0, 1], '17:00', '19:00')]);
});
test('two windows in one line', () => {
  assert.deepEqual(parseSchedule('Mon-Thu 4-6pm, Fri 3-7pm'), [
    w([1, 2, 3, 4], '16:00', '18:00'),
    w([5], '15:00', '19:00'),
  ]);
});
test('end of close gives null', () => {
  assert.equal(parseSchedule('Happy hour 4pm to close'), null);
});
test('any unparseable window nulls the whole line', () => {
  assert.equal(parseSchedule('Mon-Fri 4-6pm, Sun 9pm-close'), null);
});
test('no am/pm and no 24-hour clock gives null', () => {
  assert.equal(parseSchedule('Wednesdays 4-6'), null);
});
test('time without days gives null', () => {
  assert.equal(parseSchedule('Happy hour 4-6pm'), null);
});
test('days without time gives null', () => {
  assert.equal(parseSchedule('Student night Wednesdays'), null);
});

test('hasTimingWords', () => {
  assert.equal(hasTimingWords('10% off with student ID'), false);
  assert.equal(hasTimingWords('Student night Wednesdays: $5 off'), true);
  assert.equal(hasTimingWords('during finals week'), true);
});

test('timingFor', () => {
  assert.deepEqual(timingFor('special', 'Happy hour daily'), { timing: 'unconfirmed', schedule: null });
  assert.deepEqual(timingFor('student', '10% off with student ID'), { timing: 'any_time', schedule: null });
  assert.deepEqual(timingFor('student', 'Student night Wednesdays'), { timing: 'unconfirmed', schedule: null });
  assert.deepEqual(timingFor('student', 'Students Mon-Fri 4-6pm'), {
    timing: 'scheduled',
    schedule: [w(WEEKDAYS, '16:00', '18:00')],
  });
});
