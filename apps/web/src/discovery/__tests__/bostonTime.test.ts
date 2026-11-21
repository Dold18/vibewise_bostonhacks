import { describe, expect, it } from 'vitest';
import {
  bostonOffsetMinutes,
  bostonWallTimeToInstant,
  parseDateTimeInputs,
  toBostonIso,
} from '../bostonTime';
import { initialPreferences, preferencesReducer, resolveCustomTiming, resolveTiming } from '../preferences';

describe('Boston offsets', () => {
  it('is UTC−5 in winter and UTC−4 in summer', () => {
    expect(bostonOffsetMinutes(new Date('2026-11-21T17:00:00Z'))).toBe(-300);
    expect(bostonOffsetMinutes(new Date('2026-07-04T17:00:00Z'))).toBe(-240);
  });

  it('formats ISO strings with the right offset on each side of DST', () => {
    expect(toBostonIso(new Date('2026-11-21T17:00:00Z'))).toBe('2026-11-21T12:00:00-05:00');
    expect(toBostonIso(new Date('2026-07-04T17:00:00Z'))).toBe('2026-07-04T13:00:00-04:00');
  });
});

describe('wall time → instant', () => {
  it('reads a Boston clock time correctly in both seasons', () => {
    expect(bostonWallTimeToInstant({ year: 2026, month: 11, day: 21, hour: 19, minute: 0 }).toISOString()).toBe(
      '2026-11-22T00:00:00.000Z',
    );
    expect(bostonWallTimeToInstant({ year: 2026, month: 7, day: 4, hour: 21, minute: 30 }).toISOString()).toBe(
      '2026-07-05T01:30:00.000Z',
    );
  });

  it('moves a skipped spring-forward time (2:30 AM on 2026-03-08) to 3:30 AM EDT', () => {
    const instant = bostonWallTimeToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    expect(toBostonIso(instant)).toBe('2026-03-08T03:30:00-04:00');
  });

  it('picks the first occurrence of a repeated fall-back time (1:30 AM on 2026-11-01)', () => {
    const instant = bostonWallTimeToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
    expect(toBostonIso(instant)).toBe('2026-11-01T01:30:00-04:00');
  });
});

describe('date/time inputs', () => {
  it('parses valid input values', () => {
    expect(parseDateTimeInputs('2026-11-22', '18:45')).toEqual({ year: 2026, month: 11, day: 22, hour: 18, minute: 45 });
  });

  it('rejects malformed or impossible dates', () => {
    expect(parseDateTimeInputs('2026-02-30', '10:00')).toBeNull();
    expect(parseDateTimeInputs('11/22/2026', '10:00')).toBeNull();
    expect(parseDateTimeInputs('2026-11-22', '25:00')).toBeNull();
  });
});

describe('timing presets', () => {
  const noonEst = new Date('2026-11-21T17:00:00Z'); // Sat 12:00 PM EST

  it('"Right now" is the moment of selection', () => {
    expect(resolveTiming('now', noonEst)).toMatchObject({ kind: 'now', start: '2026-11-21T12:00:00-05:00', timeZone: 'America/New_York' });
  });

  it('"Tonight" from midday runs 7 PM → 3 AM', () => {
    expect(resolveTiming('tonight', noonEst)).toMatchObject({
      start: '2026-11-21T19:00:00-05:00',
      end: '2026-11-22T03:00:00-05:00',
    });
  });

  it('"Tonight" already in the evening starts now', () => {
    const ninePm = new Date('2026-11-22T02:00:00Z'); // Sat 9:00 PM EST
    expect(resolveTiming('tonight', ninePm)).toMatchObject({
      start: '2026-11-21T21:00:00-05:00',
      end: '2026-11-22T03:00:00-05:00',
    });
  });

  it('"Tonight" after midnight means the rest of the current night', () => {
    const oneAm = new Date('2026-11-22T06:00:00Z'); // Sun 1:00 AM EST
    expect(resolveTiming('tonight', oneAm)).toMatchObject({
      start: '2026-11-22T01:00:00-05:00',
      end: '2026-11-22T03:00:00-05:00',
    });
  });

  it('"Tomorrow" is the next Boston calendar day, even when UTC is already on it', () => {
    const lateEvening = new Date('2026-11-22T03:30:00Z'); // Sat 10:30 PM EST, Sun in UTC
    expect(resolveTiming('tomorrow', lateEvening)).toMatchObject({
      start: '2026-11-22T00:00:00-05:00',
      end: '2026-11-23T00:00:00-05:00',
    });
  });

  it('"Tomorrow" across the DST change gets each boundary\'s own offset', () => {
    const sat = new Date('2026-03-07T17:00:00Z'); // day before spring-forward
    expect(resolveTiming('tomorrow', sat)).toMatchObject({
      start: '2026-03-08T00:00:00-05:00',
      end: '2026-03-09T00:00:00-04:00',
    });
  });
});

describe('custom date/time', () => {
  const now = new Date('2026-11-21T17:00:00Z');

  it('stores a future custom time as Boston time with offset', () => {
    expect(resolveCustomTiming({ date: '2026-12-31', time: '22:00' }, now)).toEqual({
      timing: { kind: 'custom', start: '2026-12-31T22:00:00-05:00', timeZone: 'America/New_York', resolvedAt: '2026-11-21T12:00:00-05:00' },
      error: null,
    });
  });

  it('reports incomplete, invalid and past entries without storing a time', () => {
    expect(resolveCustomTiming({ date: '2026-12-31', time: '' }, now)).toEqual({ timing: null, error: 'incomplete' });
    expect(resolveCustomTiming({ date: '2026-02-30', time: '10:00' }, now)).toEqual({ timing: null, error: 'invalid' });
    expect(resolveCustomTiming({ date: '2026-11-21', time: '11:59' }, now)).toEqual({ timing: null, error: 'past' });
  });

  it('keeps the draft inputs in state while invalid', () => {
    const s = preferencesReducer(initialPreferences(), { type: 'setCustomTiming', date: '2026-11-21', time: '08:00', now });
    expect(s).toMatchObject({ timingChoice: 'custom', timing: null, timingError: 'past', customTiming: { date: '2026-11-21', time: '08:00' } });
  });

  it('switching to a preset clears a custom-time error', () => {
    let s = preferencesReducer(initialPreferences(), { type: 'setCustomTiming', date: '', time: '', now });
    s = preferencesReducer(s, { type: 'setTiming', kind: 'now', now });
    expect(s).toMatchObject({ timingChoice: 'now', timingError: null });
  });
});
