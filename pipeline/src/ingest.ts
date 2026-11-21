import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_FSQ_RELEASE } from './config.ts';
import { applyRekey, connect, fetchExisting, listNotSeen, upsertRows } from './db.ts';
import { loadFsqRows } from './foursquare.ts';
import { assertUniqueKeys, mergePlaces } from './merge.ts';
import { loadOsmElements } from './osm.ts';
import { planRekey } from './rekey.ts';
import { parseFsqRows, parseOverpass } from './sources.ts';
import type { FsqPlace, OsmPlace, RekeyAction, RestaurantRow } from './types.ts';

const CACHE_DIR = path.resolve(import.meta.dirname, '..', '.cache');

export type SourcesChoice = 'osm' | 'fsq' | 'all';
export interface CliArgs { dryRun: boolean; sources: SourcesChoice; refresh: boolean; allowPartial?: true }

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      sources: { type: 'string', default: 'all' },
      refresh: { type: 'boolean', default: false },
      'allow-partial': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const sources = values.sources;
  if (sources !== 'osm' && sources !== 'fsq' && sources !== 'all') {
    throw new Error(`invalid --sources '${sources}' (expected osm, fsq or all)`);
  }
  return {
    dryRun: values['dry-run'], sources, refresh: values.refresh,
    ...(values['allow-partial'] ? { allowPartial: true as const } : {}),
  };
}

/**
 * A non-dry run with only one source loaded would clear links and null out merged fields,
 * so it must be opted into with --allow-partial. Returns a warning to print when the opt-in is used.
 */
export function assertWritable(input: { osmLoaded: boolean; fsqLoaded: boolean; allowPartial: boolean }): string | null {
  if (input.osmLoaded && input.fsqLoaded) return null;
  const missing = !input.osmLoaded && !input.fsqLoaded ? 'OSM and Foursquare' : input.osmLoaded ? 'Foursquare' : 'OSM';
  const effect = !input.osmLoaded
    ? 'existing OSM rows will not be refreshed and existing OSM-Foursquare links may be cleared, creating duplicate pins'
    : 'every OSM-Foursquare link will be cleared and Foursquare-filled address/website/phone overwritten with null';
  if (!input.allowPartial) {
    throw new Error(`refusing to write: ${missing} data not loaded (${effect}); pass --allow-partial to write anyway`);
  }
  return `WARNING: --allow-partial with ${missing} not loaded: ${effect}`;
}

export interface SummaryInput {
  osm: number; fsq: number; matches: number; dropped: number; staleFsqDropped: number; unparseableDates?: number;
  existingKeys: Set<string>; rows: RestaurantRow[]; actions: RekeyAction[]; notSeen: number | null;
}

export function summarize(input: SummaryInput): string {
  const collapsed = input.actions.flatMap((a) => (a.kind === 'collapse' ? [a.fsqId] : []));
  const promoted = input.actions.filter((a) => a.kind === 'promote').length;
  // A promoted row already exists (re-keyed in place), so it is an update even though its new key is unseen.
  const inserted = Math.max(
    0,
    input.rows.filter((r) => !input.existingKeys.has(`${r.source}:${r.source_id}`)).length - promoted,
  );
  const collapsedText = collapsed.length > 0 ? `${collapsed.length} (lost: ${collapsed.join(', ')})` : '0';
  return [
    `OSM places: ${input.osm}`,
    `Foursquare places: ${input.fsq}`,
    `Matched pairs: ${input.matches}`,
    `Duplicates dropped: ${input.dropped}`,
    `Stale Foursquare dropped: ${input.staleFsqDropped}`,
    `Foursquare unparseable refresh dates: ${input.unparseableDates ?? 0}`,
    `Inserted: ${inserted}`,
    `Updated: ${input.rows.length - inserted}`,
    `Promoted: ${promoted}`,
    `Collapsed: ${collapsedText}`,
    `Not seen this run: ${input.notSeen === null ? 'n/a (dry run)' : input.notSeen}`,
    `Rows missing cuisine: ${input.rows.filter((r) => r.source_cuisines.length === 0).length}`,
    `Rows missing address: ${input.rows.filter((r) => r.address === null).length}`,
    `Rows missing website: ${input.rows.filter((r) => r.website === null).length}`,
  ].join('\n');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const runStart = new Date().toISOString();
  const today = runStart.slice(0, 10);

  let osm: OsmPlace[] = [];
  let fsq: FsqPlace[] = [];
  let osmLoaded = false;
  let fsqLoaded = false;
  if (args.sources !== 'fsq') {
    const { elements, fromCache } = await loadOsmElements({ refresh: args.refresh, cacheDir: CACHE_DIR, today });
    if (fromCache) console.log('OSM: using cached Overpass response');
    osm = parseOverpass(elements);
    osmLoaded = elements.length > 0;
  }
  if (args.sources !== 'osm') {
    const { rows, skipped } = await loadFsqRows({
      hfToken: process.env.HF_TOKEN,
      release: process.env.FSQ_RELEASE || DEFAULT_FSQ_RELEASE,
      refresh: args.refresh,
      cacheDir: CACHE_DIR,
    });
    fsq = parseFsqRows(rows);
    fsqLoaded = !skipped;
  }

  const merged = mergePlaces(osm, fsq, { runStart, today });
  const base = {
    osm: osm.length, fsq: fsq.length, matches: merged.matches.length,
    dropped: merged.dropped.length, staleFsqDropped: merged.staleFsqDropped,
    unparseableDates: merged.unparseableDates,
  };

  if (args.dryRun) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, 'rows.json'), JSON.stringify(merged.rows, null, 2));
    await fs.writeFile(
      path.join(CACHE_DIR, 'matches.json'),
      JSON.stringify({ matches: merged.matches, dropped: merged.dropped }, null, 2),
    );
    console.log(summarize({ ...base, existingKeys: new Set(), rows: merged.rows, actions: [], notSeen: null }));
    return;
  }

  assertUniqueKeys(merged.rows);
  const warning = assertWritable({ osmLoaded, fsqLoaded, allowPartial: args.allowPartial === true });
  if (warning !== null) console.warn(warning);

  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const existing = await fetchExisting(client);
  const actions = planRekey(existing, merged.rows);
  await applyRekey(client, actions);
  await upsertRows(client, merged.rows);
  const notSeenIds = await listNotSeen(client, runStart);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, 'not-seen.json'), JSON.stringify(notSeenIds, null, 2));
  const notSeen = notSeenIds.length;
  const existingKeys = new Set(existing.map((e) => `${e.source}:${e.source_id}`));
  console.log(summarize({ ...base, existingKeys, rows: merged.rows, actions, notSeen }));
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
