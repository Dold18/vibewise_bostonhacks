/**
 * `npm run enrich:vibe`: for a random sample of restaurants with no description/embedding yet, ask
 * Gemini for a combined facts + vibe `description` and a facts `profile`, embed the description with
 * MiniLM, and write description, embedding and profile (no other column).
 * Design: docs/EMBEDDING_PIPELINE.md §4. Default sample is 300; the full catalog is a later step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import {
  enrichmentCounts, fetchInputs, fetchPhotoUrls, fetchRestaurants, fetchUnenrichedIds,
  isStillUnenriched, writeEnrichment,
} from './dbVibe.ts';
import { connect } from './db.ts';
import { USER_AGENT } from './config.ts';
import { createEmbedder, type Embedder } from './embed.ts';
import { DEFAULT_GEMINI_MODEL, GeminiQuotaError, GeminiRequestError } from './gemini.ts';
import { createVibeGenerator, type VibeImage } from './geminiVibe.ts';
import {
  buildBundle, parseVibeResponse, sample, seededRandom,
  type VibeInputRow, type VibeProfile, type VibeRestaurant,
} from './vibe.ts';

export interface VibeArgs { dryRun: boolean; limit: number; rpm: number; chunk: number; seed: number | null; photos: boolean; idsFile: string | null }

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid --${name} '${raw}' (expected a positive whole number)`);
  return n;
}

export function parseVibeArgs(argv: string[]): VibeArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      'no-photos': { type: 'boolean', default: false },
      limit: { type: 'string' }, rpm: { type: 'string' }, chunk: { type: 'string' }, seed: { type: 'string' },
      'ids-file': { type: 'string' },
    },
    strict: true,
  });
  return {
    dryRun: values['dry-run'],
    photos: !values['no-photos'],
    limit: positiveInt('limit', values.limit, 300),
    rpm: positiveInt('rpm', values.rpm, 60),
    chunk: positiveInt('chunk', values.chunk, 25),
    seed: values.seed === undefined ? null : positiveInt('seed', values.seed, 0),
    idsFile: values['ids-file'] ?? null,
  };
}

const PHOTO_TIMEOUT_MS = 15_000;
const PHOTO_MAX_BYTES = 8_000_000;
const PHOTO_MAX_SIDE = 768;

/** Download one photo and shrink it for the model. Returns null (with a reason) if it can't be used. Never stored. */
export async function fetchImage(url: string): Promise<{ image: VibeImage | null; reason?: string }> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    if (!res.ok) return { image: null, reason: `http ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)/i.test(type)) return { image: null, reason: `type ${type || 'unknown'}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > PHOTO_MAX_BYTES) return { image: null, reason: 'too large' };
    const jpeg = await sharp(buf).rotate().resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer();
    return { image: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } };
  } catch (err) {
    return { image: null, reason: (err as Error).name === 'TimeoutError' ? 'timeout' : 'unreadable' };
  }
}

export interface Failure { id: number; name: string; reason: string }
export interface VibeSummary {
  selected: number;
  succeeded: number;
  skippedAlreadyDone: number;
  failed: Failure[];
  withPhoto: number;
  photoFailures: Record<string, number>;
  withDescriptive: number;
  factsOnly: number;
  /** Rows that needed more than one attempt before the answer passed (or the row failed). */
  retriedRows: number;
  /** Total rejected answers by reason: 'sensory' = unsupported sensory claim (code guard), 'other' = malformed, too short/long, empty. */
  rejections: { sensory: number; photo: number; other: number };
  samples: Array<{ id: number; name: string; rich: boolean; photo: boolean; description: string; profile: VibeProfile }>;
  stoppedEarly: string | null;
}

export interface VibeDeps {
  rows: VibeRestaurant[];
  inputs: Map<number, VibeInputRow[]>;
  photoUrls: Map<number, string>;
  isStillUnenriched: (id: number) => Promise<boolean>;
  fetchImage: (url: string) => Promise<{ image: VibeImage | null; reason?: string }>;
  generate: (prompt: string, image?: VibeImage) => Promise<string>;
  embed: Embedder;
  /** null in a dry run. */
  write: ((id: number, v: { description: string; embedding: number[]; profile: VibeProfile }) => Promise<boolean>) | null;
  chunk: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Delays between the 3 attempts for a malformed or empty answer. */
  retryDelaysMs?: number[];
  /** Stop the run after this many rows in a row fail on quota/overload (the key is probably exhausted). */
  maxConsecutiveQuota?: number;
}

export async function runVibeEnrichment(d: VibeDeps): Promise<VibeSummary> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = d.retryDelaysMs ?? [2_000, 6_000];
  const maxQuota = d.maxConsecutiveQuota ?? 3;
  const s: VibeSummary = {
    selected: d.rows.length, succeeded: 0, skippedAlreadyDone: 0, failed: [], withPhoto: 0, photoFailures: {},
    withDescriptive: 0, factsOnly: 0, retriedRows: 0, rejections: { sensory: 0, photo: 0, other: 0 }, samples: [], stoppedEarly: null,
  };
  let quotaStreak = 0;
  const richSamples: VibeSummary['samples'] = [];
  const thinSamples: VibeSummary['samples'] = [];

  for (let i = 0; i < d.rows.length; i++) {
    if (i > 0 && i % d.chunk === 0) {
      d.log?.(`progress ${i}/${d.rows.length}: ${s.succeeded} ok, ${s.failed.length} failed, ${s.skippedAlreadyDone} skipped (last id ${d.rows[i - 1]!.id})`);
    }
    const row = d.rows[i]!;
    // Never process a row that was enriched since selection (re-run or partial-failure resume).
    if (!(await d.isStillUnenriched(row.id))) { s.skippedAlreadyDone++; continue; }

    let image: VibeImage | undefined;
    const photoUrl = d.photoUrls.get(row.id);
    if (photoUrl) {
      const r = await d.fetchImage(photoUrl);
      if (r.image) image = r.image;
      else s.photoFailures[r.reason ?? 'unknown'] = (s.photoFailures[r.reason ?? 'unknown'] ?? 0) + 1;
    }

    const rowInputs = d.inputs.get(row.id) ?? [];
    let bundle = buildBundle(row, rowInputs, !!image);
    let result: ReturnType<typeof parseVibeResponse> | null = null;
    let lastError = '';
    let sendImage = image;
    let quota = false;
    let attempts = 0;
    for (let attempt = 0; attempt < 3 && result === null; attempt++) {
      attempts++;
      if (attempt > 0) await sleep(delays[attempt - 1] ?? 5_000);
      try {
        bundle = buildBundle(row, rowInputs, !!sendImage);
        // A rejected answer is retried with the reason, so the model can correct it.
        const prompt = attempt > 0 && lastError && !quota ? `${bundle.prompt}\n\nYour previous answer was rejected: ${lastError}. Fix this.` : bundle.prompt;
        const raw = await d.generate(prompt, sendImage);
        result = parseVibeResponse(raw, { hasDescriptive: bundle.hasDescriptive, hasPhoto: !!sendImage, hasPrice: bundle.hasPrice });
        quota = false;
      } catch (err) {
        if (err instanceof GeminiQuotaError) { lastError = `quota/overload: ${err.message}`; quota = true; break; }
        if (err instanceof GeminiRequestError) {
          // A rejected image is the one 4xx worth retrying: send the facts without it.
          if (sendImage) { sendImage = undefined; lastError = `request rejected with image: ${err.message}`; continue; }
          s.stoppedEarly = err.message; // bad key, bad model name: no point continuing
          break;
        }
        lastError = (err as Error).message;
        if (lastError.startsWith('unsupported sensory claim')) s.rejections.sensory++;
        else if (lastError.startsWith('photo narration')) s.rejections.photo++;
        else s.rejections.other++;
      }
    }
    if (attempts > 1) s.retriedRows++;
    if (s.stoppedEarly) break;
    if (result === null) {
      s.failed.push({ id: row.id, name: row.name, reason: lastError || 'no result' });
      quotaStreak = quota ? quotaStreak + 1 : 0;
      if (quotaStreak >= maxQuota) { s.stoppedEarly = `${maxQuota} rows in a row failed on quota/overload`; break; }
      continue;
    }
    quotaStreak = 0;

    try {
      const embedding = await d.embed(result.description);
      if (d.write) {
        const wrote = await d.write(row.id, { description: result.description, embedding, profile: result.profile });
        if (!wrote) { s.skippedAlreadyDone++; continue; }
      }
    } catch (err) {
      s.failed.push({ id: row.id, name: row.name, reason: `embed/write: ${(err as Error).message}` });
      continue;
    }
    s.succeeded++;
    if (sendImage) s.withPhoto++;
    if (bundle.hasDescriptive) s.withDescriptive++;
    if (!bundle.hasDescriptive && !sendImage) s.factsOnly++;
    const entry = { id: row.id, name: row.name, rich: bundle.hasDescriptive || !!sendImage, photo: !!sendImage, description: result.description, profile: result.profile };
    (entry.rich ? richSamples : thinSamples).push(entry);
  }
  // A mix for manual review: up to 5 rich-input and 5 thin-input cases.
  s.samples = [...richSamples.slice(0, 5), ...thinSamples.slice(0, 5)];
  return s;
}

export function formatVibeSummary(s: VibeSummary, dryRun: boolean): string {
  return [
    dryRun ? 'DRY RUN: nothing was written' : null,
    s.stoppedEarly ? `STOPPED EARLY: ${s.stoppedEarly}. Re-run to continue; unreached rows are still unenriched.` : null,
    `Selected: ${s.selected}`,
    `Succeeded: ${s.succeeded}  (with photo ${s.withPhoto}, with website/guide text ${s.withDescriptive}, facts only ${s.factsOnly})`,
    `Skipped (already enriched): ${s.skippedAlreadyDone}`,
    `Failed: ${s.failed.length}`,
    `Rows needing a retry: ${s.retriedRows}  (rejected answers: ${s.rejections.sensory} unsupported-sensory-claim guard, ${s.rejections.photo} photo-narration guard, ${s.rejections.other} other)`,
    Object.keys(s.photoFailures).length ? `Photos unusable: ${JSON.stringify(s.photoFailures)}` : null,
    ...s.failed.map((f) => `  FAILED id ${f.id} (${f.name}): ${f.reason}`),
  ].filter((l): l is string => l !== null).join('\n');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
}

async function main(): Promise<void> {
  const args = parseVibeArgs(process.argv.slice(2));
  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const generate = createVibeGenerator({
    apiKey: requireEnv('GEMINI_API_KEY'), model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, rpm: args.rpm,
  });

  const before = await enrichmentCounts(client);
  console.log(`Before: description ${before.description}, embedding ${before.embedding}, profile ${before.profile} rows populated`);
  const candidates = await fetchUnenrichedIds(client);
  let ids: number[];
  if (args.idsFile) {
    // Re-process exactly these ids, but only those still unenriched: a row that has a description is never touched.
    const wanted = JSON.parse(readFileSync(args.idsFile, 'utf8')) as number[];
    const open = new Set(candidates);
    ids = wanted.filter((id) => open.has(id));
    console.log(`${wanted.length} ids in ${args.idsFile}; ${ids.length} still unenriched (${args.dryRun ? 'dry run' : 'writing'}, ${args.rpm} rpm)`);
  } else {
    ids = sample(candidates, args.limit, args.seed === null ? Math.random : seededRandom(args.seed));
    console.log(`${candidates.length} restaurants are unenriched; sampled ${ids.length} at random (${args.dryRun ? 'dry run' : 'writing'}, ${args.rpm} rpm)`);
  }

  const [rows, inputs, photoUrls] = await Promise.all([
    fetchRestaurants(client, ids), fetchInputs(client, ids), args.photos ? fetchPhotoUrls(client, ids) : Promise.resolve(new Map<number, string>()),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  console.log(`Loaded ${rows.length} rows; ${inputs.size} have crawled text inputs, ${photoUrls.size} have a photo`);

  console.log('Loading MiniLM (first run downloads the model)...');
  const embed = await createEmbedder();

  const summary = await runVibeEnrichment({
    rows, inputs, photoUrls, embed, generate, chunk: args.chunk, log: (l) => console.log(l),
    isStillUnenriched: (id) => isStillUnenriched(client, id),
    fetchImage,
    write: args.dryRun ? null : (id, v) => writeEnrichment(client, id, v),
  });
  console.log(formatVibeSummary(summary, args.dryRun));

  const after = await enrichmentCounts(client);
  console.log(`After:  description ${after.description}, embedding ${after.embedding}, profile ${after.profile} rows populated`);
  console.log(`Delta:  description +${after.description - before.description}, embedding +${after.embedding - before.embedding}, profile +${after.profile - before.profile} (expected +${args.dryRun ? 0 : summary.succeeded} each)`);

  console.log('\nSamples for manual review:');
  for (const x of summary.samples) {
    console.log(`\n[${x.rich ? 'rich input' : 'facts only'}${x.photo ? ' + photo' : ''}] id ${x.id} ${x.name}\n  ${x.description}\n  profile: ${JSON.stringify(x.profile)}`);
  }
  if (summary.stoppedEarly) process.exitCode = 1;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
