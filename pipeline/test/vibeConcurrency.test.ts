import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiQuotaError } from '../src/gemini.ts';
import { parseVibeArgs, runVibeEnrichment, type VibeDeps } from '../src/enrichVibe.ts';
import { createVibeGenerator } from '../src/geminiVibe.ts';
import type { VibeRestaurant } from '../src/vibe.ts';

const row = (id: number): VibeRestaurant => ({
  id, name: `R${id}`, category: 'restaurant', cuisines: ['thai'], price_band: '$', osm_tags: null, context_features: null,
});

const GOOD = JSON.stringify({
  description: 'A casual, unpretentious spot for Thai food at an easy price, suited to a quick weeknight meal with friends.',
  profile: { cuisines: ['thai'], signature_dishes: [], dietary_options: [], price_feel: 'cheap', median_entree_price: null },
});

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

function deps(over: Partial<VibeDeps> = {}): VibeDeps & { written: number[]; peak: () => number } {
  const written: number[] = [];
  let inFlight = 0;
  let peak = 0;
  const d: VibeDeps = {
    rows: Array.from({ length: 10 }, (_, i) => row(i + 1)),
    inputs: new Map(), photoUrls: new Map(),
    isStillUnenriched: async () => true,
    fetchImage: async () => ({ image: null }),
    generate: async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return GOOD;
    },
    embed: async () => [0.1, 0.2],
    write: async (id) => { written.push(id); return true; },
    chunk: 4, sleep: async () => {}, retryDelaysMs: [0, 0],
    ...over,
  };
  return Object.assign(d, { written, peak: () => peak });
}

test('concurrent runner processes every row exactly once and overlaps calls', async () => {
  const d = deps({ concurrency: 4 });
  const s = await runVibeEnrichment(d);
  assert.equal(s.succeeded, 10);
  assert.deepEqual([...d.written].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(d.peak() > 1, 'calls should overlap');
  assert.ok(d.peak() <= 4, 'never more than the concurrency limit in flight');
});

test('concurrency 1 keeps calls strictly one at a time', async () => {
  const d = deps({ concurrency: 1 });
  await runVibeEnrichment(d);
  assert.equal(d.peak(), 1);
});

test('a quota stop halts new rows even with several workers', async () => {
  let calls = 0;
  const d = deps({
    concurrency: 3,
    rows: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    generate: async () => { calls++; await tick(); throw new GeminiQuotaError('429'); },
  });
  const s = await runVibeEnrichment(d);
  assert.match(s.stoppedEarly ?? '', /rows in a row failed on quota/);
  assert.equal(d.written.length, 0);
  assert.ok(calls < 30, `stopped before taking every row (made ${calls} calls)`);
});

test('progress is logged by completed rows', async () => {
  const lines: string[] = [];
  await runVibeEnrichment(deps({ concurrency: 3, log: (l) => lines.push(l) }));
  assert.deepEqual(lines.map((l) => l.match(/^progress (\d+)\/10/)?.[1]), ['4', '8']);
});

test('the shared pacer spaces calls that start together', async () => {
  // Clock frozen at 0: each call's wait is exactly how far after the first call it is scheduled.
  const waits: number[] = [];
  let fetches = 0;
  const generate = createVibeGenerator({
    apiKey: 'k', model: 'gemini-3.1-flash-lite', rpm: 60,
    now: () => 0,
    sleep: async (ms) => { waits.push(ms); },
    fetchImpl: (async () => {
      fetches++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }), { status: 200 });
    }) as typeof fetch,
  });
  await Promise.all([generate('a'), generate('b'), generate('c')]);
  assert.equal(fetches, 3);
  assert.deepEqual([...waits].sort((a, b) => a - b), [1000, 2000]); // first call at once, then 1 s apart (60 rpm)
});

test('--concurrency is parsed with a default of 1', () => {
  assert.equal(parseVibeArgs(['--type', 'parks']).concurrency, 1);
  assert.equal(parseVibeArgs(['--type', 'parks', '--concurrency', '6']).concurrency, 6);
  assert.throws(() => parseVibeArgs(['--type', 'parks', '--concurrency', '0']), /invalid --concurrency/);
});
