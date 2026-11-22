/**
 * Gemini `generateContent` client for the vibe step: one restaurant or place per call, structured JSON out,
 * optional inline image (Gemini vision, no CLIP). Paced to a requests-per-minute limit; 429 and
 * transient 5xx are retried with backoff even on a paid tier. Same conventions as gemini.ts.
 */
import { GeminiQuotaError, GeminiRequestError } from './gemini.ts';
import { VIBE_RESPONSE_SCHEMA, VIBE_SYSTEM_PROMPT } from './vibe.ts';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BACKOFF_MS = [5_000, 15_000, 45_000]; // between the 4 attempts
const REQUEST_TIMEOUT_MS = 90_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface VibeImage { mimeType: string; data: string /* base64 */ }
export interface VibeGeminiOptions {
  apiKey: string;
  model: string;
  rpm: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  backoffMs?: number[];
  /** Defaults to the restaurant prompt and schema; non-food places pass PLACE_SYSTEM_PROMPT and PLACE_RESPONSE_SCHEMA. */
  systemPrompt?: string;
  responseSchema?: unknown;
}

/** 2.5 models (flash, flash-lite) take a thinking budget, 3.x models (flash, flash-lite) a thinking level; others are left alone. */
function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (/^gemini-2\.5-/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return undefined;
}

/** Returns a function that sends one restaurant or place and resolves to the model's raw JSON text. */
export function createVibeGenerator(o: VibeGeminiOptions): (prompt: string, image?: VibeImage) => Promise<string> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const backoff = o.backoffMs ?? BACKOFF_MS;
  const minIntervalMs = 60_000 / o.rpm;
  let lastStart: number | undefined;

  async function paced(): Promise<void> {
    if (lastStart !== undefined) {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();
  }

  return async (prompt, image) => {
    const parts: unknown[] = [{ text: prompt }];
    if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: o.systemPrompt ?? VIBE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.3, responseMimeType: 'application/json', responseSchema: o.responseSchema ?? VIBE_RESPONSE_SCHEMA,
        thinkingConfig: thinkingConfigFor(o.model), maxOutputTokens: 1024,
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if ((err as Error).name !== 'TimeoutError' && !(err instanceof TypeError)) throw err;
        res = null; // timeout or dropped connection: retried like an overloaded server
      }
      if (res === null || RETRYABLE_STATUS.has(res.status)) {
        const wait = backoff[attempt];
        if (wait === undefined) {
          throw new GeminiQuotaError(`Gemini still returned ${res?.status ?? 'no response'} after ${attempt + 1} attempts`);
        }
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new GeminiRequestError(`Gemini request failed with ${res.status}: ${detail.slice(0, 300)}`);
      }
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    }
  };
}
