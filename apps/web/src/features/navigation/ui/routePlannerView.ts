/** Navigation card driven by the shared trip lifecycle and the Express API. */
import { createStore, type Store } from '../../../discovery/store';
import { h, icon, ICONS } from '../../../discovery/ui/dom';
import { createTripFields, type TripFieldsConfig } from './tripFields';
import { initialTripState, tripReducer, createTripRouter, missingEndpoint, type TripState, type TripAction } from '../trip';
import { buildItinerary, bostonTime } from '../itinerary';
import type { RouteEndpoint, RouteProvider } from '../routing';
import '../navigation.css';
export { originToEndpoint } from './tripFields';
export interface RoutePlannerConfig extends Omit<TripFieldsConfig, 'store'> {
  store?: Store<TripState, TripAction>;
  provider: RouteProvider | null;
  onOpenChange?(open: boolean): void;
}
export function createRoutePlanner(c: RoutePlannerConfig) {
  const store = c.store ?? createStore(tripReducer, initialTripState());
  const router = !c.store && c.provider ? createTripRouter(store, c.provider) : null;
  const fields = createTripFields({ ...c, store });
  const close = h('button', { type: 'button', class: 'vb-icon-btn', 'aria-label': 'Close directions' }, icon(ICONS.close, 20));
  const results = h('div', { class: 'vb-planner-results', 'aria-live': 'polite' });
  const root = h('section', { class: 'vb-ui vb-planner', role: 'dialog', 'aria-label': 'Directions', hidden: true },
    h('header', { class: 'vb-planner-header' }, h('h2', { class: 'vb-planner-title' }, 'Directions'), close), fields.root, results);
  const end = () => { fields.close(); store.dispatch({ type: 'endNavigation' }); };
  close.addEventListener('click', end);
  root.addEventListener('keydown', e => { if(e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); end(); } });
  function render(s: TripState, prev?: TripState) {
    root.hidden = !s.navigationOpen;
    results.replaceChildren();
    const missing = missingEndpoint(s);
    const p = (text: string) => h('p', { class: 'vb-planner-notice' }, text);
    if (missing) results.append(p(missing === 'to' ? 'Choose a destination from the suggestions.' : 'Choose a starting location, or select Use current location.'));
    else if (s.route.kind === 'loading') results.append(p('Checking MBTA service…'));
    else if (s.route.kind === 'done') {
      const r = s.route.result;
      if (r.status === 'ok') {
        const itinerary = buildItinerary(r.route, { fromLabel: s.from!.label, toLabel: s.to!.label });
        results.append(h('p', { class: 'vb-route-summary' }, itinerary.summary), p(itinerary.summaryNote));
        if (itinerary.departure) results.append(p(itinerary.departure));
        const steps = h('ol', { class: 'vb-route-legs' });
        for (const step of itinerary.steps) {
          const row = h('li', {});
          if (step.kind === 'ride') {
            const chip = h('strong', { class: 'vb-line-chip' }, step.line);
            chip.style.borderLeft = `6px solid ${step.color}`;
            row.append(chip, h('div', {}, `${step.from} → ${step.to}`), h('div', {}, step.schedule ?? step.detail));
          } else row.append(h('strong', {}, step.text), h('div', {}, step.detail ?? ''));
          steps.append(row);
        }
        results.append(steps, p(itinerary.lastTrain), h('p', { class: 'vb-planner-source' }, `Source: ${r.provider}`));
      } else {
        results.append(p(`${r.status === 'error' ? `${r.reason === 'unreachable' ? 'API unreachable' : r.reason === 'invalid_response' ? 'Invalid response' : 'Route service error'}: ` : ''}${r.message}`));
        if (r.status === 'no_service' && r.nextScheduledDepartureAt) results.append(p(`Next scheduled departure: ${bostonTime(r.nextScheduledDepartureAt)}`));
        const retry = h('button', { type: 'button', class: 'vb-text-btn' }, 'Retry');
        retry.addEventListener('click', () => store.dispatch({ type: 'retry' })); results.append(retry);
      }
    }
    if (s.navigationOpen !== prev?.navigationOpen) {
      c.onOpenChange?.(s.navigationOpen);
      if (s.navigationOpen) queueMicrotask(() => { if (!s.from) fields.focusFrom(); else close.focus(); });
    }
  }
  const off = store.subscribe(render); render(store.getState());
  return { root, open: ({ from, to }: { from: RouteEndpoint | null; to: RouteEndpoint | null }) => {
    if (to) store.dispatch({ type: 'navigateTo', destination: to, discoveryOrigin: from });
  }, close: end, isOpen: () => store.getState().navigationOpen, getState: store.getState,
    destroy: () => { off(); router?.dispose(); fields.destroy(); root.remove(); } };
}
