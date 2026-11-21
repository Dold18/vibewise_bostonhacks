/**
 * The account store's view of Supabase: auth plus the `profiles` and
 * `vibe_events` tables (supabase/migrations/20261121180000_create_accounts.sql).
 * Row Level Security limits every query to the signed-in user's own rows.
 *
 * Uses its own client with sessions persisted; src/catalog.ts keeps its
 * session-less client. Different storage keys keep the two apart.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { VibeEvent } from './taste';
import { VIBE_VOCAB_VERSION, type VibeScores, type VibeSource } from './vibes';

export interface AccountUser {
  id: string;
  email: string;
}

export interface AccountProfile {
  effectsEnabled: boolean;
}

export interface AccountBackend {
  getUser(): Promise<AccountUser | null>;
  onAuthChange(cb: (user: AccountUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signUp(email: string, password: string): Promise<{ error?: string; needsConfirmation?: boolean }>;
  signOut(): Promise<void>;
  /** Creates the row (effects on) if the sign-up trigger didn't. */
  loadProfile(userId: string): Promise<AccountProfile>;
  saveEffectsEnabled(userId: string, enabled: boolean): Promise<void>;
  /** Newest first. */
  loadEvents(limit: number): Promise<VibeEvent[]>;
  insertEvent(e: { scores: VibeScores; source: VibeSource; placeId?: string }): Promise<VibeEvent>;
  deleteAllEvents(userId: string): Promise<void>;
}

/** The auth-enabled client, or null when the Supabase env vars are missing. */
export function createAccountClient(): SupabaseClient | null {
  // Same env and URL tolerance as src/catalog.ts.
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'vibenta-auth' },
  });
}

const EVENT_COLUMNS = 'id, created_at, source, scores, place_id';

interface EventRow {
  id: number;
  created_at: string;
  source: VibeSource;
  scores: VibeScores;
  place_id: string | null;
}

const toEvent = (r: EventRow): VibeEvent => ({
  id: r.id,
  createdAt: r.created_at,
  source: r.source,
  scores: r.scores,
  placeId: r.place_id,
});

const toUser = (u: User | null | undefined): AccountUser | null => (u ? { id: u.id, email: u.email ?? '' } : null);

/** Supabase auth errors as short, user-facing copy. */
export function friendlyAuthError(error: { message?: string; status?: number; name?: string }): string {
  const message = error.message ?? '';
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/already registered|already exists/i.test(message)) return 'An account with that email already exists. Sign in instead.';
  if (error.status === 429 || /rate limit/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  if (/fetch|network/i.test(message) || error.name === 'AuthRetryableFetchError') {
    return "Can't reach the server. Check your connection and try again.";
  }
  return message || 'Something went wrong. Please try again.';
}

export function createSupabaseBackend(client: SupabaseClient): AccountBackend {
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    async getUser() {
      const { data } = await client.auth.getSession();
      return toUser(data.session?.user);
    },
    onAuthChange(cb) {
      // Supabase warns against awaiting its own calls inside this callback, and
      // the store loads data on every change, so hand off on the next tick.
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => cb(toUser(session?.user)), 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error ? { error: friendlyAuthError(error) } : {};
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) return { error: friendlyAuthError(error) };
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      await client.auth.signOut();
    },
    async loadProfile(userId) {
      const row = check(
        await client.from('profiles').select('effects_enabled').eq('id', userId).maybeSingle<{ effects_enabled: boolean }>(),
      );
      if (row) return { effectsEnabled: row.effects_enabled };
      check(await client.from('profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true }));
      return { effectsEnabled: true };
    },
    async saveEffectsEnabled(userId, enabled) {
      check(await client.from('profiles').upsert({ id: userId, effects_enabled: enabled }));
    },
    async loadEvents(limit) {
      const rows = check(
        await client.from('vibe_events').select(EVENT_COLUMNS).order('created_at', { ascending: false }).limit(limit),
      );
      return ((rows ?? []) as EventRow[]).map(toEvent);
    },
    async insertEvent(e) {
      const row = check(
        await client
          .from('vibe_events')
          .insert({ scores: e.scores, source: e.source, place_id: e.placeId ?? null, vocab_version: VIBE_VOCAB_VERSION })
          .select(EVENT_COLUMNS)
          .single<EventRow>(),
      );
      if (!row) throw new Error('vibe_events insert returned no row');
      return toEvent(row);
    },
    async deleteAllEvents(userId) {
      check(await client.from('vibe_events').delete().eq('user_id', userId));
    },
  };
}
