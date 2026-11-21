// Client side of the transit route feature. Talks to the server ONLY via fetch('/api/transit/route');
// it must never import from ./features/transit (that module is server-side, see server/index.ts).
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';

export type LatLng = { lat: number; lng: number };

// Minimal local mirror of the response shapes we use (CONTRACTS.md TransitLeg/TransitOption + the
// status wrappers from the server). Unknown extra fields are ignored.
interface Leg {
  mode: string;
  durationSec: number;
  geometry: [number, number][]; // [lng, lat]
  routeShortName?: string;
  routeColor?: string;
  fromStopName?: string;
  toStopName?: string;
}
interface LastTrainBack {
  fromStopName: string;
  toStopName: string;
  departsAt: string;
  catchable: boolean;
}
export type RouteResponse =
  | { status: 'ok'; option: { durationSec: number; transfers: number; legs: Leg[] }; lastTrainBack: LastTrainBack | null; lastTrainBackNote?: string }
  | { status: 'no_tier1_route'; reason?: string }
  | { status: 'no_service'; message: string; nextScheduledDepartureAt?: string }
  | { status: 'error'; message: string };

export type RouteState =
  | { kind: 'origin_required' }
  | { kind: 'loading' }
  | { kind: 'result'; result: RouteResponse }
  | { kind: 'error'; message: string };

export async function fetchRoute(origin: LatLng, destination: LatLng, signal: AbortSignal): Promise<RouteState> {
  try {
    const res = await fetch('/api/transit/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destination }),
      signal,
    });
    const body = (await res.json().catch(() => null)) as RouteResponse | null;
    if (!body || typeof body.status !== 'string') {
      return { kind: 'error', message: `Route service returned an unexpected response (HTTP ${res.status}).` };
    }
    return { kind: 'result', result: body };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { kind: 'error', message: "Couldn't reach the route service." };
  }
}

const boston = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

const NO_ROUTE_TEXT: Record<string, string> = {
  same_stop: 'The nearest stations to you and this place are the same one, so there is no train ride to take.',
  no_shared_pattern: 'No MBTA subway route connects the stations nearest you and this place.',
  no_pattern_in_travel_direction: 'No subway line runs from the station nearest you to the one nearest this place.',
  no_candidate_hub: 'No single-transfer subway route connects these stations.',
  no_valid_hub: 'No single-transfer subway route connects these stations.',
};

/** Fill `box` with the state's message. Drawing is separate (drawRoute) and only happens for `ok`. */
export function renderRouteState(box: HTMLElement, state: RouteState, retry: () => void) {
  box.replaceChildren();
  box.dataset.state = state.kind === 'result' ? state.result.status : state.kind;
  const line = (text: string, cls = 'route-line') => {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = text;
    box.append(p);
  };
  const title = (text: string) => line(text, 'route-title');

  if (state.kind === 'origin_required') {
    title('Getting there');
    line('Pick a starting point in the left panel to see the transit route.');
  } else if (state.kind === 'loading') {
    title('Getting there');
    line('Finding a route…');
  } else if (state.kind === 'error') {
    title("Couldn't get a route");
    line(state.message);
    addRetry(box, retry);
  } else {
    const r = state.result;
    if (r.status === 'ok') {
      const mins = Math.max(1, Math.round(r.option.durationSec / 60));
      const t = r.option.transfers;
      title(`About ${mins} min · ${t === 0 ? 'no transfers' : `${t} transfer${t === 1 ? '' : 's'}`}`);
      line('Walk and ride time; excludes waiting for the train. Walks are straight-line estimates.', 'route-note');
      const ul = document.createElement('ul');
      ul.className = 'route-legs';
      for (const leg of r.option.legs) {
        const li = document.createElement('li');
        const m = Math.max(1, Math.round(leg.durationSec / 60));
        const what =
          leg.mode === 'walk'
            ? `Walk to ${leg.toStopName ?? 'destination'}`
            : `${leg.routeShortName ?? leg.mode}: ${leg.fromStopName ?? ''} → ${leg.toStopName ?? ''}`;
        li.textContent = `${what} · ${m} min`;
        li.style.setProperty('--leg-color', leg.mode === 'walk' ? '#6b7280' : (leg.routeColor ?? '#1a73e8'));
        li.className = leg.mode === 'walk' ? 'leg-walk' : 'leg-transit';
        ul.append(li);
      }
      box.append(ul);
      if (r.lastTrainBack) {
        const l = r.lastTrainBack;
        line(
          `Last scheduled train back from ${l.fromStopName} toward ${l.toStopName}: ${boston(l.departsAt)}` +
            (l.catchable ? '' : ' (leaves before you would arrive)'),
        );
      } else {
        line(`Last train back: ${r.lastTrainBackNote ?? 'unavailable'}.`, 'route-note');
      }
    } else if (r.status === 'no_tier1_route') {
      title('No subway route found');
      line((r.reason && NO_ROUTE_TEXT[r.reason]) || 'No MBTA subway route connects these places.');
    } else if (r.status === 'no_service') {
      title('No trains running right now');
      line(r.message);
      if (r.nextScheduledDepartureAt) line(`Next scheduled departure: ${boston(r.nextScheduledDepartureAt)}.`);
    } else {
      title("Couldn't get a route");
      line(r.message);
      addRetry(box, retry);
    }
  }
}

function addRetry(box: HTMLElement, retry: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'action-btn route-retry';
  b.textContent = 'Try again';
  b.addEventListener('click', retry);
  box.append(b);
}

// ---- Map overlay ----------------------------------------------------------

const SRC = 'transit-route';
const CASING = 'transit-route-casing';
const WALK = 'transit-route-walk';
const RIDE = 'transit-route-ride';
const EMPTY = { type: 'FeatureCollection', features: [] } as const;

function ensureLayers(map: MapLibreMap): GeoJSONSource {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: EMPTY });
    // A white outline under every leg keeps the route visible on any map
    // theme, including the dark late-night palette (src/features/vibeTheme).
    map.addLayer({
      id: CASING,
      type: 'line',
      source: SRC,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: RIDE,
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'mode'], 'transit'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: WALK,
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'mode'], 'walk'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#374151', 'line-width': 4, 'line-dasharray': [1, 1.5] },
    });
  }
  return map.getSource(SRC) as GeoJSONSource;
}

export function clearRoute(map: MapLibreMap) {
  (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(EMPTY);
}

/** Draw only what the server returned (each leg's own geometry). Walk = dashed gray, transit = line color. */
export function drawRoute(map: MapLibreMap, legs: Leg[]) {
  const features = legs
    .filter((l) => Array.isArray(l.geometry) && l.geometry.length >= 2)
    .map((l) => ({
      type: 'Feature' as const,
      properties: { mode: l.mode === 'walk' ? 'walk' : 'transit', color: l.routeColor ?? '#1a73e8' },
      geometry: { type: 'LineString' as const, coordinates: l.geometry },
    }));
  ensureLayers(map).setData({ type: 'FeatureCollection', features });
}
