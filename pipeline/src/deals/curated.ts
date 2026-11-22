import type { DealRow, DealWindow } from './types.ts';

export type CuratedRow = DealRow & { placeRef: number };

const TIME = /^(\d{2}):(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const minutes = (t: unknown): number | null => {
  if (typeof t !== 'string') return null;
  const m = TIME.exec(t);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
};

function parseWindows(raw: unknown): DealWindow[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'schedule must be a non-empty array';
  const out: DealWindow[] = [];
  for (const [i, w] of raw.entries()) {
    const o = (w ?? {}) as Record<string, unknown>;
    const days = o.days;
    if (!Array.isArray(days) || days.length === 0 || !days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
      return `schedule[${i}].days must be a non-empty list of 0-6`;
    }
    const start = minutes(o.start), end = minutes(o.end);
    if (start === null || end === null) return `schedule[${i}] start/end must be "HH:MM" (end may be "24:00")`;
    if (start === 24 * 60) return `schedule[${i}].start cannot be "24:00"`;
    if (start === end) return `schedule[${i}] start and end must differ`;
    out.push({ days: days as number[], start: o.start as string, end: o.end as string });
  }
  return out;
}

/** The UTC offset (e.g. "-05:00") Boston has at noon on the given calendar date. */
function bostonOffset(y: number, m: number, d: number): string {
  const probe = new Date(Date.UTC(y, m - 1, d, 17)); // DST changes at 2am local, so noon is unambiguous
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName')!.value; // "GMT-05:00"
  return name.replace('GMT', '');
}

function bostonToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now); // YYYY-MM-DD
}

function noonBoston(checkedOn: unknown, now: Date): string | null {
  if (typeof checkedOn !== 'string') return null;
  const m = DATE.exec(checkedOn);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (checkedOn > bostonToday(now)) return null; // a future date would keep a row fresh indefinitely
  return `${checkedOn}T12:00:00${bostonOffset(y, mo, d)}`;
}

/** Validate deals.curated.json against the place_deals table rules; bad entries are reported and skipped. */
export function validateCurated(raw: unknown, placeIds: Map<string, number>, now: Date = new Date()): { rows: CuratedRow[]; errors: string[] } {
  const rows: CuratedRow[] = [];
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { rows, errors: ['curated file must be a JSON array'] };

  for (const [i, entry] of raw.entries()) {
    const fail = (why: string) => errors.push(`entry ${i}: ${why}`);
    const e = (entry ?? {}) as Record<string, unknown>;

    const placeRef = typeof e.place_id === 'string' ? placeIds.get(e.place_id) : undefined;
    if (placeRef === undefined) { fail(`unknown place_id ${JSON.stringify(e.place_id)}`); continue; }
    if (e.kind !== 'student' && e.kind !== 'special') { fail('kind must be "student" or "special"'); continue; }
    const kind = e.kind;
    if (typeof e.title !== 'string' || e.title.trim() === '') { fail('title is required'); continue; }
    if (e.title.length > 120) { fail('title is longer than 120 characters'); continue; }
    if (typeof e.source_url !== 'string' || e.source_url.trim() === '') { fail('source_url is required'); continue; }
    const checkedAt = noonBoston(e.checked_on, now);
    if (checkedAt === null) { fail('checked_on must be a valid YYYY-MM-DD date, not in the future'); continue; }
    if (e.timing !== undefined && e.timing !== 'unconfirmed') { fail('timing may only be "unconfirmed" when set'); continue; }

    let schedule: DealWindow[] | null = null;
    if (e.schedule !== undefined && e.schedule !== null) {
      const w = parseWindows(e.schedule);
      if (typeof w === 'string') { fail(w); continue; }
      schedule = w;
    }
    if (schedule && e.timing === 'unconfirmed') { fail('a schedule cannot be combined with timing "unconfirmed"'); continue; }

    const timing = schedule ? 'scheduled' : e.timing === 'unconfirmed' ? 'unconfirmed' : kind === 'student' ? 'any_time' : 'unconfirmed';
    rows.push({ placeRef, kind, title: e.title, quote: null, timing, schedule, source: 'curated', sourceUrl: e.source_url, checkedAt });
  }
  return { rows, errors };
}
