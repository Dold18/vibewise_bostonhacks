import { h, icon, ICONS } from '../../../discovery/ui/dom';
import { createSearchController, type PlaceSearchProvider } from '../../../discovery/placeSearch';
import type { Place } from '../../../osm';
import { createTripFields, type TripFieldsConfig } from './tripFields';
import { canRoute } from '../trip';
export function createTripSearch(c: TripFieldsConfig & {
  provider: PlaceSearchProvider; onOpen(): void; onClose(): void;
  onResults(places: Place[]): void; onSelect(place: Place): void;
}) {
  const status = h('p', { class: 'vb-view-status', role: 'status' });
  const list = h('ul', { class: 'vb-result-list', 'aria-label': 'Search results' });
  const controller = createSearchController(c.provider, s => {
    status.textContent = s.status === 'searching' ? 'Searching…' : s.status === 'error' ? 'Search unavailable. Try again.' : s.status === 'empty' ? 'No results found.' : '';
    list.replaceChildren();
    if (s.status === 'results') {
      c.onResults(s.results);
      for (const place of s.results) {
        const button = h('button', { type: 'button', class: 'vb-result' }, h('span', { class: 'vb-result-name' }, place.name), h('span', { class: 'vb-result-sub' }, place.tags.display_name ?? place.category));
        button.addEventListener('click', () => c.onSelect(place));
        list.append(h('li', {}, button));
      }
    }
  });
  const fields = createTripFields({ ...c, onSubmitText: q => { void controller.submit(q); } });
  const close = h('button', { type: 'button', class: 'vb-icon-btn', 'aria-label': 'Close search' }, icon(ICONS.close, 20));
  close.addEventListener('click', c.onClose);
  const directions = h('button', { type: 'button', class: 'vb-primary-btn vb-planner-find' }, 'Get Directions');
  directions.addEventListener('click', () => c.store.dispatch({ type: 'getDirections' }));
  const root = h('section', { class: 'vb-view', 'data-view': 'search', 'aria-label': 'Search', hidden: true },
    h('header', { class: 'vb-view-header' }, h('h3', { class: 'vb-view-title' }, 'Search'), close), fields.root,
    h('p', { class: 'vb-view-note' }, `Destination: press Enter for broader place search · ${c.provider.name}`), directions, status, list);
  root.addEventListener('keydown', e => { if(e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); c.onClose(); } });
  const off = c.store.subscribe(s => { directions.disabled = !canRoute(s); });
  directions.disabled = !canRoute(c.store.getState());
  return { root, focus: () => fields.focusFrom(), onOpen: c.onOpen,
    onClose: () => { controller.clear(); fields.close(); c.store.dispatch({ type: 'closeSearch' }); },
    destroy: () => { off(); controller.dispose(); fields.destroy(); } };
}
