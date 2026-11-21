/**
 * "Plan a trip": the on-demand navigation overlay opened from a destination
 * popup's Navigate button. Not part of the discovery panel.
 *
 * - From/To re-use the discovery location field (suggestions + current
 *   location). A typed label is never an endpoint; only a picked suggestion
 *   with real coordinates is.
 * - Opening the planner never requests routes. Routing runs only when the
 *   user asks, and only if a provider is connected; otherwise the results
 *   area says routing isn't connected and nothing else is shown.
 */
import type { GeolocationEnvironment, LocationSuggestionProvider } from '../../../discovery/locations';
import type { Origin, OriginSource } from '../../../discovery/preferences';
import { createStore } from '../../../discovery/store';
import { h, icon, ICONS, uid } from '../../../discovery/ui/dom';
import { createLocationField } from '../../../discovery/ui/locationField';
import {
  canRoute,
  initialPlannerState,
  requestRoutes,
  routePlannerReducer,
  type RoutePlannerState,
} from '../routePlanner';
import { realPlaceId, type RouteEndpoint, type RouteProvider, type RouteResult } from '../routing';
import '../navigation.css';

export interface RoutePlannerConfig {
  /** Suggestions for each field (e.g. map places + saved + offline Boston list). */
  fromSuggestions: LocationSuggestionProvider;
  toSuggestions: LocationSuggestionProvider;
  /** Null until live routing is switched on. */
  provider: RouteProvider | null;
  geolocation?: GeolocationEnvironment;
  /** Told when the planner opens or closes. (The discovery panel is never collapsed for it.) */
  onOpenChange?(open: boolean): void;
}

export interface RoutePlanner {
  root: HTMLElement;
  open(defaults: { from: RouteEndpoint | null; to: RouteEndpoint | null }): void;
  close(): void;
  isOpen(): boolean;
  getState(): RoutePlannerState;
  destroy(): void;
}

const PLACE_SOURCES: readonly string[] = ['map_place', 'saved_place'];

/** A location-field pick → endpoint. Only map/saved places keep their (real) place id. */
export function originToEndpoint(o: Origin): RouteEndpoint {
  const placeId = PLACE_SOURCES.includes(o.source) ? realPlaceId(o.sourceRef) : undefined;
  return { label: o.label, location: { ...o.location }, source: o.source, ...(placeId ? { placeId } : {}) };
}

const ORIGIN_SOURCES: readonly OriginSource[] = ['local_suggestion', 'device_geolocation', 'live_geocoder', 'map_place', 'saved_place'];

function endpointToOrigin(e: RouteEndpoint | null): Origin | null {
  if (!e) return null;
  return {
    label: e.label,
    location: { ...e.location },
    source: ORIGIN_SOURCES.includes(e.source as OriginSource) ? (e.source as OriginSource) : 'local_suggestion',
  };
}

export function createRoutePlanner(config: RoutePlannerConfig): RoutePlanner {
  const store = createStore(routePlannerReducer, initialPlannerState());
  const titleId = uid('planner-title');

  const fromField = createLocationField({
    provider: config.fromSuggestions,
    geolocation: config.geolocation,
    label: 'From',
    placeholder: 'Choose a starting point',
    searchPlaceholder: 'Station, campus, landmark or map place',
    onSelect: (o) => store.dispatch({ type: 'setFrom', endpoint: originToEndpoint(o) }),
  });
  const toField = createLocationField({
    provider: config.toSuggestions,
    geolocation: config.geolocation,
    allowCurrentLocation: false,
    label: 'To',
    placeholder: 'Choose a destination',
    searchPlaceholder: 'Map place, saved place, station or landmark',
    onSelect: (o) => store.dispatch({ type: 'setTo', endpoint: originToEndpoint(o) }),
  });

  const swapBtn = h(
    'button',
    { type: 'button', class: 'vb-icon-btn vb-planner-swap', 'aria-label': 'Swap starting point and destination', title: 'Swap' },
    icon(ICONS.swap, 20),
  );
  const closeBtn = h('button', { type: 'button', class: 'vb-icon-btn', 'aria-label': 'Close trip planner' }, icon(ICONS.close, 20));
  const findBtn = h('button', { type: 'button', class: 'vb-primary-btn vb-planner-find' }, 'Find MBTA routes');
  const results = h('div', { class: 'vb-planner-results', 'aria-live': 'polite' });

  const root = h(
    'section',
    { class: 'vb-ui vb-planner', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, hidden: true },
    h(
      'header',
      { class: 'vb-planner-header' },
      icon(ICONS.directions, 22, 'vb-icon vb-planner-icon'),
      h('h2', { class: 'vb-planner-title', id: titleId }, 'Plan a trip'),
      closeBtn,
    ),
    h('div', { class: 'vb-planner-fields' }, fromField.root, swapBtn, toField.root),
    h('div', { class: 'vb-planner-actions' }, findBtn),
    results,
  );

  swapBtn.addEventListener('click', () => store.dispatch({ type: 'swap' }));
  closeBtn.addEventListener('click', () => api.close());
  findBtn.addEventListener('click', () => void requestRoutes(store.getState, store.dispatch, config.provider));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.stopPropagation();
      api.close();
    }
  });

  function renderResults(s: RoutePlannerState) {
    if (!config.provider) {
      results.replaceChildren(
        h('p', { class: 'vb-planner-notice' }, h('strong', {}, 'MBTA routing isn’t connected yet. '), 'Trip options will appear here once the transit service is switched on.'),
      );
      return;
    }
    switch (s.status.kind) {
      case 'idle':
      case 'not_connected':
        results.replaceChildren();
        return;
      case 'loading':
        results.replaceChildren(h('p', { class: 'vb-planner-notice' }, 'Checking MBTA service…'));
        return;
      case 'done':
        results.replaceChildren(...renderResult(s.status.result));
    }
  }

  function render(s: RoutePlannerState) {
    root.hidden = !s.open;
    fromField.setValue(endpointToOrigin(s.from));
    toField.setValue(endpointToOrigin(s.to));
    const ready = canRoute(s);
    findBtn.disabled = !ready || !config.provider || s.status.kind === 'loading';
    findBtn.title = !config.provider ? 'MBTA routing isn’t connected yet' : ready ? '' : 'Choose both endpoints first';
    renderResults(s);
    const hint = root.querySelector('.vb-planner-hint');
    hint?.remove();
    if (!ready) {
      results.prepend(h('p', { class: 'vb-planner-hint' }, 'Pick a starting point and a destination from the suggestions.'));
    }
  }

  const unsubscribe = store.subscribe((s, prev) => {
    render(s);
    if (s.open !== prev.open) config.onOpenChange?.(s.open);
  });
  render(store.getState());

  const api: RoutePlanner = {
    root,
    open(defaults) {
      store.dispatch({ type: 'open', from: defaults.from, to: defaults.to });
      closeBtn.focus();
    },
    close() {
      if (!store.getState().open) return;
      fromField.close();
      toField.close();
      store.dispatch({ type: 'close' });
    },
    isOpen: () => store.getState().open,
    getState: store.getState,
    destroy() {
      unsubscribe();
      fromField.destroy();
      toField.destroy();
      root.remove();
    },
  };
  return api;
}

/** Results from a connected provider. Only what the provider returned; nothing estimated here. */
function renderResult(r: RouteResult): Node[] {
  if (r.status !== 'ok') return [h('p', { class: 'vb-planner-notice' }, r.message)];
  const fmt = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;
  return [
    ...r.options.map((o) =>
      h(
        'div',
        { class: 'vb-route-option' },
        h('p', { class: 'vb-route-summary' }, `${fmt(o.durationSec)} · ${o.transfers === 0 ? 'no transfers' : `${o.transfers} transfer${o.transfers > 1 ? 's' : ''}`}`),
        h(
          'ol',
          { class: 'vb-route-legs' },
          ...o.legs.map((l) =>
            h('li', {}, l.mode === 'walk' ? `Walk, about ${fmt(l.durationSec)} (estimate)` : `${l.routeShortName ?? l.mode} from ${l.fromStopName ?? '?'} to ${l.toStopName ?? '?'} · ${fmt(l.durationSec)}`),
          ),
        ),
      ),
    ),
    h('p', { class: 'vb-planner-source' }, `Source: ${r.provider}${r.notes?.length ? ` · ${r.notes.join(' · ')}` : ''}`),
  ];
}
