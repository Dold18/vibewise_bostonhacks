import type { LocationSuggestionProvider, GeolocationEnvironment } from '../../../discovery/locations';
import type { Origin, OriginSource } from '../../../discovery/preferences';
import type { Store } from '../../../discovery/store';
import { h, icon, ICONS } from '../../../discovery/ui/dom';
import { createLocationField } from '../../../discovery/ui/locationField';
import { realPlaceId, type RouteEndpoint } from '../routing';
import type { TripState, TripAction } from '../trip';

export function originToEndpoint(o: Origin, resolvePlaceId?: (id: string) => string | undefined): RouteEndpoint {
  const placeId = ['map_place', 'saved_place'].includes(o.source) ? (realPlaceId(o.sourceRef) ?? (o.sourceRef ? resolvePlaceId?.(o.sourceRef) : undefined)) : undefined;
  return { label: o.label, location: { ...o.location }, source: o.source,
    ...(placeId ? { placeId } : {}), ...(o.accuracyMeters ? { accuracyMeters: o.accuracyMeters } : {}) };
}
function asOrigin(e: RouteEndpoint | null): Origin | null {
  return e ? { ...e, source: (e.source === 'discovery_origin' || e.source === 'search_result' ? 'local_suggestion' : e.source) as OriginSource } : null;
}
export interface TripFieldsConfig {
  store: Store<TripState, TripAction>;
  fromSuggestions: LocationSuggestionProvider;
  toSuggestions: LocationSuggestionProvider;
  geolocation?: GeolocationEnvironment;
  resolvePlaceId?(id: string): string | undefined;
  onSubmitText?(query: string): void;
  onDestination?(endpoint: RouteEndpoint): void;
}
export function createTripFields(c: TripFieldsConfig) {
  const field = (side: 'From' | 'To', provider: LocationSuggestionProvider) => createLocationField({
    provider, geolocation: c.geolocation, label: side === 'From' ? 'Starting location' : 'Destination',
    placeholder: side === 'From' ? 'Choose a starting location' : 'Choose a destination',
    allowCurrentLocation: side === 'From',
    onClear: () => c.store.dispatch({ type: side === 'From' ? 'setFrom' : 'setTo', endpoint: null }),
    onEdit: () => {
      if (c.store.getState()[side === 'From' ? 'from' : 'to']) c.store.dispatch({ type: side === 'From' ? 'setFrom' : 'setTo', endpoint: null });
    },
    onSubmitText: side === 'To' ? c.onSubmitText : undefined,
    onSelect: o => {
      const endpoint = originToEndpoint(o, c.resolvePlaceId);
      c.store.dispatch({ type: side === 'From' ? 'setFrom' : 'setTo', endpoint });
      if (side === 'To') c.onDestination?.(endpoint);
    },
  });
  const from = field('From', c.fromSuggestions), to = field('To', c.toSuggestions);
  const swap = h('button', { type: 'button', class: 'vb-icon-btn vb-planner-swap', 'aria-label': 'Swap starting location and destination' }, icon(ICONS.swap, 20));
  swap.addEventListener('click', () => c.store.dispatch({ type: 'swap' }));
  const root = h('div', { class: 'vb-planner-fields' }, from.root, swap, to.root);
  const render = (s: TripState) => { from.setValue(asOrigin(s.from)); to.setValue(asOrigin(s.to)); };
  const off = c.store.subscribe(render); render(c.store.getState());
  return { root, focusFrom: () => from.open(), close: () => { from.close(); to.close(); }, destroy: () => { off(); from.destroy(); to.destroy(); } };
}
