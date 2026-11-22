import type { DealRow, DealWindow } from './types.ts';

const DAY_INDEX: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const TIME = '(?:[01][0-9]|2[0-3]):[0-5][0-9]';
const RANGE = new RegExp(`^(${TIME})-(${TIME}|24:00)$`);

function parseDays(part: string): number[] | null {
  const days: number[] = [];
  for (const item of part.split(',')) {
    const m = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(item);
    if (!m) return null;
    const from = DAY_INDEX[m[1]];
    if (from === undefined) return null;
    if (!m[2]) { days.push(from); continue; }
    const to = DAY_INDEX[m[2]];
    if (to === undefined) return null;
    for (let d = from; ; d = (d + 1) % 7) {
      days.push(d);
      if (d === to) break;
    }
  }
  return days;
}

/** Parses the simple `Days HH:MM-HH:MM[,HH:MM-HH:MM]; ...` subset of OSM opening_hours; null for anything else. */
export function parseOpeningHoursSubset(value: string): DealWindow[] | null {
  const windows: DealWindow[] = [];
  const seenDays = new Set<number>();
  for (const rule of value.split(';')) {
    const m = /^\s*(\S+)\s+(\S+)\s*$/.exec(rule);
    if (!m) return null;
    const days = parseDays(m[1]);
    if (!days) return null;
    // A later rule replaces earlier ones for the same day in opening_hours; don't guess the result.
    for (const d of days) {
      if (seenDays.has(d)) return null;
    }
    days.forEach((d) => seenDays.add(d));
    for (const r of m[2].split(',')) {
      const t = RANGE.exec(r);
      if (!t || t[1] === t[2]) return null;
      windows.push({ days: [...days], start: t[1], end: t[2] });
    }
  }
  return windows.length > 0 ? windows : null;
}

export function osmHappyHourDeal(tag: string, lastSeenAt: string): DealRow {
  const schedule = parseOpeningHoursSubset(tag);
  return {
    kind: 'special',
    title: 'Happy hour',
    quote: tag.slice(0, 200),
    timing: schedule ? 'scheduled' : 'unconfirmed',
    schedule,
    source: 'osm',
    sourceUrl: null,
    checkedAt: lastSeenAt,
  };
}
