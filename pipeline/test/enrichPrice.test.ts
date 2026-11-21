import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPriceSummary, parsePriceArgs, runPriceEnrichment } from '../src/enrichPrice.ts';
import { GeminiQuotaError } from '../src/gemini.ts';
import type { PriceCandidate, PromptPlace, WritePlan } from '../src/price.ts';

const cand = (id: number): PriceCandidate =>
  ({ id, name: `Place ${id}`, category: 'restaurant', cuisines: [], osm_tags: null, price_source: null });

/** Answers '$' for odd ids and 'unknown' for even ids. */
const answerAll = async (places: PromptPlace[]) =>
  JSON.stringify(places.map((p) => ({ id: p.id, band: Number(p.id) % 2 ? '$' : 'unknown' })));

function recorder() {
  const plans: WritePlan[] = [];
  const write = async (plan: WritePlan) => {
    plans.push(plan);
    return Object.values(plan.bands).flat().length + plan.reset.length;
  };
  return { plans, write };
}

test('parsePriceArgs defaults and flags', () => {
  assert.deepEqual(parsePriceArgs([]), { dryRun: false, limit: null, force: false, batchSize: 100, rpm: 10 });
  assert.deepEqual(parsePriceArgs(['--dry-run', '--limit=5', '--force', '--batch-size=20', '--rpm=4']),
    { dryRun: true, limit: 5, force: true, batchSize: 20, rpm: 4 });
});

test('parsePriceArgs rejects bad numbers', () => {
  assert.throws(() => parsePriceArgs(['--limit=0']), /--limit/);
  assert.throws(() => parsePriceArgs(['--rpm=x']), /--rpm/);
  assert.throws(() => parsePriceArgs(['--batch-size=2.5']), /--batch-size/);
});

test('batches candidates and writes per batch', async () => {
  const r = recorder();
  let calls = 0;
  const s = await runPriceEnrichment({
    candidates: [1, 2, 3, 4, 5].map(cand), estimate: async (p) => { calls++; return answerAll(p); }, write: r.write, batchSize: 2,
  });
  assert.equal(calls, 3);
  assert.equal(r.plans.length, 3);
  assert.deepEqual(r.plans.flatMap((p) => p.bands.$), [1, 3, 5]);
  assert.equal(s.selected, 5);
  assert.equal(s.requests, 3);
  assert.equal(s.counts.$, 3);
  assert.equal(s.counts.unknown, 2);
  assert.equal(s.written, 3);
  assert.equal(s.stoppedEarly, null);
  assert.deepEqual(s.samples.slice(0, 2), ['Place 1 → $', 'Place 2 → unknown']);
});

test('dry run never writes', async () => {
  const s = await runPriceEnrichment({ candidates: [1, 2].map(cand), estimate: answerAll, write: null, batchSize: 10 });
  assert.equal(s.written, 0);
  assert.equal(s.counts.$, 1);
  assert.match(formatPriceSummary(s, true), /dry run/i);
});

test('retries a truncated batch once then skips it', async () => {
  const r = recorder();
  let calls = 0;
  const s = await runPriceEnrichment({
    candidates: [1].map(cand), estimate: async () => { calls++; return '[{"id"'; }, write: r.write, batchSize: 10,
  });
  assert.equal(calls, 2);
  assert.equal(s.requests, 2);
  assert.equal(s.skippedBatches, 1);
  assert.equal(r.plans.length, 0);
});

test('a retry that answers enough is used', async () => {
  const r = recorder();
  let calls = 0;
  const s = await runPriceEnrichment({
    candidates: [1, 3].map(cand), estimate: async (p) => (++calls === 1 ? '[]' : answerAll(p)), write: r.write, batchSize: 10,
  });
  assert.equal(calls, 2);
  assert.equal(s.skippedBatches, 0);
  assert.deepEqual(r.plans[0]!.bands.$, [1, 3]);
});

test('stops on quota error and reports partial summary', async () => {
  const r = recorder();
  let calls = 0;
  const s = await runPriceEnrichment({
    candidates: [1, 2, 3, 4, 5].map(cand),
    estimate: async (p) => { if (++calls === 2) throw new GeminiQuotaError('quota'); return answerAll(p); },
    write: r.write, batchSize: 2,
  });
  assert.equal(calls, 2);
  assert.equal(s.requests, 2);
  assert.equal(r.plans.length, 1);
  assert.equal(s.stoppedEarly, 'quota');
  assert.match(formatPriceSummary(s, false), /stopped early/i);
});

test('missing rows are counted and not written', async () => {
  const r = recorder();
  const s = await runPriceEnrichment({
    candidates: [1, 3, 5].map(cand), estimate: async () => '[{"id":"1","band":"$$"},{"id":"3","band":"$$"}]', write: r.write, batchSize: 10,
  });
  assert.equal(s.missing, 1);
  assert.deepEqual(r.plans[0]!.bands.$$, [1, 3]);
});

test('other errors propagate', async () => {
  await assert.rejects(runPriceEnrichment({
    candidates: [cand(1)], estimate: async () => { throw new Error('400 bad key'); }, write: null, batchSize: 10,
  }), /bad key/);
});
