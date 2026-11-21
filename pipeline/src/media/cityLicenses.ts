import fs from 'node:fs/promises';
import path from 'node:path';
import proj4 from 'proj4';
import {
  BOSTON_ALCOHOL_PAGE, BOSTON_ALCOHOL_RESOURCE, BOSTON_DATASTORE_SEARCH, BOSTON_ENTERTAINMENT_PAGE,
  BOSTON_ENTERTAINMENT_RESOURCE,
} from '../config.ts';
import { metersBetween } from '../geo.ts';
import { nameSimilarity } from '../normalize.ts';
import type { PoliteFetcher } from './http.ts';
import type { EnrichPlace, VibeInput } from './types.ts';

// EPSG:2249, NAD83 / Massachusetts Mainland (US survey feet): the city's gpsx/gpsy.
const MA_STATE_PLANE = '+proj=lcc +lat_1=42.68333333333333 +lat_2=41.71666666666667 +lat_0=41 +lon_0=-71.5 +x_0=200000.0001016002 +y_0=750000 +ellps=GRS80 +datum=NAD83 +units=us-ft +no_defs';
const PAGE_SIZE = 1000;
const MATCH_METERS = 60;
const MATCH_SIMILARITY = 0.5;

export interface CityLicense {
  dataset: 'entertainment' | 'alcohol'; name: string; lat: number; lng: number;
  licenseType: string; closing: string | null; capacity: string | null; unitType: string | null; premises: string | null;
}

type Row = Record<string, unknown>;

export function stateplaneToWgs84(x: number, y: number): { lat: number; lng: number } {
  const [lng, lat] = proj4(MA_STATE_PLANE, 'WGS84', [x, y]) as [number, number];
  return { lat, lng };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function located(r: Row): { lat: number; lng: number } | null {
  const x = Number(r.gpsx);
  const y = Number(r.gpsy);
  if (r.gpsx === null || r.gpsy === null || !Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return null;
  return stateplaneToWgs84(x, y);
}

function usable(r: Row): boolean {
  return str(r.status) === 'Active' && (str(r.dba_name) ?? str(r.business_name)) !== null;
}

/** One license per license_num; the detailed dataset has a row per entertainment unit type. */
export function mapEntertainmentRows(rows: Row[]): CityLicense[] {
  const byNum = new Map<string, CityLicense>();
  for (const r of rows) {
    if (!usable(r)) continue;
    const at = located(r);
    if (!at) continue;
    const num = str(r.license_num) ?? `${str(r.dba_name) ?? str(r.business_name)}@${at.lat},${at.lng}`;
    const unit = str(r.unit_type);
    const existing = byNum.get(num);
    if (existing) {
      if (unit && !(existing.unitType ?? '').split(', ').includes(unit)) {
        existing.unitType = existing.unitType ? `${existing.unitType}, ${unit}` : unit;
      }
      continue;
    }
    byNum.set(num, {
      dataset: 'entertainment', name: (str(r.dba_name) ?? str(r.business_name))!, lat: at.lat, lng: at.lng,
      licenseType: str(r.license_type) ?? 'Entertainment', closing: str(r.end_time), capacity: str(r.capacity),
      unitType: unit, premises: null,
    });
  }
  return [...byNum.values()];
}

export function mapAlcoholRows(rows: Row[]): CityLicense[] {
  const out: CityLicense[] = [];
  for (const r of rows) {
    if (!usable(r)) continue;
    const at = located(r);
    if (!at) continue;
    out.push({
      dataset: 'alcohol', name: (str(r.dba_name) ?? str(r.business_name))!, lat: at.lat, lng: at.lng,
      licenseType: str(r.license_type) ?? 'Alcohol', closing: str(r.closing), capacity: str(r.capacity),
      unitType: null, premises: str(r.location_comments),
    });
  }
  return out;
}

async function fetchAll(http: PoliteFetcher, resourceId: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${BOSTON_DATASTORE_SEARCH}?${new URLSearchParams({ resource_id: resourceId, limit: String(PAGE_SIZE), offset: String(offset) })}`;
    const res = await http.getJson<{ success?: boolean; result?: { records?: Row[] } }>(url);
    if (res.success === false) throw new Error(`data.boston.gov datastore_search failed for ${resourceId}`);
    const page = res.result?.records ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function loadCityLicenses(http: PoliteFetcher, opts: { cacheDir: string; refresh: boolean }): Promise<CityLicense[]> {
  const cacheFile = path.join(opts.cacheDir, 'city-licenses.json');
  if (!opts.refresh) {
    try { return JSON.parse(await fs.readFile(cacheFile, 'utf8')) as CityLicense[]; } catch { /* no cache yet */ }
  }
  const all = [
    ...mapEntertainmentRows(await fetchAll(http, BOSTON_ENTERTAINMENT_RESOURCE)),
    ...mapAlcoholRows(await fetchAll(http, BOSTON_ALCOHOL_RESOURCE)),
  ];
  await fs.mkdir(opts.cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(all));
  return all;
}

export function matchCityLicenses(place: EnrichPlace, all: CityLicense[]): CityLicense[] {
  return all.filter((l) => metersBetween(place, l) <= MATCH_METERS && nameSimilarity(l.name, place.name) >= MATCH_SIMILARITY);
}

function line(l: CityLicense): string {
  const capacity = l.capacity ? `, capacity ${l.capacity}` : '';
  if (l.dataset === 'entertainment') {
    const units = l.unitType ? ` (${l.unitType})` : '';
    const until = l.closing ? `, until ${l.closing}` : '';
    return `Entertainment license: ${l.licenseType}${units}${until}${capacity}.`;
  }
  const closes = l.closing ? `, closes ${l.closing}` : '';
  const premises = l.premises ? ` Premises: ${l.premises}` : '';
  return `Alcohol license: ${l.licenseType}${closes}${capacity}.${premises}`;
}

export function cityLicenseInput(matches: CityLicense[]): VibeInput | null {
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => (a.dataset === b.dataset ? 0 : a.dataset === 'entertainment' ? -1 : 1));
  return {
    source: 'city_licenses',
    content: sorted.map(line).join('\n'),
    sourceUrl: sorted[0]!.dataset === 'entertainment' ? BOSTON_ENTERTAINMENT_PAGE : BOSTON_ALCOHOL_PAGE,
  };
}
