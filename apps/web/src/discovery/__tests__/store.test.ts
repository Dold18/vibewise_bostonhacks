import { describe, expect, it, vi } from 'vitest';
import { createStore, initialLayout, isExpanded, layoutReducer, type LayoutAction, type LayoutState } from '../store';

const run = (start: LayoutState, ...actions: LayoutAction[]) => actions.reduce(layoutReducer, start);

describe('createStore', () => {
  it('notifies subscribers only when state changes', () => {
    const store = createStore((n: number, a: 'inc' | 'noop') => (a === 'inc' ? n + 1 : n), 0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.dispatch('noop');
    store.dispatch('inc');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1, 0);
    unsubscribe();
    store.dispatch('inc');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('panel layout while a destination card is open', () => {
  it('collapses (not hides) when the card opens and restores when it closes', () => {
    const open = run(initialLayout('expanded'), { type: 'cardOpened' });
    expect(isExpanded(open)).toBe(false);
    expect(isExpanded(run(open, { type: 'cardClosed' }))).toBe(true);
  });

  it('returns to a collapsed panel if the user had collapsed it before', () => {
    const s = run(initialLayout('expanded'), { type: 'collapse' }, { type: 'cardOpened' }, { type: 'cardClosed' });
    expect(isExpanded(s)).toBe(false);
  });

  it('can be expanded on top of the card without changing the preferred state', () => {
    const peek = run(initialLayout('collapsed'), { type: 'cardOpened' }, { type: 'expand' });
    expect(isExpanded(peek)).toBe(true);
    const closed = run(peek, { type: 'cardClosed' });
    expect(isExpanded(closed)).toBe(false);
  });

  it('a newly opened card collapses the panel again', () => {
    const s = run(initialLayout('expanded'), { type: 'cardOpened' }, { type: 'expand' }, { type: 'cardClosed' }, { type: 'cardOpened' });
    expect(isExpanded(s)).toBe(false);
  });

  it('toggle flips the visible state', () => {
    expect(isExpanded(run(initialLayout('expanded'), { type: 'toggle' }))).toBe(false);
    expect(isExpanded(run(initialLayout('collapsed'), { type: 'cardOpened' }, { type: 'toggle' }))).toBe(true);
  });
});
