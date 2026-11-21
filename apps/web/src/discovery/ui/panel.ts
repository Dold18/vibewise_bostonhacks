/**
 * The floating "Plan your outing" panel. Renders preference state, sends every
 * change through the preferences store, and collapses to a one-line summary
 * (never disappears) while the map's destination card is open.
 *
 * The body is a `data-step="preferences"` section so the Vibe Quiz can later
 * replace it inside the same panel without touching the map.
 */
import { bostonWallTime, toDateInputValue } from '../bostonTime';
import { qualificationsFor } from '../filter';
import type { GeolocationEnvironment, LocationSuggestionProvider } from '../locations';
import { mapLayersFor, type MapLayer } from '../mapLayers';
import {
  ACTIVITY_OPTIONS,
  ACTIVITY_TYPE_OPTIONS,
  BUDGET_OPTIONS,
  CUISINE_OPTIONS,
  initialPreferences,
  secondaryFieldFor,
  summarizePreferences,
  VIBE_TEXT_MAX_LENGTH,
  type InitialPreferences,
  type PreferencesAction,
} from '../preferences';
import { isExpanded, type LayoutAction, type LayoutState, type Store } from '../store';
import { h, icon, ICONS, uid } from './dom';
import { createLocationField } from './locationField';
import { createMultiSelectField } from './multiSelectField';
import { createSelectField } from './selectField';
import { createTimingField } from './timingField';
import {
  createQuickTools,
  createSavedView,
  createSearchView,
  type SavedViewConfig,
  type SearchViewConfig,
} from './panelViews';

export interface PanelDeps {
  prefs: Store<InitialPreferences, PreferencesAction>;
  layout: Store<LayoutState, LayoutAction>;
  provider: LocationSuggestionProvider;
  geolocation?: GeolocationEnvironment;
  now: () => Date;
  /** The map's place categories, when the panel drives what the map loads. */
  mapLayers?: readonly MapLayer[];
  /** Quick Tools: each tool appears only if provided. */
  search?: Omit<SearchViewConfig, 'onBack'>;
  saved?: Omit<SavedViewConfig, 'onBack'>;
  onRecenter?: () => void;
}

export type PanelView = 'preferences' | 'search' | 'saved';
export type OverlayKind = 'popup' | 'planner' | null;

export interface Panel {
  root: HTMLElement;
  /** Close any open dropdown or search inside the panel. */
  closePopups(): void;
  showView(view: PanelView): void;
  /** Which map overlay is open (for placing the collapsed summary). */
  setOverlayKind(kind: OverlayKind): void;
  destroy(): void;
}

export function createPanel({ prefs, layout, provider, geolocation, now, mapLayers, search, saved, onRecenter }: PanelDeps): Panel {
  const dispatch = prefs.dispatch;
  const bodyId = uid('panel-body');
  const titleId = uid('panel-title');

  // --- Fields ---------------------------------------------------------------
  const activity = createSelectField({
    label: 'Activity',
    placeholder: 'Choose an activity',
    options: ACTIVITY_OPTIONS,
    onSelect: (id) => dispatch({ type: 'setActivity', activity: id }),
  });
  const cuisines = createMultiSelectField({
    label: 'Preferred cuisines',
    placeholder: 'Any cuisine',
    options: CUISINE_OPTIONS,
    onToggle: (id) => dispatch({ type: 'toggleSubtype', id }),
    onClear: () => dispatch({ type: 'clearSubtypes' }),
  });
  const activityTypes = createMultiSelectField({
    label: 'Types of activities',
    placeholder: 'Any type',
    options: ACTIVITY_TYPE_OPTIONS,
    onToggle: (id) => dispatch({ type: 'toggleSubtype', id }),
    onClear: () => dispatch({ type: 'clearSubtypes' }),
  });
  const origin = createLocationField({
    provider,
    geolocation,
    onSelect: (o) => dispatch({ type: 'setOrigin', origin: o }),
  });
  const budget = createSelectField({
    label: 'Budget per person',
    placeholder: 'Choose a budget',
    options: BUDGET_OPTIONS,
    onSelect: (choice) => dispatch({ type: 'setBudget', choice }),
  });
  const timing = createTimingField({
    now,
    onChoose: (kind) => {
      if (kind === 'custom' && !prefs.getState().customTiming.date) {
        // Start the date picker on today (Boston); the time is left for the user.
        const today = toDateInputValue(bostonWallTime(now()));
        dispatch({ type: 'setCustomTiming', date: today, time: prefs.getState().customTiming.time, now: now() });
      } else {
        dispatch({ type: 'setTiming', kind, now: now() });
      }
    },
    onCustomChange: (date, time) => dispatch({ type: 'setCustomTiming', date, time, now: now() }),
  });

  const vibeId = uid('vibe');
  const vibeCountId = uid('vibe-count');
  const vibe = h('textarea', {
    id: vibeId,
    class: 'vb-textarea',
    rows: 3,
    maxlength: VIBE_TEXT_MAX_LENGTH,
    placeholder: 'An intimate cafe on a rainy night, somewhere lively with friends...',
    'aria-describedby': vibeCountId,
  });
  const vibeCount = h('span', { class: 'vb-counter', id: vibeCountId }, `0/${VIBE_TEXT_MAX_LENGTH}`);
  vibe.addEventListener('input', () => dispatch({ type: 'setVibeText', text: vibe.value }));
  const vibeField = h(
    'div',
    { class: 'vb-field vb-vibe' },
    h('label', { class: 'vb-label', for: vibeId }, 'Describe your vibe ', h('span', { class: 'vb-optional' }, '(optional)')),
    vibe,
    h('div', { class: 'vb-field-foot' }, h('span', { class: 'vb-hint-inline' }, 'Saved for the upcoming vibe matching.'), vibeCount),
  );

  // --- Notes, header, footer ------------------------------------------------
  const notesList = h('ul', { class: 'vb-notes-list' });
  const notes = h(
    'section',
    { class: 'vb-notes', hidden: true, 'aria-label': 'How your preferences are used' },
    h('h3', { class: 'vb-notes-title' }, 'How these are used right now'),
    notesList,
  );

  const minimizeBtn = h(
    'button',
    { type: 'button', class: 'vb-icon-btn vb-minimize', 'aria-label': 'Minimize preferences', 'aria-expanded': 'true', 'aria-controls': bodyId },
    icon(ICONS.chevronDown, 22),
  );
  const resetBtn = h('button', { type: 'button', class: 'vb-text-btn' }, 'Clear all');
  resetBtn.addEventListener('click', () => {
    dispatch({ type: 'reset' });
    activity.focus();
  });

  const summaryText = h('span', { class: 'vb-summary-text' });
  const summaryBtn = h(
    'button',
    { type: 'button', class: 'vb-summary-btn', 'aria-expanded': 'false', 'aria-controls': bodyId },
    h('span', { class: 'vb-handle', 'aria-hidden': 'true' }),
    icon(ICONS.tune, 20, 'vb-icon vb-summary-icon'),
    h('span', { class: 'vb-summary-stack' }, h('span', { class: 'vb-summary-title' }, 'Your preferences'), summaryText),
    icon(ICONS.chevronDown, 20, 'vb-icon vb-summary-chevron'),
  );

  // --- Quick Tools and secondary views ---------------------------------------
  const searchView = search ? createSearchView({ ...search, onBack: () => showView('preferences', 'search') }) : null;
  const savedView = saved ? createSavedView({ ...saved, onBack: () => showView('preferences', 'saved') }) : null;
  const quickTools = createQuickTools({
    search: searchView ? () => showView('search') : undefined,
    saved: savedView ? () => showView('saved') : undefined,
    recenter: onRecenter,
  });
  const hasTools = !!(searchView || savedView || onRecenter);
  quickTools.setSavedCount(saved?.store.list().length ?? 0);
  const unsubSavedCount = saved?.store.subscribe((items) => quickTools.setSavedCount(items.length));

  const subtitle = h('p', { class: 'vb-subtitle' }, 'Set the basics. The map stays live while you choose.');
  const stepSection = h(
    'section',
    { class: 'vb-step', 'data-step': 'preferences', 'aria-labelledby': titleId },
    activity.root,
    cuisines.root,
    activityTypes.root,
    origin.root,
    budget.root,
    timing.root,
    hasTools ? quickTools.root : null,
    vibeField,
    notes,
  );
  const footer = h(
    'footer',
    { class: 'vb-footer' },
    h(
      'p',
      { class: 'vb-footer-note' },
      mapLayers
        ? "Activity sets which places the map loads. Other choices are saved but don't filter pins yet."
        : "Preview: preferences are saved but don't filter map pins yet.",
    ),
    resetBtn,
  );

  const body = h(
    'div',
    { class: 'vb-body', id: bodyId },
    h(
      'header',
      { class: 'vb-header' },
      h('span', { class: 'vb-handle', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'vb-header-text' },
        h('h2', { class: 'vb-title', id: titleId }, 'Plan your outing'),
        subtitle,
      ),
      minimizeBtn,
    ),
    stepSection,
    searchView?.root ?? null,
    savedView?.root ?? null,
    footer,
  );

  let view: PanelView = 'preferences';
  /** Switch views; returning to preferences puts focus back on the tool that opened the view. */
  function showView(next: PanelView, from?: 'search' | 'saved') {
    if (next !== 'preferences' && !isExpanded(layout.getState())) layout.dispatch({ type: 'expand' });
    view = next;
    closePopups();
    stepSection.hidden = next !== 'preferences';
    footer.hidden = next !== 'preferences';
    subtitle.hidden = next !== 'preferences';
    if (searchView) searchView.root.hidden = next !== 'search';
    if (savedView) savedView.root.hidden = next !== 'saved';
    root.dataset.panelView = next; // data-panel-view (views themselves carry data-view)
    if (next === 'search') searchView?.focus();
    else if (next === 'saved') savedView?.focus();
    else if (from) quickTools.focus(from);
  }

  const root = h('aside', { class: 'vb-discovery', 'aria-label': 'Plan your outing' }, summaryBtn, body);

  // --- Layout ---------------------------------------------------------------
  const fields = [activity, cuisines, activityTypes, origin, budget, timing];
  const closePopups = () => fields.forEach((f) => f.close());

  minimizeBtn.addEventListener('click', () => {
    layout.dispatch({ type: 'collapse' });
    summaryBtn.focus();
  });
  summaryBtn.addEventListener('click', () => {
    layout.dispatch({ type: 'expand' });
    minimizeBtn.focus();
  });

  function renderLayout(s: LayoutState) {
    const expanded = isExpanded(s);
    root.classList.toggle('is-expanded', expanded);
    root.classList.toggle('is-collapsed', !expanded);
    root.classList.toggle('card-open', s.cardOpen);
    body.hidden = !expanded;
    summaryBtn.hidden = expanded;
    summaryBtn.setAttribute('aria-expanded', String(expanded));
    minimizeBtn.setAttribute('aria-expanded', String(expanded));
    if (!expanded) closePopups();
  }

  // --- Render preferences ---------------------------------------------------
  function render(state: InitialPreferences) {
    activity.setValue(state.activity);
    const secondary = secondaryFieldFor(state.activity);
    cuisines.setVisible(secondary === 'cuisines');
    activityTypes.setVisible(secondary === 'activityTypes');
    cuisines.setSelected(state.cuisines);
    activityTypes.setSelected(state.activityTypes);
    renderMapHints(state);
    origin.setValue(state.origin);
    budget.setValue(state.budget?.choice ?? null);
    budget.setHint(
      state.budget && state.budget.maxCentsPerPerson !== null ? 'Estimated total per person, before transit fare.' : '',
    );
    timing.update(state);
    if (vibe.value !== state.vibeText) vibe.value = state.vibeText;
    vibeCount.textContent = `${state.vibeText.length}/${VIBE_TEXT_MAX_LENGTH}`;

    const q = qualificationsFor(state);
    notesList.replaceChildren(...q.map((text) => h('li', {}, text)));
    notes.hidden = q.length === 0;

    const parts = summarizePreferences(state);
    summaryText.textContent = parts.length ? parts.join(' · ') : 'Set activity, start, budget and time';
    resetBtn.disabled = JSON.stringify(state) === EMPTY_STATE;
  }
  const EMPTY_STATE = JSON.stringify(initialPreferences());

  /** Say plainly what the map is showing for these preferences, and what it can't show yet. */
  function renderMapHints(state: InitialPreferences) {
    if (!mapLayers) return;
    const sel = mapLayersFor(state, mapLayers);
    const labels = (ids: readonly string[]) =>
      mapLayers.filter((l) => ids.includes(l.id)).map((l) => l.label).join(', ');
    activity.setHint(
      sel.detail === 'tiles'
        ? 'Until you choose, the map shows nearby places of every type it supports.'
        : sel.layerIds.length
          ? `On the map: ${labels(sel.layerIds)}`
          : 'Nothing on the map matches these choices yet.',
    );

    const unsupported = ACTIVITY_TYPE_OPTIONS.filter((o) => sel.unsupportedActivityTypes.includes(o.id)).map((o) => o.label);
    activityTypes.setHint(
      unsupported.length === 0
        ? ''
        : sel.layerIds.length === 0
          ? `${unsupported.join(', ')} ${unsupported.length === 1 ? "isn't" : "aren't"} on the map yet, so no places are shown. Your choice is saved.`
          : `Not on the map yet: ${unsupported.join(', ')}. Your choice is saved.`,
      'warning',
    );
    cuisines.setHint(
      state.cuisines.length ? "Saved for recommendations. Cuisine doesn't filter map pins yet." : '',
    );
  }

  const unsubPrefs = prefs.subscribe(render);
  const unsubLayout = layout.subscribe(renderLayout);
  render(prefs.getState());
  renderLayout(layout.getState());

  return {
    root,
    closePopups,
    showView: (next) => {
      if (next !== view) showView(next);
    },
    setOverlayKind(kind) {
      root.classList.toggle('overlay-popup', kind === 'popup');
      root.classList.toggle('overlay-planner', kind === 'planner');
    },
    destroy() {
      unsubPrefs();
      unsubLayout();
      fields.forEach((f) => f.destroy());
      searchView?.destroy();
      savedView?.destroy();
      unsubSavedCount?.();
    },
  };
}
