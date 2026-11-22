import { parse } from 'node-html-parser';
import type { PoliteFetcher } from '../media/http.ts';
import type { EnrichPlace } from '../media/types.ts';
import { isThirdParty, websiteUrl } from '../media/website.ts';
import { extractLines, matchDeals } from './match.ts';
import type { DealRow } from './types.ts';

export type WebsiteScan =
  | { outcome: 'ok'; deals: DealRow[] }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; detail: string };

export const DEAL_LINK = /special|happy[\s_-]?hour|student|deal|promo|discount/i;
const MAX_LINKED_PAGES = 2;
const MAX_DEALS = 5;

/** Same-origin pages whose href or text looks deal-related, in page order, de-duplicated. */
function dealLinks(html: string, homeUrl: string): string[] {
  const origin = new URL(homeUrl).origin;
  const out: string[] = [];
  for (const a of parse(html).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!DEAL_LINK.test(href) && !DEAL_LINK.test(a.text)) continue;
    let u: URL;
    try { u = new URL(href, homeUrl); } catch { continue; }
    u.hash = '';
    const s = u.toString();
    if (u.origin !== origin || s === homeUrl || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_LINKED_PAGES) break;
  }
  return out;
}

export async function scanWebsite(place: EnrichPlace, http: PoliteFetcher, checkedAt: string): Promise<WebsiteScan> {
  const permanent = (detail: string): WebsiteScan => ({ outcome: 'permanent', detail });
  if (!place.website) return permanent('no website');
  const start = websiteUrl(place.website);
  if (!start) return permanent(`invalid website URL: ${place.website}`);
  if (isThirdParty(start)) return permanent(`not the place's own site: ${start}`);

  const home = await http.getText(start, { checkRobots: true });
  if (!home.ok) {
    return home.reason === 'timeout' || home.reason === 'network'
      ? { outcome: 'transient', detail: home.detail }
      : permanent(`${home.reason}: ${home.detail}`);
  }
  if (isThirdParty(home.url)) return permanent(`not the place's own site: ${home.url}`);

  const pages = [{ url: home.url, body: home.body }];
  for (const link of dealLinks(home.body, home.url)) {
    const page = await http.getText(link, { checkRobots: true });
    if (page.ok) pages.push({ url: page.url, body: page.body });
    else if (page.reason === 'timeout' || page.reason === 'network') return { outcome: 'transient', detail: page.detail };
    // robots, http, not_html or third_party on a linked page: skip it
  }

  const deals: DealRow[] = [];
  const seen = new Set<string>();
  for (const { url, body } of pages) {
    for (const deal of matchDeals(extractLines(body), url, checkedAt)) {
      const key = deal.title.toLowerCase();
      if (seen.has(key) || deals.length >= MAX_DEALS) continue;
      seen.add(key);
      deals.push(deal);
    }
  }
  return { outcome: 'ok', deals };
}
