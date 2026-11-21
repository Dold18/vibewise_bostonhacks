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

describe('panel layout: only the user collapses or expands it', () => {
  it('minimize and expand change the state; repeats are no-ops', () => {
    const start = initialLayout('expanded');
    const collapsed = run(start, { type: 'collapse' });
    expect(isExpanded(collapsed)).toBe(false);
    expect(run(collapsed, { type: 'collapse' })).toBe(collapsed);
    expect(isExpanded(run(collapsed, { type: 'expand' }))).toBe(true);
    expect(run(start, { type: 'expand' })).toBe(start);
  });

  it('toggle flips the visible state', () => {
    expect(isExpanded(run(initialLayout('expanded'), { type: 'toggle' }))).toBe(false);
    expect(isExpanded(run(initialLayout('collapsed'), { type: 'toggle' }))).toBe(true);
  });

  it('has no map-overlay actions: popups and the trip planner cannot collapse the panel', () => {
    const state = initialLayout('expanded');
    for (const type of ['cardOpened', 'cardClosed', 'overlayOpened', 'overlayClosed']) {
      // Unknown actions (e.g. the removed cardOpened/cardClosed) leave the layout untouched.
      expect(layoutReducer(state, { type } as unknown as LayoutAction)).toBe(state);
    }
    expect(Object.keys(state)).toEqual(['preferred']);
  });
});
