/**
 * Single-choice dropdown following the WAI-ARIA "select-only combobox"
 * pattern: a focusable combobox that owns a listbox, with
 * aria-activedescendant tracking the highlighted option.
 *
 * Keys (closed): ↓ ↑ Enter Space Alt+↓ Home End open; typing opens and jumps.
 * Keys (open):   ↓ ↑ Home End PageUp PageDown move; Enter/Space choose;
 *                Esc closes; Tab closes without changing the value.
 */
import type { Option } from '../preferences';
import { h, icon, ICONS, onOutsideInteraction, uid } from './dom';

export interface SelectFieldConfig<Id extends string> {
  label: string;
  placeholder: string;
  options: readonly Option<Id>[];
  onSelect(id: Id): void;
  /** Optional text under the field. */
  hint?: string;
}

export interface SelectField<Id extends string> {
  root: HTMLElement;
  setValue(id: Id | null): void;
  setHint(text: string, tone?: 'muted' | 'warning'): void;
  focus(): void;
  close(): void;
  destroy(): void;
}

export function createSelectField<Id extends string>(config: SelectFieldConfig<Id>): SelectField<Id> {
  const labelId = uid('label');
  const listId = uid('listbox');
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const valueText = h('span', { class: 'vb-trigger-value is-placeholder' }, config.placeholder);
  const combo = h(
    'div',
    {
      class: 'vb-trigger',
      role: 'combobox',
      tabindex: 0,
      'aria-labelledby': labelId,
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-controls': listId,
    },
    valueText,
    icon(ICONS.chevronDown, 20, 'vb-icon vb-chevron'),
  );
  const optionEls = config.options.map((option, i) =>
    h(
      'li',
      { id: optionId(i), role: 'option', class: 'vb-option', 'aria-selected': 'false', 'data-id': option.id },
      h('span', { class: 'vb-option-label' }, option.label),
      icon(ICONS.check, 18, 'vb-icon vb-option-check'),
    ),
  );
  const list = h('ul', { id: listId, role: 'listbox', class: 'vb-popover vb-listbox', 'aria-labelledby': labelId, tabindex: -1, hidden: true }, ...optionEls);
  const hint = h('p', { class: 'vb-hint', hidden: !config.hint }, config.hint ?? '');
  const root = h(
    'div',
    { class: 'vb-field' },
    h('span', { class: 'vb-label', id: labelId }, config.label),
    h('div', { class: 'vb-control' }, combo, list),
    hint,
  );

  let value: Id | null = null;
  let open = false;
  let active = -1;
  let typeahead = '';
  let typeaheadTimer: number | undefined;

  const selectedIndex = () => config.options.findIndex((o) => o.id === value);

  function setActive(i: number) {
    active = Math.max(0, Math.min(config.options.length - 1, i));
    optionEls.forEach((el, j) => el.classList.toggle('is-active', j === active));
    combo.setAttribute('aria-activedescendant', optionId(active));
    optionEls[active]?.scrollIntoView({ block: 'nearest' });
  }

  function setOpen(next: boolean, activeIndex?: number) {
    if (next === open) {
      if (next && activeIndex !== undefined) setActive(activeIndex);
      return;
    }
    open = next;
    list.hidden = !next;
    combo.setAttribute('aria-expanded', String(next));
    root.classList.toggle('is-open', next);
    if (next) {
      setActive(activeIndex ?? Math.max(0, selectedIndex()));
      list.scrollIntoView({ block: 'nearest' });
    } else {
      combo.removeAttribute('aria-activedescendant');
      optionEls.forEach((el) => el.classList.remove('is-active'));
    }
  }

  function choose(i: number) {
    const option = config.options[i];
    setOpen(false);
    combo.focus();
    if (option && option.id !== value) config.onSelect(option.id);
  }

  function jumpByTyping(char: string) {
    window.clearTimeout(typeaheadTimer);
    typeahead += char.toLowerCase();
    typeaheadTimer = window.setTimeout(() => (typeahead = ''), 600);
    const start = open ? active + (typeahead.length === 1 ? 1 : 0) : 0;
    const n = config.options.length;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (config.options[i].label.toLowerCase().startsWith(typeahead)) {
        setOpen(true, i);
        return;
      }
    }
  }

  combo.addEventListener('click', () => setOpen(!open));
  combo.addEventListener('keydown', (e) => {
    const last = config.options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setOpen(true, e.key === 'Home' ? 0 : last);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        jumpByTyping(e.key);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (e.altKey) return;
        setActive(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey) choose(active);
        else setActive(active - 1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(last);
        break;
      case 'PageDown':
        e.preventDefault();
        setActive(active + 5);
        break;
      case 'PageUp':
        e.preventDefault();
        setActive(active - 5);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // don't also close surrounding UI
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) jumpByTyping(e.key);
    }
  });

  optionEls.forEach((el, i) => {
    // Keep focus on the combobox while clicking an option.
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('pointermove', () => active !== i && setActive(i));
    el.addEventListener('click', () => choose(i));
  });

  const stopOutside = onOutsideInteraction(root, () => open, () => setOpen(false));

  return {
    root,
    setValue(next) {
      value = next;
      const i = selectedIndex();
      valueText.textContent = i >= 0 ? config.options[i].label : config.placeholder;
      valueText.classList.toggle('is-placeholder', i < 0);
      root.classList.toggle('has-value', i >= 0);
      optionEls.forEach((el, j) => el.setAttribute('aria-selected', String(j === i)));
    },
    setHint(text, tone = 'muted') {
      hint.textContent = text;
      hint.hidden = !text;
      hint.classList.toggle('is-warning', tone === 'warning');
    },
    focus: () => combo.focus(),
    close: () => setOpen(false),
    destroy() {
      stopOutside();
      window.clearTimeout(typeaheadTimer);
    },
  };
}
