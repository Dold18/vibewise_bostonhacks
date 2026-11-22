import type { DealKind, DealTiming, DealWindow } from './types.ts';

const DAY_WORD =
  '(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)s?\\b';
const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const RANGE_SEP = '(?:[-–—]|through|thru|to)';
const DAY_ITEM = `\\b${DAY_WORD}(?:\\s*${RANGE_SEP}\\s*${DAY_WORD})?`;
const LIST_SEP = '(?:\\s*[,&/]\\s*|\\s+and\\s+)';
const DAY_EXPR_RE = new RegExp(
  `\\b(?:weekdays?|weekends?|daily|every\\s?day)\\b|${DAY_ITEM}(?:${LIST_SEP}${DAY_ITEM})*`,
  'gi',
);
const DAY_WORD_RE = new RegExp(`\\b${DAY_WORD}`, 'gi');

const MERIDIEM = '[ap]\\.?m\\b\\.?';
const TIME_TOKEN = `(?:noon|midnight|\\d{1,2}(?::\\d{2})?(?:\\s*${MERIDIEM})?)`;
const TIME_RANGE_RE = new RegExp(
  `(?<![\\d$:.])\\b(${TIME_TOKEN})\\s*(?:[-–—]|to|until|till)\\s*(${TIME_TOKEN}|close|closing|late)(?![\\d%:])`,
  'gi',
);
const STRAY_TIME_RE = new RegExp(`\\b(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*${MERIDIEM})`, 'i');

interface Found<T> {
  start: number;
  end: number;
  value: T;
}

function dayIndex(word: string): number {
  return DAY_INDEX[word.slice(0, 3).toLowerCase()]!;
}

function expandDays(expr: string): number[] {
  const lower = expr.toLowerCase();
  if (/^weekdays?$/.test(lower)) return [1, 2, 3, 4, 5];
  if (/^weekends?$/.test(lower)) return [0, 6];
  if (/^(daily|every\s?day)$/.test(lower)) return [0, 1, 2, 3, 4, 5, 6];
  const days: number[] = [];
  const add = (d: number) => {
    if (!days.includes(d)) days.push(d);
  };
  for (const item of expr.split(/\s*[,&/]\s*|\s+and\s+/i)) {
    const words = item.match(DAY_WORD_RE) ?? [];
    const first = dayIndex(words[0]!);
    if (words.length < 2) {
      add(first);
      continue;
    }
    const last = dayIndex(words[1]!);
    for (let d = first; ; d = (d + 1) % 7) {
      add(d);
      if (d === last) break;
    }
  }
  return days;
}

interface Clock {
  hour: number;
  minute: number;
  meridiem: 'am' | 'pm' | null;
  h24: boolean;
}

function parseClock(token: string): Clock | null {
  const t = token.trim().toLowerCase();
  if (t === 'noon') return { hour: 12, minute: 0, meridiem: 'pm', h24: false };
  if (t === 'midnight') return { hour: 12, minute: 0, meridiem: 'am', h24: false };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?$/.exec(t);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (minute > 59) return null;
  const meridiem = m[3] === undefined ? null : m[3] === 'a' ? 'am' : 'pm';
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return { hour, minute, meridiem, h24: false };
  }
  const h24 = hour >= 13 || (m[1]!.length === 2 && m[1]!.startsWith('0'));
  if (h24 && (hour > 24 || (hour === 24 && minute !== 0))) return null;
  return { hour, minute, meridiem: null, h24 };
}

function minutesOf(c: Clock, meridiem: 'am' | 'pm' | null): number {
  if (!meridiem) return c.hour * 60 + c.minute;
  return ((c.hour % 12) + (meridiem === 'pm' ? 12 : 0)) * 60 + c.minute;
}

function fmt(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

const other = (m: 'am' | 'pm'): 'am' | 'pm' => (m === 'am' ? 'pm' : 'am');

/** True when `to` is 1 minute to 12 hours after `from`, wrapping past midnight. */
function within12h(from: number, to: number): boolean {
  const d = (to - from + 1440) % 1440;
  return d > 0 && d <= 720;
}

function resolveRange(a: string, b: string): { start: string; end: string } | null {
  const s = parseClock(a);
  const e = parseClock(b);
  if (!s || !e) return null;
  let sm: number;
  let em: number;
  if (s.meridiem && e.meridiem) {
    sm = minutesOf(s, s.meridiem);
    em = minutesOf(e, e.meridiem);
    if (sm === em) return null;
  } else if (e.meridiem) {
    // The end's am/pm applies to the start only if that gives a sane window ("11-2pm" is 11:00-14:00).
    em = minutesOf(e, e.meridiem);
    sm = minutesOf(s, e.meridiem);
    if (!within12h(sm, em)) sm = minutesOf(s, other(e.meridiem));
    if (!within12h(sm, em)) return null;
  } else if (s.meridiem) {
    sm = minutesOf(s, s.meridiem);
    em = minutesOf(e, s.meridiem);
    if (!within12h(sm, em)) em = minutesOf(e, other(s.meridiem));
    if (!within12h(sm, em)) return null;
  } else {
    if (!s.h24 && !e.h24) return null;
    sm = minutesOf(s, null);
    em = minutesOf(e, null);
    if (sm === em || sm >= 1440) return null;
  }
  return { start: fmt(sm), end: fmt(em) };
}

/** Parse day and time expressions in one piece of text. Returns null unless every part is understood. */
export function parseSchedule(text: string): DealWindow[] | null {
  const days: Found<number[]>[] = [];
  for (const m of text.matchAll(DAY_EXPR_RE)) {
    days.push({ start: m.index, end: m.index + m[0].length, value: expandDays(m[0]) });
  }

  const ranges: Found<{ start: string; end: string }>[] = [];
  let rest = text;
  for (const m of text.matchAll(TIME_RANGE_RE)) {
    const resolved = resolveRange(m[1]!, m[2]!);
    if (!resolved) return null;
    ranges.push({ start: m.index, end: m.index + m[0].length, value: resolved });
    rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
  }
  if (ranges.length === 0) return null;
  if (STRAY_TIME_RE.test(rest)) return null; // a time we could not pair into a range

  const paired = new Set<Found<number[]>>();
  const dailyAny = /\b(daily|every\s?day)\b/i.test(text);
  const windows: DealWindow[] = [];
  for (const r of ranges) {
    const before = days.filter((d) => !paired.has(d) && d.end <= r.start).at(-1);
    const after = days.find((d) => !paired.has(d) && d.start >= r.end);
    const day = before ?? after;
    if (day) {
      paired.add(day);
      windows.push({ days: day.value, ...r.value });
    } else if (dailyAny) {
      windows.push({ days: [0, 1, 2, 3, 4, 5, 6], ...r.value });
    } else {
      return null;
    }
  }
  if (paired.size < days.length) return null;
  return windows;
}

const TIMING_WORD_RES: RegExp[] = [
  new RegExp(`\\b${DAY_WORD}`, 'i'),
  /\b(?:weekdays?|weekends?|daily|every\s?day|nights?|lunch|dinner|brunch|hours?|week|finals|semester|until|till|am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  new RegExp(`\\b\\d{1,2}\\s*${MERIDIEM}`, 'i'),
  /\b(?:noon|midnight)\b/i,
];

export function hasTimingWords(text: string): boolean {
  return TIMING_WORD_RES.some((re) => re.test(text));
}

export function timingFor(
  kind: DealKind,
  text: string,
): { timing: DealTiming; schedule: DealWindow[] | null } {
  const schedule = parseSchedule(text);
  if (schedule) return { timing: 'scheduled', schedule };
  if (kind === 'student' && !hasTimingWords(text)) return { timing: 'any_time', schedule: null };
  return { timing: 'unconfirmed', schedule: null };
}
