import fs from 'node:fs/promises';
import path from 'node:path';
import { metersBetween } from '../geo.ts';
import { nameKey, nameSimilarity } from '../normalize.ts';
import type { PoliteFetcher } from './http.ts';
import type { EnrichPlace } from './types.ts';
import { isDistinctiveName } from './wikimedia.ts';

const API = 'https://en.wikivoyage.org/w/api.php';
const FIXED_PAGES = ['Boston', 'Cambridge (Massachusetts)', 'Somerville', 'Brookline'];
const LISTING_TEMPLATES = new Set(['eat', 'drink', 'see', 'do', 'listing']);
const MATCH_METERS = 100;
const MATCH_SIMILARITY = 0.8;

export interface Listing { name: string; lat: number | null; lng: number | null; content: string; pageTitle: string }

/** Index just past the `}}` closing the template that opens at `start`, or -1. */
function templateEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '{' && s[i + 1] === '{') { depth++; i++; } else if (s[i] === '}' && s[i + 1] === '}') {
      depth--; i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Split on `|` that is not inside a nested {{…}} or [[…]]. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  return parts;
}

function cleanWikitext(s: string): string {
  let out = s;
  // Drop nested templates, innermost first.
  for (let prev = ''; prev !== out;) { prev = out; out = out.replace(/\{\{[^{}]*\}\}/g, ''); }
  return out
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

export function parseListings(wikitext: string, pageTitle: string): Listing[] {
  const out: Listing[] = [];
  for (let i = wikitext.indexOf('{{'); i !== -1; i = wikitext.indexOf('{{', i + 2)) {
    const end = templateEnd(wikitext, i);
    if (end === -1) break;
    const [head, ...params] = splitTopLevel(wikitext.slice(i + 2, end - 2));
    if (!LISTING_TEMPLATES.has((head ?? '').trim().toLowerCase())) continue;
    const kv: Record<string, string> = {};
    for (const p of params) {
      const eq = p.indexOf('=');
      if (eq > 0) kv[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    }
    const name = cleanWikitext(kv.name ?? '');
    if (!name) continue;
    out.push({ name, lat: toNumber(kv.lat), lng: toNumber(kv.long), content: cleanWikitext(kv.content ?? ''), pageTitle });
    i = end - 2;
  }
  return out;
}

function apiUrl(params: Record<string, string>): string {
  return `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
}

export async function loadListings(http: PoliteFetcher, opts: { cacheDir: string; refresh: boolean }): Promise<Listing[]> {
  const cacheFile = path.join(opts.cacheDir, 'wikivoyage.json');
  if (!opts.refresh) {
    try { return JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Listing[]; } catch { /* no cache yet */ }
  }
  const titles = new Set(FIXED_PAGES);
  let apcontinue: string | undefined;
  do {
    const res = await http.getJson<{ query?: { allpages?: Array<{ title: string }> }; continue?: { apcontinue?: string } }>(apiUrl({
      action: 'query', list: 'allpages', apprefix: 'Boston/', apnamespace: '0', aplimit: 'max',
      ...(apcontinue ? { apcontinue } : {}),
    }));
    for (const p of res.query?.allpages ?? []) titles.add(p.title);
    apcontinue = res.continue?.apcontinue;
  } while (apcontinue);

  const listings: Listing[] = [];
  for (const page of titles) {
    const res = await http.getJson<{ parse?: { title?: string; wikitext?: string } }>(apiUrl({ action: 'parse', page, prop: 'wikitext' }));
    listings.push(...parseListings(res.parse?.wikitext ?? '', res.parse?.title ?? page));
  }
  await fs.mkdir(opts.cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(listings));
  return listings;
}

/**
 * `sameNamePlaces` is how many catalog places share this place's name; a name-only match (no coordinates) is
 * refused for chains, or every branch would get the one listing.
 */
export function matchListing(place: EnrichPlace, listings: Listing[], opts: { sameNamePlaces?: number } = {}): Listing | null {
  let best: { l: Listing; d: number } | null = null;
  for (const l of listings) {
    if (l.lat === null || l.lng === null) continue;
    const d = metersBetween(place, { lat: l.lat, lng: l.lng });
    if (d <= MATCH_METERS && nameSimilarity(l.name, place.name) >= MATCH_SIMILARITY && (!best || d < best.d)) best = { l, d };
  }
  if (best) return best.l;
  if (!isDistinctiveName(place.name) || (opts.sameNamePlaces ?? 1) > 1) return null;
  const key = nameKey(place.name);
  const sameName = listings.filter((l) => nameKey(l.name) === key);
  const only = sameName.length === 1 ? sameName[0]! : null;
  return only && only.lat === null ? only : null;
}
