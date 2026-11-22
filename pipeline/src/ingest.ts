import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_FSQ_RELEASE } from './config.ts';
import { findCrossTypeDuplicates, splitTypeConflicts, type TypeConflict } from './crossType.ts';
import {
  applyRekey, connect, deleteRegistryRows, fetchExisting, fetchOtherTypePlaces, fetchRegistry, listNotSeen, registerPlaces,
  upsertRows, type RegistryEntry,
} from './db.ts';
import { loadFsqRows } from './foursquare.ts';
import { assertUniqueKeys, mergePlaces } from './merge.ts';
import { loadOsmElements } from './osm.ts';
import { PLACE_TYPE_CONFIG, parseTypeOption, type PlaceType } from './placeTypes.ts';
import { planRekey } from './rekey.ts';
import { parseFsqRows, parseOverpass } from './sources.ts';
import type { ExistingRow, FsqPlace, OsmPlace, PlaceRow, RekeyAction } from './types.ts';

const CACHE_DIR = path.resolve(import.meta.dirname, '..', '.cache');

export type SourcesChoice = 'osm' | 'fsq' | 'all';
export interface CliArgs { type: PlaceType; dryRun: boolean; sources: SourcesChoice; refresh: boolean; allowPartial?: true }

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      type: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      sources: { type: 'string', default: 'all' },
      refresh: { type: 'boolean', default: false },
      'allow-partial': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const type = parseTypeOption(values.type);
  const sources = values.sources;
  if (sources !== 'osm' && sources !== 'fsq' && sources !== 'all') {
    throw new Error(`invalid --sources '${sources}' (expected osm, fsq or all)`);
  }
  return {
    type, dryRun: values['dry-run'], sources, refresh: values.refresh,
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

/**
 * The registry id of every row: an existing row's id by `source:source_id` (after rekey), else the id
 * registerPlaces just created for its place_id. Throws rather than let a row reach the upsert without one.
 */
export function assignIds(
  rows: PlaceRow[], idByKey: Map<string, number>, newIds: Map<string, number>,
): Array<PlaceRow & { id: number }> {
  return rows.map((row) => {
    const id = idByKey.get(`${row.source}:${row.source_id}`) ?? newIds.get(row.place_id);
    if (id === undefined) throw new Error(`refusing to write: no registry id for ${row.place_id}`);
    return { ...row, id };
  });
}

/**
 * A rekey promote sets the FSQ-only row's place_id to the OSM target's, and the registry copies it (unique place_id).
 * `registry` holds the registry rows of the promote targets of `planRekey(existing, rows)`:
 * - a target registered under another type is a type conflict: its OSM row is dropped from this run and the plan is
 *   redone without it, so the FSQ-only row stays as it is (dropping rows only removes promotes, never adds one);
 * - a target registered as this type is an orphan (planRekey only promotes to a key with no row in this table):
 *   its registry row is to be deleted before the rekey so the promote can take the place_id.
 */
export function resolvePromoteTargets(
  existing: ExistingRow[], rows: PlaceRow[], registry: Map<string, RegistryEntry>, type: PlaceType,
): { rows: PlaceRow[]; actions: RekeyAction[]; conflicts: TypeConflict[]; orphanIds: number[] } {
  const actions = planRekey(existing, rows);
  const conflicts: TypeConflict[] = [];
  const orphanIds: number[] = [];
  for (const a of actions) {
    if (a.kind !== 'promote') continue;
    const entry = registry.get(a.placeId);
    if (entry === undefined) continue;
    if (entry.placeType === type) orphanIds.push(entry.id);
    else conflicts.push({ placeId: a.placeId, registeredAs: entry.placeType });
  }
  if (conflicts.length === 0) return { rows, actions, conflicts, orphanIds };
  const dropped = new Set(conflicts.map((c) => c.placeId));
  const kept = rows.filter((r) => !dropped.has(r.place_id));
  return { rows: kept, actions: planRekey(existing, kept), conflicts, orphanIds };
}

/**
 * New rows (no row in this type's table) whose place_id is already registered as this type are orphans left by a
 * run that stopped between registering and upserting: their registry id is reused. Unregistered ones are to be
 * registered. Rows registered under another type are in neither (splitTypeConflicts has removed them).
 */
export function reuseOrphanIds(
  newRows: PlaceRow[], registry: Map<string, RegistryEntry>, type: PlaceType,
): { reused: Map<string, number>; toRegister: string[] } {
  const reused = new Map<string, number>();
  const toRegister: string[] = [];
  for (const r of newRows) {
    const entry = registry.get(r.place_id);
    if (entry === undefined) toRegister.push(r.place_id);
    else if (entry.placeType === type) reused.set(r.place_id, entry.id);
  }
  return { reused, toRegister };
}

export interface SummaryInput {
  type: PlaceType;
  osm: number; fsq: number; matches: number; dropped: number; staleFsqDropped: number; unparseableDates?: number;
  subVenuesDropped?: number;           // non-food only: Foursquare-only places inside an OSM place's bounds
  existingKeys: Set<string>; rows: PlaceRow[]; actions: RekeyAction[]; notSeen: number | null;
  crossTypeSkipped: number | null; conflictsSkipped: number | null;   // null in a dry run (no database read)
  orphansReused: number | null; orphansCleared: number | null;
}

const orDryRun = (n: number | null): string => (n === null ? 'n/a (dry run)' : String(n));

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
    ...(input.type === 'restaurants' ? [] : [`Foursquare sub-venues dropped: ${input.subVenuesDropped ?? 0}`]),
    `Inserted: ${inserted}`,
    `Updated: ${input.rows.length - inserted}`,
    `Promoted: ${promoted}`,
    `Collapsed: ${collapsedText}`,
    `Cross-type duplicates skipped: ${orDryRun(input.crossTypeSkipped)}`,
    `Type conflicts skipped: ${orDryRun(input.conflictsSkipped)}`,
    `Orphan registry ids reused: ${orDryRun(input.orphansReused)}`,
    `Orphan registry rows cleared: ${orDryRun(input.orphansCleared)}`,
    `Not seen this run: ${orDryRun(input.notSeen)}`,
    ...(input.type === 'restaurants'
      ? [`Rows missing cuisine: ${input.rows.filter((r) => 'source_cuisines' in r && r.source_cuisines.length === 0).length}`]
      : []),
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
  const cfg = PLACE_TYPE_CONFIG[args.type];

  let osm: OsmPlace[] = [];
  let fsq: FsqPlace[] = [];
  let osmLoaded = false;
  let fsqLoaded = false;
  if (args.sources !== 'fsq') {
    const { elements, fromCache } = await loadOsmElements({ refresh: args.refresh, cacheDir: CACHE_DIR, today, cfg });
    if (fromCache) console.log('OSM: using cached Overpass response');
    osm = parseOverpass(elements, cfg);
    osmLoaded = elements.length > 0;
  }
  if (args.sources !== 'osm') {
    const { rows, skipped } = await loadFsqRows({
      hfToken: process.env.HF_TOKEN,
      release: process.env.FSQ_RELEASE || DEFAULT_FSQ_RELEASE,
      refresh: args.refresh,
      cacheDir: CACHE_DIR,
      cfg,
    });
    fsq = parseFsqRows(rows, cfg);
    fsqLoaded = !skipped;
  }

  const merged = mergePlaces(osm, fsq, { runStart, today, cfg });
  const rows = merged.rows;
  const base = {
    type: args.type, osm: osm.length, fsq: fsq.length, matches: merged.matches.length,
    dropped: merged.dropped.length, staleFsqDropped: merged.staleFsqDropped,
    unparseableDates: merged.unparseableDates, subVenuesDropped: merged.subVenuesDropped.length,
  };
  // Food output stays exactly as before: the sub-venue filter never runs for restaurants.
  const subVenueRecord = args.type === 'restaurants' ? {} : { foursquareSubVenues: merged.subVenuesDropped };
  const cacheFile = (name: string) => path.join(CACHE_DIR, `${name}-${args.type}.json`);

  if (args.dryRun) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cacheFile('rows'), JSON.stringify(rows, null, 2));
    await fs.writeFile(cacheFile('matches'), JSON.stringify({ matches: merged.matches, dropped: merged.dropped, ...subVenueRecord }, null, 2));
    console.log(summarize({
      ...base, existingKeys: new Set(), rows, actions: [], notSeen: null, crossTypeSkipped: null, conflictsSkipped: null,
      orphansReused: null, orphansCleared: null,
    }));
    return;
  }

  assertUniqueKeys(rows);
  const warning = assertWritable({ osmLoaded, fsqLoaded, allowPartial: args.allowPartial === true });
  if (warning !== null) console.warn(warning);

  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const table = args.type;
  const existing = await fetchExisting(client, table);
  // Check promote targets against the registry first: a promote onto a registered place_id would hit its unique key.
  const promoteTargets = planRekey(existing, rows).flatMap((a) => (a.kind === 'promote' ? [a.placeId] : []));
  const resolved = resolvePromoteTargets(existing, rows, await fetchRegistry(client, promoteTargets), table);
  const { actions } = resolved;
  await deleteRegistryRows(client, table, resolved.orphanIds);
  await applyRekey(client, table, actions);
  // Re-read after rekey so promoted rows are found under their new key and collapsed ones are gone.
  const idByKey = new Map((await fetchExisting(client, table)).map((e) => [`${e.source}:${e.source_id}`, e.id]));
  const isNew = (r: PlaceRow) => !idByKey.has(`${r.source}:${r.source_id}`);

  // Only new rows are checked: ingest never moves a place that is already in this type's table.
  const cross = findCrossTypeDuplicates(resolved.rows.filter(isNew), await fetchOtherTypePlaces(client, table));
  const registry = await fetchRegistry(client, cross.kept.map((r) => r.place_id));
  const registered = new Map([...registry].map(([placeId, e]) => [placeId, e.placeType]));
  const split = splitTypeConflicts(cross.kept, registered, table);
  const { reused, toRegister } = reuseOrphanIds(split.kept, registry, table);
  const newIds = new Map([...reused, ...await registerPlaces(client, table, toRegister)]);

  const conflicts = [...resolved.conflicts, ...split.conflicts];
  const skipped = new Set([...cross.duplicates.map((d) => d.placeId), ...split.conflicts.map((c) => c.placeId)]);
  const toWrite = assignIds(resolved.rows.filter((r) => !skipped.has(r.place_id)), idByKey, newIds);
  await upsertRows(client, table, toWrite);
  const notSeenIds = await listNotSeen(client, table, runStart);

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile('not-seen'), JSON.stringify(notSeenIds, null, 2));
  await fs.writeFile(
    cacheFile('skipped'),
    JSON.stringify({ crossTypeDuplicates: cross.duplicates, typeConflicts: conflicts, ...subVenueRecord }, null, 2),
  );
  const existingKeys = new Set(existing.map((e) => `${e.source}:${e.source_id}`));
  console.log(summarize({
    ...base, existingKeys, rows: toWrite, actions, notSeen: notSeenIds.length,
    crossTypeSkipped: cross.duplicates.length, conflictsSkipped: conflicts.length,
    orphansReused: reused.size, orphansCleared: resolved.orphanIds.length,
  }));
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
