import { AttributionControl, Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './design/visualFoundation.css';
import { activateVisualPreview } from './design/visualFoundation';
import { BUILDING_3D_LAYERS, BUILDING_3D_OPACITY, mapStyle } from './mapStyle';
import { PIN_COLORS } from './pinColors';
import { outingProfiles } from './features/vibe/publisher';
import type { Ranking } from './features/vibe/adapters';
import { semanticMarkerState } from './features/map/semanticMarkers';
import { createConvergence, mapDisplay } from './features/vibe/convergence';
import { rankPlaces } from './discovery/filter';
import { mountAccount } from './features/account';
import { mountScene, sceneDevHook } from './features/scene';
import {
  CATEGORIES,
  metersBetween,
  placesFromTiles,
  placesNearAny,
  searchPlaces,
  type CategorizedPlace,
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
import { createApiRouteProvider, placeIdFor, sameLocation, type RouteEndpoint } from './features/navigation/routing';
import { createRoutePlanner } from './features/navigation/ui/routePlannerView';
import { createStore } from './discovery/store';
import { initialTripState, tripReducer, createTripRouter } from './features/navigation/trip';
import { createTripSearch } from './features/navigation/ui/searchView';
import { createPitchLock } from './features/map/pitchLock';
import { createFocusController } from './features/map/focusMode';
import { createPinLabels } from './features/map/pinLabels';
import { markerVisible, setMarkerVisible } from './features/map/markerVisibility';
import { createRouteHubs } from './features/map/routeHubs';
import { paddingAround } from './features/map/routeFrame';
import { drawRoute, clearRoute, routeBounds, routeStations } from './transitRoute';
import { catalogPlacesNear, catalogSemanticCandidates, isCatalogCategory } from './catalog';
import { activeKinds, chipText } from './deals';

const BOSTON = { lng: -71.0636, lat: 42.3555 }; // Boston Common
const TILTED = { pitch: 60, bearing: -20 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The opt-in visual preview changes paint and CSS only; no layout or map camera changes.
activateVisualPreview();

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

const CATEGORY_COLORS = PIN_COLORS;

const PIN_PATH = 'M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 40 14 40s14-15.7 14-26.1C28 6.2 21.7 0 14 0z';

let markers: Marker[] = [];
let shadows: Marker[] = [];
let selectedPin: HTMLElement | null = null;
let semanticRanking: Ranking | null = null;
let refreshConvergence = () => {};
let markerPlaces: Place[] = [];
let dealTimer: ReturnType<typeof setInterval> | undefined;
let temporaryPlaceMarker: Marker | null = null;

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
  const chip = document.createElement('span');
  chip.className = 'pin-deal';
  chip.hidden = true;
  chip.setAttribute('aria-hidden', 'true');
  el.append(chip);
  const body = document.createElement('span');
  body.className = 'pin-body';
  // Two-tone contrast ring (issue #40): a dark ring under the head's light edge,
  // so every pin stays visible on light, mid-tone and dark map themes.
  body.innerHTML = `<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true"><path class="pin-ring" d="${PIN_PATH}" /><path class="pin-head" d="${PIN_PATH}" /></svg>`;
  el.append(body);
  return el;
}

/** What each shown pin looks like, for the popup and saved places (pin id → look). */
let shownPlaces: Place[] = [];
const pinLooks = new Map<string, { color: string; icon?: string }>();
const pinById = new Map<string, HTMLElement>();
const searchMarkers = new Map<string, { place: Place; marker: Marker }>();

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
  markerPlaces = places;
  updateDealChips(new Date());
  dealTimer = setInterval(() => updateDealChips(new Date()), 60_000);
  // Pins refreshed under an open popup (the map moved): keep its place highlighted.
  const open = placePopup?.current();
  const refreshed = open ? places.find(place => place.id === open.id) : undefined;
  if (refreshed) placePopup.open(refreshed, pinLooks.get(refreshed.id)!);
  const openPin = open ? pinById.get(open.id) : undefined;
  if (openPin) { selectPin(openPin); temporaryPlaceMarker?.remove(); temporaryPlaceMarker = null; }
  syncMarkerVisibility();
  refreshConvergence();
}

/** Refresh deal badges as schedules and freshness change. */
function updateDealChips(now: Date) {
  markers.forEach((marker, i) => {
    const place = markerPlaces[i];
    const pin = marker.getElement();
    const chip = pin.querySelector<HTMLElement>('.pin-deal');
    if (!place || !chip) return;
    const text = chipText(activeKinds(place.deals ?? [], now));
    chip.textContent = text;
    chip.hidden = text === '';
    pin.setAttribute('aria-label', text ? `${place.name}, deal on now` : place.name);
  });
  placePopup.refreshDeals(now);
}

function clearPins() {
  [...markers, ...shadows].forEach((m) => m.remove());
  markers = [];
  shadows = [];
  markerPlaces = [];
  shownPlaces = [];
  pinById.clear();
  pinLooks.clear();
  selectedPin = null;
  clearInterval(dealTimer);
  dealTimer = undefined;
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
    for (const { marker } of searchMarkers.values()) marker.getElement().classList.remove('selected');
    queueMicrotask(syncTrip);
    temporaryPlaceMarker?.remove(); temporaryPlaceMarker = null;
  },
});

// The popup never changes the discovery panel (no collapse/expand/move);
// instead the camera keeps the popup clear of the panel where it can.
function openPlace(place: Place, look: { color: string; icon?: string }) {
  temporaryPlaceMarker?.remove(); temporaryPlaceMarker = null;
  if (!pinById.has(place.id) && !searchMarkers.has(place.id)) {
    const el = pinElement(); el.classList.add('selected', 'vb-temporary-place'); el.setAttribute('aria-label', place.name);
    el.style.setProperty('--pin-color', look.color);
    temporaryPlaceMarker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([place.lon, place.lat]).addTo(map);
  }
  placePopup.open(place, look);
  syncMarkerVisibility();
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
  map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), 16.5), pitch: pitchLock.isLocked() ? 0 : map.getPitch(), bearing: pitchLock.isLocked() ? 0 : map.getBearing(), offset, essential: true });
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
  closePopup(); hideToast();
  for (const { marker } of searchMarkers.values()) marker.remove();
  searchMarkers.clear();
  for (const place of places) {
    const el = pinElement(); el.dataset.markerKind = 'search'; el.setAttribute('aria-label', place.name);
    el.style.setProperty('--pin-color', CATEGORY_COLORS.search);
    el.addEventListener('click', e => {
      e.stopPropagation();
      trip.dispatch({ type: 'setTo', endpoint: endpointFor(place) });
      openSearchResult(place);
    });
    const marker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([place.lon, place.lat]).addTo(map);
    searchMarkers.set(place.id, { place, marker });
  }
  syncMarkerVisibility();
}
function syncMarkerVisibility() {
  const s = trip.getState();
  const relevant = [placePopup.current()?.id, s.from?.placeId, s.to?.placeId].filter((id): id is string => !!id);
  const mode = focus.mode();
  for (const [id, pin] of pinById) {
    const appearance = semanticMarkerState(semanticRanking, id, mode, relevant, mapDisplay.showAll);
    const visible = appearance.visible && !(mode === 'search' && searchMarkers.has(id));
    setMarkerVisible(pin, visible);
    pin.style.setProperty('--pin-scale', String(appearance.scale));
    const shadow = shadows[Number(pin.dataset.index)]?.getElement();
    if (shadow) {
      setMarkerVisible(shadow, visible);
      shadow.style.setProperty('--pin-scale', String(appearance.scale));
    }
  }
  for (const [id, { marker }] of searchMarkers) setMarkerVisible(marker.getElement(), markerVisible(mode, 'search', id, mode === 'discovery' ? [placePopup.current()?.id ?? ''] : relevant));
  if (temporaryPlaceMarker) setMarkerVisible(temporaryPlaceMarker.getElement(), mode !== 'navigation');
}

function openSearchResult(place: Place) {
  const pin = pinById.get(place.id);
  if (pin) selectPin(pin);
  if (!pin) { setPinSelected(selectedPin, false); selectedPin = null; }
  for (const [id, { marker }] of searchMarkers) marker.getElement().classList.toggle('selected', id === place.id);
  openPlace(place, pinLooks.get(place.id) ?? { color: CATEGORY_COLORS.search });
  focusPlace(place);
}

/** Saved destinations reuse pins or one temporary marker, without changing activity filters. */
function openSavedPlace(place: Place, categoryId?: string) {
  place = shownPlaces.find(current => current.id === place.id) ?? place;
  const category = CATEGORIES.find(c => c.id === categoryId);
  const pin = pinById.get(place.id);
  if (pin) selectPin(pin);
  openPlace(place, pinLooks.get(place.id) ?? { color: CATEGORY_COLORS[categoryId ?? ''] ?? CATEGORY_COLORS.search, icon: category?.icon });
  discovery.showView('preferences');
  focusPlace(place);
}

// ---------------------------------------------------------------------------
// Place categories (tile POIs + Overpass), chosen by the discovery panel
// ---------------------------------------------------------------------------

let categoryAbort: AbortController | undefined;
/** What the category pins currently show, so they can follow the map; null while search results (or nothing) are shown. */
let currentSelection: { categories: Category[]; detail: 'tiles' | 'full' } | null = null;
/** Where the category pins were last loaded. */
let lastView: { center: { lat: number; lon: number }; zoom: number } | null = null;

/** Roughly the visible area around the centre; wider when zoomed out. */
const radiusFor = (zoom: number) => Math.min(4000, Math.max(400, 1200 * 2 ** (16 - zoom)));

/**
 * Show places from several categories at once, each pin in its category's
 * color.
 * - Food & drink (Restaurants / Coffee / Bars) always come from our Supabase
 *   catalog when it can answer, with address, website, phone and hours,
 *   whether or not an activity is chosen.
 * - Other categories: `detail: 'tiles'` uses only what's already in the loaded
 *   map tiles (no network); `'full'` upgrades them with one Overpass lookup.
 * A newer call aborts an older one, and every await re-checks that signal,
 * so a late response can never replace newer pins. `refresh` (the map moved)
 * keeps the open card and result list as they are.
 */
async function showCategories(categories: Category[], detail: 'tiles' | 'full', { refresh = false } = {}) {
  categoryAbort?.abort();
  currentSelection = categories.length > 0 ? { categories, detail } : null;
  if (!refresh) closePopup();
  if (categories.length === 0) {
    clearPins();
    refreshConvergence();
    hideToast();
    return;
  }
  const abort = (categoryAbort = new AbortController());
  const label = categories.length === 1 ? categories[0].label.toLowerCase() : 'places';
  const c = map.getCenter();
  const center = { lat: c.lat, lon: c.lng };
  lastView = { center, zoom: map.getZoom() };
  const radius = radiusFor(map.getZoom());
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

  const byId = new Map(categories.map((cat) => [cat.id, cat]));
  const groupsOf = (list: CategorizedPlace[]): [Category, Place[]][] =>
    list.map(({ place, categoryId }) => [byId.get(categoryId)!, [place]]);
  const otherCategories = categories.filter((cat) => !isCatalogCategory(cat));

  // 2) Food & drink from our catalog, with details, for any detail level.
  const catalogCategories = categories.filter(isCatalogCategory);
  const fromCatalog = catalogCategories.length
    ? await catalogPlacesNear(catalogCategories, center, radius, perCategory)
    : null;
  if (abort.signal.aborted) return;

  if (detail === 'tiles') {
    if (!fromCatalog) return; // the tile pins stay
    haveDetailed = true;
    const showWithTiles = () => {
      if (abort.signal.aborted) return;
      const others = otherCategories.map((cat): [Category, Place[]] => [cat, placesFromTiles(tilePois(cat), center, radius, perCategory)]);
      showPlaces(merge([...groupsOf(fromCatalog), ...others]), lookFor, iconFor);
      remember();
      hideToast();
    };
    showWithTiles();
    if (!map.loaded()) map.once('idle', showWithTiles); // tile pins for the other categories may still be streaming in
    return;
  }

  // 3) Overpass for everything else (or for everything, when the catalog can't answer).
  const overpassCategories = fromCatalog ? otherCategories : categories;
  try {
    const fromOverpass = overpassCategories.length
      ? await placesNearAny(overpassCategories, center, radius, abort.signal, perCategory)
      : [];
    if (abort.signal.aborted) return;
    const detailed = [...(fromCatalog ?? []), ...fromOverpass];
    if (detailed.length > 0) {
      haveDetailed = true;
      showPlaces(merge(groupsOf(detailed)), lookFor, iconFor);
      remember();
      hideToast();
    } else if (quickCount === 0) {
      showToast(`No ${label} found here. Try moving the map.`);
    }
  } catch {
    if (abort.signal.aborted) return;
    if (fromCatalog?.length) {
      // Overpass failed for the other categories; still show what the catalog has.
      haveDetailed = true;
      showPlaces(merge(groupsOf(fromCatalog)), lookFor, iconFor);
      remember();
      showToast('Showing food & drink only. The OSM details service is busy right now.');
      return;
    }
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

// Category pins follow the map: once it settles somewhere meaningfully new,
// reload the same categories there (search results are left alone).
let moveTimer: number | undefined;
map.on('moveend', () => {
  window.clearTimeout(moveTimer);
  moveTimer = window.setTimeout(() => {
    if (!currentSelection || !lastView) return;
    const c = map.getCenter();
    const moved = metersBetween(lastView.center, { lat: c.lat, lon: c.lng });
    const zoomed = Math.abs(map.getZoom() - lastView.zoom);
    if (moved < radiusFor(lastView.zoom) * 0.3 && zoomed < 0.75) return;
    void showCategories(currentSelection.categories, currentSelection.detail, { refresh: true });
  }, 500);
});

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
  if (pitchLock.isLocked()) return;
  const flat = map.getPitch() < 5;
  map.easeTo(flat ? { ...TILTED, duration: 1000 } : { pitch: 0, bearing: 0, duration: 1000 });
});

function syncControls() {
  needle.style.transform = `rotate(${-map.getBearing()}deg)`;
  const flat = map.getPitch() < 5;
  tiltBtn.textContent = flat ? '3D' : '2D';
  const locked = pitchLock.isLocked();
  tiltBtn.disabled = locked;
  tiltBtn.title = locked ? 'Navigation keeps the map in 2D. Close Directions to restore 3D.' : flat ? 'Switch to 3D view' : 'Switch to top-down view';
  tiltBtn.setAttribute('aria-label', tiltBtn.title);
}

/**
 * Depth follows the camera: looking straight down the map is flat (building
 * footprints, no pin shadows); tilting raises the 3D buildings and casts pin
 * shadows. Tied to pitch so the toggle, drag-tilt and flyTo all animate it.
 */
function syncDepth() {
  const depth = Math.min(1, Math.max(0, (map.getPitch() - 3) / 22));
  map.getContainer().style.setProperty('--depth', depth.toFixed(3));
  for (const id of BUILDING_3D_LAYERS) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'fill-extrusion-opacity', BUILDING_3D_OPACITY * depth);
  }
}
map.on('style.load', syncDepth);
map.on('rotate', syncControls);
map.on('pitch', () => {
  syncControls();
  syncDepth();
});
syncDepth();

// ---------------------------------------------------------------------------
// Shared Search / Navigation state and MBTA route provider
// ---------------------------------------------------------------------------

const mapPlaceSuggestions = createPlaceListProvider(() => [...shownPlaces, ...[...searchMarkers.values()].map(x => x.place)], {
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

const trip = createStore(tripReducer, initialTripState());
const fromSuggestions = combineProviders([bostonSuggestions, savedSuggestions, mapPlaceSuggestions], 'Offline Boston list, saved places and places on the map');
const toSuggestions = combineProviders([mapPlaceSuggestions, savedSuggestions, bostonSuggestions], 'Places on the map, saved places and the offline Boston list');
const pitchLock = createPitchLock(map, { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, onChange: () => queueMicrotask(syncControls) });
const focus = createFocusController(map, pitchLock, { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
const resolvePlaceId = (id: string) => {
  const p = shownPlaces.find(p => p.id === id) ?? saved.list().map(savedToPlace).find(p => p.id === id);
  return p ? placeIdFor(p) : undefined;
};
const planner = createRoutePlanner({ store: trip, fromSuggestions, toSuggestions, resolvePlaceId, provider: createApiRouteProvider() });

syncControls();
const endpointFor = (place: Place): RouteEndpoint => ({ label: place.name, location: { lat: place.lat, lng: place.lon }, source: 'map_place', placeId: placeIdFor(place) });
const discoveryEndpoint = (): RouteEndpoint | null => {
  const o = discovery.getPreferences().origin;
  return o ? { ...o, location: { ...o.location } } : null;
};
function openPlanner(place: Place) {
  trip.dispatch({ type: 'navigateTo', destination: endpointFor(place), discoveryOrigin: discoveryEndpoint() });
  closePopup();
}
function previewEndpoint(e: RouteEndpoint) {
  const place = shownPlaces.find(p => p.id === e.placeId) ?? saved.list().map(savedToPlace).find(p => p.id === e.placeId)
    ?? { id: e.placeId ?? 'trip-preview', name: e.label, lat: e.location.lat, lon: e.location.lng, category: 'Chosen location', tags: {} };
  openSearchResult(place);
}
const tripSearch = createTripSearch({ store: trip, fromSuggestions, toSuggestions, resolvePlaceId, provider: searchProvider,
  onDestination: previewEndpoint,
  onOpen: () => trip.dispatch({ type: 'openSearch', discoveryOrigin: discoveryEndpoint(), selectedPlace: placePopup.current() ? endpointFor(placePopup.current()!) : null }),
  onClose: () => discovery.showView('preferences'), onResults: showSearchResults,
  onSelect: place => { trip.dispatch({ type: 'setTo', endpoint: endpointFor(place) }); openSearchResult(place); discovery.showView('preferences'); },
});

// ---------------------------------------------------------------------------
// Discovery panel: the left-hand interface. Its Activity choice decides which
// categories the map loads; Quick Tools give search, saved places and recenter.
// ---------------------------------------------------------------------------

const loadLayers = (selection: MapLayerSelection) => {
  void showCategories(
    CATEGORIES.filter((c) => selection.layerIds.includes(c.id)),
    selection.detail,
  );
};

const discovery = mountDiscoveryPanel(document.body, {
  mapLayers: { available: CATEGORIES, onChange: loadLayers },
  search: tripSearch,
  directions: { panel: planner.root, control: planner.control },
  saved: {
    store: saved,
    onSelect: (s) => openSavedPlace(savedToPlace(s), s.categoryId),
  },
  onRecenter: () => {
    // No starting point: Boston Common, from the bundled OpenStreetMap list.
    const common = bostonCommon()?.location;
    const target = recenterTarget(discovery.getPreferences().origin, common ?? BOSTON);
    const flat = pitchLock.isLocked() || map.getPitch() < 5;
    map.flyTo({
      center: target.center,
      zoom: 16,
      pitch: flat ? 0 : TILTED.pitch,
      bearing: flat ? 0 : TILTED.bearing,
      essential: true,
    });
  },
});
// Account taste and the scene composer retain ownership of map appearance.
const account = mountAccount(document.body, { map });
const scene = mountScene({
  theme: account.theme,
  account: account.store,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)'),
  onError: (error) => console.error('[scene]', error),
});
if (import.meta.env.DEV) Object.assign(window, { vibentaScene: sceneDevHook(scene, map) });
// One publisher feeds the existing compiler/session and the existing pin system.
scene.connectProfiles(outingProfiles);
const convergence = createConvergence(
  outingProfiles,
  signal => catalogSemanticCandidates(rankPlaces(shownPlaces, discovery.getPreferences()).included.map(row => row.place), signal),
  ranking => {
    semanticRanking = ranking;
    syncMarkerVisibility();
    if (import.meta.env.DEV) Object.assign(window, { vibentaOutingRanking: ranking });
  },
);
refreshConvergence = () => { void convergence.refresh(); };
const stopConvergence = discovery.subscribe(refreshConvergence);
if (import.meta.env.DEV) Object.assign(window, { vibentaOutingProfiles: outingProfiles });


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

// Trip markers and route layers follow only the current generation.
const tripOrigin = createOriginMarker(mapLibreOriginDeps(map));
const hubs = createRouteHubs(map);
let destinationMarker: Marker | null = null;
let renderedGeneration = -1;
let userMovedWhileLoading = false;
let navigationWasOpen = false;
let routeStyleReady = map.isStyleLoaded();
map.on('movestart', e => { if (e.originalEvent && trip.getState().route.kind === 'loading') userMovedWhileLoading = true; });
const syncTrip = () => {
  const s = trip.getState();
  if (s.navigationOpen && !navigationWasOpen) { navigationWasOpen = true; closePopup(); }
  if (!s.navigationOpen) navigationWasOpen = false;
  scene.setNavigation(s.navigationOpen);
  focus.apply(s);
  syncMarkerVisibility();
  discovery.setDirectionsExpanded(s.navigationOpen && s.directionsExpanded);
  if (!s.searchOpen && discovery.element().dataset.panelView === 'search') discovery.showView('preferences');
  const discoveryOrigin = discovery.getPreferences().origin;
  const focused = focus.mode() !== 'discovery';
  originMarker.update(!focused || (s.from && sameLocation(s.from.location, discoveryOrigin?.location)) ? discoveryOrigin : null);
  tripOrigin.update(focused && s.from && !sameLocation(s.from.location, discoveryOrigin?.location) ? s.from : null);
  const needsDestinationMarker = s.navigationOpen || (s.searchOpen && s.to && !placePopup.isOpen() && !pinById.has(s.to.placeId ?? '') && !searchMarkers.has(s.to.placeId ?? ''));
  if (needsDestinationMarker && s.to) {
    if (!destinationMarker) {
      const el = document.createElement('div'); el.className = 'vb-trip-destination'; el.setAttribute('role', 'img');
      destinationMarker = new Marker({ element: el }).setLngLat([s.to.location.lng, s.to.location.lat]).addTo(map);
    }
    destinationMarker.getElement().setAttribute('aria-label', `Destination: ${s.to.label}`);
    destinationMarker.setLngLat([s.to.location.lng, s.to.location.lat]);
  } else { destinationMarker?.remove(); destinationMarker = null; }
  if (s.route.kind === 'loading' && renderedGeneration !== s.generation) { userMovedWhileLoading = false; renderedGeneration = s.generation; }
  if (!routeStyleReady) return;
  if (s.navigationOpen && s.route.kind === 'done' && s.route.result.status === 'ok') {
    const legs = s.route.result.route.option.legs;
    drawRoute(map, legs); hubs.update(routeStations(legs)); focus.refresh();
    if (renderedGeneration !== -s.generation - 2) {
      renderedGeneration = -s.generation - 2;
      const bounds = routeBounds(legs, [s.from!.location, s.to!.location]);
      if (bounds && !userMovedWhileLoading) {
        const container = map.getContainer().getBoundingClientRect();
        const obstacles = [discovery.element()].map(el => el.getBoundingClientRect());
        map.fitBounds(bounds, { padding: paddingAround(container, obstacles), pitch: 0, bearing: 0, duration: 650, maxZoom: 16 });
      }
    }
  } else { clearRoute(map); hubs.update([]); }
};
trip.subscribe(syncTrip);
discovery.subscribe(syncTrip);
map.on('style.load', () => { routeStyleReady = true; renderedGeneration = -1; syncTrip(); });
createTripRouter(trip, createApiRouteProvider());
if (import.meta.env.DEV) Object.assign(window, { vibentaTrip: trip });

// Place names stay attached to DOM pins, with collisions resolved after camera/marker updates.
const pinLabels = createPinLabels(map.getContainer(), () => [...document.querySelectorAll('.vb-discovery, .vb-place-popup, .map-controls, .vb-route-hub, .vb-hub-label')]);
map.on('render', pinLabels.schedule);

// Release the profile consumers before Vite replaces this entry module.
if (import.meta.hot) import.meta.hot.dispose(() => {
  stopConvergence();
  convergence.destroy();
  discovery.destroy();
  scene.destroy();
  account.destroy();
});
