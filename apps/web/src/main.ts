import { AttributionControl, Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { BUILDING_3D_LAYER, BUILDING_3D_OPACITY, mapStyle } from './mapStyle';
import {
  CATEGORIES,
  placesFromTiles,
  placesNearAny,
  searchPlaces,
  type Category,
  type Place,
  type TilePoi,
} from './osm';
import {
  bostonCommon,
  combineProviders,
  createBostonSuggestionProvider,
  createPlaceListProvider,
  createSavedStore,
  mountDiscoveryPanel,
  savedToPlace,
  type MapLayerSelection,
  type PlaceSearchProvider,
} from './discovery';
import { createOriginMarker, mapLibreOriginDeps, recenterTarget, shouldRevealOrigin } from './features/map/originMarker';
import { createPlacePopup, POPUP_PIN_GAP } from './features/map/placePopup';
import { pinTarget, popupRevealShift } from './features/map/popupPlacement';
import { realPlaceId, type RouteEndpoint } from './features/navigation/routing';
import { createRoutePlanner } from './features/navigation/ui/routePlannerView';

const BOSTON = { lng: -71.0636, lat: 42.3555 }; // Boston Common
const TILTED = { pitch: 60, bearing: -20 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Served untouched by the `maplibre-worker` plugin in vite.config.ts.
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`);

const map = new MapLibreMap({
  container: 'map',
  style: mapStyle,
  center: BOSTON,
  zoom: 16,
  ...TILTED,
  maxPitch: 75,
  attributionControl: false,
});
map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
map.on('error', (e) => console.error('[map]', e.error?.message ?? e));
if (import.meta.env.DEV) Object.assign(window, { map }); // handy for poking at it from devtools

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  search: '#ea4335',
  restaurants: '#f2711c',
  coffee: '#a5673f',
  bars: '#c2185b',
  parks: '#1e8e3e',
  museums: '#1a73e8',
};

const PIN_PATH = 'M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 40 14 40s14-15.7 14-26.1C28 6.2 21.7 0 14 0z';

let markers: Marker[] = [];
let shadows: Marker[] = [];
let selectedPin: HTMLElement | null = null;

/*
 * MapLibre positions every marker by rewriting its element's inline
 * `transform` each frame. So the marker elements below carry no transform,
 * transition or position styling of their own; all visuals and animation
 * live on inner elements. (A transition on the marker itself makes it lag
 * behind the map, which detached pins from their shadows.)
 */

/**
 * A pin's ground shadow, laid flat on the map by MapLibre: a soft contact spot
 * under the tip plus the pin's silhouette cast away from the scene light.
 * Fades in with camera pitch (see syncDepth).
 */
function shadowElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pin-shadow';
  el.innerHTML = `<svg class="pin-shadow-cast" viewBox="0 0 28 40" aria-hidden="true"><path d="${PIN_PATH}" /></svg>
    <span class="pin-shadow-contact"></span>`;
  return el;
}

/**
 * How one pin looks. Today every pin in a result set shares a look; the plan
 * is for each place's match score to drive both (better match = stronger
 * color, bigger pin). `scale` 1 is the default 28×40px pin; its shadow
 * scales with it.
 */
interface PinLook {
  color: string;
  scale: number;
}

function applyPinLook(pin: HTMLElement, shadow: HTMLElement, look: PinLook) {
  pin.style.setProperty('--pin-color', look.color);
  pin.style.setProperty('--pin-scale', String(look.scale));
  shadow.style.setProperty('--pin-scale', String(look.scale));
}

/** A solid teardrop pin, colored and sized entirely by --pin-color / --pin-scale. */
function pinElement(): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pin';
  const body = document.createElement('span');
  body.className = 'pin-body';
  body.innerHTML = `<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true"><path d="${PIN_PATH}" /></svg>`;
  el.append(body);
  return el;
}

/** What each shown pin looks like, for the popup and saved places (pin id → look). */
let shownPlaces: Place[] = [];
const pinLooks = new Map<string, { color: string; icon?: string }>();
const pinById = new Map<string, HTMLElement>();

/** `icon` is the popup icon: one for every place, or chosen per place (mixed categories). */
function showPlaces(places: Place[], lookFor: (place: Place) => PinLook, icon?: string | ((place: Place) => string | undefined)) {
  clearPins();
  shownPlaces = places;
  pinLooks.clear();
  pinById.clear();
  // Shadows first so every pin draws above every shadow.
  shadows = places.map((place) =>
    new Marker({ element: shadowElement(), anchor: 'bottom', pitchAlignment: 'map', rotationAlignment: 'viewport' })
      .setLngLat([place.lon, place.lat])
      .addTo(map),
  );
  markers = places.map((place, i) => {
    const look = lookFor(place);
    const el = pinElement();
    applyPinLook(el, shadows[i].getElement(), look);
    el.dataset.index = String(i);
    el.setAttribute('aria-label', place.name);
    const popupLook = { color: look.color, icon: typeof icon === 'function' ? icon(place) : icon };
    pinLooks.set(place.id, popupLook);
    pinById.set(place.id, el);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectPin(el);
      openPlace(place, popupLook);
      revealPopup(place);
    });
    return new Marker({ element: el, anchor: 'bottom' }).setLngLat([place.lon, place.lat]).addTo(map);
  });
}

/** Every pin the same: what search results and location types use until match scores exist. */
const uniformLook = (color: string) => (): PinLook => ({ color, scale: 1 });

function clearPins() {
  [...markers, ...shadows].forEach((m) => m.remove());
  markers = [];
  shadows = [];
  selectedPin = null;
}

/** Highlight a pin and its shadow together (both scale up). */
function setPinSelected(pin: HTMLElement | null, selected: boolean) {
  if (!pin) return;
  pin.classList.toggle('selected', selected);
  shadows[Number(pin.dataset.index)]?.getElement().classList.toggle('selected', selected);
}

function selectPin(el: HTMLElement) {
  setPinSelected(selectedPin, false);
  selectedPin = el;
  setPinSelected(el, true);
}

// ---------------------------------------------------------------------------
// Destination popup (anchored to the selected place)
// ---------------------------------------------------------------------------

const saved = createSavedStore();
/** Map category each shown place came from (for saving with the right pin colour). */
const pinCategory = new Map<string, string>();

const placePopup = createPlacePopup(map, {
  onNavigate: (place) => openPlanner(place),
  saved: {
    has: (id) => saved.has(id),
    toggle: (place) => saved.toggle(place, { categoryId: pinCategory.get(place.id) }),
  },
  onClose: () => {
    setPinSelected(selectedPin, false);
    selectedPin = null;
  },
});

// The popup never changes the discovery panel (no collapse/expand/move);
// instead the camera keeps the popup clear of the panel where it can.
function openPlace(place: Place, look: { color: string; icon?: string }) {
  placePopup.open(place, look);
}

function closePopup() {
  placePopup.close();
}

/** Screen rects (relative to the map) for camera placement around the discovery panel. */
function placementFrame() {
  const box = map.getContainer().getBoundingClientRect();
  const container = { left: 0, top: 0, right: box.width, bottom: box.height };
  const panelEl = discovery?.element();
  const p = panelEl?.getBoundingClientRect();
  const panel = p && p.width > 0 ? { left: p.left - box.left, top: p.top - box.top, right: p.right - box.left, bottom: p.bottom - box.top } : null;
  return { container, panel };
}

/** After a pin tap: pan only if the popup above the pin would overlap the panel or leave the map. */
function revealPopup(place: Place) {
  const size = placePopup.size();
  if (!size) return;
  const { container, panel } = placementFrame();
  const pin = map.project([place.lon, place.lat]);
  const shift = popupRevealShift(pin, size, POPUP_PIN_GAP, container, panel);
  if (!shift) return;
  // Ease the pin itself to its target point. (panBy moves the map centre by
  // pixels, which on the tilted map moves a pin lower on screen by a
  // different amount.)
  const offset: [number, number] = [pin.x + shift.x - container.right / 2, pin.y + shift.y - container.bottom / 2];
  map.easeTo({ center: [place.lon, place.lat], offset, duration: 400 });
}

/** Fly to a place (search result, saved place) so it and its open popup land clear of the panel. */
function focusPlace(place: Place) {
  const size = placePopup.size() ?? { width: 304, height: 240 };
  const { container, panel } = placementFrame();
  const target = pinTarget(size, POPUP_PIN_GAP, container, panel);
  const offset: [number, number] = [target.x - container.right / 2, target.y - container.bottom / 2];
  map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 16.5), ...TILTED, offset, essential: true });
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

const toast = $<HTMLElement>('toast');
let toastTimer: number | undefined;
function showToast(message: string, sticky = false) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  if (!sticky) toastTimer = window.setTimeout(() => (toast.hidden = true), 3500);
}
function hideToast() {
  toast.hidden = true;
}

// ---------------------------------------------------------------------------
// Search (Nominatim, submit only; the UI lives in the discovery panel)
// ---------------------------------------------------------------------------

const searchProvider: PlaceSearchProvider = {
  name: 'OpenStreetMap Nominatim',
  search: (query, signal) => searchPlaces(query, signal),
};

function showSearchResults(places: Place[]) {
  cancelCategory();
  closePopup();
  hideToast();
  showPlaces(places, uniformLook(CATEGORY_COLORS.search));
}

function openSearchResult(place: Place) {
  const pin = pinById.get(place.id);
  if (pin) selectPin(pin);
  openPlace(place, pinLooks.get(place.id) ?? { color: CATEGORY_COLORS.search });
  focusPlace(place);
}

/** Show a saved place: reuse its pin if it's on the map, otherwise add it to the current pins. */
function openSavedPlace(place: Place, categoryId?: string) {
  if (!pinById.has(place.id)) {
    const looks = new Map(pinLooks);
    const category = CATEGORIES.find((c) => c.id === categoryId);
    looks.set(place.id, { color: CATEGORY_COLORS[categoryId ?? ''] ?? CATEGORY_COLORS.search, icon: category?.icon });
    showPlaces(
      [...shownPlaces.filter((p) => p.id !== place.id), place],
      (p) => ({ color: looks.get(p.id)?.color ?? CATEGORY_COLORS.search, scale: 1 }),
      (p) => looks.get(p.id)?.icon,
    );
  }
  openSearchResult(place);
}

// ---------------------------------------------------------------------------
// Place categories (tile POIs + Overpass), chosen by the discovery panel
// ---------------------------------------------------------------------------

let categoryAbort: AbortController | undefined;

/** Stop any category lookup still in flight, so it can't overwrite newer pins (e.g. search results). */
function cancelCategory() {
  categoryAbort?.abort();
}

/**
 * Show places from several categories at once, each pin in its category's
 * color. `detail: 'tiles'` uses only what's already in the loaded map tiles
 * (no network); `'full'` then upgrades to one combined Overpass lookup.
 * A newer call aborts an older one, and every await re-checks that signal,
 * so a late response can never replace newer pins.
 */
async function showCategories(categories: Category[], detail: 'tiles' | 'full') {
  categoryAbort?.abort();
  closePopup();
  if (categories.length === 0) {
    clearPins();
    hideToast();
    return;
  }
  const abort = (categoryAbort = new AbortController());
  const label = categories.length === 1 ? categories[0].label.toLowerCase() : 'places';
  const c = map.getCenter();
  const center = { lat: c.lat, lon: c.lng };
  // Roughly the visible area around the centre; wider when zoomed out.
  const radius = Math.min(4000, Math.max(400, 1200 * 2 ** (16 - map.getZoom())));
  // Share the pin budget between categories so mixed views stay responsive.
  const perCategory = categories.length === 1 ? 60 : Math.max(20, Math.floor(100 / categories.length));

  // Which category each shown place belongs to (first match wins; dedupes by place id).
  let categoryOf = new Map<string, Category>();
  const merge = (groups: [Category, Place[]][]): Place[] => {
    categoryOf = new Map();
    const merged: Place[] = [];
    for (const [category, places] of groups) {
      for (const place of places) {
        if (categoryOf.has(place.id)) continue;
        categoryOf.set(place.id, category);
        merged.push(place);
      }
    }
    return merged;
  };
  const remember = () => {
    pinCategory.clear();
    for (const [id, cat] of categoryOf) pinCategory.set(id, cat.id);
  };
  const lookFor = (place: Place): PinLook => ({
    color: CATEGORY_COLORS[categoryOf.get(place.id)?.id ?? ''] ?? CATEGORY_COLORS.search,
    scale: 1,
  });
  const iconFor = (place: Place) => categoryOf.get(place.id)?.icon;

  // 1) Instant: OSM places already inside the loaded map tiles (name + type only).
  let quickCount = 0;
  let haveDetailed = false;
  const showQuick = () => {
    if (abort.signal.aborted || haveDetailed) return;
    const quick = merge(categories.map((cat) => [cat, placesFromTiles(tilePois(cat), center, radius, perCategory)]));
    quickCount = quick.length;
    showPlaces(quick, lookFor, iconFor);
    remember();
    if (quickCount > 0) hideToast();
  };
  showQuick();
  if (quickCount === 0) {
    if (detail === 'full') showToast(`Finding ${label} nearby…`, true);
    // Tiles may still be streaming in (e.g. right after page load); retry once they're in.
    if (!map.loaded()) map.once('idle', showQuick);
  }
  if (detail === 'tiles') return;

  // 2) Richer: one Overpass request for full OSM tags (hours, website, address...).
  try {
    const detailed = await placesNearAny(categories, center, radius, abort.signal, perCategory);
    if (abort.signal.aborted) return;
    if (detailed.length > 0) {
      haveDetailed = true;
      const byId = new Map(categories.map((cat) => [cat.id, cat]));
      showPlaces(
        merge(detailed.map(({ place, categoryId }) => [byId.get(categoryId)!, [place]])),
        lookFor,
        iconFor,
      );
      remember();
      hideToast();
    } else if (quickCount === 0) {
      showToast(`No ${label} found here. Try moving the map.`);
    }
  } catch {
    if (abort.signal.aborted) return;
    if (quickCount === 0) {
      showToast(`Couldn't find ${label} here, and the OSM details service is busy. Try again shortly.`);
    } else {
      showToast('Showing basic info. The OSM details service is busy right now.');
    }
  }
}

function tilePois(category: Category): TilePoi[] {
  const features = map.querySourceFeatures('openmaptiles', {
    sourceLayer: 'poi',
    filter: ['in', ['get', 'subclass'], ['literal', category.tileSubclasses]],
  });
  return features.flatMap((f) =>
    f.geometry.type === 'Point'
      ? [{ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], properties: f.properties }]
      : [],
  );
}

// Clicking empty map closes the popup.
map.on('click', () => closePopup());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && placePopup.isOpen() && !planner.isOpen()) closePopup();
});

// ---------------------------------------------------------------------------
// Map controls
// ---------------------------------------------------------------------------

const tiltBtn = $<HTMLButtonElement>('tilt-toggle');
const needle = $<HTMLElement>('compass-needle');

$('zoom-in').addEventListener('click', () => map.zoomIn());
$('zoom-out').addEventListener('click', () => map.zoomOut());
$('compass').addEventListener('click', () => map.easeTo({ bearing: 0 }));

tiltBtn.addEventListener('click', () => {
  const flat = map.getPitch() < 5;
  map.easeTo(flat ? { ...TILTED, duration: 1000 } : { pitch: 0, bearing: 0, duration: 1000 });
});

function syncControls() {
  needle.style.transform = `rotate(${-map.getBearing()}deg)`;
  const flat = map.getPitch() < 5;
  tiltBtn.textContent = flat ? '3D' : '2D';
  tiltBtn.title = flat ? 'Switch to 3D view' : 'Switch to top-down view';
}

/**
 * Depth follows the camera: looking straight down the map is flat (building
 * footprints, no pin shadows); tilting raises the 3D buildings and casts pin
 * shadows. Tied to pitch so the toggle, drag-tilt and flyTo all animate it.
 */
function syncDepth() {
  const depth = Math.min(1, Math.max(0, (map.getPitch() - 3) / 22));
  map.getContainer().style.setProperty('--depth', depth.toFixed(3));
  if (map.getLayer(BUILDING_3D_LAYER)) {
    map.setPaintProperty(BUILDING_3D_LAYER, 'fill-extrusion-opacity', BUILDING_3D_OPACITY * depth);
  }
}
map.on('style.load', syncDepth);
map.on('rotate', syncControls);
map.on('pitch', () => {
  syncControls();
  syncDepth();
});
syncControls();
syncDepth();

// ---------------------------------------------------------------------------
// Trip planner (opened by Navigate; live MBTA routing not connected yet)
// ---------------------------------------------------------------------------

const mapPlaceSuggestions = createPlaceListProvider(() => shownPlaces, {
  description: 'Places on the map',
  source: 'map_place',
  kind: 'place',
  secondary: 'On the map',
});
const savedSuggestions = createPlaceListProvider(() => saved.list().map(savedToPlace), {
  description: 'Saved places',
  source: 'saved_place',
  kind: 'saved',
  secondary: 'Saved',
});
const bostonSuggestions = createBostonSuggestionProvider();

const planner = createRoutePlanner({
  fromSuggestions: combineProviders([bostonSuggestions, savedSuggestions, mapPlaceSuggestions], 'Offline Boston list, saved places and places on the map'),
  toSuggestions: combineProviders([mapPlaceSuggestions, savedSuggestions, bostonSuggestions], 'Places on the map, saved places and the offline Boston list'),
  // Live routing (transit's planTripLive via createTransitRouteProvider) is switched on in a later step.
  provider: null,
});
document.body.append(planner.root);

function openPlanner(place: Place) {
  const to: RouteEndpoint = {
    label: place.name,
    location: { lat: place.lat, lng: place.lon },
    source: 'map_place',
    ...(realPlaceId(place.id) ? { placeId: place.id } : {}),
  };
  const origin = discovery.getPreferences().origin;
  const from: RouteEndpoint | null = origin
    ? { label: origin.label, location: { ...origin.location }, source: 'discovery_origin' }
    : null;
  closePopup();
  planner.open({ from, to });
}

// ---------------------------------------------------------------------------
// Discovery panel: the left-hand interface. Its Activity choice decides which
// categories the map loads; Quick Tools give search, saved places and recenter.
// ---------------------------------------------------------------------------

let lastLayers: MapLayerSelection | null = null;
const loadLayers = (selection: MapLayerSelection) => {
  lastLayers = selection;
  void showCategories(
    CATEGORIES.filter((c) => selection.layerIds.includes(c.id)),
    selection.detail,
  );
};

const discovery = mountDiscoveryPanel(document.body, {
  mapLayers: { available: CATEGORIES, onChange: loadLayers },
  search: {
    provider: searchProvider,
    onResults: showSearchResults,
    onSelect: (place) => openSearchResult(place),
    // Leaving search: back to the Activity's places.
    onDismiss: () => {
      if (lastLayers) loadLayers(lastLayers);
    },
  },
  saved: {
    store: saved,
    onSelect: (s) => openSavedPlace(savedToPlace(s), s.categoryId),
  },
  onRecenter: () => {
    // No starting point: Boston Common, from the bundled OpenStreetMap list.
    const common = bostonCommon()?.location;
    const target = recenterTarget(discovery.getPreferences().origin, common ?? BOSTON);
    const flat = map.getPitch() < 5;
    map.flyTo({
      center: target.center,
      zoom: 16,
      pitch: flat ? 0 : TILTED.pitch,
      bearing: flat ? 0 : TILTED.bearing,
      essential: true,
    });
  },
});
saved.subscribe(() => placePopup.refreshSaved());

// Starting-point marker, driven by the panel's origin preference.
const originMarker = createOriginMarker(mapLibreOriginDeps(map));
const syncOrigin = () => {
  const origin = discovery.getPreferences().origin;
  const update = originMarker.update(origin);
  if (!origin) return;
  const lngLat: [number, number] = [origin.location.lng, origin.location.lat];
  if (shouldRevealOrigin(update, map.getBounds().contains(lngLat))) map.easeTo({ center: lngLat, duration: 800 });
};
discovery.subscribe(syncOrigin);
syncOrigin();
