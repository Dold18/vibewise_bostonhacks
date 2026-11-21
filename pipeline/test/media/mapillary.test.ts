import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDiff, bearingDegrees, facingPhoto } from '../../src/media/mapillary.ts';
import type { PoliteFetcher } from '../../src/media/http.ts';
import type { EnrichPlace } from '../../src/media/types.ts';

const PLACE: EnrichPlace = { id: 1, placeId: 'osm:node/1', name: 'X', lat: 42.35, lng: -71.08, website: null, address: null, osmTags: null };
const M_PER_DEG_LAT = 111_195;

function img(id: string, metersSouth: number, compass: number) {
  return { id, computed_compass_angle: compass, computed_geometry: { type: 'Point', coordinates: [PLACE.lng, PLACE.lat - metersSouth / M_PER_DEG_LAT] } };
}
function fakeHttp(data: unknown[]) {
  const urls: string[] = [];
  const http: PoliteFetcher = {
    async getBytes() { throw new Error('not used'); },
    async getText() { throw new Error('not used'); },
    async getJson<T>(url: string): Promise<T> { urls.push(url); return { data } as T; },
  };
  return { http, urls };
}

test('bearingDegrees: north is 0, east is about 90', () => {
  assert.ok(Math.abs(bearingDegrees({ lat: 42, lng: -71 }, { lat: 42.001, lng: -71 })) < 0.01);
  assert.ok(Math.abs(bearingDegrees({ lat: 42, lng: -71 }, { lat: 42, lng: -70.999 }) - 90) < 0.1);
  const west = bearingDegrees({ lat: 42, lng: -71 }, { lat: 42, lng: -71.001 });
  assert.ok(west >= 0 && west < 360 && Math.abs(west - 270) < 0.1);
});

test('angleDiff wraps around 360', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(0, 180), 180);
});

test('a farther image facing the place beats a nearer one facing away', async () => {
  const { http, urls } = fakeHttp([img('near-away', 5, 180), img('facing', 10, 0)]);
  const p = await facingPhoto(PLACE, 'TOKEN', http);
  assert.deepEqual(p, {
    kind: 'licensed', source: 'mapillary', matchMethod: 'nearest_facing', url: null, mapillaryId: 'facing',
    pageUrl: 'https://www.mapillary.com/app/?pKey=facing', license: 'CC BY-SA 4.0', credit: 'Mapillary contributors',
  });
  const u = new URL(urls[0]!);
  assert.equal(u.origin + u.pathname, 'https://graph.mapillary.com/images');
  assert.equal(u.searchParams.get('access_token'), 'TOKEN');
  assert.equal(u.searchParams.get('fields'), 'id,computed_compass_angle,computed_geometry');
});

test('a facing image within 45° is accepted, at 60° it is not', async () => {
  assert.equal((await facingPhoto(PLACE, 'T', fakeHttp([img('a', 10, 40)]).http))?.mapillaryId, 'a');
  assert.equal(await facingPhoto(PLACE, 'T', fakeHttp([img('b', 10, 60)]).http), null);
});

test('nothing within 30 m returns null', async () => {
  assert.equal(await facingPhoto(PLACE, 'T', fakeHttp([img('far', 40, 0)]).http), null);
});

test('images without a compass angle are skipped', async () => {
  const noAngle = { id: 'x', computed_geometry: { type: 'Point', coordinates: [PLACE.lng, PLACE.lat - 10 / M_PER_DEG_LAT] } };
  assert.equal(await facingPhoto(PLACE, 'T', fakeHttp([noAngle]).http), null);
});
