/** Minimal observable store: state changes only through `dispatch(action)`. */
export interface Store<S, A> {
  getState(): S;
  dispatch(action: A): void;
  subscribe(listener: (state: S, previous: S) => void): () => void;
}

export function createStore<S, A>(reducer: (state: S, action: A) => S, initial: S): Store<S, A> {
  let state = initial;
  const listeners = new Set<(state: S, previous: S) => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const previous = state;
      state = reducer(state, action);
      if (state !== previous) for (const listener of [...listeners]) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------------------
// Panel layout
// ---------------------------------------------------------------------------

/**
 * The panel is either expanded or collapsed to a one-line summary, and only
 * the user changes that (minimize / summary buttons). Map interactions such
 * as opening or closing a destination popup or the trip planner never do.
 */
export interface LayoutState {
  preferred: 'expanded' | 'collapsed';
}

export type LayoutAction = { type: 'toggle' } | { type: 'expand' } | { type: 'collapse' };

export const initialLayout = (preferred: LayoutState['preferred']): LayoutState => ({ preferred });

export function isExpanded(s: LayoutState): boolean {
  return s.preferred === 'expanded';
}

export function layoutReducer(s: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'toggle':
      return { preferred: isExpanded(s) ? 'collapsed' : 'expanded' };
    case 'expand':
      return isExpanded(s) ? s : { preferred: 'expanded' };
    case 'collapse':
      return isExpanded(s) ? { preferred: 'collapsed' } : s;
    default:
      return s;
  }
}
