export type DealKind = 'student' | 'special';
export type DealTiming = 'any_time' | 'scheduled' | 'unconfirmed';
export type DealSource = 'curated' | 'osm' | 'website';

/** days 0=Sun..6=Sat; times "HH:MM" in Boston local time; end may be "24:00". */
export interface DealWindow {
  days: number[];
  start: string;
  end: string;
}

export interface DealRow {
  kind: DealKind;
  title: string;
  quote: string | null;
  timing: DealTiming;
  schedule: DealWindow[] | null;
  source: DealSource;
  sourceUrl: string | null;
  checkedAt: string;
}
