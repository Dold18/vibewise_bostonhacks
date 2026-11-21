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
 * The panel is either expanded or collapsed to a one-line summary.
 *
 * - `preferred` is what the user last chose with no destination card open.
 * - While the map's destination card is open the panel collapses so the card
 *   has room, but the user may still expand it on top (`peekWhileCard`).
 * - When the card closes, the panel returns to `preferred`.
 */
export interface LayoutState {
  preferred: 'expanded' | 'collapsed';
  cardOpen: boolean;
  peekWhileCard: boolean;
}

export type LayoutAction =
  | { type: 'toggle' }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'cardOpened' }
  | { type: 'cardClosed' };

export const initialLayout = (preferred: LayoutState['preferred']): LayoutState => ({
  preferred,
  cardOpen: false,
  peekWhileCard: false,
});

export function isExpanded(s: LayoutState): boolean {
  return s.cardOpen ? s.peekWhileCard : s.preferred === 'expanded';
}

export function layoutReducer(s: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'toggle':
      return layoutReducer(s, { type: isExpanded(s) ? 'collapse' : 'expand' });
    case 'expand':
      if (isExpanded(s)) return s;
      return s.cardOpen ? { ...s, peekWhileCard: true } : { ...s, preferred: 'expanded' };
    case 'collapse':
      if (!isExpanded(s)) return s;
      return s.cardOpen ? { ...s, peekWhileCard: false } : { ...s, preferred: 'collapsed' };
    case 'cardOpened':
      return s.cardOpen ? s : { ...s, cardOpen: true, peekWhileCard: false };
    case 'cardClosed':
      return s.cardOpen ? { ...s, cardOpen: false, peekWhileCard: false } : s;
  }
}
