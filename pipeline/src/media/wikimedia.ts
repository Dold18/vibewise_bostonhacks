import { nameKey, nameSimilarity } from '../normalize.ts';
import type { PoliteFetcher } from './http.ts';
import type { EnrichPlace, PhotoCandidate } from './types.ts';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const TITLES_PER_REQUEST = 50;
const GEOSEARCH_RADIUS_M = 50;
const THUMB_WIDTH = 1024;

// Words that say what a place is, not which place it is.
const GENERIC = new Set([
  'cafe', 'coffee', 'pizza', 'pizzeria', 'bar', 'pub', 'restaurant', 'bakery', 'deli', 'grill', 'kitchen', 'diner',
  'sushi', 'tavern', 'bistro', 'eatery', 'market', 'burger', 'burgers', 'tacos', 'taqueria', 'ramen', 'pho', 'bagels',
  'donuts', 'shop', 'house', 'place', 'and', 'of', 'tea', 'bbq', 'wine', 'beer', 'lounge', 'food', 'express',
]);

export interface CommonsFile { url: string; pageUrl: string; license: string; credit: string; categories: string[] }

function apiUrl(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
}

export function isAllowedLicense(shortName: string): boolean {
  const s = shortName.trim();
  if (!s || /\bNC\b|\bND\b|non-?commercial|no-?deriv/i.test(s)) return false;
  return /^(cc0|cc-zero|public domain|pd\b|pd-|cc[ -]by(-sa)?([ -]\d|$))/i.test(s);
}

// Area words common in Boston photo titles; they say where, not which place.
const LOCALITY = new Set([
  'boston', 'cambridge', 'somerville', 'brookline', 'allston', 'brighton', 'fenway', 'harvard', 'kendall', 'central',
  'porter', 'davis', 'square', 'street', 'st', 'avenue', 'ave', 'station', 'center', 'centre', 'downtown', 'north', 'south',
]);

/** A token that can identify a place: 3+ letters, not a number, not a generic food word or an area word. */
function isSpecificToken(t: string, extraGeneric: ReadonlySet<string>): boolean {
  return !GENERIC.has(t) && !extraGeneric.has(t) && !LOCALITY.has(t) && (t.match(/\p{L}/gu)?.length ?? 0) >= 3;
}

export function isDistinctiveName(name: string, extraGeneric: ReadonlySet<string> = new Set()): boolean {
  const tokens = nameKey(name).split(' ').filter(Boolean);
  const specific = tokens.filter((t) => isSpecificToken(t, extraGeneric));
  if (specific.length === 0) return false;
  return tokens.length >= 2 || specific.some((t) => t.length >= 5);
}

export function nameMatches(haystack: string, name: string, extraGeneric: ReadonlySet<string> = new Set()): boolean {
  if (!isDistinctiveName(name, extraGeneric)) return false;
  const hay = haystack.replace(/^(File|Category):/i, '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const hayTokens = new Set(nameKey(hay).split(' '));
  const nameTokens = nameKey(name).split(' ').filter(Boolean);
  return nameTokens.every((t) => hayTokens.has(t)) || nameSimilarity(hay, name) >= 0.8;
}

/** "File:Some_name.jpg" or "Some name.jpg" → "File:Some name.jpg", as MediaWiki normalizes titles. */
function fileTitle(raw: string): string {
  let name = raw.replace(/^File:/i, '');
  try { name = decodeURIComponent(name); } catch { /* keep as is */ }
  name = name.replace(/_/g, ' ').trim();
  return `File:${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

interface CommonsPage {
  title: string; missing?: boolean;
  imageinfo?: Array<{ thumburl?: string; url?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }>;
  categories?: Array<{ title: string }>;
}

export async function commonsFiles(titles: string[], http: PoliteFetcher): Promise<Map<string, CommonsFile>> {
  const out = new Map<string, CommonsFile>();
  const unique = [...new Set(titles.map(fileTitle))];
  for (let i = 0; i < unique.length; i += TITLES_PER_REQUEST) {
    const batch = unique.slice(i, i + TITLES_PER_REQUEST);
    const res = await http.getJson<{ query?: { pages?: CommonsPage[] } }>(apiUrl(COMMONS_API, {
      action: 'query', prop: 'imageinfo|categories', iiprop: 'url|extmetadata', iiurlwidth: String(THUMB_WIDTH),
      cllimit: 'max', titles: batch.join('|'),
    }));
    for (const page of res.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (page.missing || !info) continue;
      const license = stripHtml(info.extmetadata?.LicenseShortName?.value ?? '');
      const url = info.thumburl ?? info.url;
      if (!url || !url.startsWith('https:') || !isAllowedLicense(license)) continue;
      out.set(page.title, {
        url,
        pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        license,
        credit: stripHtml(info.extmetadata?.Artist?.value ?? '') || 'Wikimedia Commons',
        categories: (page.categories ?? []).map((c) => c.title.replace(/^Category:/, '')),
      });
    }
  }
  return out;
}

function toCandidate(f: CommonsFile, source: 'osm' | 'wikidata' | 'commons', matchMethod: 'osm_tag' | 'wikidata' | 'name_match'): PhotoCandidate {
  return { kind: 'licensed', source, matchMethod, url: f.url, mapillaryId: null, pageUrl: f.pageUrl, license: f.license, credit: f.credit };
}

/** A Commons file title from an OSM `image` URL, or null when the URL isn't a Commons file. */
function commonsTitleFromUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.host === 'commons.wikimedia.org') {
    const m = /\/wiki\/(File:.+)$/.exec(u.pathname);
    return m ? fileTitle(m[1]!) : null;
  }
  if (u.host === 'upload.wikimedia.org') {
    // /wikipedia/commons/a/ab/Name.jpg or /wikipedia/commons/thumb/a/ab/Name.jpg/800px-Name.jpg
    const m = /\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(u.pathname);
    return m ? fileTitle(m[1]!) : null;
  }
  return null;
}

export async function linkedPhotos(
  place: EnrichPlace,
  http: PoliteFetcher,
): Promise<{ photos: PhotoCandidate[]; wikidata: { enwikiTitle: string | null } | null }> {
  const tags = place.osmTags ?? {};
  const osmTitles: string[] = [];
  const commonsTag = tags.wikimedia_commons?.trim();
  if (commonsTag && /^File:/i.test(commonsTag)) osmTitles.push(fileTitle(commonsTag));
  const fromImage = tags.image ? commonsTitleFromUrl(tags.image.trim()) : null;
  if (fromImage) osmTitles.push(fromImage);

  let wikidata: { enwikiTitle: string | null } | null = null;
  let p18: string | null = null;
  const qid = tags.wikidata?.trim();
  if (qid && /^Q\d+$/.test(qid)) {
    const res = await http.getJson<{ entities?: Record<string, {
      claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> };
      sitelinks?: { enwiki?: { title?: string } };
    }> }>(apiUrl(WIKIDATA_API, { action: 'wbgetentities', ids: qid, props: 'claims|sitelinks', sitefilter: 'enwiki' }));
    const entity = res.entities?.[qid];
    wikidata = { enwikiTitle: entity?.sitelinks?.enwiki?.title ?? null };
    const v = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (typeof v === 'string' && v.trim()) p18 = fileTitle(v);
  }

  const all = [...osmTitles, ...(p18 ? [p18] : [])];
  if (all.length === 0) return { photos: [], wikidata };
  const files = await commonsFiles(all, http);
  const photos: PhotoCandidate[] = [];
  for (const t of osmTitles) { const f = files.get(t); if (f) photos.push(toCandidate(f, 'osm', 'osm_tag')); }
  if (p18) { const f = files.get(p18); if (f) photos.push(toCandidate(f, 'wikidata', 'wikidata')); }
  return { photos, wikidata };
}

export async function geosearchPhotos(
  place: EnrichPlace, http: PoliteFetcher, extraGeneric: ReadonlySet<string> = new Set(),
): Promise<PhotoCandidate[]> {
  if (!isDistinctiveName(place.name, extraGeneric)) return [];
  const res = await http.getJson<{ query?: { geosearch?: Array<{ title: string }> } }>(apiUrl(COMMONS_API, {
    action: 'query', list: 'geosearch', gscoord: `${place.lat}|${place.lng}`, gsradius: String(GEOSEARCH_RADIUS_M),
    gsnamespace: '6', gslimit: '50',
  }));
  const titles = (res.query?.geosearch ?? []).map((g) => g.title);
  if (titles.length === 0) return [];
  const files = await commonsFiles(titles, http);
  const photos: PhotoCandidate[] = [];
  for (const [title, f] of files) {
    if (nameMatches(title, place.name, extraGeneric) || f.categories.some((c) => nameMatches(c, place.name, extraGeneric))) {
      photos.push(toCandidate(f, 'commons', 'name_match'));
    }
  }
  return photos;
}

export async function wikipediaExtract(title: string, http: PoliteFetcher): Promise<{ text: string; url: string } | null> {
  const res = await http.getJson<{ query?: { pages?: Array<{ title?: string; extract?: string; missing?: boolean }> } }>(
    apiUrl(WIKIPEDIA_API, { action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', redirects: '1', titles: title }),
  );
  const page = res.query?.pages?.[0];
  const text = page?.extract?.trim();
  if (!page || page.missing || !text) return null;
  return { text, url: `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title ?? title).replace(/ /g, '_'))}` };
}
