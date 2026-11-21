/**
 * Gemini `generateContent` client for price estimates: plain fetch, paced to a
 * requests-per-minute limit, backing off on 429/503. No tools, so no Google
 * Search grounding (no Google data enters the catalog).
 */
import { PRICE_SYSTEM_PROMPT, type PromptPlace } from './price.ts';

// Chosen 2026-11-21: answered a test batch in under a second with thinking off;
// gemini-3.5-flash gave the same bands ten times slower and gemini-3.8-flash timed out.
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BACKOFF_MS = [10_000, 20_000, 40_000]; // between the 4 attempts
const REQUEST_TIMEOUT_MS = 180_000;
/** Rate limits and transient server errors are retried with backoff; other errors stop the run. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Still rate-limited or overloaded after every attempt; usually the key's quota is used up. */
export class GeminiQuotaError extends Error {}
/** Any other failure, e.g. a bad key or model name (4xx). */
export class GeminiRequestError extends Error {}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  rpm: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Per-request timeout; default 180 s. */
  timeoutMs?: number;
}

/** Banding needs no reasoning: thinking off for 2.5 models, lowest level for 3.x; untouched for others. */
function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (/^gemini-2\.5-/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return undefined;
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      band: { type: 'STRING', enum: ['$', '$$', '$$$', '$$$$', 'unknown'] },
    },
    required: ['id', 'band'],
  },
};

/** Returns a function that sends one batch and resolves to the model's raw JSON text. */
export function createPriceEstimator(o: GeminiOptions): (places: PromptPlace[]) => Promise<string> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const minIntervalMs = 60_000 / o.rpm;
  let lastStart: number | undefined;

  async function paced(): Promise<void> {
    if (lastStart !== undefined) {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();
  }

  return async (places) => {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: PRICE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(places) }] }],
      generationConfig: {
        temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: thinkingConfigFor(o.model),
      },
    });
    for (let attempt = 0; ; attempt++) {
      await paced();
      let res: Response | null;
      try {
        res = await fetchImpl(`${API_BASE}/${o.model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': o.apiKey, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(o.timeoutMs ?? REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        // A timeout or dropped connection is retried like an overloaded server.
        if ((err as Error).name !== 'TimeoutError' && !(err instanceof TypeError)) throw err;
        res = null;
      }
      if (res === null || RETRYABLE_STATUS.has(res.status)) {
        const backoff = BACKOFF_MS[attempt];
        if (backoff === undefined) {
          throw new GeminiQuotaError(`Gemini still returned ${res?.status ?? 'no response'} after ${attempt + 1} attempts (quota used up or service overloaded)`);
        }
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new GeminiRequestError(`Gemini request failed with ${res.status}: ${detail.slice(0, 300)}`);
      }
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
      const candidate = json.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      // No text (e.g. finishReason SAFETY or MAX_TOKENS) comes back as '', which the caller
      // treats like an unreadable response: retried once, then the batch is skipped.
      return text;
    }
  };
}
