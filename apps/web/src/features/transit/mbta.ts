// Minimal MBTA V3 client + Boston service-day helpers. Provider-specific JSON stays in this layer
// and in departures.ts / ride.ts; nothing here leaks into map components.
//
// Base URL: https://api-v3.mbta.com. Auth: `x-api-key` header (an `api_key` query param also works,
// but the header keeps the key out of URLs and logs). A wrong key gets HTTP 403; no key is allowed
// but rate-limited to 20 requests/min.
//
// The key is read from MBTA_API_KEY (see /.env.example) or passed in via `LiveOptions.apiKey`.
// It must stay server-side: this module deliberately never reads a VITE_* variable, so a Vite
// client build cannot silently bundle it. Browser code should call a server route that uses this.

export const MBTA_BASE_URL = "https://api-v3.mbta.com";

export interface LiveOptions {
  /** The requested time (defaults to the real current time). */
  now?: Date;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class MbtaApiError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "MbtaApiError";
    this.status = status;
  }
}

// ---- JSON:API shapes (only what we read) ----
export interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}
export interface JsonApiDoc { data: JsonApiResource[]; included?: JsonApiResource[] }

const cache = new Map<string, { expires: number; doc: JsonApiDoc }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function envKey(): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.MBTA_API_KEY || undefined;
}

/** GET a V3 collection. Throws MbtaApiError on any failure; never returns made-up data. */
export async function mbtaGet(
  path: string,
  params: Record<string, string>,
  opts: LiveOptions = {},
  cacheTtlMs = 30_000,
): Promise<JsonApiDoc> {
  const url = new URL(path, opts.baseUrl ?? MBTA_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const href = url.toString();
  const hit = cache.get(href);
  if (hit && hit.expires > Date.now()) return hit.doc;

  const key = opts.apiKey ?? envKey();
  const f = opts.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(href, { headers: { accept: "application/vnd.api+json", ...(key ? { "x-api-key": key } : {}) } });
    } catch (e) {
      throw new MbtaApiError(`network error: ${(e as Error).message}`);
    }
    if (res.status === 429 && attempt < 2) {
      // Rate limited: wait for the window to reset if that is short, else give up honestly.
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      const wait = Number.isFinite(reset) ? reset - Date.now() + 500 : 5_000;
      if (wait > 0 && wait <= 65_000) { await sleep(wait); continue; }
    }
    if (!res.ok) throw new MbtaApiError(`MBTA API ${res.status} for ${url.pathname}`, res.status);
    let doc: JsonApiDoc;
    try { doc = (await res.json()) as JsonApiDoc; } catch { throw new MbtaApiError("malformed JSON from MBTA API", res.status); }
    if (!doc || !Array.isArray(doc.data)) throw new MbtaApiError("unexpected MBTA API payload (no data array)", res.status);
    cache.set(href, { expires: Date.now() + cacheTtlMs, doc });
    return doc;
  }
}

export function clearMbtaCache(): void { cache.clear(); }

// ---- Boston service-day helpers ----
const TZ = "America/New_York";

/** Local Boston calendar date (YYYY-MM-DD) and minutes since local midnight for an instant. */
export function bostonParts(d: Date): { date: string; minutes: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function prevDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/**
 * /schedules windows covering [from, from+lengthMin]. MBTA schedules belong to a *service date*
 * and run past midnight as 24:xx/25:xx, so before ~4 AM the previous service date must be queried
 * as well (e.g. 01:10 on the 23rd is 25:10 of the 22nd's service day).
 */
export function scheduleWindows(from: Date, lengthMin: number): { date: string; min: string; max: string }[] {
  const { date, minutes } = bostonParts(from);
  const out = [{ date, min: hhmm(minutes), max: hhmm(minutes + lengthMin) }];
  if (minutes < 4 * 60) out.push({ date: prevDate(date), min: hhmm(minutes + 1440), max: hhmm(minutes + 1440 + lengthMin) });
  return out;
}

export const fmtBoston = (d: Date | string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }).format(typeof d === "string" ? new Date(d) : d);
