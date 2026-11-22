export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

export function toEwkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/** Reads `toEwkt`'s 'SRID=4326;POINT(lng lat)' (SRID optional); null for anything else. */
export function parseEwktPoint(ewkt: string): { lat: number; lng: number } | null {
  const m = /^(?:SRID=\d+;)?POINT\(\s*(\S+)\s+(\S+)\s*\)$/i.exec(ewkt.trim());
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Decodes the hex EWKB PostgREST returns for a geography/geometry Point column (copied from
 * apps/web/src/catalog.ts `parsePoint`). Null for anything but a finite, non-(0,0) point.
 */
export function parseEwkbPoint(hex: string): { lat: number; lng: number } | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 42) return null;
  const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  const view = new DataView(bytes.buffer);
  const little = view.getUint8(0) === 1;
  const type = view.getUint32(1, little);
  if ((type & 0xff) !== 1) return null; // not a Point
  const offset = type & 0x20000000 ? 9 : 5; // skip the SRID when present
  if (bytes.length < offset + 16) return null;
  const lng = view.getFloat64(offset, little);
  const lat = view.getFloat64(offset + 8, little);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}
