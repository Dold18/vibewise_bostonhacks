/** Navigation card driven by the shared trip lifecycle and the Express API. */
import { createStore, type Store } from '../../../discovery/store';
import { h, icon, ICONS } from '../../../discovery/ui/dom';
import { createTripFields, type TripFieldsConfig } from './tripFields';
import { initialTripState, tripReducer, createTripRouter, missingEndpoint, type TripState, type TripAction } from '../trip';
import { estimatedWalkArc } from '../../../transitRoute';
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
  const close = h('button', { type: 'button', class: 'vb-icon-btn', 'aria-label': 'Collapse directions' }, icon(ICONS.close, 20));
  const exit = h('button', { type: 'button', class: 'vb-text-btn vb-exit-navigation', 'aria-label': 'Exit Navigation' }, 'Exit');
  const estimateNote = h('small', { class: 'vb-directions-estimates', hidden: true }, 'Walking estimates');
  const pill = h('button', { type: 'button', class: 'vb-directions-pill', 'aria-expanded': 'false' }, icon(ICONS.directions, 20), h('span', { class: 'vb-directions-pill-copy' }, h('span', {}, 'Directions'), estimateNote));
  const compactExit = h('button', { type: 'button', class: 'vb-text-btn vb-exit-navigation', 'aria-label': 'Exit Navigation' }, 'Exit');
  const control = h('div', { class: 'vb-directions-control', hidden: true }, pill, compactExit);
  const results = h('div', { class: 'vb-planner-results', 'aria-live': 'polite' });
  const root = h('section', { class: 'vb-ui vb-planner', role: 'dialog', 'aria-label': 'Directions', id: 'vb-directions-panel', hidden: true },
    h('header', { class: 'vb-planner-header' }, h('h2', { class: 'vb-planner-title' }, 'Directions'), exit, close), fields.root, results);
  const end = () => { fields.close(); store.dispatch({ type: 'endNavigation' }); };
  const collapse = () => { fields.close(); store.dispatch({ type: 'setDirectionsExpanded', expanded: false }); pill.focus(); };
  pill.setAttribute('aria-controls', 'vb-directions-panel');
  pill.addEventListener('click', () => store.dispatch({ type: 'setDirectionsExpanded', expanded: true }));
  close.addEventListener('click', collapse);
  exit.addEventListener('click', end); compactExit.addEventListener('click', end);
  root.addEventListener('keydown', e => { if(e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); collapse(); } });
  function render(s: TripState, prev?: TripState) {
    root.hidden = !s.navigationOpen || !s.directionsExpanded;
    control.hidden = !s.navigationOpen || s.directionsExpanded;
    pill.setAttribute("aria-expanded", String(s.directionsExpanded));
    estimateNote.hidden = !(s.route.kind === 'done' && s.route.result.status === 'ok' && s.route.result.route.option.legs.some(l => !!estimatedWalkArc(l)));
    results.replaceChildren();
    const missing = missingEndpoint(s);
    const p = (text: string) => h('p', { class: 'vb-planner-notice' }, text);
    if (missing) results.append(p(missing === 'to' ? 'Choose a destination from the suggestions.' : 'Choose a starting location, or select Use current location.'));
    else if (s.route.kind === 'loading') results.append(p('Checking MBTA service…'));
    else if (s.route.kind === 'done') {
      const r = s.route.result;
      if (r.status === 'ok') {
        const itinerary = buildItinerary(r.route, { fromLabel: s.from!.label, toLabel: s.to!.label });
        if (!estimateNote.hidden) results.append(p('Dashed arcs are estimated walking connections, not verified pedestrian directions. Follow streets and crossings; the arcs do not show a walking path.'));
        results.append(h('p', { class: 'vb-route-summary' }, itinerary.summary), p(itinerary.summaryNote));
        if (itinerary.departure) results.append(p(itinerary.departure));
        const steps = h('ol', { class: 'vb-route-legs' });
        for (const step of itinerary.steps) {
          const row = h('li', step.kind === 'wait' ? { class: 'vb-leg-wait' } : {});
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
    }
  }
  const focusOff = store.subscribe((s, prev) => {
    if (s.navigationOpen && s.directionsExpanded && (!prev.navigationOpen || !prev.directionsExpanded)) queueMicrotask(() => { if (!store.getState().directionsExpanded) return; if (!s.from) fields.focusFrom(); else close.focus(); });
  });
  const off = store.subscribe(render); render(store.getState());
  return { root, control, open: ({ from, to }: { from: RouteEndpoint | null; to: RouteEndpoint | null }) => {
    if (to) store.dispatch({ type: 'navigateTo', destination: to, discoveryOrigin: from });
  }, close: end, isOpen: () => store.getState().navigationOpen, getState: store.getState,
    destroy: () => { off(); focusOff(); router?.dispose(); fields.destroy(); root.remove(); control.remove(); } };
}
