/**
 * The signed-in user's account: auth state, settings, vibe history and the
 * taste derived from it. Everything async is tagged with a generation number
 * that changes whenever the user does, so a slow response for a previous
 * user can never leak into the current one.
 */
import { createStore } from '../../discovery/store';
import type { AccountBackend, AccountProfile, AccountUser } from './backend';
import { computeTaste, type Taste, type VibeEvent } from './taste';
import { normalizeScores, type VibeSource } from './vibes';

export const HISTORY_LIMIT = 200;

export type AccountState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed_out'; error?: string; notice?: 'confirm_email' }
  | {
      status: 'signed_in';
      user: AccountUser;
      profile: AccountProfile;
      events: VibeEvent[];
      taste: Taste;
      error?: string;
    };

export type RecordResult = { recorded: true } | { recorded: false; reason: 'signed_out' | 'invalid' | 'error' };

export interface AccountStore {
  getState(): AccountState;
  subscribe(listener: (s: AccountState) => void): () => void;
  start(): Promise<void>;
  /** The signed-in user's access token; null in any other state. */
  getAccessToken(): Promise<string | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Optimistic; reverts and sets `error` if saving fails. */
  setEffectsEnabled(enabled: boolean): Promise<void>;
  clearHistory(): Promise<void>;
  /** The Vibe Engine's entry point (VibeSignal in docs/CONTRACTS.md). */
  recordVibe(signal: { scores: unknown; source: VibeSource; placeId?: string }): Promise<RecordResult>;
}

type SignedIn = Extract<AccountState, { status: 'signed_in' }>;

export function createAccountStore(
  backend: AccountBackend | null,
  opts: { includeDev: boolean; now?: () => Date },
): AccountStore {
  const store = createStore<AccountState, AccountState>((_s, next) => next, backend ? { status: 'loading' } : { status: 'unavailable' });
  const now = opts.now ?? (() => new Date());
  let generation = 0;
  let currentUserId: string | null = null;

  const set = (s: AccountState) => store.dispatch(s);
  const signedIn = (): SignedIn | null => {
    const s = store.getState();
    return s.status === 'signed_in' ? s : null;
  };
  const tasteFor = (userId: string, events: VibeEvent[]) => computeTaste(userId, events, now(), { includeDev: opts.includeDev });

  async function onUser(user: AccountUser | null): Promise<void> {
    if (!backend) return;
    // Same user again (token refresh, or already loading them): nothing to do.
    // The one exception is the first "no session" answer, which ends `loading`.
    const id = user?.id ?? null;
    if (id === currentUserId && (user || store.getState().status !== 'loading')) return;
    const gen = ++generation;
    currentUserId = user?.id ?? null;
    if (!user) {
      const s = store.getState();
      // Keep a sign-in error or confirm-email notice on screen.
      if (s.status !== 'signed_out') set({ status: 'signed_out' });
      return;
    }
    set({ status: 'loading' }); // the previous user's data goes now, not after the fetch
    try {
      const [profile, events] = await Promise.all([backend.loadProfile(user.id), backend.loadEvents(HISTORY_LIMIT)]);
      if (gen !== generation) return;
      set({ status: 'signed_in', user, profile, events, taste: tasteFor(user.id, events) });
    } catch {
      if (gen !== generation) return;
      const events: VibeEvent[] = [];
      set({
        status: 'signed_in',
        user,
        profile: { effectsEnabled: true },
        events,
        taste: tasteFor(user.id, events),
        error: "Couldn't load your vibe history. Try reloading.",
      });
    }
  }

  return {
    getState: store.getState,
    subscribe: (listener) => store.subscribe((s) => listener(s)),

    async start() {
      if (!backend) return;
      backend.onAuthChange((user) => void onUser(user));
      try {
        await onUser(await backend.getUser());
      } catch {
        set({ status: 'signed_out', error: "Can't reach the server. Check your connection and try again." });
      }
    },

    async getAccessToken() {
      if (!backend || !signedIn()) return null;
      return backend.getAccessToken();
    },

    async signIn(email, password) {
      if (!backend) return;
      const { error } = await backend.signIn(email, password);
      if (error) {
        set({ status: 'signed_out', error });
        return;
      }
      await onUser(await backend.getUser());
    },

    async signUp(email, password) {
      if (!backend) return;
      const { error, needsConfirmation } = await backend.signUp(email, password);
      if (error) set({ status: 'signed_out', error });
      else if (needsConfirmation) set({ status: 'signed_out', notice: 'confirm_email' });
      else await onUser(await backend.getUser());
    },

    async signOut() {
      if (!backend) return;
      generation++;
      currentUserId = null;
      set({ status: 'signed_out' });
      try {
        await backend.signOut();
      } catch {
        // The backend signs out with scope 'local', which clears this device's
        // session before any network call; only the server-side revoke can fail.
      }
    },

    async setEffectsEnabled(enabled) {
      const s = signedIn();
      if (!backend || !s || s.profile.effectsEnabled === enabled) return;
      const gen = generation;
      set({ ...s, profile: { ...s.profile, effectsEnabled: enabled }, error: undefined });
      try {
        await backend.saveEffectsEnabled(s.user.id, enabled);
      } catch {
        const latest = signedIn();
        if (gen !== generation || !latest) return;
        set({ ...latest, profile: { ...latest.profile, effectsEnabled: !enabled }, error: "Couldn't save that setting. Try again." });
      }
    },

    async clearHistory() {
      const s = signedIn();
      if (!backend || !s) return;
      const gen = generation;
      try {
        await backend.deleteAllEvents(s.user.id);
      } catch {
        const latest = signedIn();
        if (gen === generation && latest) set({ ...latest, error: "Couldn't clear your history. Try again." });
        return;
      }
      const latest = signedIn();
      if (gen !== generation || !latest) return;
      set({ ...latest, events: [], taste: tasteFor(latest.user.id, []), error: undefined });
    },

    async recordVibe({ scores, source, placeId }) {
      const s = signedIn();
      if (!backend || !s) return { recorded: false, reason: 'signed_out' };
      const clean = normalizeScores(scores);
      if (!clean) return { recorded: false, reason: 'invalid' };
      const gen = generation;
      let event: VibeEvent;
      try {
        event = await backend.insertEvent({ scores: clean, source, ...(placeId ? { placeId } : {}) });
      } catch {
        return { recorded: false, reason: 'error' };
      }
      // Saved for the user who was signed in when it was recorded; only show it if they still are.
      const latest = signedIn();
      if (gen === generation && latest) {
        const events = [event, ...latest.events].slice(0, HISTORY_LIMIT);
        set({ ...latest, events, taste: tasteFor(latest.user.id, events) });
      }
      return { recorded: true };
    },
  };
}
