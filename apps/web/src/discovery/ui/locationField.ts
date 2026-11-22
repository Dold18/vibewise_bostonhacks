/**
 * Starting point: a compact field that turns into a search box with
 * suggestions (WAI-ARIA combobox with list autocomplete) and a
 * "Use current location" action.
 *
 * Suggestions come from whatever `LocationSuggestionProvider` is passed in;
 * the list is labelled with the provider's description so an offline list is
 * never mistaken for live address search.
 */
import {
  GEOLOCATION_MESSAGES,
  requestCurrentLocation,
  suggestionToOrigin,
  type GeolocationEnvironment,
  type LocationSuggestion,
  type LocationSuggestionProvider,
} from '../locations';
import type { Origin } from '../preferences';
import { h, icon, ICONS, onOutsideInteraction, uid } from './dom';
import type { IconName } from '../../design/vibewise/icons';

export interface LocationFieldConfig {
  provider: LocationSuggestionProvider;
  /** Field label (default "Starting point"). */
  label?: string;
  /** Collapsed placeholder (default "Choose a starting point"). */
  placeholder?: string;
  /** Search box placeholder. */
  searchPlaceholder?: string;
  /** Offer "Use current location" (default true). */
  allowCurrentLocation?: boolean;
  onSelect(origin: Origin, meta: { outsideBoston?: boolean }): void;
  geolocation?: GeolocationEnvironment;
  onClear?(): void;
  onSubmitText?(query: string): void;
  onEdit?(): void;
}

export interface LocationField {
  root: HTMLElement;
  setValue(origin: Origin | null): void;
  open(): void;
  close(): void;
  destroy(): void;
}

const KIND_ICON: Record<string, IconName> = {
  station: ICONS.train,
  university: ICONS.school,
  landmark: ICONS.landmark,
  place: ICONS.landmark,
  saved: ICONS.bookmark,
};

const SEARCH_DEBOUNCE_MS = 120;

export function createLocationField(config: LocationFieldConfig): LocationField {
  const labelId = uid('label');
  const valueId = uid('value');
  const listId = uid('suggestions');
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // Collapsed state
  const placeholder = config.placeholder ?? 'Choose a starting point';
  const valueText = h('span', { class: 'vb-trigger-value is-placeholder', id: valueId }, placeholder);
  const valueSub = h('span', { class: 'vb-trigger-sub', hidden: true });
  const trigger = h(
    'button',
    { type: 'button', class: 'vb-trigger vb-trigger-location', 'aria-labelledby': `${labelId} ${valueId}` },
    icon(ICONS.landmark, 20, 'vb-icon vb-lead-icon'),
    h('span', { class: 'vb-trigger-stack' }, valueText, valueSub),
    icon(ICONS.search, 20, 'vb-icon vb-chevron'),
  );

  // Editing state
  const input = h('input', {
    type: 'text',
    class: 'vb-search-input',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-labelledby': labelId,
    'aria-describedby': `${listId}-caption`,
    placeholder: config.searchPlaceholder ?? 'T station, campus or landmark',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
  });
  const cancelBtn = h('button', { type: 'button', class: 'vb-icon-btn vb-small', 'aria-label': 'Cancel' }, icon(ICONS.close, 18));
  const geoBtn = h(
    'button',
    { type: 'button', class: 'vb-geo-btn', hidden: config.allowCurrentLocation === false },
    icon(ICONS.myLocation, 20, 'vb-icon'),
    h('span', {}, 'Use current location'),
  );
  const geoStatus = h('p', { class: 'vb-geo-status', role: 'status', 'aria-live': 'polite' });
  const caption = h(
    'p',
    { class: 'vb-suggest-caption', id: `${listId}-caption` },
    config.provider.live ? config.provider.description : `${config.provider.description}. Live address search isn't connected yet.`,
  );
  const list = h('ul', { id: listId, role: 'listbox', class: 'vb-suggestions', 'aria-label': 'Starting point suggestions', hidden: true });
  const emptyMsg = h('p', { class: 'vb-empty', hidden: true });
  const listLabel = config.provider.live ? 'list' : 'offline list';
  const editor = h(
    'div',
    { class: 'vb-location-editor', hidden: true },
    h('div', { class: 'vb-search-box' }, icon(ICONS.search, 20, 'vb-icon'), input, cancelBtn),
    h('div', { class: 'vb-popover vb-location-popover' }, geoBtn, geoStatus, caption, list, emptyMsg),
  );

  const warning = h('p', { class: 'vb-hint is-warning', hidden: true, role: 'status' });
  const root = h(
    'div',
    { class: 'vb-field' },
    h('span', { class: 'vb-label', id: labelId }, config.label ?? 'Starting point'),
    h('div', { class: 'vb-control' }, trigger, editor),
    warning,
  );

  if (config.onClear) {
    const clear = h('button', { type: 'button', class: 'vb-text-btn', 'aria-label': `Clear ${config.label ?? 'location'}` }, 'Clear');
    clear.addEventListener('click', () => { config.onClear?.(); setEditing(true); });
    root.append(clear);
  }

  let editing = false;
  let suggestions: LocationSuggestion[] = [];
  let active = -1;
  let searchTimer: number | undefined;
  let searchAbort: AbortController | undefined;
  let searchSeq = 0;
  let locating = false;
  let destroyed = false;

  function setEditing(next: boolean, { restoreFocus = false } = {}) {
    if (next === editing) return;
    editing = next;
    ++searchSeq;
    trigger.hidden = next;
    editor.hidden = !next;
    root.classList.toggle('is-open', next);
    if (next) {
      input.value = '';
      geoStatus.textContent = '';
      geoStatus.classList.remove('is-error');
      renderSuggestions([], '');
      input.focus();
      editor.scrollIntoView({ block: 'nearest' });
    } else {
      window.clearTimeout(searchTimer);
      searchAbort?.abort();
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      if (restoreFocus) trigger.focus();
    }
  }

  function renderSuggestions(items: LocationSuggestion[], query: string) {
    suggestions = items;
    active = -1;
    input.removeAttribute('aria-activedescendant');
    list.replaceChildren(
      ...items.map((s, i) =>
        h(
          'li',
          { id: optionId(i), role: 'option', class: 'vb-suggestion', 'aria-selected': 'false' },
          icon(KIND_ICON[s.kind] ?? ICONS.landmark, 18, 'vb-icon vb-suggestion-icon'),
          h('span', { class: 'vb-suggestion-text' }, h('span', { class: 'vb-suggestion-name' }, s.label), s.secondary ? h('span', { class: 'vb-suggestion-sub' }, s.secondary) : null),
        ),
      ),
    );
    [...list.children].forEach((li, i) => {
      li.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('pointermove', () => active !== i && setActive(i));
      li.addEventListener('click', () => choose(i));
    });
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(items.length > 0));
    const trimmed = query.trim();
    emptyMsg.hidden = !trimmed || items.length > 0;
    emptyMsg.textContent = trimmed
      ? `No matches for "${trimmed}" in the ${listLabel}. Try a nearby T station, campus or landmark.`
      : '';
  }

  function setActive(i: number) {
    if (suggestions.length === 0) return;
    active = (i + suggestions.length) % suggestions.length;
    [...list.children].forEach((li, j) => {
      li.classList.toggle('is-active', j === active);
      li.setAttribute('aria-selected', String(j === active));
    });
    input.setAttribute('aria-activedescendant', optionId(active));
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i: number) {
    const s = suggestions[i];
    if (!s) return;
    warning.hidden = true;
    config.onSelect(suggestionToOrigin(s), {});
    setEditing(false, { restoreFocus: true });
  }

  function search(query: string) {
    window.clearTimeout(searchTimer);
    searchAbort?.abort();
    const seq = ++searchSeq;
    if (!query.trim()) {
      renderSuggestions([], '');
      return;
    }
    searchTimer = window.setTimeout(async () => {
      const abort = (searchAbort = new AbortController());
      try {
        const items = await config.provider.search(query, { limit: 8, signal: abort.signal });
        // Ignore late results for an older query.
        if (seq === searchSeq && editing && !destroyed) renderSuggestions(items, query);
      } catch (err) {
        if ((err as Error).name === 'AbortError' || seq !== searchSeq) return;
        renderSuggestions([], '');
        emptyMsg.hidden = false;
        emptyMsg.textContent = "Suggestions aren't available right now.";
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  async function useCurrentLocation() {
    if (locating) return;
    locating = true;
    geoBtn.disabled = true;
    geoBtn.setAttribute('aria-busy', 'true');
    geoStatus.classList.remove('is-error');
    geoStatus.textContent = 'Finding your location…';
    const result = await requestCurrentLocation(config.geolocation);
    locating = false;
    geoBtn.disabled = false;
    geoBtn.removeAttribute('aria-busy');
    if (destroyed) return;
    if (result.ok) {
      geoStatus.textContent = '';
      warning.textContent = result.outsideBoston
        ? 'This location looks outside the Boston area, so distances may not be useful.'
        : '';
      warning.hidden = !result.outsideBoston;
      config.onSelect(result.origin, { outsideBoston: result.outsideBoston });
      setEditing(false, { restoreFocus: true });
    } else {
      geoStatus.classList.add('is-error');
      geoStatus.textContent = GEOLOCATION_MESSAGES[result.reason];
    }
  }

  trigger.addEventListener('click', () => setEditing(true));
  cancelBtn.addEventListener('click', () => setEditing(false, { restoreFocus: true }));
  geoBtn.addEventListener('click', useCurrentLocation);
  input.addEventListener('input', () => { config.onEdit?.(); search(input.value); });
  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(active - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (active >= 0) choose(active);
        else if (config.onSubmitText) config.onSubmitText(input.value);
        else if (suggestions.length === 1) choose(0);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setEditing(false, { restoreFocus: true });
        break;
    }
  });

  const stopOutside = onOutsideInteraction(root, () => editing, () => setEditing(false));

  return {
    root,
    setValue(origin) {
      valueText.textContent = origin ? origin.label : placeholder;
      valueText.classList.toggle('is-placeholder', !origin);
      valueSub.textContent = origin?.secondaryLabel ?? '';
      valueSub.hidden = !origin?.secondaryLabel;
      root.classList.toggle('has-value', !!origin);
      if (!origin) warning.hidden = true;
    },
    open: () => { setEditing(true); input.focus(); },
    close: () => setEditing(false),
    destroy() {
      destroyed = true;
      stopOutside();
      window.clearTimeout(searchTimer);
      searchAbort?.abort();
    },
  };
}
