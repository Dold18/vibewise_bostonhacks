import { USER_AGENT } from '../config.ts';
import { parseRobots } from './robots.ts';
import type { FetchDeps } from './types.ts';

export type FetchResult =
  | { ok: true; url: string; contentType: string; body: string }
  | { ok: false; reason: 'robots' | 'http' | 'timeout' | 'not_html' | 'network' | 'third_party'; detail: string };

export type BytesResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; reason: 'http' | 'timeout' | 'network' | 'too_large'; detail: string };

export interface PoliteFetcher {
  getText(url: string, opts?: { checkRobots?: boolean }): Promise<FetchResult>;
  getJson<T>(url: string): Promise<T>;
  getBytes(url: string, opts?: { maxBytes?: number }): Promise<BytesResult>;
}

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Failure = Extract<FetchResult, { ok: false }>;

function failureFromError(err: unknown): Failure {
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  const detail = err instanceof Error ? err.message : String(err);
  return name === 'TimeoutError' || name === 'AbortError'
    ? { ok: false, reason: 'timeout', detail }
    : { ok: false, reason: 'network', detail };
}

export function createPoliteFetcher(deps: FetchDeps & { minIntervalMs?: number; timeoutMs?: number } = {}): PoliteFetcher {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const minIntervalMs = deps.minIntervalMs ?? 1000;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const lastAt = new Map<string, number>();
  const robots = new Map<string, Promise<(path: string) => boolean>>();

  // Reserve the host's next slot synchronously so concurrent callers queue instead of racing.
  async function space(host: string): Promise<void> {
    const prev = lastAt.get(host);
    const t = now();
    const slot = prev === undefined ? t : Math.max(t, prev + minIntervalMs);
    lastAt.set(host, slot);
    if (slot > t) await sleep(slot - t);
  }

  async function send(url: string, accept: string, redirect: RequestRedirect): Promise<Response> {
    await space(new URL(url).host);
    return fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      redirect,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  function robotsFor(origin: string): Promise<(path: string) => boolean> {
    let p = robots.get(origin);
    if (!p) {
      p = (async () => {
        try {
          const res = await send(`${origin}/robots.txt`, 'text/plain', 'follow');
          if (res.ok) return parseRobots(await res.text(), USER_AGENT);
          if (res.status >= 400 && res.status < 500) return () => true;
          return () => false;
        } catch {
          return () => false;
        }
      })();
      robots.set(origin, p);
    }
    return p;
  }

  return {
    async getText(url, opts = {}) {
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const u = new URL(current);
        if (opts.checkRobots && !(await robotsFor(u.origin))(u.pathname + u.search)) {
          return { ok: false, reason: 'robots', detail: `disallowed by robots.txt: ${current}` };
        }
        let res: Response;
        try {
          res = await send(current, 'text/html,application/xhtml+xml', 'manual');
        } catch (err) {
          return failureFromError(err);
        }
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) return { ok: false, reason: 'http', detail: `HTTP ${res.status} without Location from ${current}` };
          current = new URL(location, current).toString();
          continue;
        }
        if (!res.ok) return { ok: false, reason: 'http', detail: `HTTP ${res.status} from ${current}` };
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('text/html')) {
          return { ok: false, reason: 'not_html', detail: `${contentType || 'no content type'} from ${current}` };
        }
        try {
          return { ok: true, url: current, contentType, body: await res.text() };
        } catch (err) {
          return failureFromError(err);
        }
      }
      return { ok: false, reason: 'http', detail: `more than ${MAX_REDIRECTS} redirects from ${url}` };
    },

    async getJson<T>(url: string): Promise<T> {
      const res = await send(url, 'application/json', 'follow');
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return (await res.json()) as T;
    },

    async getBytes(url, opts = {}) {
      const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
      let res: Response;
      try {
        res = await send(url, 'image/*,*/*;q=0.5', 'follow');
      } catch (err) {
        return failureFromError(err) as Extract<BytesResult, { ok: false }>;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: 'http', detail: `HTTP ${res.status} from ${url}` };
      }
      const tooLarge = (): BytesResult => ({ ok: false, reason: 'too_large', detail: `over ${maxBytes} bytes: ${url}` });
      if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
        await res.body?.cancel().catch(() => {});
        return tooLarge();
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.body) return { ok: true, bytes: new Uint8Array(), contentType };
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            return tooLarge();
          }
          chunks.push(value);
        }
      } catch (err) {
        return failureFromError(err) as Extract<BytesResult, { ok: false }>;
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
      return { ok: true, bytes, contentType };
    },
  };
}
