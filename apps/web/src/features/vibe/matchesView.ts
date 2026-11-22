/**
 * One source of truth for the quiz's results controls, read by both the quiz panel (its primary button)
 * and the map (final pins, rank badges, legend), so the two can never disagree.
 *
 *   Show My Matches ──request──▶ loading ──▶ shown ──▶ Rank My Matches ⇄ Show Unranked Matches
 *                                   └──────▶ error ──▶ Show My Matches (retry)
 *
 * - `sessionId`: the quiz session whose final matches the user explicitly asked for. main.ts only runs the
 *   catalog-wide final search (finalSearch.ts) for a requested session.
 * - `stage`: what the map shows for that request. `shown` is set by main.ts only after the final pins are
 *   on the map, never on the search response alone.
 * - `ranked`: whether the shown pins carry match-strength styling. Presentation only: it never changes
 *   which places are shown or their order, and never triggers a search.
 *
 * Leaving results (editing an answer, Continue Refining, Start over, a new quiz, or handing the map back to
 * the activity layers) resets everything, so stale ranks and badges cannot survive. A new result set for the
 * same request (a filter change) resets `ranked`.
 *
 * Kept free of map and DOM code so it can be unit-tested.
 */
export type MatchesStage = 'idle' | 'loading' | 'error' | 'shown';

export interface MatchesViewState {
  readonly sessionId: string | null;
  readonly stage: MatchesStage;
  readonly ranked: boolean;
  /** Final places on the map (stage `shown`). */
  readonly count: number;
  readonly message: string | null;
}

const IDLE: MatchesViewState = { sessionId: null, stage: 'idle', ranked: false, count: 0, message: null };

export function createMatchesView() {
  let state = IDLE;
  const subscribers = new Set<(s: MatchesViewState) => void>();
  const requestListeners = new Set<() => void>();
  const set = (next: MatchesViewState) => {
    if (next.sessionId === state.sessionId && next.stage === state.stage && next.ranked === state.ranked && next.count === state.count && next.message === state.message) return;
    state = next;
    for (const f of [...subscribers]) f(state);
  };
  const requested = () => state.sessionId !== null;
  const setRanked = (ranked: boolean) => { if (state.stage === 'shown' && state.count > 0) set({ ...state, ranked }); };
  return {
    getState: (): MatchesViewState => state,
    subscribe(f: (s: MatchesViewState) => void): () => void { subscribers.add(f); return () => { subscribers.delete(f); }; },
    /** main.ts starts (or retries) the final search when the user asks; see `request`. */
    onRequest(f: () => void): () => void { requestListeners.add(f); return () => { requestListeners.delete(f); }; },
    isRequested: (sessionId: string): boolean => state.sessionId === sessionId,
    /** The user pressed Show My Matches (or a retry) for this quiz session. */
    request(sessionId: string): void {
      set({ ...IDLE, sessionId, stage: 'loading' });
      for (const f of [...requestListeners]) f();
    },
    /** Forget the request once the quiz is cleared, restarted or leaves its results phase. */
    syncProfile(profile: { sessionId: string; phase: string } | null): void {
      if (!requested()) return;
      if (!profile || profile.phase !== 'results' || profile.sessionId !== state.sessionId) set(IDLE);
    },
    /** The final search is running (first request, a retry, or new filters for the same request). */
    loading(): void { if (requested()) set({ ...state, stage: 'loading', ranked: false, count: 0, message: null }); },
    failed(message: string): void { if (requested()) set({ ...state, stage: 'error', ranked: false, count: 0, message }); },
    /** The final pins are on the map. Always a fresh, unranked view of this result set. */
    shown(count: number): void { if (requested()) set({ ...state, stage: 'shown', ranked: false, count, message: null }); },
    /** Rank My Matches / Show Unranked Matches. Only possible while results are actually shown. */
    setRanked,
    toggleRanked(): void { setRanked(!state.ranked); },
    /** The map was handed back to the activity layers: results are no longer shown. */
    reset(): void { set(IDLE); },
  };
}

export type MatchesView = ReturnType<typeof createMatchesView>;

/** The app-wide instance (like `outingProfiles`): the quiz panel and main.ts share it. */
export const matchesView = createMatchesView();
