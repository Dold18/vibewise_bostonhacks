import path from 'node:path';
import { parseArgs } from 'node:util';
import { connect } from './db.ts';
import {
  deletePhotoRow, fetchPhotosToStore, recordStored, recordStoreError, storedBytesTotal, uploadCopy, type PhotoToStore,
} from './media/db.ts';
import { parseTypeOption, type PlaceType } from './placeTypes.ts';
import { createPoliteFetcher, type BytesResult } from './media/http.ts';
import { processImage, storagePathFor } from './media/photoStore.ts';

const MB = 1_000_000;

export interface PhotoArgs { type: PlaceType; dryRun: boolean; limit: number | null; concurrency: number; maxMb: number }

export interface StoreContext {
  download: (url: string) => Promise<BytesResult>;
  upload: (path: string, webp: Uint8Array) => Promise<void>;
  recordStored: (id: number, path: string, bytes: number, at: string) => Promise<void>;
  recordError: (id: number, error: string) => Promise<void>;
  deleteRow: (id: number) => Promise<void>;
  dryRun: boolean;
  now: () => string;
}

export type StoreOutcome =
  | { kind: 'stored'; bytes: number }
  | { kind: 'rejected'; reason: 'too_small' | 'not_image' }
  | { kind: 'failed'; reason: string };

export interface PoolResult { outcomes: StoreOutcome[]; stoppedForBudget: boolean }

function positiveInt(name: string, v: string | undefined, fallback: number | null): number | null {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid --${name} '${v}' (expected a positive integer)`);
  return n;
}

export function parsePhotoArgs(argv: string[]): PhotoArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      type: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      limit: { type: 'string' },
      concurrency: { type: 'string' },
      'max-mb': { type: 'string' },
    },
    strict: true,
  });
  return {
    type: parseTypeOption(values.type),
    dryRun: values['dry-run'],
    limit: positiveInt('limit', values.limit, null),
    concurrency: positiveInt('concurrency', values.concurrency, 8)!,
    maxMb: positiveInt('max-mb', values['max-mb'], 800)!,
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function storeOne(photo: PhotoToStore, ctx: StoreContext): Promise<StoreOutcome> {
  const got = await ctx.download(photo.url);
  if (!got.ok) {
    if (!ctx.dryRun) await ctx.recordError(photo.id, `${got.reason}: ${got.detail}`);
    return { kind: 'failed', reason: got.reason };
  }
  const img = await processImage(got.bytes);
  if (!img.ok) {
    // It broke the 400 px rule (or isn't an image) and slipped past the URL check: drop the candidate.
    if (!ctx.dryRun) await ctx.deleteRow(photo.id);
    return { kind: 'rejected', reason: img.reason };
  }
  if (ctx.dryRun) return { kind: 'stored', bytes: img.webp.byteLength };
  const objectPath = storagePathFor(photo.placeRef, photo.url);
  try {
    await ctx.upload(objectPath, img.webp);
  } catch (err) {
    await ctx.recordError(photo.id, `upload: ${message(err)}`);
    return { kind: 'failed', reason: 'upload' };
  }
  await ctx.recordStored(photo.id, objectPath, img.webp.byteLength, ctx.now());
  return { kind: 'stored', bytes: img.webp.byteLength };
}

/** Work through `photos` with `concurrency` workers; no new photo starts once stored bytes reach the budget. */
export async function runPool(
  photos: PhotoToStore[],
  ctx: StoreContext,
  opts: { concurrency: number; budgetBytes: number; usedBytes: number; sink?: StoreOutcome[] },
): Promise<PoolResult> {
  const outcomes: StoreOutcome[] = opts.sink ?? []; // a caller-owned sink lets an interrupt summarize progress
  let used = opts.usedBytes;
  let stoppedForBudget = false;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < photos.length) {
      if (used >= opts.budgetBytes) { stoppedForBudget = true; return; }
      const photo = photos[next++]!;
      let outcome: StoreOutcome;
      try {
        outcome = await storeOne(photo, ctx);
      } catch (err) {
        outcome = { kind: 'failed', reason: 'error' };
        console.error(`photo ${photo.id}: ${message(err)}`);
      }
      if (outcome.kind === 'stored') used += outcome.bytes;
      outcomes.push(outcome);
      if (outcomes.length % 100 === 0) console.log(`  ${outcomes.length}/${photos.length} photos, ${(used / MB).toFixed(1)} MB stored`);
    }
  }
  if (used >= opts.budgetBytes) return { outcomes, stoppedForBudget: true };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, Math.max(photos.length, 1)) }, worker));
  return { outcomes, stoppedForBudget };
}

export function summarizePhotos(r: PoolResult, previouslyStoredBytes: number): string {
  const stored = r.outcomes.filter((o): o is Extract<StoreOutcome, { kind: 'stored' }> => o.kind === 'stored');
  const runBytes = stored.reduce((s, o) => s + o.bytes, 0);
  const count = (kind: 'rejected' | 'failed') => {
    const m = new Map<string, number>();
    for (const o of r.outcomes) if (o.kind === kind) m.set(o.reason, (m.get(o.reason) ?? 0) + 1);
    return m.size === 0 ? 'none' : [...m].map(([k, v]) => `${k} ${v}`).join(', ');
  };
  return [
    `Photos processed: ${r.outcomes.length}`,
    `Stored: ${stored.length} (${(runBytes / MB).toFixed(1)} MB this run, ${((runBytes + previouslyStoredBytes) / MB).toFixed(1)} MB total)`,
    `Rejected: ${count('rejected')}`,
    `Failed: ${count('failed')}`,
    `Stopped for budget: ${r.stoppedForBudget ? 'yes' : 'no'}`,
  ].join('\n');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
}

async function main(): Promise<void> {
  const args = parsePhotoArgs(process.argv.slice(2));
  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const http = createPoliteFetcher({ minIntervalMs: 200 });
  const usedBytes = await storedBytesTotal(client);
  const photos = await fetchPhotosToStore(client, { limit: args.limit, type: args.type });
  console.log(`${photos.length} photos to store; ${(usedBytes / MB).toFixed(1)} MB already stored; budget ${args.maxMb} MB${args.dryRun ? ' (dry run)' : ''}`);

  const ctx: StoreContext = {
    download: (url) => http.getBytes(url),
    upload: (p, webp) => uploadCopy(client, p, webp),
    recordStored: (id, p, bytes, at) => recordStored(client, id, p, bytes, at),
    recordError: (id, e) => recordStoreError(client, id, e),
    deleteRow: (id) => deletePhotoRow(client, id),
    dryRun: args.dryRun,
    now: () => new Date().toISOString(),
  };
  const partial: PoolResult = { outcomes: [], stoppedForBudget: false };
  process.on('SIGINT', () => {
    console.log(`\nInterrupted.\n${summarizePhotos(partial, usedBytes)}`);
    process.exit(130);
  });
  const r = await runPool(photos, ctx, {
    concurrency: args.concurrency, budgetBytes: args.maxMb * MB, usedBytes, sink: partial.outcomes,
  });
  console.log(summarizePhotos(r, usedBytes));
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(message(err));
    process.exit(1);
  });
}
