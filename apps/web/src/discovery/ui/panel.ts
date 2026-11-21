/**
 * The floating "Plan your outing" panel. Renders preference state, sends every
 * change through the preferences store, and collapses to a one-line summary
 * (never disappears) while the map's destination card is open.
 *
 * The user first sets practical constraints, then moves into a dedicated
 * inspiration screen. Both screens share the existing preferences store;
 * future Akinator questions can replace/extend the second screen.
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
  type InitialPreferences,
  type PreferencesAction,
} from '../preferences';
import { isExpanded, type LayoutAction, type LayoutState, type Store } from '../store';
import { h, icon, ICONS, uid } from './dom';
import { createLocationField } from './locationField';
import { createMultiSelectField } from './multiSelectField';
import { createSelectField } from './selectField';
import { createTimingField } from './timingField';
import { createVibeStep } from './vibeStep';

export interface PanelDeps {
  prefs: Store<InitialPreferences, PreferencesAction>;
  layout: Store<LayoutState, LayoutAction>;
  provider: LocationSuggestionProvider;
  geolocation?: GeolocationEnvironment;
  now: () => Date;
  /** The map's place categories, when the panel drives what the map loads. */
  mapLayers?: readonly MapLayer[];
}

export interface Panel {
  root: HTMLElement;
  /** Close any open dropdown or search inside the panel. */
  closePopups(): void;
  destroy(): void;
}

export function createPanel({ prefs, layout, provider, geolocation, now, mapLayers }: PanelDeps): Panel {
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

  const vibeStep = createVibeStep(prefs);
  let currentStep: 'plan' | 'vibe' = 'plan';

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
    showStep('plan');
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

  const heading = h('h2', { class: 'vb-title', id: titleId, tabindex: '-1' }, 'Plan your outing');
  const subtitle = h('p', { class: 'vb-subtitle' }, 'First, the basics. Then we’ll find the feeling.');

  const planSection = h(
    'section',
    { class: 'vb-step', 'data-step': 'preferences', 'aria-labelledby': titleId },
    activity.root,
    cuisines.root,
    activityTypes.root,
    origin.root,
    budget.root,
    timing.root,
    notes,
  );
  const vibeSection = h(
    'section',
    { class: 'vb-step', 'data-step': 'vibe', 'aria-labelledby': titleId, hidden: true },
    vibeStep.root,
  );

  const continueBtn = h('button', { type: 'button', class: 'vb-primary-btn vb-continue-btn' }, 'Continue to your vibe');
  const backBtn = h('button', { type: 'button', class: 'vb-text-btn vb-back-btn' }, 'Back to details');
  const doneBtn = h('button', { type: 'button', class: 'vb-primary-btn vb-continue-btn' }, 'Save my vibe');

  const planActions = h('div', { class: 'vb-footer-actions' }, resetBtn, continueBtn);
  const vibeActions = h('div', { class: 'vb-footer-actions', hidden: true }, backBtn, doneBtn);
  const footerNote = h('p', { class: 'vb-step-footnote' },
    'Next: describe the atmosphere you have in mind. All these details stay saved.');
  const footer = h('footer', { class: 'vb-footer vb-step-footer' }, footerNote, planActions, vibeActions);
  const body = h(
    'div',
    { class: 'vb-body', id: bodyId },
    h(
      'header',
      { class: 'vb-header' },
      h('span', { class: 'vb-handle', 'aria-hidden': 'true' }),
      h('div', { class: 'vb-header-text' }, heading, subtitle),
      minimizeBtn,
    ),
    planSection,
    vibeSection,
    footer,
  );

  function showStep(next: 'plan' | 'vibe') {
    currentStep = next;
    planSection.hidden = next !== 'plan';
    vibeSection.hidden = next !== 'vibe';
    planActions.hidden = next !== 'plan';
    vibeActions.hidden = next !== 'vibe';
    root.dataset.step = next;
    heading.textContent = next === 'plan' ? 'Plan your outing' : 'Find your vibe';
    subtitle.textContent = next === 'plan'
      ? 'First, the basics. Then we’ll find the feeling.'
      : 'Use words, images, memories or music to show us what you mean.';
    footerNote.textContent = next === 'plan'
      ? 'Next: describe the atmosphere you have in mind. All these details stay saved.'
      : 'Your inspiration is saved here. Visual matching and the adaptive quiz are coming next.';
    if (next === 'vibe') {
      closePopups();
      // Keep the instructional placeholder visible until the user clicks the box.
      // Focus the step heading for accessible navigation instead of the textarea.
      heading.focus();
    } else {
      activity.focus();
    }
  }

  continueBtn.addEventListener('click', () => showStep('vibe'));
  backBtn.addEventListener('click', () => showStep('plan'));
  doneBtn.addEventListener('click', () => {
    layout.dispatch({ type: 'collapse' });
    summaryBtn.focus();
  });

  const root = h('aside', { class: 'vb-discovery', 'aria-label': 'Plan your outing' }, summaryBtn, body);
  root.dataset.step = currentStep;

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
    vibeStep.render(state);

    const q = qualificationsFor(state);
    notesList.replaceChildren(...q.map((text) => h('li', {}, text)));
    notes.hidden = q.length === 0;

    const parts = summarizePreferences(state);
    if (state.vibeText.trim() || state.vibeImages.length > 0) parts.push('Vibe saved' + (state.vibeImages.length ? ` · ${state.vibeImages.length} photo${state.vibeImages.length === 1 ? '' : 's'}` : ''));
    summaryText.textContent = parts.length ? parts.join(' · ') : 'Plan your outing and define the vibe';
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
    destroy() {
      unsubPrefs();
      unsubLayout();
      fields.forEach((f) => f.destroy());
      vibeStep.destroy();
    },
  };
}
