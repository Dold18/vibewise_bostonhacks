/**
 * Deal markers: pure active-deal logic. Every schedule is Boston local time, and
 * the clock is only ever read through `bostonWallTime`, so results are the same
 * whatever the device's time zone.
 */
import { bostonWallTime } from './discovery/bostonTime';

export type DealKind = 'student' | 'special';

/** days: 0 = Sunday … 6 = Saturday. start "HH:MM"; end "HH:MM" or "24:00". */
export interface DealWindow {
  days: number[];
  start: string;
  end: string;
}

export interface Deal {
  kind: DealKind;
  title: string;
  timing: 'any_time' | 'scheduled' | 'unconfirmed';
  schedule: DealWindow[] | null;
  source: 'curated' | 'osm' | 'website';
  sourceUrl: string | null;
  checkedAt: string;
}

export const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export type DealStatus =
  | { kind: 'active' }
  | { kind: 'next'; label: string }
  | { kind: 'unconfirmed' }
  | { kind: 'stale' };

const MINUTES_PER_DAY = 24 * 60;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "HH:MM" (or "24:00") → minutes since midnight. Callers pass validated strings. */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Boston weekday (0 = Sunday) and minute-of-day at `now`. */
function bostonDayAndMinute(now: Date): { day: number; minute: number } {
  const w = bostonWallTime(now);
  return {
    day: new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay(),
    minute: w.hour * 60 + w.minute,
  };
}

function isStale(deal: Deal, now: Date): boolean {
  const checked = Date.parse(deal.checkedAt);
  return Number.isNaN(checked) || now.getTime() - checked > STALE_AFTER_MS;
}

function inWindow(window: DealWindow, day: number, minute: number): boolean {
  const start = minutes(window.start);
  const end = minutes(window.end);
  if (end > start) return window.days.includes(day) && minute >= start && minute < end;
  // Runs past midnight: belongs to its start day, spills into the next.
  return (
    (window.days.includes(day) && minute >= start) ||
    (window.days.includes((day + 6) % 7) && minute < end)
  );
}

function scheduleActive(deal: Deal, now: Date): boolean {
  if (!deal.schedule) return false;
  const { day, minute } = bostonDayAndMinute(now);
  return deal.schedule.some((w) => inWindow(w, day, minute));
}

export function isActive(deal: Deal, now: Date): boolean {
  if (isStale(deal, now)) return false;
  if (deal.timing === 'any_time') return true;
  if (deal.timing === 'scheduled') return scheduleActive(deal, now);
  return false;
}

/** The window whose start is soonest within the next 7 days, if any. */
function nextWindow(schedule: DealWindow[], now: Date): { window: DealWindow; day: number } | null {
  const { day: today, minute } = bostonDayAndMinute(now);
  let best: { window: DealWindow; day: number; wait: number } | null = null;
  for (const window of schedule) {
    const start = minutes(window.start);
    for (const day of window.days) {
      const wait = ((day - today + 7) % 7) * MINUTES_PER_DAY + start - minute;
      const until = wait > 0 ? wait : wait + 7 * MINUTES_PER_DAY;
      if (!best || until < best.wait) best = { window, day, wait: until };
    }
  }
  return best;
}

export function dealStatus(deal: Deal, now: Date): DealStatus {
  if (isStale(deal, now)) return { kind: 'stale' };
  if (isActive(deal, now)) return { kind: 'active' };
  if (deal.timing === 'scheduled' && deal.schedule) {
    const next = nextWindow(deal.schedule, now);
    if (next) {
      return { kind: 'next', label: `Next: ${DAY_NAMES[next.day]} ${formatRange(next.window.start, next.window.end)}` };
    }
  }
  return { kind: 'unconfirmed' };
}

export function activeKinds(deals: readonly Deal[], now: Date): Set<DealKind> {
  const kinds = new Set<DealKind>();
  for (const deal of deals) if (isActive(deal, now)) kinds.add(deal.kind);
  return kinds;
}

function formatClock(total: number): { text: string; meridiem: 'am' | 'pm' } {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { text: m === 0 ? String(h12) : `${h12}:${String(m).padStart(2, '0')}`, meridiem: h < 12 ? 'am' : 'pm' };
}

/** "4–6pm", "4:30–6:30pm", "10pm–1am". */
function formatRange(start: string, end: string): string {
  if (start === '00:00' && end === '24:00') return 'all day';
  const a = formatClock(minutes(start));
  const b = formatClock(minutes(end));
  if (minutes(start) === 0) return `${a.text}am–${b.text}${b.meridiem}`; // "12am–6am", not "12–6am"
  return a.meridiem === b.meridiem ? `${a.text}–${b.text}${b.meridiem}` : `${a.text}${a.meridiem}–${b.text}${b.meridiem}`;
}

/** Sorted unique days; runs of three or more collapse ("Mon–Fri"), the rest join with ", ". */
function formatDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((x, y) => x - y);
  if (sorted.length === 7) return 'Daily';
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${DAY_NAMES[sorted[i]]}–${DAY_NAMES[sorted[j]]}`);
    else for (let k = i; k <= j; k++) parts.push(DAY_NAMES[sorted[k]]);
    i = j + 1;
  }
  return parts.join(', ');
}

export function describeSchedule(deal: Deal): string {
  if (deal.timing === 'any_time') return 'Any time';
  if (deal.timing !== 'scheduled' || !deal.schedule) return 'Times not confirmed';
  return deal.schedule
    .map((w) => {
      const range = formatRange(w.start, w.end);
      return `${formatDays(w.days)}${range === 'all day' ? ',' : ''} ${range}`;
    })
    .join('; ');
}

export function chipText(kinds: ReadonlySet<DealKind>): string {
  const parts: string[] = [];
  if (kinds.has('student')) parts.push('🎓');
  if (kinds.has('special')) parts.push('%');
  return parts.join(' ');
}

// ---- Validation of PostgREST rows ------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseWindow(raw: unknown): DealWindow | null {
  if (!isRecord(raw)) return null;
  const { days, start, end } = raw;
  if (!Array.isArray(days) || days.length === 0) return null;
  if (!days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) return null;
  if (typeof start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return null;
  if (typeof end !== 'string' || !(/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end === '24:00')) return null;
  if (minutes(start) === minutes(end)) return null; // would read as a 24-hour window
  return { days: days as number[], start, end };
}

function parseSchedule(raw: unknown): DealWindow[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const windows = raw.map(parseWindow);
  return windows.every((w): w is DealWindow => w !== null) ? windows : null;
}

function toDeal(raw: unknown): Deal | null {
  if (!isRecord(raw)) return null;
  const { kind, title, timing, schedule, source, source_url: sourceUrl, checked_at: checkedAt } = raw;
  if (kind !== 'student' && kind !== 'special') return null;
  if (typeof title !== 'string' || title.trim() === '') return null;
  if (timing !== 'any_time' && timing !== 'scheduled' && timing !== 'unconfirmed') return null;
  if (timing === 'any_time' && kind !== 'student') return null;
  if (source !== 'curated' && source !== 'osm' && source !== 'website') return null;
  if (sourceUrl !== null && sourceUrl !== undefined && typeof sourceUrl !== 'string') return null;
  if (typeof checkedAt !== 'string' || Number.isNaN(Date.parse(checkedAt))) return null;

  let windows: DealWindow[] | null = null;
  if (timing === 'scheduled') {
    windows = parseSchedule(schedule);
    if (!windows) return null;
  } else if (schedule !== null && schedule !== undefined) {
    return null;
  }
  return { kind, title, timing, schedule: windows, source, sourceUrl: sourceUrl ?? null, checkedAt };
}

/** Validates PostgREST `place_deals` rows (snake_case); malformed rows are dropped. */
export function toDeals(raw: unknown): Deal[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toDeal).filter((d): d is Deal => d !== null);
}
