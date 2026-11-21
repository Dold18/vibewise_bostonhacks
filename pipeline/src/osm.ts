import fs from 'node:fs/promises';
import path from 'node:path';
import {
  OSM_AMENITIES, OVERPASS_BACKOFF_START_MS, OVERPASS_MAX_ATTEMPTS, OVERPASS_MIRRORS,
  OVERPASS_REQUEST_TIMEOUT_MS, STUDY_BBOX, USER_AGENT,
} from './config.ts';
import type { OverpassElement } from './sources.ts';
import type { Bbox } from './types.ts';

export interface OverpassDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  mirrors?: string[];
}

export function buildOverpassQuery(bbox: Bbox, amenities: string[]): string {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:180];nwr["amenity"~"^(${amenities.join('|')})$"]["name"](${box});out center tags;`;
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
  opts: { refresh: boolean; cacheDir: string; today: string },
  deps: OverpassDeps = {},
): Promise<{ elements: OverpassElement[]; fromCache: boolean }> {
  const file = path.join(opts.cacheDir, `osm-${opts.today}.json`);
  if (!opts.refresh) {
    try {
      const elements = JSON.parse(await fs.readFile(file, 'utf8')) as OverpassElement[];
      return { elements, fromCache: true };
    } catch {
      // no usable cache: fall through to a live fetch
    }
  }
  const elements = await fetchOverpass(buildOverpassQuery(STUDY_BBOX, [...OSM_AMENITIES]), deps);
  await fs.mkdir(opts.cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(elements));
  return { elements, fromCache: false };
}
