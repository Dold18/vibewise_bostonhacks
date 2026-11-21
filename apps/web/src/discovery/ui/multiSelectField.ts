/**
 * Multi-select dropdown made of real checkboxes in a labelled group.
 *
 * - The trigger is a disclosure button showing a summary ("Japanese, Thai +1").
 * - Toggling a checkbox applies immediately; "Done" (or Esc) closes and
 *   returns focus to the trigger; "Clear selections" unticks everything.
 * - ↑/↓ move between checkboxes; Space toggles (native checkbox behaviour).
 */
import { summarizeSelection, type Option } from '../preferences';
import { h, icon, ICONS, onOutsideInteraction, uid } from './dom';

export interface MultiSelectFieldConfig<Id extends string> {
  label: string;
  placeholder: string;
  options: readonly Option<Id>[];
  onToggle(id: Id): void;
  onClear(): void;
}

export interface MultiSelectField<Id extends string> {
  root: HTMLElement;
  setSelected(ids: readonly Id[]): void;
  setVisible(visible: boolean): void;
  setHint(text: string, tone?: 'muted' | 'warning'): void;
  close(): void;
  destroy(): void;
}

export function createMultiSelectField<Id extends string>(config: MultiSelectFieldConfig<Id>): MultiSelectField<Id> {
  const labelId = uid('label');
  const valueId = uid('value');
  const popoverId = uid('checks');

  const valueText = h('span', { class: 'vb-trigger-value is-placeholder', id: valueId }, config.placeholder);
  const trigger = h(
    'button',
    {
      type: 'button',
      class: 'vb-trigger',
      'aria-labelledby': `${labelId} ${valueId}`,
      'aria-expanded': 'false',
      'aria-controls': popoverId,
    },
    valueText,
    icon(ICONS.chevronDown, 20, 'vb-icon vb-chevron'),
  );

  const boxes = config.options.map((option) =>
    h('input', { type: 'checkbox', class: 'vb-checkbox-input', value: option.id }),
  );
  const checklist = h(
    'div',
    { class: 'vb-checklist' },
    ...config.options.map((option, i) =>
      h(
        'label',
        { class: 'vb-check' },
        boxes[i],
        h('span', { class: 'vb-checkbox', 'aria-hidden': 'true' }, icon(ICONS.check, 14, 'vb-icon')),
        h('span', { class: 'vb-check-label' }, option.label),
      ),
    ),
  );
  const clearBtn = h('button', { type: 'button', class: 'vb-text-btn' }, 'Clear selections');
  const doneBtn = h('button', { type: 'button', class: 'vb-primary-btn vb-small' }, 'Done');
  const popover = h(
    'div',
    { id: popoverId, class: 'vb-popover vb-multi', role: 'group', 'aria-labelledby': labelId, hidden: true },
    checklist,
    h('div', { class: 'vb-popover-footer' }, clearBtn, doneBtn),
  );

  const root = h(
    'div',
    { class: 'vb-field vb-reveal' },
    h('span', { class: 'vb-label', id: labelId }, config.label),
    h('div', { class: 'vb-control' }, trigger, popover),
  );
  const hint = h('p', { class: 'vb-hint', hidden: true, 'aria-live': 'polite' });
  root.append(hint);

  let open = false;
  let selected: readonly Id[] = [];

  function setOpen(next: boolean, { restoreFocus = false } = {}) {
    if (next === open) return;
    open = next;
    popover.hidden = !next;
    trigger.setAttribute('aria-expanded', String(next));
    root.classList.toggle('is-open', next);
    if (next) {
      popover.scrollIntoView({ block: 'nearest' });
      (boxes.find((b) => b.checked) ?? boxes[0])?.focus();
    } else if (restoreFocus) {
      trigger.focus();
    }
  }

  trigger.addEventListener('click', () => setOpen(!open));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  });
  boxes.forEach((box, i) => {
    box.addEventListener('change', () => config.onToggle(config.options[i].id));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        boxes[(i + (e.key === 'ArrowDown' ? 1 : boxes.length - 1)) % boxes.length].focus();
      } else if (e.key === 'Enter') {
        // Enter inside the list means "I'm done", like the Done button.
        e.preventDefault();
        setOpen(false, { restoreFocus: true });
      }
    });
  });
  clearBtn.addEventListener('click', () => {
    config.onClear();
    boxes[0]?.focus();
  });
  doneBtn.addEventListener('click', () => setOpen(false, { restoreFocus: true }));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false, { restoreFocus: true });
    }
  });

  const stopOutside = onOutsideInteraction(root, () => open, () => setOpen(false));

  return {
    root,
    setSelected(ids) {
      selected = ids;
      boxes.forEach((box, i) => (box.checked = selected.includes(config.options[i].id)));
      const summary = summarizeSelection(config.options, selected);
      valueText.textContent = summary || config.placeholder;
      valueText.classList.toggle('is-placeholder', !summary);
      root.classList.toggle('has-value', selected.length > 0);
      clearBtn.disabled = selected.length === 0;
    },
    setVisible(visible) {
      if (!visible) setOpen(false);
      root.hidden = !visible;
    },
    setHint(text, tone = 'muted') {
      hint.textContent = text;
      hint.hidden = !text;
      hint.classList.toggle('is-warning', tone === 'warning');
    },
    close: () => setOpen(false),
    destroy: stopOutside,
  };
}
