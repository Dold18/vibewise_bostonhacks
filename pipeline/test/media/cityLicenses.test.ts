import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cityLicenseInput, loadCityLicenses, mapAlcoholRows, mapEntertainmentRows, matchCityLicenses, stateplaneToWgs84,
  type CityLicense,
} from '../../src/media/cityLicenses.ts';
import { BOSTON_ALCOHOL_RESOURCE, BOSTON_ENTERTAINMENT_RESOURCE } from '../../src/config.ts';
import type { PoliteFetcher } from '../../src/media/http.ts';
import type { EnrichPlace } from '../../src/media/types.ts';

const SPUR_X = 780647.69;
const SPUR_Y = 2960179.33;

const ENT_ROWS = [
  { license_num: 'CAL-1', status: 'Active', license_type: 'Live Entertainment', business_name: 'Spur LLC', dba_name: 'The Spur', applicant: 'Jo Doe', manager: 'Jo Doe', capacity: 49, end_time: '2:00AM', unit_type: 'Disc Jockey', gpsx: SPUR_X, gpsy: SPUR_Y },
  { license_num: 'CAL-1', status: 'Active', license_type: 'Live Entertainment', business_name: 'Spur LLC', dba_name: 'The Spur', applicant: 'Jo Doe', manager: 'Jo Doe', capacity: 49, end_time: '2:00AM', unit_type: 'Dancing by Patrons', gpsx: SPUR_X, gpsy: SPUR_Y },
  { license_num: 'CAL-2', status: 'Inactive', license_type: 'Live Entertainment', business_name: 'Old', dba_name: 'Old', capacity: 10, end_time: '1:00AM', unit_type: 'Vocal', gpsx: SPUR_X, gpsy: SPUR_Y },
  { license_num: 'CAL-3', status: 'Active', license_type: 'Live Entertainment', business_name: 'NoGeo', dba_name: null, capacity: 10, end_time: null, unit_type: 'Vocal', gpsx: null, gpsy: null },
];
const ALC_ROWS = [
  { license_num: 'LB-1', status: 'Active', license_type: 'CV7 Malt Wine Liq', business_name: 'Spur LLC', dba_name: null, closing: '1:00 AM', capacity: '49', location_comments: 'One room with a long bar and a patio.', applicant: 'Jo Doe', manager: 'Jo Doe', day_phone: '(617)555-0100', gpsx: SPUR_X, gpsy: SPUR_Y },
];

test('stateplaneToWgs84 puts the sample license at Maverick Square', () => {
  const p = stateplaneToWgs84(SPUR_X, SPUR_Y);
  assert.ok(Math.abs(p.lat - 42.369) < 0.005, String(p.lat));
  assert.ok(Math.abs(p.lng - -71.039) < 0.005, String(p.lng));
});

test('entertainment rows group by license, keep only safe fields and skip inactive or unlocated rows', () => {
  const out = mapEntertainmentRows(ENT_ROWS);
  assert.equal(out.length, 1);
  const l = out[0]!;
  assert.equal(l.name, 'The Spur');
  assert.equal(l.unitType, 'Disc Jockey, Dancing by Patrons');
  assert.equal(l.closing, '2:00AM');
  assert.equal(l.capacity, '49');
  assert.equal(l.premises, null);
  assert.deepEqual(Object.keys(l).sort(), ['capacity', 'closing', 'dataset', 'lat', 'licenseType', 'lng', 'name', 'premises', 'unitType']);
});

test('alcohol rows fall back to business_name and keep the premises description, never personal fields', () => {
  const [l] = mapAlcoholRows(ALC_ROWS);
  assert.equal(l!.name, 'Spur LLC');
  assert.equal(l!.premises, 'One room with a long bar and a patio.');
  assert.equal(JSON.stringify(l).includes('Jo Doe'), false);
  assert.equal(JSON.stringify(l).includes('555'), false);
});

const at = stateplaneToWgs84(SPUR_X, SPUR_Y);
const PLACE: EnrichPlace = { id: 1, placeId: 'osm:node/1', name: 'The Spur Bar', lat: at.lat + 40 / 111_195, lng: at.lng, website: null, address: null, osmTags: null };
const lic = (o: Partial<CityLicense>): CityLicense => ({ dataset: 'entertainment', name: 'The Spur', lat: at.lat, lng: at.lng, licenseType: 'Live Entertainment', closing: '2:00AM', capacity: '49', unitType: 'Disc Jockey', premises: null, ...o });

test('a license 40 m away with a similar name matches', () => {
  assert.equal(matchCityLicenses(PLACE, [lic({})]).length, 1);
});

test('a license 200 m away does not match', () => {
  assert.deepEqual(matchCityLicenses(PLACE, [lic({ lat: at.lat + 200 / 111_195 })]), []);
});

test('a nearby license with an unrelated name does not match', () => {
  assert.deepEqual(matchCityLicenses(PLACE, [lic({ name: 'Maverick Pharmacy' })]), []);
});

test('cityLicenseInput writes one line per license', () => {
  const input = cityLicenseInput([lic({}), lic({ dataset: 'alcohol', licenseType: 'CV7 Malt Wine Liq', closing: '1:00 AM', unitType: null, premises: 'One room with a patio.' })]);
  assert.ok(input);
  assert.equal(input.source, 'city_licenses');
  const lines = input.content.split('\n');
  assert.equal(lines[0], 'Entertainment license: Live Entertainment (Disc Jockey), until 2:00AM, capacity 49.');
  assert.equal(lines[1], 'Alcohol license: CV7 Malt Wine Liq, closes 1:00 AM, capacity 49. Premises: One room with a patio.');
  assert.equal(input.sourceUrl, 'https://data.boston.gov/dataset/entertainment-licenses-legacy');
});

test('cityLicenseInput returns null for no matches', () => {
  assert.equal(cityLicenseInput([]), null);
});

test('loadCityLicenses pages each dataset and caches the result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'city-'));
  const urls: string[] = [];
  const http: PoliteFetcher = {
    async getText() { throw new Error('not used'); },
    async getJson<T>(url: string): Promise<T> {
      urls.push(url);
      const p = new URL(url).searchParams;
      const rows = p.get('resource_id') === BOSTON_ENTERTAINMENT_RESOURCE ? ENT_ROWS : ALC_ROWS;
      const offset = Number(p.get('offset'));
      return { success: true, result: { records: offset === 0 ? rows : [] } } as T;
    },
  };
  const all = await loadCityLicenses(http, { cacheDir: dir, refresh: false });
  assert.deepEqual(all.map((l) => l.dataset).sort(), ['alcohol', 'entertainment']);
  assert.ok(urls.every((u) => u.startsWith('https://data.boston.gov/api/3/action/datastore_search?')));
  assert.ok(urls.some((u) => u.includes(BOSTON_ALCOHOL_RESOURCE)));
  const n = urls.length;
  await loadCityLicenses(http, { cacheDir: dir, refresh: false });
  assert.equal(urls.length, n);
});
