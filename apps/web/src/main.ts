import { AttributionControl, Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { BUILDING_3D_LAYER, BUILDING_3D_OPACITY, mapStyle } from './mapStyle';
import {
  CATEGORIES,
  formatAddress,
  osmUrl,
  placesFromTiles,
  placesNear,
  searchPlaces,
  type Category,
  type Place,
  type TilePoi,
} from './osm';

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

/**
 * A pin's shadow: the pin silhouette lying on the ground plane, its tip at the
 * pin's base, cast away from the scene light. It fades in with camera pitch.
 */
function shadowElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pin-shadow';
  el.innerHTML = `<svg class="pin-shadow-shape" viewBox="0 0 28 40" preserveAspectRatio="none" aria-hidden="true">
    <path d="${PIN_PATH}" />
  </svg>`;
  return el;
}

function pinElement(color: string, icon?: string): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pin';
  el.style.setProperty('--pin-color', color);
  el.innerHTML = `<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true">
    <path d="${PIN_PATH}" fill="var(--pin-color)" stroke="rgba(0,0,0,.18)" />
  </svg>`;
  const glyph = document.createElement('span');
  glyph.className = 'pin-glyph';
  glyph.textContent = icon ?? '';
  el.append(glyph);
  return el;
}

function showPlaces(places: Place[], color: string, icon?: string) {
  clearPins();
  // Shadows first so every pin draws above every shadow.
  shadows = places.map((place) =>
    new Marker({ element: shadowElement(), anchor: 'bottom', pitchAlignment: 'map', rotationAlignment: 'viewport' })
      .setLngLat([place.lon, place.lat])
      .addTo(map),
  );
  markers = places.map((place, i) => {
    const el = pinElement(color, icon);
    el.dataset.index = String(i);
    el.setAttribute('aria-label', place.name);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectPin(el);
      openCard(place, color, icon);
    });
    return new Marker({ element: el, anchor: 'bottom' }).setLngLat([place.lon, place.lat]).addTo(map);
  });
}

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
  card.hidden = true;
  setPinSelected(selectedPin, false);
  selectedPin = null;
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
  setActiveChip(undefined);
  input.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  searchAbort?.abort();
  searchAbort = new AbortController();
  setActiveChip(undefined);
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
  showPlaces(places, color);
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
    });
    li.append(btn);
    resultsList.append(li);
  }
  resultsList.hidden = false;
}

// ---------------------------------------------------------------------------
// Category chips (Overpass)
// ---------------------------------------------------------------------------

const chipsBar = $<HTMLElement>('chips');
let chipAbort: AbortController | undefined;
let activeChip: string | undefined;

for (const category of CATEGORIES) {
  const chip = el('button', 'chip');
  chip.type = 'button';
  chip.dataset.id = category.id;
  chip.append(el('span', 'chip-icon', category.icon), el('span', undefined, category.label));
  chip.addEventListener('click', () => toggleCategory(category));
  chipsBar.append(chip);
}

function setActiveChip(id: string | undefined) {
  activeChip = id;
  for (const chip of chipsBar.querySelectorAll<HTMLElement>('.chip')) {
    chip.classList.toggle('active', chip.dataset.id === id);
  }
}

async function toggleCategory(category: Category) {
  chipAbort?.abort();
  closeCard();
  resultsList.hidden = true;
  if (activeChip === category.id) {
    setActiveChip(undefined);
    clearPins();
    hideToast();
    return;
  }
  setActiveChip(category.id);
  const abort = (chipAbort = new AbortController());
  const label = category.label.toLowerCase();
  const color = CATEGORY_COLORS[category.id] ?? CATEGORY_COLORS.search;
  const c = map.getCenter();
  const center = { lat: c.lat, lon: c.lng };
  // Roughly the visible area around the centre; wider when zoomed out.
  const radius = Math.min(4000, Math.max(400, 1200 * 2 ** (16 - map.getZoom())));

  // 1) Instant: OSM places already inside the loaded map tiles (name + type only).
  let quickCount = 0;
  let haveDetailed = false;
  const showQuick = () => {
    if (abort.signal.aborted || haveDetailed) return;
    const quick = placesFromTiles(tilePois(category), center, radius);
    quickCount = quick.length;
    showPlaces(quick, color, category.icon);
    if (quickCount > 0) hideToast();
  };
  showQuick();
  if (quickCount === 0) {
    showToast(`Finding ${label} nearby…`, true);
    // Tiles may still be streaming in (e.g. right after page load); retry once they're in.
    if (!map.loaded()) map.once('idle', showQuick);
  }

  // 2) Richer: ask Overpass for full OSM tags (hours, website, address...).
  try {
    const detailed = await placesNear(category, center, radius, abort.signal);
    if (abort.signal.aborted) return;
    if (detailed.length > 0) {
      haveDetailed = true;
      showPlaces(detailed, color, category.icon);
      hideToast();
    } else if (quickCount === 0) {
      showToast(`No ${label} found here. Try moving the map.`);
    }
  } catch {
    if (abort.signal.aborted) return;
    if (quickCount === 0) {
      setActiveChip(undefined);
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
