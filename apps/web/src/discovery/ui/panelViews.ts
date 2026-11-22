/**
 * Secondary views inside the discovery panel, plus the Quick Tools row that
 * opens them. Preferences stay the panel's main view; these are short detours
 * that return to it (Back / Esc).
 */
import type { Place } from '../../osm';
import { createSearchController, type PlaceSearchProvider, type SearchState } from '../placeSearch';
import type { SavedPlace, SavedStore } from '../saved';
import { h, icon, ICONS, uid } from './dom';
import type { IconName } from '../../design/vibewise/icons';

// ---------------------------------------------------------------------------
// Quick Tools
// ---------------------------------------------------------------------------

export interface QuickTools {
  root: HTMLElement;
  setSavedCount(n: number): void;
  setExpanded(view: string, controls: string): void;
  focus(tool: 'search' | 'saved' | 'recenter'): void;
}

export function createQuickTools(actions: {
  search?: () => void;
  saved?: () => void;
  recenter?: () => void;
}): QuickTools {
  const tool = (label: string, name: IconName, onClick?: () => void, extra?: Node) => {
    const btn = h('button', { type: 'button', class: 'vb-tool', hidden: !onClick }, icon(name, 24), h('span', { class: 'vb-tool-label' }, label), extra ?? null);
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  };
  const badge = h('span', { class: 'vb-tool-badge', hidden: true });
  const buttons = {
    search: tool('Search', ICONS.search, actions.search),
    saved: tool('Saved', ICONS.bookmark, actions.saved, badge),
    recenter: tool('Recenter', ICONS.recenter, actions.recenter),
  };
  buttons.recenter.title = 'Back to your starting point (or Boston Common)';
  const root = h('div', { class: 'vb-quick-tools', role: 'group', 'aria-label': 'Quick tools' }, buttons.search, buttons.saved, buttons.recenter);
  return {
    root,
    setExpanded(view, controls) {
      for (const name of ['search', 'saved'] as const) { buttons[name].setAttribute('aria-expanded', String(view === name)); buttons[name].setAttribute('aria-controls', controls); }
    },
    setSavedCount(n) {
      badge.textContent = String(n);
      badge.hidden = n === 0;
      buttons.saved.setAttribute('aria-label', n ? `Saved, ${n} place${n === 1 ? '' : 's'}` : 'Saved');
    },
    focus: (name) => buttons[name].focus(),
  };
}

// ---------------------------------------------------------------------------
// Shared view header
// ---------------------------------------------------------------------------

function viewHeader(title: string, titleId: string, onBack: () => void) {
  const back = h('button', { type: 'button', class: 'vb-icon-btn vb-small', 'aria-label': `Close ${title.toLowerCase()}` }, icon(ICONS.close, 20));
  back.addEventListener('click', onBack);
  return { el: h('div', { class: 'vb-view-header' }, back, h('h3', { class: 'vb-view-title', id: titleId }, title)), back };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchViewConfig {
  provider: PlaceSearchProvider;
  /** New results (or none) to show on the map. */
  onResults(places: Place[]): void;
  /** A result was chosen. */
  onSelect(place: Place, index: number): void;
  /** Search was cleared or left; the map can restore what it showed before. */
  onDismiss(): void;
  onBack(): void;
}

export interface SearchView {
  root: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function createSearchView(config: SearchViewConfig): SearchView {
  const titleId = uid('search-title');
  const inputId = uid('search-input');
  // Leaving search clears it, so the map returns to the Activity's places.
  const leave = () => {
    clear();
    config.onBack();
  };
  const header = viewHeader('Search places', titleId, leave);
  const input = h('input', {
    id: inputId,
    type: 'search',
    class: 'vb-search-input',
    placeholder: 'Search Boston',
    autocomplete: 'off',
    enterkeyhint: 'search',
    'aria-label': 'Search places',
  });
  const clearBtn = h('button', { type: 'button', class: 'vb-icon-btn vb-small', 'aria-label': 'Clear search', hidden: true }, icon(ICONS.close, 18));
  const submitBtn = h('button', { type: 'submit', class: 'vb-icon-btn vb-small vb-search-submit', 'aria-label': 'Search' }, icon(ICONS.search, 20));
  const form = h('form', { class: 'vb-search-box vb-search-form', role: 'search' }, input, clearBtn, submitBtn);
  const status = h('p', { class: 'vb-view-status', role: 'status', 'aria-live': 'polite' });
  const list = h('ul', { class: 'vb-result-list', 'aria-labelledby': titleId });
  const root = h(
    'section',
    { class: 'vb-view', 'data-view': 'search', 'aria-labelledby': titleId, hidden: true },
    header.el,
    form,
    h('p', { class: 'vb-view-note' }, `Press Enter to search · ${config.provider.name}`),
    status,
    list,
  );

  let shownResults = false;
  const controller = createSearchController(config.provider, render);

  function render(s: SearchState) {
    status.textContent =
      s.status === 'searching'
        ? 'Searching…'
        : s.status === 'empty'
          ? `No results for “${s.query}”.`
          : s.status === 'error'
            ? 'Search is unavailable right now. Try again in a moment.'
            : s.status === 'results'
              ? `${s.results.length} result${s.results.length === 1 ? '' : 's'} for “${s.query}”`
              : '';
    const results = s.status === 'results' ? s.results : [];
    list.replaceChildren(
      ...results.map((place, i) => {
        const btn = h(
          'button',
          { type: 'button', class: 'vb-result' },
          h('span', { class: 'vb-result-name' }, place.name),
          h('span', { class: 'vb-result-sub' }, place.tags.display_name ?? place.category),
        );
        btn.addEventListener('click', () => config.onSelect(place, i));
        return h('li', {}, btn);
      }),
    );
    if (s.status === 'results') {
      shownResults = true;
      config.onResults(s.results);
    } else if (s.status === 'empty' && shownResults) {
      shownResults = false;
      config.onDismiss();
    }
  }

  function clear() {
    input.value = '';
    clearBtn.hidden = true;
    controller.clear();
    if (shownResults) {
      shownResults = false;
      config.onDismiss();
    }
  }

  input.addEventListener('input', () => (clearBtn.hidden = input.value.length === 0));
  clearBtn.addEventListener('click', () => {
    clear();
    input.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void controller.submit(input.value);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      leave();
    }
  });

  return {
    root,
    focus: () => input.focus(),
    destroy: () => controller.dispose(),
  };
}

// ---------------------------------------------------------------------------
// Saved
// ---------------------------------------------------------------------------

export interface SavedViewConfig {
  store: SavedStore;
  onSelect(place: SavedPlace): void;
  onBack(): void;
}

export interface SavedView {
  root: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function createSavedView(config: SavedViewConfig): SavedView {
  const titleId = uid('saved-title');
  const header = viewHeader('Saved places', titleId, () => config.onBack());
  const note = h('p', { class: 'vb-view-note' });
  const list = h('ul', { class: 'vb-result-list', 'aria-labelledby': titleId });
  const empty = h('p', { class: 'vb-view-status' }, 'Nothing saved yet. Use Save on a place’s popup to keep it here.');
  const root = h('section', { class: 'vb-view', 'data-view': 'saved', 'aria-labelledby': titleId, hidden: true }, header.el, note, empty, list);

  function render(items: readonly SavedPlace[]) {
    note.textContent = config.store.persistent
      ? 'Saved in this browser only. There are no accounts or sync.'
      : 'This browser is blocking storage, so saved places last only until you close the page.';
    empty.hidden = items.length > 0;
    list.replaceChildren(
      ...items.map((s) => {
        const open = h(
          'button',
          { type: 'button', class: 'vb-result' },
          h('span', { class: 'vb-result-name' }, s.name),
          h('span', { class: 'vb-result-sub' }, s.category),
        );
        open.addEventListener('click', () => config.onSelect(s));
        const remove = h('button', { type: 'button', class: 'vb-icon-btn vb-small', 'aria-label': `Remove ${s.name} from saved` }, icon(ICONS.close, 18));
        remove.addEventListener('click', () => config.store.remove(s.id));
        return h('li', { class: 'vb-saved-item' }, open, remove);
      }),
    );
  }

  const unsubscribe = config.store.subscribe(render);
  render(config.store.list());
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      config.onBack();
    }
  });

  return {
    root,
    focus: () => header.back.focus(),
    destroy: unsubscribe,
  };
}
