import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiQuotaError, GeminiRequestError, createPriceEstimator } from '../src/gemini.ts';

const PLACES = [{ id: '1', name: 'Tatte', category: 'cafe', cuisines: [] }];
const okBody = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

function harness(responses: Array<{ status: number; body?: unknown }>, rpm = 600) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  let t = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;
  const sleep = async (ms: number) => { sleeps.push(ms); t += ms; };
  const estimate = createPriceEstimator({ apiKey: 'k', model: 'm', rpm, fetchImpl, sleep, now: () => t });
  return { calls, sleeps, estimate };
}

test('sends key in header, no tools, temperature 0, schema', async () => {
  const h = harness([{ status: 200, body: okBody('[]') }]);
  await h.estimate(PLACES);
  const { url, init } = h.calls[0]!;
  assert.ok(url.endsWith('/v1beta/models/m:generateContent'), url);
  assert.ok(!url.includes('key='));
  assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], 'k');
  const body = JSON.parse(init.body as string);
  assert.equal(body.tools, undefined);
  assert.equal(body.generationConfig.temperature, 0);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema.items.properties.band.enum, ['$', '$$', '$$$', '$$$$', 'unknown']);
  assert.ok(body.systemInstruction.parts[0].text.includes('per person'));
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), PLACES);
});

test('returns joined text of first candidate', async () => {
  const h = harness([{ status: 200, body: { candidates: [{ content: { parts: [{ text: '[{"id"' }, { text: ':"1","band":"$"}]' }] } }] } }]);
  assert.equal(await h.estimate(PLACES), '[{"id":"1","band":"$"}]');
});

test('paces requests to rpm', async () => {
  const h = harness([{ status: 200, body: okBody('[]') }], 10);
  await h.estimate(PLACES);
  await h.estimate(PLACES);
  assert.deepEqual(h.sleeps, [6000]);
});

test('backs off 10/20/40s on 429 then throws GeminiQuotaError', async () => {
  const h = harness([{ status: 429 }]);
  await assert.rejects(h.estimate(PLACES), GeminiQuotaError);
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.sleeps.filter((ms) => ms >= 10000), [10000, 20000, 40000]);
});

test('recovers after one 503', async () => {
  const h = harness([{ status: 503 }, { status: 200, body: okBody('[]') }]);
  assert.equal(await h.estimate(PLACES), '[]');
  assert.equal(h.calls.length, 2);
});

test('throws GeminiRequestError on 400 without retry', async () => {
  const h = harness([{ status: 400, body: { error: { message: 'API key not valid' } } }]);
  await assert.rejects(h.estimate(PLACES), (e: Error) => e instanceof GeminiRequestError && /400/.test(e.message));
  assert.equal(h.calls.length, 1);
});

test('throws GeminiRequestError when the response has no text', async () => {
  const h = harness([{ status: 200, body: { candidates: [{ finishReason: 'SAFETY' }] } }]);
  await assert.rejects(h.estimate(PLACES), GeminiRequestError);
});

test('retries a timed-out or dropped request like a 503', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls++;
    assert.ok(init.signal, 'request has a timeout signal');
    if (calls === 1) throw new DOMException('The operation timed out.', 'TimeoutError');
    if (calls === 2) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(okBody('[]')), { status: 200 });
  }) as unknown as typeof fetch;
  let t = 0;
  const estimate = createPriceEstimator({ apiKey: 'k', model: 'm', rpm: 600, fetchImpl, sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t });
  assert.equal(await estimate(PLACES), '[]');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps.filter((ms) => ms >= 10000), [10000, 20000]);
});

test('turns thinking off or down per model family', async () => {
  const sent = async (model: string) => {
    let body: { generationConfig: { thinkingConfig?: unknown } } | undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(okBody('[]')), { status: 200 });
    }) as unknown as typeof fetch;
    await createPriceEstimator({ apiKey: 'k', model, rpm: 600, fetchImpl, sleep: async () => {} })(PLACES);
    return body!.generationConfig.thinkingConfig;
  };
  assert.deepEqual(await sent('gemini-2.5-flash'), { thinkingBudget: 0 });
  assert.deepEqual(await sent('gemini-3.5-flash'), { thinkingLevel: 'low' });
  assert.equal(await sent('custom-model'), undefined);
});
