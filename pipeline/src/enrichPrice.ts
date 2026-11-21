/**
 * `npm run enrich:price`: estimate a price band for catalog rows without a price
 * and write only the price columns (spec docs/superpowers/specs/2026-11-21-price-estimates-design.md).
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { connect, fetchPriceCandidates, writePriceBands } from './db.ts';
import { DEFAULT_GEMINI_MODEL, GeminiQuotaError, createPriceEstimator } from './gemini.ts';
import {
  needsRetry, parseEstimates, planWrites, toPromptPlace,
  type PriceAnswer, type PriceCandidate, type PromptPlace, type WritePlan,
} from './price.ts';

export interface PriceArgs { dryRun: boolean; limit: number | null; force: boolean; batchSize: number; rpm: number }

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid --${name} '${raw}' (expected a positive whole number)`);
  return n;
}

export function parsePriceArgs(argv: string[]): PriceArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      limit: { type: 'string' },
      'batch-size': { type: 'string' },
      rpm: { type: 'string' },
    },
    strict: true,
  });
  return {
    dryRun: values['dry-run'],
    limit: values.limit === undefined ? null : positiveInt('limit', values.limit, 0),
    force: values.force,
    batchSize: positiveInt('batch-size', values['batch-size'], 100),
    rpm: positiveInt('rpm', values.rpm, 10),
  };
}

export interface PriceSummary {
  selected: number;
  requests: number;
  skippedBatches: number;
  counts: Record<PriceAnswer, number>;
  /** Rows in processed batches that the model gave no valid answer for. */
  missing: number;
  written: number;
  /** Why the run stopped before the last batch, or null. */
  stoppedEarly: string | null;
  samples: string[];
}

const SAMPLE_COUNT = 20;

export async function runPriceEnrichment(deps: {
  candidates: PriceCandidate[];
  estimate: (places: PromptPlace[]) => Promise<string>;
  /** null = dry run. */
  write: ((plan: WritePlan) => Promise<number>) | null;
  batchSize: number;
  log?: (line: string) => void;
}): Promise<PriceSummary> {
  const s: PriceSummary = {
    selected: deps.candidates.length, requests: 0, skippedBatches: 0,
    counts: { '$': 0, '$$': 0, '$$$': 0, '$$$$': 0, unknown: 0 }, missing: 0, written: 0, stoppedEarly: null, samples: [],
  };
  for (let i = 0; i < deps.candidates.length; i += deps.batchSize) {
    const batch = deps.candidates.slice(i, i + deps.batchSize);
    const places = batch.map(toPromptPlace);
    const ids = places.map((p) => p.id);
    let result;
    try {
      s.requests++;
      result = parseEstimates(await deps.estimate(places), ids);
      if (needsRetry(result, batch.length)) {
        s.requests++;
        result = parseEstimates(await deps.estimate(places), ids);
      }
    } catch (err) {
      if (err instanceof GeminiQuotaError) {
        s.stoppedEarly = err.message;
        break;
      }
      throw err;
    }
    if (!result.ok) {
      s.skippedBatches++;
      deps.log?.(`batch ${i / deps.batchSize + 1}: unreadable response twice, skipped`);
      continue;
    }
    for (const row of batch) {
      const answer = result.answers.get(String(row.id));
      if (!answer) {
        s.missing++;
        continue;
      }
      s.counts[answer]++;
      if (s.samples.length < SAMPLE_COUNT) s.samples.push(`${row.name} → ${answer}`);
    }
    if (deps.write) s.written += await deps.write(planWrites(batch, result.answers));
    deps.log?.(`batch ${i / deps.batchSize + 1}/${Math.ceil(deps.candidates.length / deps.batchSize)} done`);
  }
  return s;
}

export function formatPriceSummary(s: PriceSummary, dryRun: boolean): string {
  return [
    dryRun ? 'DRY RUN: nothing was written' : null,
    s.stoppedEarly ? `STOPPED EARLY: ${s.stoppedEarly}. Re-run to continue; unreached rows are still unpriced.` : null,
    `Rows selected: ${s.selected}`,
    `Requests: ${s.requests}`,
    `Batches skipped: ${s.skippedBatches}`,
    `Bands: $ ${s.counts.$} · $$ ${s.counts.$$} · $$$ ${s.counts.$$$} · $$$$ ${s.counts.$$$$} · unknown ${s.counts.unknown}`,
    `No answer: ${s.missing}`,
    `Rows written: ${s.written}`,
    s.samples.length ? `Samples:\n  ${s.samples.join('\n  ')}` : null,
  ].filter((l): l is string => l !== null).join('\n');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
}

async function main(): Promise<void> {
  const args = parsePriceArgs(process.argv.slice(2));
  const client = connect(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'));
  const estimate = createPriceEstimator({
    apiKey: requireEnv('GEMINI_API_KEY'), model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, rpm: args.rpm,
  });
  const candidates = await fetchPriceCandidates(client, args.force, args.limit);
  console.log(`Estimating ${candidates.length} rows in batches of ${args.batchSize} (${args.dryRun ? 'dry run' : 'writing'})`);
  const summary = await runPriceEnrichment({
    candidates, estimate, write: args.dryRun ? null : (plan) => writePriceBands(client, plan),
    batchSize: args.batchSize, log: (line) => console.log(line),
  });
  console.log(formatPriceSummary(summary, args.dryRun));
  if (summary.stoppedEarly) process.exitCode = 1;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
