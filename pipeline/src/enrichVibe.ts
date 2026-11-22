/**
 * `npm run enrich:vibe -- --type <type>`: for rows of one type table with no description/embedding yet,
 * ask Gemini for a combined facts + vibe `description`, embed it with MiniLM, and write description and
 * embedding (no other column). Restaurants also get a facts `profile`; non-food places (museums,
 * entertainment, parks, landmarks) have no profile column and use a place-to-visit prompt instead.
 * Design: docs/EMBEDDING_PIPELINE.md §4. Default is a random sample of 300; `--all` takes every
 * unenriched row of the type in id order.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import {
  enrichmentCounts, fetchInputs, fetchPhotoUrls, fetchPlaces, fetchRestaurants, fetchUnenrichedIds,
  isStillUnenriched, writeEnrichment,
} from './dbVibe.ts';
import { connect } from './db.ts';
import { USER_AGENT } from './config.ts';
import { createEmbedder, type Embedder } from './embed.ts';
import { DEFAULT_GEMINI_MODEL, GeminiQuotaError, GeminiRequestError } from './gemini.ts';
import { createVibeGenerator, type VibeImage } from './geminiVibe.ts';
import { PLACE_TYPE_CONFIG, parseTypeOption, type PlaceType } from './placeTypes.ts';
import {
  PLACE_RESPONSE_SCHEMA, PLACE_SYSTEM_PROMPT, VIBE_RESPONSE_SCHEMA, VIBE_SYSTEM_PROMPT,
  buildBundle, buildPlaceBundle, parsePlaceResponse, parseVibeResponse, sample, seededRandom,
  type VibeBundle, type VibeInputRow, type VibePlace, type VibeProfile, type VibeRestaurant,
} from './vibe.ts';

export interface VibeArgs {
  type: PlaceType;
  dryRun: boolean;
  limit: number;
  /** Every unenriched row of the type, in id order, instead of a random sample. */
  all: boolean;
  /** --model; null falls back to GEMINI_MODEL, then DEFAULT_GEMINI_MODEL. */
  model: string | null;
  rpm: number;
  /** Places processed at the same time (Gemini calls stay within --rpm). */
  concurrency: number;
  chunk: number;
  seed: number | null;
  photos: boolean;
  idsFile: string | null;
}

/** How one kind of row is turned into a prompt and how the answer is read. */
export interface VibeFlavor<R> {
  /** Plural noun for log lines. */
  noun: string;
  systemPrompt: string;
  responseSchema: unknown;
  buildBundle(row: R, inputs: VibeInputRow[], hasPhoto: boolean): VibeBundle;
  /** Throws on a rejected answer (the runner retries). `profile` is null for places. */
  parse(raw: string, ctx: { hasDescriptive: boolean; hasPhoto: boolean; hasPrice: boolean }): { description: string; profile: VibeProfile | null };
}

export const RESTAURANT_FLAVOR: VibeFlavor<VibeRestaurant> = {
  noun: 'restaurants',
  systemPrompt: VIBE_SYSTEM_PROMPT,
  responseSchema: VIBE_RESPONSE_SCHEMA,
  buildBundle,
  parse: parseVibeResponse,
};

/** Non-food flavor for one type: its generic name words are ignored when checking that website text names the place. */
export function placeFlavor(type: Exclude<PlaceType, 'restaurants'>): VibeFlavor<VibePlace> {
  const genericWords = PLACE_TYPE_CONFIG[type].genericNameWords;
  return {
    noun: 'places',
    systemPrompt: PLACE_SYSTEM_PROMPT,
    responseSchema: PLACE_RESPONSE_SCHEMA,
    buildBundle: (row, inputs, hasPhoto) => buildPlaceBundle(row, inputs, hasPhoto, genericWords),
    parse: (raw, ctx) => ({ ...parsePlaceResponse(raw, ctx), profile: null }),
  };
}

/** --model wins, then the GEMINI_MODEL environment variable, then the default. */
export function resolveModel(flag: string | null, env: string | undefined): string {
  return flag || env || DEFAULT_GEMINI_MODEL;
}

/** --all: every unenriched id in id order; otherwise a random (or --seed reproducible) sample of --limit. */
export function selectIds(candidates: number[], o: { all: boolean; limit: number; seed: number | null }): number[] {
  if (o.all) return [...candidates];
  return sample(candidates, o.limit, o.seed === null ? Math.random : seededRandom(o.seed));
}

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
      type: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-photos': { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      model: { type: 'string' },
      limit: { type: 'string' }, rpm: { type: 'string' }, chunk: { type: 'string' }, seed: { type: 'string' },
      concurrency: { type: 'string' },
      'ids-file': { type: 'string' },
    },
    strict: true,
  });
  const type = parseTypeOption(values.type);
  if (values.all && (values.limit !== undefined || values.seed !== undefined || values['ids-file'] !== undefined)) {
    throw new Error('--all cannot be combined with --limit, --seed or --ids-file');
  }
  if (values.model !== undefined && !values.model.trim()) throw new Error('invalid --model (expected a model name)');
  return {
    type,
    dryRun: values['dry-run'],
    photos: !values['no-photos'],
    all: values.all,
    model: values.model?.trim() ?? null,
    limit: positiveInt('limit', values.limit, 300),
    rpm: positiveInt('rpm', values.rpm, 60),
    concurrency: positiveInt('concurrency', values.concurrency, 1),
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
  samples: Array<{ id: number; name: string; rich: boolean; photo: boolean; description: string; profile: VibeProfile | null }>;
  stoppedEarly: string | null;
}

export interface VibeDeps<R extends { id: number; name: string } = VibeRestaurant> {
  rows: R[];
  /** Prompt building and answer parsing for this kind of row; defaults to restaurants. */
  flavor?: VibeFlavor<R>;
  inputs: Map<number, VibeInputRow[]>;
  photoUrls: Map<number, string>;
  isStillUnenriched: (id: number) => Promise<boolean>;
  fetchImage: (url: string) => Promise<{ image: VibeImage | null; reason?: string }>;
  generate: (prompt: string, image?: VibeImage) => Promise<string>;
  embed: Embedder;
  /** null in a dry run. */
  write: ((id: number, v: { description: string; embedding: number[]; profile: VibeProfile | null }) => Promise<boolean>) | null;
  chunk: number;
  /** Rows processed at the same time; 1 (default) is strictly one after another. */
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Delays between the 3 attempts for a malformed or empty answer. */
  retryDelaysMs?: number[];
  /** Stop the run after this many rows in a row fail on quota/overload (the key is probably exhausted). */
  maxConsecutiveQuota?: number;
}

export async function runVibeEnrichment<R extends { id: number; name: string } = VibeRestaurant>(d: VibeDeps<R>): Promise<VibeSummary> {
  const flavor = d.flavor ?? (RESTAURANT_FLAVOR as unknown as VibeFlavor<R>);
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

  // Workers take the next row until rows run out or the run stops early. JavaScript runs one callback at a
  // time, so the shared counters below need no locking; Gemini pacing is shared inside `generate`.
  let next = 0;
  let done = 0;
  const workers = Math.max(1, Math.min(d.concurrency ?? 1, d.rows.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (!s.stoppedEarly) {
      const i = next++;
      if (i >= d.rows.length) return;
      const row = d.rows[i]!;
      await processRow(row);
      done++;
      if (done % d.chunk === 0 && done < d.rows.length) {
        d.log?.(`progress ${done}/${d.rows.length}: ${s.succeeded} ok, ${s.failed.length} failed, ${s.skippedAlreadyDone} skipped (last id ${row.id})`);
      }
    }
  }));
  // A mix for manual review: up to 5 rich-input and 5 thin-input cases.
  s.samples = [...richSamples.slice(0, 5), ...thinSamples.slice(0, 5)];
  return s;

  async function processRow(row: R): Promise<void> {
    // Never process a row that was enriched since selection (re-run or partial-failure resume).
    if (!(await d.isStillUnenriched(row.id))) { s.skippedAlreadyDone++; return; }

    let image: VibeImage | undefined;
    const photoUrl = d.photoUrls.get(row.id);
    if (photoUrl) {
      const r = await d.fetchImage(photoUrl);
      if (r.image) image = r.image;
      else s.photoFailures[r.reason ?? 'unknown'] = (s.photoFailures[r.reason ?? 'unknown'] ?? 0) + 1;
    }

    const rowInputs = d.inputs.get(row.id) ?? [];
    let bundle = flavor.buildBundle(row, rowInputs, !!image);
    let result: { description: string; profile: VibeProfile | null } | null = null;
    let lastError = '';
    let sendImage = image;
    let quota = false;
    let attempts = 0;
    for (let attempt = 0; attempt < 3 && result === null; attempt++) {
      attempts++;
      if (attempt > 0) await sleep(delays[attempt - 1] ?? 5_000);
      try {
        bundle = flavor.buildBundle(row, rowInputs, !!sendImage);
        // A rejected answer is retried with the reason, so the model can correct it.
        const prompt = attempt > 0 && lastError && !quota ? `${bundle.prompt}\n\nYour previous answer was rejected: ${lastError}. Fix this.` : bundle.prompt;
        const raw = await d.generate(prompt, sendImage);
        result = flavor.parse(raw, { hasDescriptive: bundle.hasDescriptive, hasPhoto: !!sendImage, hasPrice: bundle.hasPrice });
        quota = false;
      } catch (err) {
        if (err instanceof GeminiQuotaError) { lastError = `quota/overload: ${err.message}`; quota = true; break; }
        if (err instanceof GeminiRequestError) {
          // A rejected image is the one 4xx worth retrying: send the facts without it.
          if (sendImage) { sendImage = undefined; lastError = `request rejected with image: ${err.message}`; continue; }
          s.stoppedEarly ??= err.message; // bad key, bad model name: no point continuing
          break;
        }
        lastError = (err as Error).message;
        if (lastError.startsWith('unsupported sensory claim')) s.rejections.sensory++;
        else if (lastError.startsWith('photo narration')) s.rejections.photo++;
        else s.rejections.other++;
      }
    }
    if (attempts > 1) s.retriedRows++;
    if (s.stoppedEarly) return;
    if (result === null) {
      s.failed.push({ id: row.id, name: row.name, reason: lastError || 'no result' });
      quotaStreak = quota ? quotaStreak + 1 : 0;
      if (quotaStreak >= maxQuota) s.stoppedEarly ??= `${maxQuota} rows in a row failed on quota/overload`;
      return;
    }
    quotaStreak = 0;

    try {
      const embedding = await d.embed(result.description);
      if (d.write) {
        const wrote = await d.write(row.id, { description: result.description, embedding, profile: result.profile });
        if (!wrote) { s.skippedAlreadyDone++; return; }
      }
    } catch (err) {
      s.failed.push({ id: row.id, name: row.name, reason: `embed/write: ${(err as Error).message}` });
      return;
    }
    s.succeeded++;
    if (sendImage) s.withPhoto++;
    if (bundle.hasDescriptive) s.withDescriptive++;
    if (!bundle.hasDescriptive && !sendImage) s.factsOnly++;
    const entry = { id: row.id, name: row.name, rich: bundle.hasDescriptive || !!sendImage, photo: !!sendImage, description: result.description, profile: result.profile };
    (entry.rich ? richSamples : thinSamples).push(entry);
  }
}

export function formatVibeSummary(s: VibeSummary, dryRun: boolean, noun = 'restaurants'): string {
  return [
    dryRun ? 'DRY RUN: nothing was written' : null,
    s.stoppedEarly ? `STOPPED EARLY: ${s.stoppedEarly}. Re-run to continue; unreached rows are still unenriched.` : null,
    `Selected: ${s.selected} ${noun}`,
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

type Counts = Awaited<ReturnType<typeof enrichmentCounts>>;

function countsLine(c: Counts): string {
  return `description ${c.description}, embedding ${c.embedding}${c.profile === null ? '' : `, profile ${c.profile}`} rows populated`;
}

async function main(): Promise<void> {
  const args = parseVibeArgs(process.argv.slice(2));
  const table = args.type;
  const isRestaurants = table === 'restaurants';
  const flavor = isRestaurants ? RESTAURANT_FLAVOR : placeFlavor(table);
  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const model = resolveModel(args.model, process.env.GEMINI_MODEL);
  const generate = createVibeGenerator({
    apiKey: requireEnv('GEMINI_API_KEY'), model, rpm: args.rpm,
    systemPrompt: flavor.systemPrompt, responseSchema: flavor.responseSchema,
  });
  const mode = `${args.dryRun ? 'dry run' : 'writing'}, model ${model}, ${args.rpm} rpm, concurrency ${args.concurrency}`;

  const before = await enrichmentCounts(client, table);
  console.log(`Table ${table}. Before: ${countsLine(before)}`);
  const candidates = await fetchUnenrichedIds(client, table);
  let ids: number[];
  if (args.idsFile) {
    // Re-process exactly these ids, but only those still unenriched: a row that has a description is never touched.
    const wanted = JSON.parse(readFileSync(args.idsFile, 'utf8')) as number[];
    const open = new Set(candidates);
    ids = wanted.filter((id) => open.has(id));
    console.log(`${wanted.length} ids in ${args.idsFile}; ${ids.length} still unenriched (${mode})`);
  } else {
    ids = selectIds(candidates, args);
    console.log(`${candidates.length} ${flavor.noun} are unenriched; ${args.all ? `taking all ${ids.length} in id order` : `sampled ${ids.length} at random`} (${mode})`);
  }

  const [rows, inputs, photoUrls] = await Promise.all([
    isRestaurants ? fetchRestaurants(client, ids) : fetchPlaces(client, table, ids),
    fetchInputs(client, ids),
    args.photos ? fetchPhotoUrls(client, ids) : Promise.resolve(new Map<number, string>()),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  console.log(`Loaded ${rows.length} ${flavor.noun}; ${inputs.size} have crawled text inputs, ${photoUrls.size} have a photo`);

  console.log('Loading MiniLM (first run downloads the model)...');
  const embed = await createEmbedder();

  const common = {
    inputs, photoUrls, embed, generate, chunk: args.chunk, concurrency: args.concurrency, log: (l: string) => console.log(l),
    isStillUnenriched: (id: number) => isStillUnenriched(client, table, id),
    fetchImage,
    write: args.dryRun ? null : (id: number, v: { description: string; embedding: number[]; profile: VibeProfile | null }) => writeEnrichment(client, table, id, v),
  };
  const summary = isRestaurants
    ? await runVibeEnrichment({ ...common, rows: rows as VibeRestaurant[], flavor: RESTAURANT_FLAVOR })
    : await runVibeEnrichment({ ...common, rows: rows as VibePlace[], flavor: flavor as VibeFlavor<VibePlace> });
  console.log(formatVibeSummary(summary, args.dryRun, flavor.noun));

  const after = await enrichmentCounts(client, table);
  console.log(`After:  ${countsLine(after)}`);
  const profileDelta = after.profile === null || before.profile === null ? '' : `, profile +${after.profile - before.profile}`;
  console.log(`Delta:  description +${after.description - before.description}, embedding +${after.embedding - before.embedding}${profileDelta} (expected +${args.dryRun ? 0 : summary.succeeded} each)`);

  console.log('\nSamples for manual review:');
  for (const x of summary.samples) {
    const profile = x.profile === null ? '' : `\n  profile: ${JSON.stringify(x.profile)}`;
    console.log(`\n[${x.rich ? 'rich input' : 'facts only'}${x.photo ? ' + photo' : ''}] id ${x.id} ${x.name}\n  ${x.description}${profile}`);
  }
  if (summary.stoppedEarly) process.exitCode = 1;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
