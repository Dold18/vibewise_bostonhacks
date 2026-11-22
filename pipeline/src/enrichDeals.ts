import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { connect } from './db.ts';
import { validateCurated, type CuratedRow } from './deals/curated.ts';
import {
  fetchDealPlaces, fetchHiddenDealKeys, fetchRestaurantIdsWithVisibleDeals,
  markDealsChecked, replaceCuratedDeals, replaceDeals, type DealPlace,
} from './deals/db.ts';
import { osmHappyHourDeal } from './deals/osmHappyHours.ts';
import { matchKey, websiteDecision, withoutHidden } from './deals/plan.ts';
import type { DealRow, DealSource } from './deals/types.ts';
import { scanWebsite } from './deals/website.ts';
import { createPoliteFetcher } from './media/http.ts';
import { loadCampuses, loadDemoIds, loadStops, tierOf } from './media/priority.ts';

const CACHE_DIR = path.resolve(import.meta.dirname, '..', '.cache');
const DEMO_FILE = path.resolve(import.meta.dirname, '..', 'demo-places.txt');
const CURATED_FILE = path.resolve(import.meta.dirname, '..', 'deals.curated.json');
const RESCAN_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCES: DealSource[] = ['curated', 'osm', 'website'];

export interface DealsArgs { dryRun: boolean; refresh: boolean; limit: number | null; concurrency: number; only: DealSource | null }

interface DryRow { placeId: string; name: string; source: DealSource; outcome: string; deals: DealRow[] }

function positiveInt(name: string, v: string | undefined, fallback: number | null): number | null {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid --${name} '${v}' (expected a positive integer)`);
  return n;
}

export function parseDealsArgs(argv: string[]): DealsArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      limit: { type: 'string' },
      concurrency: { type: 'string' },
      only: { type: 'string' },
    },
    strict: true,
  });
  if (values.only !== undefined && !SOURCES.includes(values.only as DealSource)) {
    throw new Error(`invalid --only '${values.only}' (expected curated, osm or website)`);
  }
  return {
    dryRun: values['dry-run'],
    refresh: values.refresh,
    limit: positiveInt('limit', values.limit, null),
    concurrency: positiveInt('concurrency', values.concurrency, 4)!,
    only: (values.only as DealSource | undefined) ?? null,
  };
}

/** A place with a website is scanned when forced, never checked, or last checked over 7 days ago. */
export function needsWebsiteScan(place: DealPlace, now: Date, refresh: boolean): boolean {
  if (!place.website) return false;
  if (refresh || place.dealsCheckedAt === null) return true;
  return now.getTime() - new Date(place.dealsCheckedAt).getTime() > RESCAN_MS;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
}

async function main(): Promise<void> {
  const args = parseDealsArgs(process.argv.slice(2));
  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const now = new Date();
  const checkedAt = now.toISOString();
  const places = await fetchDealPlaces(client);
  const byId = new Map(places.map((p) => [p.id, p]));
  const hidden = await fetchHiddenDealKeys(client);
  const hiddenFor = (id: number, source: DealSource) => hidden.get(`${id}:${source}`) ?? new Set<string>();
  const dry: DryRow[] = [];
  const run = (source: DealSource) => args.only === null || args.only === source;
  console.log(`${places.length} places${args.dryRun ? ' (dry run: no database writes)' : ''}`);

  if (run('curated')) {
    let rows: CuratedRow[] = [];
    let errors: string[] = [];
    let unreadable = false;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(CURATED_FILE, 'utf8'));
      ({ rows, errors } = validateCurated(raw, new Map(places.map((p) => [p.placeId, p.id]))));
    } catch (err) {
      unreadable = true;
      errors = [`cannot read ${CURATED_FILE}: ${message(err)}`];
    }
    for (const e of errors) console.log(`  curated: ${e}`);
    if (unreadable) {
      console.log(`curated: 0 rows, ${errors.length} errors (stored rows left alone)`);
    } else {
      // Hidden rows stay hidden: a row matching a hidden one is not re-inserted.
      const kept = rows.filter((r) => !hiddenFor(r.restaurantId, 'curated').has(matchKey(r)));
      if (args.dryRun) {
        for (const r of kept) {
          const p = byId.get(r.restaurantId)!;
          dry.push({ placeId: p.placeId, name: p.name, source: 'curated', outcome: 'ok', deals: [r] });
        }
      } else {
        await replaceCuratedDeals(client, kept);
      }
      console.log(`curated: ${kept.length} rows, ${errors.length} errors`);
    }
  }

  if (run('osm')) {
    const withRows = await fetchRestaurantIdsWithVisibleDeals(client, 'osm');
    const candidates = places.filter((p) => withRows.has(p.id) || (p.osmTags?.happy_hours ?? '').trim() !== '');
    let withRow = 0, failed = 0;
    for (const p of candidates) {
      const tag = (p.osmTags?.happy_hours ?? '').trim();
      // No tag, or no last_seen_at to date it by: clear the visible rows and add none.
      const rows = tag !== '' && p.lastSeenAt !== null
        ? withoutHidden([osmHappyHourDeal(tag, p.lastSeenAt)], hiddenFor(p.id, 'osm'))
        : [];
      if (args.dryRun) {
        dry.push({ placeId: p.placeId, name: p.name, source: 'osm', outcome: rows.length > 0 ? 'ok' : 'cleared', deals: rows });
      } else {
        try {
          await replaceDeals(client, p.id, 'osm', rows);
        } catch (err) {
          failed++;
          console.log(`  osm ${p.placeId}: ${message(err)}`);
          continue;
        }
      }
      if (rows.length > 0) withRow++;
    }
    console.log(`osm: ${candidates.length} places (${withRow} with a row${failed > 0 ? `, ${failed} failed` : ''})`);
  }

  if (run('website')) {
    const [demo, stops, campuses] = await Promise.all([loadDemoIds(DEMO_FILE), loadStops(), loadCampuses()]);
    const due = places.filter((p) => needsWebsiteScan(p, now, args.refresh))
      .map((p) => ({ p, tier: tierOf(p, { demo, stops, campuses }) }))
      .sort((a, b) => a.tier - b.tier || a.p.id - b.p.id);
    const queue = args.limit === null ? due : due.slice(0, args.limit);
    const http = createPoliteFetcher({ minIntervalMs: 1000 });
    const counts = { ok: 0, transient: 0, permanent: 0, failed: 0 };
    let done = 0;
    let next = 0;
    async function worker(): Promise<void> {
      while (next < queue.length) {
        const { p } = queue[next++]!;
        try {
          const scan = await scanWebsite(p, http, checkedAt);
          counts[scan.outcome]++;
          const decision = websiteDecision(scan, hiddenFor(p.id, 'website'));
          if (args.dryRun) {
            dry.push({ placeId: p.placeId, name: p.name, source: 'website', outcome: scan.outcome, deals: decision.rows ?? [] });
          } else if (decision.rows !== null) {
            await replaceDeals(client, p.id, 'website', decision.rows);
            if (decision.markChecked) await markDealsChecked(client, p.id, checkedAt);
          }
        } catch (err) {
          counts.failed++;
          console.log(`  website ${p.placeId}: ${message(err)}`);
        }
        if (++done % 25 === 0) console.log(`  ${done}/${queue.length} places`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(args.concurrency, Math.max(queue.length, 1)) }, worker));
    console.log(`website: ${queue.length} scanned, ok ${counts.ok}, transient ${counts.transient}, permanent ${counts.permanent}, errors ${counts.failed}`);
  }

  if (args.dryRun) {
    const file = path.join(CACHE_DIR, 'deals-dry-run.json');
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(dry, null, 2));
    console.log(`Dry run written to ${file}`);
  }
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(message(err));
    process.exit(1);
  });
}
