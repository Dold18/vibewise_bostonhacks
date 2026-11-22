import fs from 'node:fs/promises';
import path from 'node:path';
import {
  OVERPASS_BACKOFF_START_MS, OVERPASS_MAX_ATTEMPTS, OVERPASS_MIRRORS,
  OVERPASS_REQUEST_TIMEOUT_MS, STUDY_BBOX, USER_AGENT,
} from './config.ts';
import type { PlaceTypeConfig } from './placeTypes.ts';
import type { OverpassElement } from './sources.ts';
import type { Bbox } from './types.ts';

export interface OverpassDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  mirrors?: string[];
}

/**
 * One `nwr<filter>["name"](bbox);` statement per filter (a union when there are several), then
 * `out center tags;` (a point per way/relation) or `out tags bb;` (a bounding box per way/relation).
 */
export function buildOverpassQuery(bbox: Bbox, cfg: PlaceTypeConfig): string {
  if (cfg.overpassFilters.length === 0) throw new Error(`no Overpass filters for place type '${cfg.type}'`);
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const statements = cfg.overpassFilters.map((f) => `nwr${f}["name"](${box});`);
  const body = statements.length === 1 ? statements[0] : `(${statements.join('')});`;
  const out = cfg.overpassOut === 'center' ? 'out center tags;' : 'out tags bb;';
  return `[out:json][timeout:180];${body}${out}`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attemptOnce(url: string, query: string, fetchImpl: typeof fetch): Promise<OverpassElement[]> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(OVERPASS_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const body = (await res.json()) as { remark?: string; elements?: OverpassElement[] };
  if (typeof body.remark === 'string' && /error/i.test(body.remark)) {
    throw new Error(`Overpass remark from ${url}: ${body.remark}`);
  }
  const elements = body.elements ?? [];
  if (elements.length === 0) throw new Error(`Overpass returned zero elements from ${url}`);
  return elements;
}

export async function fetchOverpass(query: string, deps: OverpassDeps = {}): Promise<OverpassElement[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const mirrors = deps.mirrors ?? [...OVERPASS_MIRRORS];
  let lastError: unknown = new Error('no Overpass mirrors configured');
  for (const mirror of mirrors) {
    for (let attempt = 1; attempt <= OVERPASS_MAX_ATTEMPTS; attempt++) {
      try {
        return await attemptOnce(mirror, query, fetchImpl);
      } catch (err) {
        lastError = err;
        if (attempt < OVERPASS_MAX_ATTEMPTS) await sleep(OVERPASS_BACKOFF_START_MS * 2 ** (attempt - 1));
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`All Overpass mirrors failed; last failure: ${msg}`);
}

export async function loadOsmElements(
  opts: { refresh: boolean; cacheDir: string; today: string; cfg: PlaceTypeConfig },
  deps: OverpassDeps = {},
): Promise<{ elements: OverpassElement[]; fromCache: boolean }> {
  const file = path.join(opts.cacheDir, `osm-${opts.cfg.type}-${opts.today}.json`);
  if (!opts.refresh) {
    try {
      const elements = JSON.parse(await fs.readFile(file, 'utf8')) as OverpassElement[];
      return { elements, fromCache: true };
    } catch {
      // no usable cache: fall through to a live fetch
    }
  }
  const elements = await fetchOverpass(buildOverpassQuery(STUDY_BBOX, opts.cfg), deps);
  await fs.mkdir(opts.cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(elements));
  return { elements, fromCache: false };
}
