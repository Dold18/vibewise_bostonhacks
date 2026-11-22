import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { metersBetween } from '../geo.ts';
import type { EnrichPlace } from './types.ts';

export type Tier = 1 | 2 | 3;
type Point = { lat: number; lng: number };
export interface PriorityContext { demo: Set<string>; stops: Point[]; campuses: Point[] }

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const LOCATIONS_FILE = path.join(REPO_ROOT, 'apps/web/src/discovery/data/bostonLocations.generated.ts');
const STOPS_FILE = path.join(REPO_ROOT, 'apps/web/src/features/transit/data/stops.json');
const STOP_METERS = 800;
const CAMPUS_METERS = 1500;

export async function loadDemoIds(file: string): Promise<Set<string>> {
  let text: string;
  try { text = await fs.readFile(file, 'utf8'); } catch { return new Set(); }
  return new Set(text.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
}

export async function loadCampuses(): Promise<Point[]> {
  // Imported by URL so the pipeline's typecheck doesn't pull in the web app's sources.
  const mod = (await import(pathToFileURL(LOCATIONS_FILE).href)) as {
    BOSTON_LOCATIONS: ReadonlyArray<{ kind: string; location: Point }>;
  };
  return mod.BOSTON_LOCATIONS.filter((l) => l.kind === 'university').map((l) => ({ lat: l.location.lat, lng: l.location.lng }));
}

export async function loadStops(): Promise<Point[]> {
  const stops = JSON.parse(await fs.readFile(STOPS_FILE, 'utf8')) as Array<{ lat: number; lng: number }>;
  return stops.map((s) => ({ lat: s.lat, lng: s.lng }));
}

const within = (p: Point, points: Point[], meters: number) => points.some((q) => metersBetween(p, q) <= meters);

export function tierOf(place: EnrichPlace, ctx: PriorityContext): Tier {
  if (ctx.demo.has(place.placeId)) return 1;
  if (within(place, ctx.stops, STOP_METERS) && within(place, ctx.campuses, CAMPUS_METERS)) return 2;
  return 3;
}
