/**
 * Boston wall-clock time ↔ absolute instants, using only the built-in Intl
 * time-zone database (no date library). Every timestamp we store is an ISO
 * 8601 string with an explicit offset, e.g. "2026-11-21T19:00:00-05:00", so it
 * is unambiguous regardless of the device's own time zone.
 */

export const BOSTON_TIME_ZONE = 'America/New_York';

/** A calendar date and time as read on a Boston clock. Month is 1–12. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOSTON_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** The Boston wall-clock reading at `instant` (seconds dropped). */
export function bostonWallTime(instant: Date): WallTime {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

/** Boston's UTC offset at `instant`, in minutes (−300 for EST, −240 for EDT). */
export function bostonOffsetMinutes(instant: Date): number {
  const w = bostonWallTime(instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/**
 * The instant at which a Boston clock reads `wall`.
 *
 * - Times skipped by the spring-forward jump (e.g. 2:30 AM on the DST start
 *   date) resolve to the same clock time in the new offset, i.e. 3:30 AM EDT.
 * - Times repeated by the fall-back change (1:00–1:59 AM) resolve to the first
 *   occurrence (EDT).
 */
export function bostonWallTimeToInstant(wall: WallTime): Date {
  const naiveUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Candidate offsets are the offsets in force around that moment.
  const offsets = new Set([
    bostonOffsetMinutes(new Date(naiveUtc - 12 * 3_600_000)),
    bostonOffsetMinutes(new Date(naiveUtc + 12 * 3_600_000)),
  ]);
  const matches = [...offsets]
    .map((offset) => new Date(naiveUtc - offset * 60_000))
    .filter((candidate) => sameWallTime(bostonWallTime(candidate), wall))
    .sort((a, b) => a.getTime() - b.getTime());
  if (matches.length > 0) return matches[0];
  // Skipped (spring-forward) time: apply the offset from before the jump.
  const before = bostonOffsetMinutes(new Date(naiveUtc - 12 * 3_600_000));
  return new Date(naiveUtc - before * 60_000);
}

function sameWallTime(a: WallTime, b: WallTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

/** ISO 8601 with Boston's offset, to the minute: "2026-11-21T19:00:00-05:00". */
export function toBostonIso(instant: Date): string {
  const w = bostonWallTime(instant);
  const offset = bostonOffsetMinutes(instant);
  const sign = offset < 0 ? '-' : '+';
  return (
    `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:00` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

/** Add whole calendar days to a Boston date (handles month/year rollover). */
export function addDays(wall: WallTime, days: number): WallTime {
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return { ...wall, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** "YYYY-MM-DD" for a Boston date, as used by <input type="date">. */
export function toDateInputValue(wall: WallTime): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** Parse `<input type="date">` and `<input type="time">` values as a Boston wall time. */
export function parseDateTimeInputs(date: string, time: string): WallTime | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time);
  if (!dm || !tm) return null;
  const wall = { year: +dm[1], month: +dm[2], day: +dm[3], hour: +tm[1], minute: +tm[2] };
  if (wall.month < 1 || wall.month > 12 || wall.hour > 23 || wall.minute > 59) return null;
  // Reject impossible dates such as 2026-02-30.
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (check.getUTCMonth() !== wall.month - 1 || check.getUTCDate() !== wall.day) return null;
  return wall;
}

const labelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOSTON_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const timeOnlyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOSTON_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});
const dayOnlyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOSTON_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** "Sat, Nov 21, 7:00 PM" in Boston time. */
export const formatBostonDateTime = (iso: string) => labelFormatter.format(new Date(iso));
/** "7:00 PM" in Boston time. */
export const formatBostonTime = (iso: string) => timeOnlyFormatter.format(new Date(iso));
/** "Sat, Nov 21" in Boston time. */
export const formatBostonDay = (iso: string) => dayOnlyFormatter.format(new Date(iso));
