import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEwkbPoint, parseEwktPoint } from '../src/geo.ts';

// SRID=4326;POINT(-71.06 42.35) as PostgREST returns a geography: little-endian EWKB with the SRID flag.
function ewkbHex(lng: number, lat: number, little = true): string {
  const buf = new DataView(new ArrayBuffer(25));
  buf.setUint8(0, little ? 1 : 0);
  buf.setUint32(1, 0x20000001, little);
  buf.setUint32(5, 4326, little);
  buf.setFloat64(9, lng, little);
  buf.setFloat64(17, lat, little);
  return [...new Uint8Array(buf.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('parseEwkbPoint decodes a point with an SRID, either byte order', () => {
  assert.deepEqual(parseEwkbPoint(ewkbHex(-71.06, 42.35)), { lat: 42.35, lng: -71.06 });
  assert.deepEqual(parseEwkbPoint(ewkbHex(-71.06, 42.35, false)), { lat: 42.35, lng: -71.06 });
});

test('parseEwkbPoint rejects non-hex, non-points and the 0,0 point', () => {
  assert.equal(parseEwkbPoint('not hex'), null);
  assert.equal(parseEwkbPoint(ewkbHex(-71.06, 42.35).replace(/^0101/, '0102')), null); // LineString type
  assert.equal(parseEwkbPoint(ewkbHex(0, 0)), null);
});

test('parseEwktPoint reads the rows location string', () => {
  assert.deepEqual(parseEwktPoint('SRID=4326;POINT(-71.06 42.35)'), { lat: 42.35, lng: -71.06 });
  assert.equal(parseEwktPoint('POINT EMPTY'), null);
});
