/**
 * Discovery panel: public entry point.
 *
 *   import { mountDiscoveryPanel } from './discovery';
 *   mountDiscoveryPanel(document.body, { mapLayers, search, saved, onRecenter });
 *
 * The panel is independent of map overlays: opening or closing a destination
 * popup or the trip planner never collapses, hides or moves it. It never
 * changes map state itself; consumers read preferences through
 * `getPreferences()` / `subscribe()`.
 */
import './discovery.css';
import { BOSTON_LOCATIONS } from './data/bostonLocations.generated';
import { createLocalSuggestionProvider, type GeolocationEnvironment, type LocationSuggestionProvider } from './locations';
import { createMapLayerNotifier, type MapLayer, type MapLayerSelection } from './mapLayers';
import { initialPreferences, preferencesReducer, type InitialPreferences } from './preferences';
import { createStore, initialLayout, layoutReducer } from './store';
import { createPanel, type PanelDeps, type PanelView } from './ui/panel';

export type { InitialPreferences } from './preferences';
export { rankPlaces, evaluatePlace, type RankResult, type RankedPlace } from './filter';
export type { LocationSuggestionProvider, LocationSuggestion } from './locations';
export type { MapLayer, MapLayerSelection } from './mapLayers';
export type { PlaceSearchProvider } from './placeSearch';
export { combineProviders, createPlaceListProvider, type PlaceLike } from './locations';

/** The bundled offline Boston list (MBTA stations, universities, landmarks) as a suggestion provider. */
export const createBostonSuggestionProvider = () => createLocalSuggestionProvider(BOSTON_LOCATIONS);
export { createSavedStore, savedToPlace, type SavedPlace, type SavedStore } from './saved';
export { bostonCommon } from './landmarks';
export type { PanelView } from './ui/panel';

export interface DiscoveryPanelOptions {
  /** Elements the panel must sit below (default: none, so the panel sits at the top). */
  topAnchors?: () => Element[];
  /** Quick Tools (Search / Saved / Recenter), in an independent widget above the complete preferences card. */
  search?: PanelDeps['search'];
  saved?: PanelDeps['saved'];
  onRecenter?: () => void;
  directions?: PanelDeps['directions'];
  /** Swap in a live geocoder later; defaults to the bundled offline Boston list. */
  locationProvider?: LocationSuggestionProvider;
  geolocation?: GeolocationEnvironment;
  now?: () => Date;
  /**
   * The map's place categories and a callback to load them. Called once on
   * mount, then (debounced) whenever the set of layers to show changes.
   */
  mapLayers?: {
    available: readonly MapLayer[];
    onChange(selection: MapLayerSelection): void;
    debounceMs?: number;
  };
}

export interface DiscoveryPanelHandle {
  showView(view: PanelView): void;
  setDirectionsExpanded(expanded: boolean): void;
  /** The panel's root element (read-only use, e.g. keeping map popups clear of it). */
  element(): HTMLElement;
  getPreferences(): InitialPreferences;
  subscribe(listener: (prefs: InitialPreferences) => void): () => void;
  destroy(): void;
}

const MOBILE_QUERY = '(max-width: 640px)';
const GAP_PX = 12;

const defaultAnchors = (): Element[] => [];

export function mountDiscoveryPanel(container: HTMLElement, options: DiscoveryPanelOptions = {}): DiscoveryPanelHandle {
  const now = options.now ?? (() => new Date());
  const prefs = createStore(preferencesReducer, initialPreferences());
  const isMobile = window.matchMedia?.(MOBILE_QUERY).matches ?? false;
  // On phones the map comes first: start as a compact bottom-sheet summary.
  const layout = createStore(layoutReducer, initialLayout(isMobile ? 'collapsed' : 'expanded'));

  const panel = createPanel({
    prefs,
    layout,
    provider: options.locationProvider ?? createLocalSuggestionProvider(BOSTON_LOCATIONS),
    geolocation: options.geolocation,
    now,
    mapLayers: options.mapLayers?.available,
    search: options.search,
    saved: options.saved,
    onRecenter: options.onRecenter,
    directions: options.directions,
  });
  container.append(panel.root);

  const cleanups: (() => void)[] = [];

  // Sit just below the search bar, whatever its current height.
  const anchors = options.topAnchors ?? defaultAnchors;
  const syncTop = () => {
    const bottoms = anchors()
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => el.getBoundingClientRect().bottom);
    const top = bottoms.length ? Math.max(...bottoms) + GAP_PX : GAP_PX;
    panel.root.style.setProperty('--vb-top', `${Math.round(top)}px`);
  };
  syncTop();
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(syncTop);
    anchors().forEach((el) => ro.observe(el));
    cleanups.push(() => ro.disconnect());
  }
  window.addEventListener('resize', syncTop);
  cleanups.push(() => window.removeEventListener('resize', syncTop));

  // Tell the map which categories to load: now, then after changes settle.
  if (options.mapLayers) {
    const { available, onChange, debounceMs } = options.mapLayers;
    const notifier = createMapLayerNotifier(prefs.getState, available, onChange, debounceMs);
    notifier.start();
    cleanups.push(prefs.subscribe(notifier.schedule), notifier.dispose);
  }

  const handle: DiscoveryPanelHandle = {
    showView: panel.showView,
    setDirectionsExpanded: panel.setDirectionsExpanded,
    element: () => panel.root,
    getPreferences: prefs.getState,
    subscribe: (listener) => prefs.subscribe((state) => listener(state)),
    destroy() {
      cleanups.forEach((fn) => fn());
      panel.destroy();
      panel.root.remove();
    },
  };
  if (import.meta.env.DEV) Object.assign(window, { vibentaDiscovery: handle }); // for poking at from devtools
  return handle;
}
