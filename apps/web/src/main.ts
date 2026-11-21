import { AttributionControl, Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { BUILDING_3D_LAYER, BUILDING_3D_OPACITY, mapStyle } from './mapStyle';
import {
  CATEGORIES,
  formatAddress,
  metersBetween,
  osmUrl,
  placesFromTiles,
  placesNearAny,
  searchPlaces,
  type CategorizedPlace,
  type Category,
  type Place,
  type TilePoi,
} from './osm';
import { mountDiscoveryPanel, type DiscoveryPanelHandle } from './discovery';
import { catalogPlacesNear, isCatalogCategory, priceLabel } from './catalog';
import { clearRoute, drawRoute, fetchRoute, renderRouteState, type LatLng, type RouteState } from './transitRoute';

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

/** `icon` is the card icon: one for every place, or chosen per place (mixed categories). */
function showPlaces(places: Place[], lookFor: (place: Place) => PinLook, icon?: string | ((place: Place) => string | undefined)) {
  clearPins();
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
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectPin(el);
      openCard(place, look.color, typeof icon === 'function' ? icon(place) : icon);
      void showRouteTo(place);
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
// Place card
// ---------------------------------------------------------------------------

const card = $<HTMLElement>('place-card');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function safeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function openCard(place: Place, color: string, icon?: string) {
  card.replaceChildren();

  const hero = el('div', 'card-hero');
  hero.style.setProperty('--hero-color', color);
  hero.append(el('span', 'card-hero-icon', icon ?? '📍'));
  const close = el('button', 'card-close', '×');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeCard);
  hero.append(close);

  const body = el('div', 'card-body');
  body.append(el('h2', 'card-title', place.name), el('p', 'card-category', place.category));

  const details = el('ul', 'card-details');
  const address = formatAddress(place.tags) ?? place.tags.display_name;
  const rows: [string, string | undefined][] = [
    ['📍', address],
    ['🕒', place.tags.opening_hours],
    // Catalog places only, once their details loaded; Overpass places have no price data.
    ['💲', place.tags['catalog:price_band'] ? priceLabel(place.tags['catalog:price_band'], place.tags['catalog:price_source']) : undefined],
    ['📞', place.tags.phone ?? place.tags['contact:phone']],
  ];
  for (const [glyph, value] of rows) {
    if (!value) continue;
    const li = el('li');
    li.append(el('span', 'detail-icon', glyph), el('span', undefined, value));
    details.append(li);
  }

  const actions = el('div', 'card-actions');
  const website = safeHttpUrl(place.tags.website ?? place.tags['contact:website']);
  if (website) actions.append(linkButton('Website', website));
  actions.append(linkButton('View on OpenStreetMap', osmUrl(place)));

  if (details.childElementCount > 0) body.append(details);
  body.append(actions);
  routeBox = el('div', 'route-box');
  routeBox.setAttribute('aria-live', 'polite');
  body.append(routeBox);
  // Foursquare OS Places is Apache 2.0: keep its attribution with its data (OSM's is on the map).
  const attribution = place.tags['catalog:attribution'];
  if (attribution?.includes('Foursquare')) body.append(el('p', 'card-category', `Data: ${attribution}`));
  card.append(hero, body);
  card.hidden = false;
}

function linkButton(label: string, href: string) {
  const a = el('a', 'action-btn', label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function closeCard() {
  cancelRoute();
  card.hidden = true;
  setPinSelected(selectedPin, false);
  selectedPin = null;
}

// ---------------------------------------------------------------------------
// Transit route for the selected place (server API; see transitRoute.ts)
// ---------------------------------------------------------------------------

let routeBox: HTMLElement | null = null;
let routeSeq = 0; // id of the current selection's request; anything older is stale
let routeAbort: AbortController | undefined;
let routePlace: Place | null = null;
let discovery: DiscoveryPanelHandle | undefined; // assigned when the panel mounts, at the bottom

const currentOrigin = (): LatLng | null => discovery?.getPreferences().origin?.location ?? null;

/** Invalidate any in-flight request and remove the drawn route. */
function cancelRoute() {
  routeSeq++;
  routeAbort?.abort();
  routePlace = null;
  clearRoute(map);
}

async function showRouteTo(place: Place) {
  cancelRoute();
  routePlace = place;
  const box = routeBox; // this selection's own box; a newer card replaces routeBox
  if (!box) return;
  const seq = routeSeq;
  const show = (state: RouteState) => renderRouteState(box, state, () => void showRouteTo(place));

  const origin = currentOrigin();
  if (!origin) return show({ kind: 'origin_required' });
  show({ kind: 'loading' });
  const abort = (routeAbort = new AbortController());
  try {
    const state = await fetchRoute(origin, { lat: place.lat, lng: place.lon }, abort.signal);
    if (seq !== routeSeq) return; // a different pin was picked meanwhile: drop this response
    show(state);
    if (state.kind === 'result' && state.result.status === 'ok') drawRoute(map, state.result.option.legs);
  } catch {
    /* aborted: a newer selection owns the card now */
  }
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
// Search (Nominatim — submit only, never search-as-you-type)
// ---------------------------------------------------------------------------

const form = $<HTMLFormElement>('search-form');
const input = $<HTMLInputElement>('search-input');
const clearBtn = $<HTMLButtonElement>('search-clear');
const resultsList = $<HTMLUListElement>('results');
let searchAbort: AbortController | undefined;

input.addEventListener('input', () => {
  clearBtn.hidden = input.value.length === 0;
});

clearBtn.addEventListener('click', () => {
  input.value = '';
  clearBtn.hidden = true;
  resultsList.hidden = true;
  clearPins();
  closeCard();
  cancelCategory();
  input.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  searchAbort?.abort();
  searchAbort = new AbortController();
  cancelCategory();
  showToast('Searching…', true);
  try {
    const places = await searchPlaces(query, searchAbort.signal);
    hideToast();
    renderResults(places);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') showToast('Search is unavailable right now. Try again in a moment.');
  }
});

function renderResults(places: Place[]) {
  resultsList.replaceChildren();
  if (places.length === 0) {
    resultsList.append(el('li', 'result-empty', 'No results found'));
    resultsList.hidden = false;
    return;
  }
  const color = CATEGORY_COLORS.search;
  showPlaces(places, uniformLook(color));
  for (const [i, place] of places.entries()) {
    const li = el('li');
    const btn = el('button', 'result');
    btn.type = 'button';
    btn.append(el('span', 'result-name', place.name), el('span', 'result-sub', place.tags.display_name));
    btn.addEventListener('click', () => {
      resultsList.hidden = true;
      const marker = markers[i];
      if (marker) selectPin(marker.getElement());
      // Shift the target away from the place card so the pin stays visible.
      const offset: [number, number] = window.innerWidth > 640 ? [200, 40] : [0, -window.innerHeight * 0.22];
      map.flyTo({ center: [place.lon, place.lat], zoom: 17, ...TILTED, offset, essential: true });
      openCard(place, color);
      void showRouteTo(place);
    });
    li.append(btn);
    resultsList.append(li);
  }
  resultsList.hidden = false;
}

// ---------------------------------------------------------------------------
// Place categories (tile POIs + Overpass), chosen by the discovery panel
// ---------------------------------------------------------------------------

let categoryAbort: AbortController | undefined;
/** What the category pins currently show, so they can follow the map; null while search results (or nothing) are shown. */
let currentSelection: { categories: Category[]; detail: 'tiles' | 'full' } | null = null;
/** Where the category pins were last loaded. */
let lastView: { center: { lat: number; lon: number }; zoom: number } | null = null;

/** Stop any category lookup still in flight, so it can't overwrite newer pins (e.g. search results). */
function cancelCategory() {
  categoryAbort?.abort();
  currentSelection = null;
}

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
  if (!refresh) {
    closeCard();
    resultsList.hidden = true;
  }
  if (categories.length === 0) {
    clearPins();
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

// Clicking empty map closes the open card and result list.
map.on('click', () => {
  closeCard();
  resultsList.hidden = true;
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
// Discovery panel: the left-hand interface. Its Activity choice decides which
// categories the map loads; it only reads the map's DOM otherwise.
// ---------------------------------------------------------------------------

discovery = mountDiscoveryPanel(document.body, {
  placeCard: card,
  mapLayers: {
    available: CATEGORIES,
    onChange: ({ layerIds, detail }) => {
      void showCategories(
        CATEGORIES.filter((c) => layerIds.includes(c.id)),
        detail,
      );
    },
  },
});

// A different starting point makes the shown route wrong: re-plan for the open card's place.
let lastOrigin = currentOrigin();
discovery.subscribe((prefs) => {
  const next = prefs.origin?.location ?? null;
  if (next?.lat === lastOrigin?.lat && next?.lng === lastOrigin?.lng) return;
  lastOrigin = next;
  if (routePlace && !card.hidden) void showRouteTo(routePlace);
});
