import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { connect } from './db.ts';
import { cityLicenseInput, loadCityLicenses, matchCityLicenses, type CityLicense } from './media/cityLicenses.ts';
import { fetchEnrichPlaces, fetchHiddenKeys, fetchStudentReviewText, writePlaceMedia } from './media/db.ts';
import { nameKey } from './normalize.ts';
import { createPoliteFetcher, type FetchResult } from './media/http.ts';
import { facingPhoto } from './media/mapillary.ts';
import { loadCampuses, loadDemoIds, loadStops, tierOf, type Tier } from './media/priority.ts';
import { rankPhotos } from './media/rank.ts';
import type { EnrichPlace, PhotoCandidate, PhotoSource, VibeInput, VibeSource } from './media/types.ts';
import { scrapeWebsite } from './media/website.ts';
import { geosearchPhotos, linkedPhotos, wikipediaExtract } from './media/wikimedia.ts';
import { loadListings, matchListing, type Listing } from './media/wikivoyage.ts';

const CACHE_DIR = path.resolve(import.meta.dirname, '..', '.cache');
const DEMO_FILE = path.resolve(import.meta.dirname, '..', 'demo-places.txt');
const OSM_TAGS_LEFT_OUT = new Set(['name', 'amenity', 'wikidata', 'wikimedia_commons', 'image']);
const PHOTO_SOURCES: PhotoSource[] = ['osm', 'wikidata', 'website', 'commons', 'mapillary'];
const INPUT_SOURCES: VibeSource[] = ['website', 'wiki', 'osm_tags', 'city_licenses', 'student_reviews'];

export interface MediaArgs { dryRun: boolean; refresh: boolean; limit: number | null; concurrency: number; tiers: Tier[] }

export interface EnrichContext {
  website: (p: EnrichPlace) => Promise<{ photos: PhotoCandidate[]; input: VibeInput | null; failure: FetchResult | null }>;
  linked: (p: EnrichPlace) => Promise<{ photos: PhotoCandidate[]; wikidata: { enwikiTitle: string | null } | null }>;
  geosearch: (p: EnrichPlace) => Promise<PhotoCandidate[]>;
  wikipedia: (title: string) => Promise<{ text: string; url: string } | null>;
  listings: Listing[];
  licenses: CityLicense[];
  mapillary: ((p: EnrichPlace) => Promise<PhotoCandidate | null>) | null;
  /** Keys of hidden photos (rank.ts photoKey). A failure here fails the place: unfiltered photos are never written. */
  hiddenKeys: (restaurantId: number) => Promise<Set<string>>;
  studentReviews: (restaurantId: number) => Promise<string[]>;
  /** How many catalog places share each nameKey; chains get no name-only Wikivoyage match. */
  nameCounts: Map<string, number>;
}

export interface PlaceResult {
  photos: Array<PhotoCandidate & { rank: number }>;
  inputs: VibeInput[];
  websiteFailure: string | null;
  errors: string[];
  /** Sources whose producer failed transiently: their stored inputs are kept, not cleared. */
  keepSources: VibeSource[];
}

const TRANSIENT_WEBSITE_FAILURES = new Set(['timeout', 'network']);

function positiveInt(name: string, v: string | undefined, fallback: number | null): number | null {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid --${name} '${v}' (expected a positive integer)`);
  return n;
}

export function parseMediaArgs(argv: string[]): MediaArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      limit: { type: 'string' },
      concurrency: { type: 'string' },
      tiers: { type: 'string', default: '1,2,3' },
    },
    strict: true,
  });
  const tiers = values.tiers.split(',').map((t) => t.trim());
  if (tiers.length === 0 || tiers.some((t) => t !== '1' && t !== '2' && t !== '3')) {
    throw new Error(`invalid --tiers '${values.tiers}' (expected a list of 1, 2, 3)`);
  }
  return {
    dryRun: values['dry-run'],
    refresh: values.refresh,
    limit: positiveInt('limit', values.limit, null),
    concurrency: positiveInt('concurrency', values.concurrency, 4)!,
    tiers: [...new Set(tiers.map(Number))].sort() as Tier[],
  };
}

function osmUrl(placeId: string): string | null {
  const m = /^osm:(node|way|relation)\/(\d+)$/.exec(placeId);
  return m ? `https://www.openstreetmap.org/${m[1]}/${m[2]}` : null;
}

export async function enrichPlace(place: EnrichPlace, ctx: EnrichContext): Promise<PlaceResult> {
  // Fetched first and not caught: without it, hidden photos could be re-added.
  const hidden = await ctx.hiddenKeys(place.id);
  const errors: string[] = [];
  const keep = new Set<VibeSource>();
  async function attempt<T>(name: string, fn: () => Promise<T>, fallback: T, feeds?: VibeSource): Promise<T> {
    try { return await fn(); } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      if (feeds) keep.add(feeds);
      return fallback;
    }
  }

  const candidates: PhotoCandidate[] = [];
  const inputs: VibeInput[] = [];

  const site = await attempt('website', () => ctx.website(place), { photos: [], input: null, failure: null }, 'website');
  candidates.push(...site.photos);
  if (site.input) inputs.push(site.input);
  const websiteFailure = site.failure && !site.failure.ok ? site.failure.reason : null;
  if (websiteFailure && TRANSIENT_WEBSITE_FAILURES.has(websiteFailure)) keep.add('website');

  const linked = await attempt('linked', () => ctx.linked(place), { photos: [], wikidata: null }, 'wiki');
  candidates.push(...linked.photos);
  candidates.push(...await attempt('geosearch', () => ctx.geosearch(place), [] as PhotoCandidate[]));
  if (ctx.mapillary) {
    const mp = await attempt('mapillary', () => ctx.mapillary!(place), null);
    if (mp) candidates.push(mp);
  }

  const title = linked.wikidata?.enwikiTitle;
  const wp = title ? await attempt('wikipedia', () => ctx.wikipedia(title), null, 'wiki') : null;
  const sameNamePlaces = ctx.nameCounts.get(nameKey(place.name)) ?? 1;
  const wv = await attempt('wikivoyage', async () => matchListing(place, ctx.listings, { sameNamePlaces }), null, 'wiki');
  const wikiParts = [wp ? `Wikipedia: ${wp.text}` : null, wv?.content ? `Wikivoyage: ${wv.content}` : null].filter((s): s is string => s !== null);
  if (wikiParts.length > 0) {
    const wvUrl = wv ? `https://en.wikivoyage.org/wiki/${encodeURIComponent(wv.pageTitle.replace(/ /g, '_'))}` : null;
    inputs.push({ source: 'wiki', content: wikiParts.join('\n\n'), sourceUrl: wp?.url ?? wvUrl });
  }

  const tags = Object.entries(place.osmTags ?? {}).filter(([k]) => !OSM_TAGS_LEFT_OUT.has(k));
  if (tags.length > 0) inputs.push({ source: 'osm_tags', content: tags.map(([k, v]) => `${k}=${v}`).join('; '), sourceUrl: osmUrl(place.placeId) });

  const city = await attempt('city_licenses', async () => cityLicenseInput(matchCityLicenses(place, ctx.licenses)), null, 'city_licenses');
  if (city) inputs.push(city);

  const reviews = await attempt('student_reviews', () => ctx.studentReviews(place.id), [] as string[], 'student_reviews');
  if (reviews.length > 0) inputs.push({ source: 'student_reviews', content: reviews.join('\n---\n'), sourceUrl: null });

  const produced = new Set(inputs.map((i) => i.source));
  const keepSources = [...keep].filter((s) => !produced.has(s));
  return { photos: rankPhotos(candidates, hidden), inputs, websiteFailure, errors, keepSources };
}

export function summarizeMedia(results: PlaceResult[], skippedTiers: number): string {
  const photoCounts = Object.fromEntries(PHOTO_SOURCES.map((s) => [s, 0])) as Record<string, number>;
  const inputCounts = Object.fromEntries(INPUT_SOURCES.map((s) => [s, 0])) as Record<string, number>;
  const failures = new Map<string, number>();
  for (const r of results) {
    for (const p of r.photos) photoCounts[p.source] = (photoCounts[p.source] ?? 0) + 1;
    for (const i of r.inputs) inputCounts[i.source] = (inputCounts[i.source] ?? 0) + 1;
    if (r.websiteFailure) failures.set(r.websiteFailure, (failures.get(r.websiteFailure) ?? 0) + 1);
  }
  const list = (counts: Record<string, number>, keys: string[]) => keys.map((k) => `${k} ${counts[k] ?? 0}`).join(', ');
  return [
    `Places processed: ${results.length}`,
    `Places skipped (tier filter): ${skippedTiers}`,
    `Places with at least one photo: ${results.filter((r) => r.photos.length > 0).length}`,
    `Photos by source: ${list(photoCounts, PHOTO_SOURCES)}`,
    `Vibe inputs by source: ${list(inputCounts, INPUT_SOURCES)}`,
    `Website failures: ${failures.size === 0 ? 'none' : [...failures].map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `Places with errors: ${results.filter((r) => r.errors.length > 0).length}`,
  ].join('\n');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
}

async function main(): Promise<void> {
  const args = parseMediaArgs(process.argv.slice(2));
  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const mapillaryToken = process.env.MAPILLARY_TOKEN?.trim() || null;
  if (!mapillaryToken) console.log('MAPILLARY_TOKEN not set: skipping Mapillary street photos');

  const web = createPoliteFetcher({ minIntervalMs: 1000 });
  const api = createPoliteFetcher({ minIntervalMs: 200 });
  const [listings, licenses, demo, stops, campuses] = await Promise.all([
    loadListings(api, { cacheDir: CACHE_DIR, refresh: args.refresh }),
    loadCityLicenses(api, { cacheDir: CACHE_DIR, refresh: args.refresh }),
    loadDemoIds(DEMO_FILE), loadStops(), loadCampuses(),
  ]);
  console.log(`Loaded ${listings.length} Wikivoyage listings, ${licenses.length} city licenses, ${demo.size} demo places`);

  // Name counts come from the whole catalog, not just unchecked rows, so chains are recognized on resumed runs too.
  const catalog = await fetchEnrichPlaces(client, { refresh: true });
  const all = args.refresh ? catalog : await fetchEnrichPlaces(client, { refresh: false });
  const nameCounts = new Map<string, number>();
  for (const p of catalog) nameCounts.set(nameKey(p.name), (nameCounts.get(nameKey(p.name)) ?? 0) + 1);
  const tiered = all.map((p) => ({ p, tier: tierOf(p, { demo, stops, campuses }) }));
  const wanted = tiered.filter((t) => args.tiers.includes(t.tier)).sort((a, b) => a.tier - b.tier || a.p.id - b.p.id);
  const queue = args.limit === null ? wanted : wanted.slice(0, args.limit);
  const skippedTiers = tiered.length - wanted.length;
  console.log(`Processing ${queue.length} of ${all.length} places (tiers ${args.tiers.join(',')}${args.dryRun ? ', dry run' : ''})`);

  const ctx: EnrichContext = {
    website: (p) => scrapeWebsite(p, web),
    linked: (p) => linkedPhotos(p, api),
    geosearch: (p) => geosearchPhotos(p, api),
    wikipedia: (t) => wikipediaExtract(t, api),
    listings, licenses,
    mapillary: mapillaryToken ? (p) => facingPhoto(p, mapillaryToken, api) : null,
    hiddenKeys: (id) => fetchHiddenKeys(client, id),
    studentReviews: (id) => fetchStudentReviewText(client, id),
    nameCounts,
  };

  const results: PlaceResult[] = [];
  const dryRows: unknown[] = [];
  process.on('SIGINT', () => {
    console.log(`\nInterrupted.\n${summarizeMedia(results, skippedTiers)}`);
    process.exit(130);
  });

  let next = 0;
  async function worker(): Promise<void> {
    while (next < queue.length) {
      const { p, tier } = queue[next++]!;
      let r: PlaceResult;
      try {
        r = await enrichPlace(p, ctx);
      } catch (err) {
        // Nothing is written; media_checked_at stays null, so the next run retries this place.
        results.push({ photos: [], inputs: [], websiteFailure: null, keepSources: [], errors: [`place: ${err instanceof Error ? err.message : String(err)}`] });
        continue;
      }
      if (args.dryRun) {
        dryRows.push({ placeId: p.placeId, name: p.name, tier, ...r });
      } else {
        try {
          await writePlaceMedia(client, p.id, r.photos, r.inputs, new Date().toISOString(), r.keepSources);
        } catch (err) {
          r.errors.push(`write: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      results.push(r);
      if (results.length % 25 === 0) console.log(`  ${results.length}/${queue.length} places`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, Math.max(queue.length, 1)) }, worker));

  if (args.dryRun) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, 'media-dry-run.json'), JSON.stringify(dryRows, null, 2));
    console.log(`Dry run written to ${path.join(CACHE_DIR, 'media-dry-run.json')}`);
  }
  console.log(summarizeMedia(results, skippedTiers));
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
