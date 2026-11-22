import { describe, expect, it } from 'vitest';
import {
  activeKinds,
  chipText,
  dealStatus,
  describeSchedule,
  isActive,
  toDeals,
  type Deal,
  type DealWindow,
} from './deals';

const at = (iso: string) => new Date(iso);

function special(schedule: DealWindow[], over: Partial<Deal> = {}): Deal {
  return {
    kind: 'special',
    title: 'Happy hour',
    timing: 'scheduled',
    schedule,
    source: 'curated',
    sourceUrl: 'https://example.com',
    checkedAt: '2026-11-20T12:00:00-05:00',
    ...over,
  };
}

function student(over: Partial<Deal> = {}): Deal {
  return {
    kind: 'student',
    title: '10% off with student ID',
    timing: 'any_time',
    schedule: null,
    source: 'curated',
    sourceUrl: 'https://example.com',
    checkedAt: '2026-11-20T12:00:00-05:00',
    ...over,
  };
}

const weekdayHappyHour = special([{ days: [1, 2, 3, 4, 5], start: '16:00', end: '18:00' }]);

describe('isActive', () => {
  it('includes the start and excludes the end', () => {
    expect(isActive(weekdayHappyHour, at('2026-11-23T16:00:00-05:00'))).toBe(true);
    expect(isActive(weekdayHappyHour, at('2026-11-23T17:59:00-05:00'))).toBe(true);
    expect(isActive(weekdayHappyHour, at('2026-11-23T18:00:00-05:00'))).toBe(false);
    expect(isActive(weekdayHappyHour, at('2026-11-23T15:59:00-05:00'))).toBe(false);
  });

  it('is inactive on a day outside the window', () => {
    expect(isActive(weekdayHappyHour, at('2026-11-28T17:00:00-05:00'))).toBe(false);
  });

  it('runs a window past midnight and attributes it to its start day', () => {
    const late = special([{ days: [5], start: '22:00', end: '01:00' }]);
    expect(isActive(late, at('2026-11-27T22:00:00-05:00'))).toBe(true); // Fri 22:00
    expect(isActive(late, at('2026-11-28T00:30:00-05:00'))).toBe(true); // Sat 00:30
    expect(isActive(late, at('2026-11-28T01:00:00-05:00'))).toBe(false);
    expect(isActive(late, at('2026-11-28T22:30:00-05:00'))).toBe(false); // Sat evening is not a start day
    expect(isActive(late, at('2026-11-27T00:30:00-05:00'))).toBe(false); // Fri early morning belongs to Thu
  });

  it('treats 24:00 as the end of the day', () => {
    const w = special([{ days: [1], start: '20:00', end: '24:00' }]);
    expect(isActive(w, at('2026-11-23T23:59:00-05:00'))).toBe(true);
    expect(isActive(w, at('2026-11-24T00:00:00-05:00'))).toBe(false);
  });

  it('reads the Boston clock, not UTC', () => {
    expect(isActive(weekdayHappyHour, at('2026-11-23T21:30:00Z'))).toBe(true);
  });

  it('uses the Boston weekday when it differs from the UTC weekday', () => {
    const mon = special([{ days: [1], start: '22:00', end: '23:00' }]);
    expect(isActive(mon, at('2026-11-24T03:30:00Z'))).toBe(true); // Mon 22:30 Boston, Tue in UTC
  });

  it('is active on the second 01:30 pass of the DST end day', () => {
    const sun = special([{ days: [0], start: '01:30', end: '02:30' }]);
    expect(isActive(sun, at('2026-11-01T06:45:00Z'))).toBe(true); // 01:45 EST
  });

  it('keeps a recent any_time student deal active and a 91-day-old one stale', () => {
    const now = at('2026-11-21T12:00:00-05:00');
    const day = 24 * 60 * 60 * 1000;
    const fresh = student({ checkedAt: new Date(now.getTime() - 10 * day).toISOString() });
    const old = student({ checkedAt: new Date(now.getTime() - 91 * day).toISOString() });
    expect(isActive(fresh, now)).toBe(true);
    expect(dealStatus(fresh, now)).toEqual({ kind: 'active' });
    expect(isActive(old, now)).toBe(false);
    expect(dealStatus(old, now)).toEqual({ kind: 'stale' });
  });

  it('never activates unconfirmed deals', () => {
    const now = at('2026-11-21T12:00:00-05:00');
    for (const kind of ['student', 'special'] as const) {
      const d = student({ kind, timing: 'unconfirmed' });
      expect(isActive(d, now)).toBe(false);
      expect(dealStatus(d, now)).toEqual({ kind: 'unconfirmed' });
    }
  });

  it('applies a schedule to a student deal too', () => {
    const night = student({ timing: 'scheduled', schedule: [{ days: [3], start: '20:00', end: '23:00' }] });
    expect(isActive(night, at('2026-11-25T21:00:00-05:00'))).toBe(true);
    expect(isActive(night, at('2026-11-26T21:00:00-05:00'))).toBe(false);
  });
});

describe('dealStatus', () => {
  it('names the next window start', () => {
    const tue = special([{ days: [2], start: '16:00', end: '18:00' }]);
    expect(dealStatus(tue, at('2026-11-23T12:00:00-05:00'))).toEqual({ kind: 'next', label: 'Next: Tue 4–6pm' });
  });

  it('finds the next start later the same day and a week out', () => {
    const mon = special([{ days: [1], start: '16:00', end: '18:00' }]);
    expect(dealStatus(mon, at('2026-11-23T12:00:00-05:00'))).toEqual({ kind: 'next', label: 'Next: Mon 4–6pm' });
    expect(dealStatus(mon, at('2026-11-23T18:00:00-05:00'))).toEqual({ kind: 'next', label: 'Next: Mon 4–6pm' });
  });

  it('picks the soonest across several windows', () => {
    const d = special([
      { days: [5], start: '15:00', end: '19:00' },
      { days: [3], start: '17:00', end: '18:00' },
    ]);
    expect(dealStatus(d, at('2026-11-23T12:00:00-05:00'))).toEqual({ kind: 'next', label: 'Next: Wed 5–6pm' });
  });

  it('reports stale before active', () => {
    expect(
      dealStatus({ ...weekdayHappyHour, checkedAt: '2026-01-01T12:00:00-05:00' }, at('2026-11-23T16:30:00-05:00')),
    ).toEqual({ kind: 'stale' });
  });
});

describe('activeKinds', () => {
  it('collects the kinds that are active', () => {
    const now = at('2026-11-23T16:30:00-05:00');
    expect(activeKinds([student(), weekdayHappyHour], now)).toEqual(new Set(['student', 'special']));
    expect(activeKinds([student({ timing: 'unconfirmed' }), weekdayHappyHour], now)).toEqual(new Set(['special']));
    expect(activeKinds([], now).size).toBe(0);
  });
});

describe('describeSchedule', () => {
  const d = (schedule: DealWindow[]) => describeSchedule(special(schedule));

  it('collapses consecutive days', () => {
    expect(d([{ days: [1, 2, 3, 4, 5], start: '16:00', end: '18:00' }])).toBe('Mon–Fri 4–6pm');
  });
  it('lists non-consecutive and pair days with commas', () => {
    expect(d([{ days: [6, 5], start: '22:00', end: '01:00' }])).toBe('Fri, Sat 10pm–1am');
    expect(d([{ days: [1, 3], start: '16:00', end: '18:00' }])).toBe('Mon, Wed 4–6pm');
  });
  it('says Daily for all seven days and shows non-zero minutes', () => {
    expect(d([{ days: [0, 1, 2, 3, 4, 5, 6], start: '16:30', end: '18:30' }])).toBe('Daily 4:30–6:30pm');
  });
  it('joins several windows', () => {
    expect(
      d([
        { days: [1, 2, 3, 4], start: '16:00', end: '18:00' },
        { days: [5], start: '15:00', end: '19:00' },
      ]),
    ).toBe('Mon–Thu 4–6pm; Fri 3–7pm');
  });
  it('writes both meridiems when they differ', () => {
    expect(d([{ days: [2], start: '11:00', end: '14:00' }])).toBe('Tue 11am–2pm');
    expect(d([{ days: [2], start: '20:00', end: '24:00' }])).toBe('Tue 8pm–12am');
  });
  it('describes any_time and unconfirmed', () => {
    expect(describeSchedule(student())).toBe('Any time');
    expect(describeSchedule(student({ timing: 'unconfirmed' }))).toBe('Times not confirmed');
  });
});

describe('chipText', () => {
  it('renders the active kinds', () => {
    expect(chipText(new Set())).toBe('');
    expect(chipText(new Set(['student']))).toBe('🎓');
    expect(chipText(new Set(['special']))).toBe('%');
    expect(chipText(new Set(['student', 'special']))).toBe('🎓 %');
  });
});

describe('toDeals', () => {
  const row = {
    kind: 'special',
    title: 'Happy hour',
    timing: 'scheduled',
    schedule: [{ days: [1, 2], start: '16:00', end: '18:00' }],
    source: 'website',
    source_url: 'https://example.com/menu',
    checked_at: '2026-11-20T17:00:00+00:00',
  };

  it('maps a valid row', () => {
    expect(toDeals([row])).toEqual([
      {
        kind: 'special',
        title: 'Happy hour',
        timing: 'scheduled',
        schedule: [{ days: [1, 2], start: '16:00', end: '18:00' }],
        source: 'website',
        sourceUrl: 'https://example.com/menu',
        checkedAt: '2026-11-20T17:00:00+00:00',
      },
    ]);
  });

  it('returns [] for non-arrays', () => {
    expect(toDeals(null)).toEqual([]);
    expect(toDeals(undefined)).toEqual([]);
    expect(toDeals({})).toEqual([]);
  });

  it('drops malformed rows and keeps the rest', () => {
    const bad = [
      { ...row, schedule: null },
      { ...row, kind: 'coupon' },
      { ...row, timing: 'any_time', schedule: null }, // any_time is student-only
      { ...row, timing: 'unconfirmed' }, // schedule must be null
      { ...row, schedule: [{ days: [], start: '16:00', end: '18:00' }] },
      { ...row, schedule: [{ days: [7], start: '16:00', end: '18:00' }] },
      { ...row, schedule: [{ days: [1.5], start: '16:00', end: '18:00' }] },
      { ...row, schedule: [{ days: [1], start: '4pm', end: '18:00' }] },
      { ...row, schedule: [{ days: [1], start: '24:00', end: '18:00' }] },
      { ...row, schedule: [{ days: [1], start: '16:00', end: '25:00' }] },
      { ...row, schedule: [] },
      { ...row, title: '' },
      { ...row, source: 'scraped' },
      { ...row, checked_at: 'not a date' },
      { ...row, source_url: 5 },
      null,
      'x',
    ];
    expect(toDeals([...bad, row])).toHaveLength(1);
  });

  it('accepts a null source_url, an any_time student row and an unconfirmed row', () => {
    const out = toDeals([
      { ...row, source: 'osm', source_url: null },
      { ...row, kind: 'student', timing: 'any_time', schedule: null },
      { ...row, timing: 'unconfirmed', schedule: null },
    ]);
    expect(out.map((d) => d.timing)).toEqual(['scheduled', 'any_time', 'unconfirmed']);
    expect(out[0].sourceUrl).toBeNull();
  });
});
