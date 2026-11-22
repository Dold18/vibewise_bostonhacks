import { metersBetween } from '../geo.ts';
import type { PoliteFetcher } from './http.ts';
import type { EnrichPlace, PhotoCandidate } from './types.ts';

const GRAPH_IMAGES = 'https://graph.mapillary.com/images';
const BBOX_DEG = 0.0003;
const MAX_METERS = 30;
const MAX_ANGLE = 45;

type Point = { lat: number; lng: number };

export function bearingDegrees(from: Point, to: Point): number {
  const rad = Math.PI / 180;
  const φ1 = from.lat * rad;
  const φ2 = to.lat * rad;
  const Δλ = (to.lng - from.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

interface MapillaryImage { id: string; computed_compass_angle?: number; computed_geometry?: { coordinates?: [number, number] } }

export async function facingPhoto(place: EnrichPlace, token: string, http: PoliteFetcher): Promise<PhotoCandidate | null> {
  const bbox = [place.lng - BBOX_DEG, place.lat - BBOX_DEG, place.lng + BBOX_DEG, place.lat + BBOX_DEG].join(',');
  const url = `${GRAPH_IMAGES}?${new URLSearchParams({
    access_token: token, fields: 'id,computed_compass_angle,computed_geometry', bbox, limit: '100',
  })}`;
  const res = await http.getJson<{ data?: MapillaryImage[] }>(url);
  let best: { id: string; d: number } | null = null;
  for (const im of res.data ?? []) {
    const c = im.computed_geometry?.coordinates;
    if (!c || typeof im.computed_compass_angle !== 'number') continue;
    const at = { lat: c[1], lng: c[0] };
    const d = metersBetween(at, place);
    if (d > MAX_METERS) continue;
    if (angleDiff(im.computed_compass_angle, bearingDegrees(at, place)) > MAX_ANGLE) continue;
    if (!best || d < best.d) best = { id: im.id, d };
  }
  if (!best) return null;
  return {
    kind: 'licensed', source: 'mapillary', matchMethod: 'nearest_facing', url: null, mapillaryId: best.id,
    pageUrl: `https://www.mapillary.com/app/?pKey=${best.id}`, license: 'CC BY-SA 4.0', credit: 'Mapillary contributors',
  };
}
