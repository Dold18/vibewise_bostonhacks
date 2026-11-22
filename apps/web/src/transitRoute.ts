// Client side of the transit route feature. Talks to the server ONLY via fetch('/api/transit/route');
// it must never import from ./features/transit (that module is server-side, see server/index.ts).
//
// Two parts:
// - fetchRoute(): the request, with cancellation and a checked response shape.
// - The map overlay: route lines in their real MBTA colours with a soft neon glow, boarding /
//   transfer / exit stations, verified pedestrian paths, and clearly labeled
//   diagrammatic walking estimates (never presented as street directions).
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

export type LatLng = { lat: number; lng: number };

// Minimal local mirror of the response shapes we use (CONTRACTS.md TransitLeg/TransitOption + the
// status wrappers from the server). Unknown extra fields are ignored.
export interface RouteLeg {
  mode: string;
  durationSec: number;
  distanceMeters?: number;
  geometry: [number, number][]; // [lng, lat]
  /** Actual station/end point fields already supplied by the API. */
  start?: LatLng & { stop_id?: string };
  end?: LatLng & { stop_id?: string };
  routeShortName?: string;
  routeColor?: string;
  fromStopName?: string;
  toStopName?: string;
  instructions?: string;
  /** Provenance, e.g. "approx: straight-line walk, ~80 m/min" or "MBTA GTFS static shape …". */
  source?: string;
}
/** Schedule-derived timing of one ride (never a live prediction). */
export interface RideTiming {
  kind: 'scheduled';
  departsAt: string;
  arrivesAt: string;
  rideSeconds: number;
}
export interface LastTrainBack {
  fromStopName: string;
  toStopName: string;
  departsAt: string;
  catchable: boolean;
}
export interface RouteOk {
  status: 'ok';
  tier?: 1 | 2;
  option: { durationSec: number; transfers: number; legs: RouteLeg[] };
  /** Tier 1: the single ride. */
  timing?: RideTiming;
  /** Tier 2: both rides. */
  timings?: [RideTiming, RideTiming];
  /** Tier 2: scheduled wait at the transfer station (included in durationSec). */
  transferWaitSeconds?: number;
  lastTrainBack: LastTrainBack | null;
  lastTrainBackNote?: string;
}
export type RouteResponse =
  | RouteOk
  | { status: 'no_tier1_route'; reason?: string }
  | { status: 'no_service'; message: string; nextScheduledDepartureAt?: string }
  | { status: 'error'; message: string };

export type FetchRouteResult =
  | { kind: 'result'; result: RouteResponse }
  | { kind: 'error'; reason: 'unreachable' | 'invalid_response'; message: string };

const finiteNonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const validCoordinate = (p: unknown) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const validDate = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function validTiming(t: unknown) { return isObj(t) && t.kind === 'scheduled' && validDate(t.departsAt) && validDate(t.arrivesAt) && finiteNonnegative(t.rideSeconds); }

/** True only for a response we can safely render (an `ok` must carry legs with geometry arrays). */
export function isRouteResponse(body: unknown): body is RouteResponse {
  if (!isObj(body) || typeof body.status !== 'string') return false;
  switch (body.status) {
    case 'ok': {
      const o = body.option;
      return (
        isObj(o) &&
        finiteNonnegative(o.durationSec) &&
        finiteNonnegative(o.transfers) && Number.isInteger(o.transfers) &&
        Array.isArray(o.legs) &&
        o.legs.length > 0 &&
        o.legs.every((l) => isObj(l) && typeof l.mode === 'string' && finiteNonnegative(l.durationSec) && Array.isArray(l.geometry) && l.geometry.length >= 2 && l.geometry.every(validCoordinate) && ['routeShortName', 'routeColor', 'fromStopName', 'toStopName', 'source'].every(k => l[k] === undefined || typeof l[k] === 'string')) &&
        (body.timing === undefined || validTiming(body.timing)) &&
        (body.timings === undefined || (Array.isArray(body.timings) && body.timings.length === 2 && body.timings.every(validTiming))) &&
        (body.lastTrainBack == null || (isObj(body.lastTrainBack) && typeof body.lastTrainBack.fromStopName === 'string' && typeof body.lastTrainBack.toStopName === 'string' && validDate(body.lastTrainBack.departsAt) && typeof body.lastTrainBack.catchable === 'boolean'))
      );
    }
    case 'no_tier1_route':
      return true;
    case 'no_service':
      return typeof body.message === 'string' && (body.nextScheduledDepartureAt === undefined || validDate(body.nextScheduledDepartureAt));
    case 'error':
      return typeof body.message === 'string';
    default:
      return false;
  }
}

/** POST the two points to the server. Throws only AbortError (the caller cancelled). */
export async function fetchRoute(
  origin: LatLng,
  destination: LatLng,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchRouteResult> {
  let res: Response;
  try {
    res = await fetchImpl('/api/transit/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destination }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { kind: 'error', reason: 'unreachable', message: "Couldn't reach the route service. Is the transit API running?" };
  }
  const body: unknown = await res.json().catch(() => null);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!isRouteResponse(body)) {
    return { kind: 'error', reason: 'invalid_response', message: `The route service returned an unexpected response (HTTP ${res.status}).` };
  }
  return { kind: 'result', result: body };
}

export const NO_ROUTE_TEXT: Record<string, string> = {
  same_stop: 'The nearest stations to the start and the destination are the same one, so there is no train ride to take.',
  no_shared_pattern: 'No MBTA subway route connects the stations nearest these two points.',
  no_pattern_in_travel_direction: 'No subway line runs from the station nearest the start to the one nearest the destination.',
  no_candidate_hub: 'No single-transfer subway route connects these stations.',
  no_valid_hub: 'No single-transfer subway route connects these stations.',
};

// ---- Line colours -----------------------------------------------------------

/**
 * Official MBTA subway colours (GTFS route_color), used only when a leg carries
 * no colour of its own. The leg's own `routeColor` always wins.
 */
export const MBTA_LINE_COLORS: Record<string, string> = {
  Red: '#DA291C',
  Mattapan: '#DA291C',
  Orange: '#ED8B00',
  Blue: '#003DA5',
  Green: '#00843D',
  B: '#00843D',
  C: '#00843D',
  D: '#00843D',
  E: '#00843D',
};
/** Unknown line: neutral gray, never a guessed MBTA colour. */
export const UNKNOWN_LINE_COLOR = '#9AA0A6';

const HEX = /^#?[0-9a-f]{6}$/i;

export function lineColor(leg: Pick<RouteLeg, 'routeColor' | 'routeShortName'>): { color: string; known: boolean } {
  if (leg.routeColor && HEX.test(leg.routeColor)) {
    const hex = leg.routeColor.toUpperCase();
    return { color: hex.startsWith('#') ? hex : `#${hex}`, known: true };
  }
  const ref = leg.routeShortName ? MBTA_LINE_COLORS[leg.routeShortName] : undefined;
  return ref ? { color: ref, known: true } : { color: UNKNOWN_LINE_COLOR, known: false };
}

/** "Red Line", "Green Line B", or the short name for anything else. */
export function lineName(leg: Pick<RouteLeg, 'routeShortName' | 'mode'>): string {
  const n = leg.routeShortName;
  if (!n) return leg.mode === 'subway' ? 'Subway' : leg.mode;
  if (['Red', 'Orange', 'Blue', 'Green', 'Mattapan'].includes(n)) return `${n} Line`;
  if (/^[BCDE]$/.test(n)) return `Green Line ${n}`;
  return n;
}

// ---- Walking provenance -----------------------------------------------------

/**
 * Walking geometry is drawn only when its source says it's a real pedestrian
 * path. Proposed convention for the transit workstream: a walk leg whose
 * `source` starts with "pedestrian-route:" carries routed street/sidewalk
 * geometry. Everything else (today: "approx: straight-line walk …") is an
 * estimate; a known straight-line estimate may be shown as a labeled diagrammatic
 * connector, never as pedestrian geometry.
 */
export const VERIFIED_WALK_SOURCE = /^pedestrian-route:/i;

export function isVerifiedWalkGeometry(leg: RouteLeg): boolean {
  return leg.mode === 'walk' && !!leg.source && VERIFIED_WALK_SOURCE.test(leg.source) && leg.geometry.length >= 2;
}

/** Diagrammatic arc between known endpoints, never a street or sidewalk route. */
export function estimatedWalkArc(leg: RouteLeg): [number, number][] | null {
  if (leg.mode !== 'walk' || !/^approx: straight-line walk/i.test(leg.source ?? '') || leg.geometry.length < 2) return null;
  const a = leg.geometry[0], b = leg.geometry[leg.geometry.length - 1];
  const latMeters = 111320, lngMeters = latMeters * Math.cos((a[1] + b[1]) * Math.PI / 360);
  if (Math.abs(lngMeters) < 1) return null;
  const dx = (b[0] - a[0]) * lngMeters, dy = (b[1] - a[1]) * latMeters;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const bend = Math.min(45, length * .2);
  const cx = dx / 2 - dy / length * bend * 2, cy = dy / 2 + dx / length * bend * 2;
  return Array.from({ length: 21 }, (_, i): [number, number] => {
    const t = i / 20, k = 2 * (1 - t) * t;
    return [a[0] + (k * cx + t * t * dx) / lngMeters, a[1] + (k * cy + t * t * dy) / latMeters];
  });
}

const isRide = (leg: RouteLeg) => leg.mode !== 'walk';

// ---- Stations ----------------------------------------------------------------

export type StationRole = 'board' | 'transfer' | 'exit';
export interface RouteStation {
  role: StationRole;
  id?: string;
  name: string;
  lng: number;
  lat: number;
  /** Colour of the line boarded (or, for the exit, the line left). */
  color: string;
}

/** Boarding, transfer and exit stations, from the ride legs' own geometry and stop names. */
export function routeStations(legs: RouteLeg[]): RouteStation[] {
  const rides = legs.filter(l => isRide(l) && Array.isArray(l.geometry) && l.geometry.length >= 2);
  const out: RouteStation[] = [];
  const point = (leg: RouteLeg, at: 'start' | 'end') => {
    const p = leg[at];
    if (p && Number.isFinite(p.lng) && Number.isFinite(p.lat)) return { lng: p.lng, lat: p.lat, id: p.stop_id };
    const [lng, lat] = leg.geometry[at === 'start' ? 0 : leg.geometry.length - 1];
    return { lng, lat };
  };
  function add(station: RouteStation) {
    const previous = out.find(s => (s.id && s.id === station.id) ||
      (Math.abs(s.lng - station.lng) < .00002 && Math.abs(s.lat - station.lat) < .00002));
    if (previous) {
      if (station.role === 'transfer') { previous.role = station.role; previous.color = station.color; }
      return;
    }
    out.push(station);
  }
  rides.forEach((leg, i) => {
    const color = lineColor(leg).color;
    add({ role: i === 0 ? 'board' : 'transfer', name: leg.fromStopName ?? '', ...point(leg, 'start'), color });
    add({ role: i === rides.length - 1 ? 'exit' : 'transfer', name: leg.toStopName ?? '', ...point(leg, 'end'), color });
  });
  return out;
}

// ---- GeoJSON for the overlay ------------------------------------------------

export interface RouteLineFeature {
  type: 'Feature';
  properties: { kind: 'ride' | 'walk' | 'walk_estimate'; color: string; order: number; label?: string; provenance?: string };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}
export interface RouteStationFeature {
  type: 'Feature';
  properties: { role: StationRole; name: string; color: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

/** Real paths retain geometry; known walking estimates use labeled diagrammatic arcs. */
export function routeLineFeatures(legs: RouteLeg[]): { type: 'FeatureCollection'; features: RouteLineFeature[] } {
  const features: RouteLineFeature[] = [];
  legs.forEach((leg, order) => {
    if (!Array.isArray(leg.geometry) || leg.geometry.length < 2) return;
    if (leg.mode === 'walk') {
      if (!isVerifiedWalkGeometry(leg)) {
        const arc = estimatedWalkArc(leg);
        if (arc) features.push({ type: 'Feature', properties: { kind: 'walk_estimate', color: '#315B7E', order, label: 'Walk · estimate', provenance: leg.source }, geometry: { type: 'LineString', coordinates: arc } });
        return; // Unknown provenance is still omitted; straight-line estimates become labeled diagrams only.
      }
      features.push({ type: 'Feature', properties: { kind: 'walk', color: '#17212E', order }, geometry: { type: 'LineString', coordinates: leg.geometry } });
      return;
    }
    features.push({ type: 'Feature', properties: { kind: 'ride', color: lineColor(leg).color, order }, geometry: { type: 'LineString', coordinates: leg.geometry } });
  });
  return { type: 'FeatureCollection', features };
}

export function routeStationFeatures(legs: RouteLeg[]): { type: 'FeatureCollection'; features: RouteStationFeature[] } {
  return {
    type: 'FeatureCollection',
    features: routeStations(legs).map((s) => ({
      type: 'Feature',
      properties: { role: s.role, name: s.name, color: s.color },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  };
}

/** [[west, south], [east, north]] around everything drawn, plus extra points (start, destination). */
export function routeBounds(legs: RouteLeg[], extra: LatLng[] = []): [[number, number], [number, number]] | null {
  const pts: [number, number][] = [];
  for (const f of routeLineFeatures(legs).features) pts.push(...f.geometry.coordinates);
  for (const s of routeStations(legs)) pts.push([s.lng, s.lat]);
  for (const p of extra) pts.push([p.lng, p.lat]);
  if (pts.length === 0) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lng, lat] of pts) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [[w, s], [e, n]];
}

// ---- Map overlay ------------------------------------------------------------

const LINE_SRC = 'transit-route';
const STATION_SRC = 'transit-route-stations';
export const ROUTE_LAYERS = {
  casing: 'transit-route-casing',
  rideGlow: 'transit-route-ride-glow',
  ride: 'transit-route-ride',
  rideHighlight: 'transit-route-ride-highlight',
  walkGlow: 'transit-route-walk-glow',
  walkCasing: 'transit-route-walk-casing',
  walk: 'transit-route-walk',
  estimatedWalkCasing: 'transit-route-walk-estimate-casing',
  estimatedWalk: 'transit-route-walk-estimate',
  estimatedWalkLabels: 'transit-route-walk-estimate-labels',
  stations: 'transit-route-station-dots',
} as const;
const EMPTY = { type: 'FeatureCollection', features: [] } as const;

/** The basemap's first label layer: route lines go just beneath it so street names stay readable. */
function firstSymbolLayer(map: MapLibreMap): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === 'symbol' && !l.id.startsWith('transit-route') && !l.id.startsWith('vb-'))?.id;
}

function ensureLayers(map: MapLibreMap): { lines: GeoJSONSource; stations: GeoJSONSource } {
  if (!map.getSource(LINE_SRC)) {
    map.addSource(LINE_SRC, { type: 'geojson', data: EMPTY });
    map.addSource(STATION_SRC, { type: 'geojson', data: EMPTY });
    const before = firstSymbolLayer(map);
    const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
    // Main's contrast casing is retained beneath the refined route layers.
    // It uses only rendered features, so no unverified straight walk is exposed.
    map.addLayer({
      id: ROUTE_LAYERS.casing, type: 'line', source: LINE_SRC,
      layout: round,
      paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
    }, before);
    // The halo and thin luminous center add neon contrast without changing MBTA line identity.
    map.addLayer({
      id: ROUTE_LAYERS.rideGlow, type: 'line', source: LINE_SRC,
      filter: ['==', ['get', 'kind'], 'ride'], layout: round,
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-blur': 6,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 18, 16, 26] },
    }, before);
    map.addLayer(
      {
        id: ROUTE_LAYERS.ride,
        type: 'line',
        source: LINE_SRC,
        filter: ['==', ['get', 'kind'], 'ride'],
        layout: round,
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 7.5] },
      },
      before,
    );
    map.addLayer({
      id: ROUTE_LAYERS.rideHighlight, type: 'line', source: LINE_SRC,
      filter: ['==', ['get', 'kind'], 'ride'], layout: round,
      paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 1.8] },
    }, before);
    map.addLayer({
      id: ROUTE_LAYERS.walkGlow, type: 'line', source: LINE_SRC,
      filter: ['match', ['get', 'kind'], ['walk', 'walk_estimate'], true, false], layout: round,
      paint: { 'line-color': '#73C7FF', 'line-opacity': .5, 'line-width': 13, 'line-blur': 4 },
    }, before);
    map.addLayer(
      {
        id: ROUTE_LAYERS.walkCasing,
        type: 'line',
        source: LINE_SRC,
        filter: ['==', ['get', 'kind'], 'walk'],
        layout: round,
        paint: { 'line-color': '#F7FAFC', 'line-opacity': 0.95, 'line-width': 8 },
      },
      before,
    );
    map.addLayer(
      {
        id: ROUTE_LAYERS.walk,
        type: 'line',
        source: LINE_SRC,
        filter: ['==', ['get', 'kind'], 'walk'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#17212E', 'line-width': 4.5, 'line-dasharray': [1.6, 1.4] },
      },
      before,
    );
    map.addLayer({
      id: ROUTE_LAYERS.estimatedWalkCasing, type: 'line', source: LINE_SRC,
      filter: ['==', ['get', 'kind'], 'walk_estimate'], layout: round,
      paint: { 'line-color': '#E5F0FF', 'line-opacity': .8, 'line-width': 7, 'line-blur': .5 },
    }, before);
    map.addLayer({
      id: ROUTE_LAYERS.estimatedWalk, type: 'line', source: LINE_SRC,
      filter: ['==', ['get', 'kind'], 'walk_estimate'], layout: round,
      paint: { 'line-color': '#315B7E', 'line-width': 4, 'line-dasharray': [.8, 1.6] },
    }, before);
    map.addLayer({
      id: ROUTE_LAYERS.estimatedWalkLabels, type: 'symbol', source: LINE_SRC,
      filter: ['==', ['get', 'kind'], 'walk_estimate'],
      layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1] },
      paint: { 'text-color': '#EAF4FF' },
    });
    // Stations sit above everything (including labels) so they stay readable.
    map.addLayer({
      id: ROUTE_LAYERS.stations,
      type: 'circle',
      source: STATION_SRC,
      paint: {
        'circle-color': '#FFFFFF',
        'circle-radius': ['match', ['get', 'role'], 'transfer', 7.5, 6.5],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': ['match', ['get', 'role'], 'transfer', 4, 3.5],
      },
    });

  }
  return { lines: map.getSource(LINE_SRC) as GeoJSONSource, stations: map.getSource(STATION_SRC) as GeoJSONSource };
}

export function clearRoute(map: MapLibreMap) {
  (map.getSource(LINE_SRC) as GeoJSONSource | undefined)?.setData(EMPTY);
  (map.getSource(STATION_SRC) as GeoJSONSource | undefined)?.setData(EMPTY);
}

/** Draw only what the server returned (each leg's own geometry). Replaces any earlier route. */
export function drawRoute(map: MapLibreMap, legs: RouteLeg[]) {
  const { lines, stations } = ensureLayers(map);
  lines.setData(routeLineFeatures(legs));
  stations.setData(routeStationFeatures(legs));
}
