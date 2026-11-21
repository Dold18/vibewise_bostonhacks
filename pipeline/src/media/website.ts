import { parse, type HTMLElement } from 'node-html-parser';
import type { FetchResult, PoliteFetcher } from './http.ts';
import type { EnrichPlace, PhotoCandidate, VibeInput } from './types.ts';

const MAX_TEXT = 4000;
const MAX_PHOTOS = 5;
const MIN_SIDE_PX = 400;
const MIN_SRCSET_W = 800;
const BAD_IMAGE = /logo|icon|favicon|sprite|placeholder/i;
const ABOUT_LINK = /about|our-story|story|who-we-are/i;
const STRIPPED = ['script', 'style', 'nav', 'footer', 'header', 'noscript', 'template', 'svg'];

export interface PageExtract { text: string; description: string | null; images: string[]; aboutUrl: string | null }

function resolveImage(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.startsWith('data:')) return null;
  let u: URL;
  try { u = new URL(v, base); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const path = u.pathname.toLowerCase();
  if (path.endsWith('.svg') || path.endsWith('.gif') || BAD_IMAGE.test(u.pathname)) return null;
  return u.toString();
}

function jsonLdObjects(root: HTMLElement): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      out.push(o);
      if (Array.isArray(o['@graph'])) visit(o['@graph']);
    }
  };
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(s.rawText)); } catch { /* malformed JSON-LD is ignored */ }
  }
  return out;
}

function ldImageValues(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(ldImageValues);
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return [(v as { url: string }).url];
  return [];
}

function imgQualifies(img: HTMLElement): boolean {
  const w = Number.parseInt(img.getAttribute('width') ?? '', 10);
  const h = Number.parseInt(img.getAttribute('height') ?? '', 10);
  if (w >= MIN_SIDE_PX && h >= MIN_SIDE_PX) return true;
  const srcset = img.getAttribute('srcset') ?? '';
  return [...srcset.matchAll(/(\d+)w\b/g)].some((m) => Number(m[1]) >= MIN_SRCSET_W);
}

function metaContent(root: HTMLElement, selector: string): string | null {
  const v = root.querySelector(selector)?.getAttribute('content')?.trim();
  return v ? v : null;
}

export function extractPage(html: string, pageUrl: string): PageExtract {
  const root = parse(html);
  const ld = jsonLdObjects(root);

  const ldDescription = ld.map((o) => o.description).find((d): d is string => typeof d === 'string' && d.trim() !== '');
  const description = metaContent(root, 'meta[name="description"]')
    ?? metaContent(root, 'meta[property="og:description"]')
    ?? ldDescription?.trim() ?? null;

  const rawImages = [
    metaContent(root, 'meta[property="og:image"]') ?? undefined,
    ...ld.flatMap((o) => ldImageValues(o.image)),
    ...root.querySelectorAll('img').filter(imgQualifies).map((i) => i.getAttribute('src')),
  ];
  const images = [...new Set(rawImages.map((r) => resolveImage(r ?? undefined, pageUrl)).filter((u): u is string => u !== null))];

  const origin = new URL(pageUrl).origin;
  let aboutUrl: string | null = null;
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!ABOUT_LINK.test(href) && !ABOUT_LINK.test(a.text)) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.origin === origin && u.toString() !== pageUrl) { aboutUrl = u.toString(); break; }
    } catch { /* bad href */ }
  }

  for (const tag of STRIPPED) root.querySelectorAll(tag).forEach((el) => el.remove());
  const body = root.querySelector('body') ?? root;
  const text = body.structuredText.replace(/\s+/g, ' ').trim();

  return { text, description, images, aboutUrl };
}

function websiteUrl(raw: string): string | null {
  const v = raw.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Round-robin across pages so the about page's (usually interior) photos aren't crowded out by the home page. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

export async function scrapeWebsite(
  place: EnrichPlace,
  http: PoliteFetcher,
): Promise<{ photos: PhotoCandidate[]; input: VibeInput | null; failure: FetchResult | null }> {
  if (!place.website) return { photos: [], input: null, failure: null };
  const start = websiteUrl(place.website);
  if (!start) return { photos: [], input: null, failure: { ok: false, reason: 'http', detail: `invalid website URL: ${place.website}` } };

  const home = await http.getText(start, { checkRobots: true });
  if (!home.ok) return { photos: [], input: null, failure: home };
  const homePage = extractPage(home.body, home.url);

  const pages: Array<{ url: string; page: PageExtract }> = [{ url: home.url, page: homePage }];
  if (homePage.aboutUrl) {
    const about = await http.getText(homePage.aboutUrl, { checkRobots: true });
    if (about.ok) pages.push({ url: about.url, page: extractPage(about.body, about.url) });
  }

  const bodyText = pages[1]?.page.text || homePage.text;
  const parts = [homePage.description, bodyText].filter((s): s is string => !!s && s.trim() !== '');
  const content = [...new Set(parts)].join('\n\n').slice(0, MAX_TEXT).trim();

  const credit = new URL(home.url).hostname.replace(/^www\./, '');
  const seen = new Set<string>();
  const photos: PhotoCandidate[] = [];
  for (const { url, pageUrl } of interleave(pages.map((p) => p.page.images.map((u) => ({ url: u, pageUrl: p.url }))))) {
    if (seen.has(url) || photos.length >= MAX_PHOTOS) continue;
    seen.add(url);
    photos.push({ kind: 'website', source: 'website', matchMethod: 'website', url, mapillaryId: null, pageUrl, license: null, credit });
  }

  return { photos, input: content ? { source: 'website', content, sourceUrl: start } : null, failure: null };
}
