import type { WebsiteScan } from './website.ts';
import type { DealRow } from './types.ts';

/** Identity of a deal for hidden-row matching: curated by title, other sources by quote (falling back to title). */
export function matchKey(row: Pick<DealRow, 'source' | 'title' | 'quote'>): string {
  const text = row.source === 'curated' ? row.title : (row.quote ?? row.title);
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function withoutHidden(rows: DealRow[], hiddenKeys: Set<string>): DealRow[] {
  return rows.filter((r) => !hiddenKeys.has(matchKey(r)));
}

/** rows null = leave the place's stored deals alone; markChecked = stamp deals_checked_at. */
export function websiteDecision(scan: WebsiteScan, hiddenKeys: Set<string>): { rows: DealRow[] | null; markChecked: boolean } {
  if (scan.outcome === 'transient') return { rows: null, markChecked: false };
  if (scan.outcome === 'permanent') return { rows: [], markChecked: true };
  return { rows: withoutHidden(scan.deals, hiddenKeys), markChecked: true };
}
