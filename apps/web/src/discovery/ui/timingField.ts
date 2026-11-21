/**
 * "When?" — a single-choice dropdown plus date and time inputs for
 * "Pick date/time". Inputs are always read as Boston time, whatever the
 * device's own time zone.
 */
import {
  bostonWallTime,
  formatBostonDateTime,
  formatBostonDay,
  formatBostonTime,
  toDateInputValue,
} from '../bostonTime';
import { TIMING_OPTIONS, type InitialPreferences, type TimingError, type TimingKind } from '../preferences';
import { h, uid } from './dom';
import { createSelectField } from './selectField';

export interface TimingFieldConfig {
  onChoose(kind: TimingKind): void;
  onCustomChange(date: string, time: string): void;
  now: () => Date;
}

export interface TimingField {
  root: HTMLElement;
  update(state: InitialPreferences): void;
  close(): void;
  destroy(): void;
}

const ERROR_TEXT: Record<TimingError, string> = {
  incomplete: 'Choose a date and a time.',
  invalid: 'Enter a valid date and time.',
  past: 'That time has already passed. Pick a later one.',
};

export function createTimingField(config: TimingFieldConfig): TimingField {
  const select = createSelectField({
    label: 'When?',
    placeholder: 'Choose a time',
    options: TIMING_OPTIONS,
    onSelect: (kind) => config.onChoose(kind),
  });

  const dateId = uid('date');
  const timeId = uid('time');
  const errorId = uid('time-error');
  const dateInput = h('input', { type: 'date', id: dateId, class: 'vb-input', 'aria-describedby': errorId, required: true });
  const timeInput = h('input', { type: 'time', id: timeId, class: 'vb-input', 'aria-describedby': errorId, required: true });
  const error = h('p', { class: 'vb-hint is-warning', id: errorId, hidden: true });
  const custom = h(
    'div',
    { class: 'vb-custom-time vb-reveal', hidden: true },
    h('div', { class: 'vb-inline-field' }, h('label', { for: dateId, class: 'vb-sublabel' }, 'Date'), dateInput),
    h('div', { class: 'vb-inline-field' }, h('label', { for: timeId, class: 'vb-sublabel' }, 'Time (Boston)'), timeInput),
  );
  select.root.querySelector('.vb-control')!.after(custom, error);

  let touched = false;
  const emit = () => {
    touched = true;
    config.onCustomChange(dateInput.value, timeInput.value);
  };
  dateInput.addEventListener('change', emit);
  timeInput.addEventListener('change', emit);

  return {
    root: select.root,
    update(state) {
      select.setValue(state.timingChoice);
      const isCustom = state.timingChoice === 'custom';
      if (isCustom && custom.hidden) touched = false;
      custom.hidden = !isCustom;
      dateInput.min = toDateInputValue(bostonWallTime(config.now()));
      if (dateInput.value !== state.customTiming.date) dateInput.value = state.customTiming.date;
      if (timeInput.value !== state.customTiming.time) timeInput.value = state.customTiming.time;

      // Only nag about an incomplete entry once the user has started typing.
      const showError = isCustom && state.timingError && (state.timingError !== 'incomplete' || touched);
      error.hidden = !showError;
      error.textContent = showError ? ERROR_TEXT[state.timingError!] : '';
      for (const field of [dateInput, timeInput]) {
        if (showError) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
      }

      select.setHint(state.timing ? describeWindow(state.timing.start, state.timing.end) : '');
    },
    close: select.close,
    destroy: select.destroy,
  };
}

/** "Sat, Nov 21 · 7:00 PM – 3:00 AM, Boston time". */
export function describeWindow(start: string, end?: string): string {
  if (!end) return `${formatBostonDateTime(start)}, Boston time`;
  const startsAtMidnight = formatBostonTime(start) === '12:00 AM' && formatBostonTime(end) === '12:00 AM';
  if (startsAtMidnight) return `${formatBostonDay(start)}, all day (Boston time)`;
  return `${formatBostonDay(start)} · ${formatBostonTime(start)} – ${formatBostonTime(end)}, Boston time`;
}
