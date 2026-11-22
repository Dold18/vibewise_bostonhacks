import { describe, expect, it } from 'vitest';
import type { AccountBackend, AccountProfile, AccountUser } from '../backend';
import { createAccountStore, type AccountState } from '../session';
import type { VibeEvent } from '../taste';
import type { VibeScores, VibeSource } from '../vibes';

const NOW = new Date('2026-11-21T12:00:00Z');
const A: AccountUser = { id: 'user-a', email: 'a@test.local' };
const B: AccountUser = { id: 'user-b', email: 'b@test.local' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** In-memory backend. Passwords: "pw". Set `hold*` to control when calls resolve. */
class FakeBackend implements AccountBackend {
  user: AccountUser | null = null;
  users = [A, B];
  profiles = new Map<string, AccountProfile>();
  events = new Map<string, VibeEvent[]>();
  listeners = new Set<(u: AccountUser | null) => void>();
  nextId = 1;
  confirmSignUps = false;
  failInsert = false;
  failSaveEffects = false;
  holdEvents: ReturnType<typeof deferred<void>> | null = null;
  inserts = 0;
  loads = 0;
  tokenCalls = 0;

  private emit() {
    for (const l of this.listeners) l(this.user);
  }
  async getUser() {
    return this.user;
  }
  async getAccessToken() {
    this.tokenCalls++;
    return this.user ? 'tok' : null;
  }
  onAuthChange(cb: (u: AccountUser | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  async signIn(email: string, password: string) {
    const u = this.users.find((x) => x.email === email);
    if (!u || password !== 'pw') return { error: 'Wrong email or password.' };
    this.user = u;
    this.emit();
    return {};
  }
  async signUp(email: string, _password: string) {
    const u = { id: `user-${email}`, email };
    this.users.push(u);
    if (this.confirmSignUps) return { needsConfirmation: true };
    this.user = u;
    this.emit();
    return {};
  }
  async signOut() {
    this.user = null;
    this.emit();
  }
  async loadProfile(userId: string) {
    if (!this.profiles.has(userId)) this.profiles.set(userId, { effectsEnabled: true });
    return { ...this.profiles.get(userId)! };
  }
  async saveEffectsEnabled(userId: string, enabled: boolean) {
    if (this.failSaveEffects) throw new Error('offline');
    this.profiles.set(userId, { effectsEnabled: enabled });
  }
  async loadEvents(limit: number) {
    this.loads++;
    const uid = this.user?.id;
    if (this.holdEvents) await this.holdEvents.promise;
    return (this.events.get(uid ?? '') ?? []).slice(0, limit);
  }
  async insertEvent(e: { scores: VibeScores; source: VibeSource; placeId?: string }) {
    if (this.failInsert) throw new Error('offline');
    this.inserts++;
    const row: VibeEvent = { id: this.nextId++, createdAt: NOW.toISOString(), source: e.source, scores: e.scores, placeId: e.placeId ?? null };
    const list = this.events.get(this.user!.id) ?? [];
    this.events.set(this.user!.id, [row, ...list]);
    return row;
  }
  async deleteAllEvents(userId: string) {
    this.events.set(userId, []);
  }
  seed(user: AccountUser, scores: VibeScores[], source: VibeSource = 'quiz') {
    this.events.set(
      user.id,
      scores.map((s) => ({ id: this.nextId++, createdAt: NOW.toISOString(), source, scores: s, placeId: null })),
    );
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(opts: { includeDev?: boolean } = {}) {
  const backend = new FakeBackend();
  const store = createAccountStore(backend, { includeDev: opts.includeDev ?? true, now: () => NOW });
  const states: AccountState[] = [];
  store.subscribe((s) => states.push(s));
  return { backend, store, states };
}

function signedIn(state: AccountState) {
  if (state.status !== 'signed_in') throw new Error(`expected signed_in, got ${state.status}`);
  return state;
}

describe('account store', () => {
  it('is unavailable without a backend', () => {
    expect(createAccountStore(null, { includeDev: false }).getState()).toEqual({ status: 'unavailable' });
  });

  it('getAccessToken returns the backend token when signed in', async () => {
    const { backend, store } = await setup();
    backend.user = A;
    await store.start();
    expect(await store.getAccessToken()).toBe('tok');
  });

  it('getAccessToken is null when signed out and does not ask the backend', async () => {
    const { backend, store } = await setup();
    await store.start();
    expect(await store.getAccessToken()).toBeNull();
    expect(backend.tokenCalls).toBe(0);
  });

  it('starts signed out when there is no session', async () => {
    const { store } = await setup();
    await store.start();
    expect(store.getState()).toEqual({ status: 'signed_out' });
  });

  it('sign-in loads the profile and events and computes taste', async () => {
    const { backend, store } = await setup();
    backend.seed(A, [{ cozy: 1 }, { cozy: 0.8 }]);
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    const s = signedIn(store.getState());
    expect(s.user).toEqual(A);
    expect(s.profile).toEqual({ effectsEnabled: true });
    expect(s.events).toHaveLength(2);
    expect(s.taste.topVibes[0].key).toBe('cozy');
    expect(s.taste.profile.userId).toBe(A.id);
  });

  it('a token refresh for the same user does not reload', async () => {
    const { backend, store } = await setup();
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    const loads = backend.loads;
    for (const l of backend.listeners) l(A);
    await flush();
    expect(backend.loads).toBe(loads);
    expect(store.getState().status).toBe('signed_in');
  });

  it('a sign-up that needs confirmation stays signed out with a notice', async () => {
    const { backend, store } = await setup();
    backend.confirmSignUps = true;
    await store.start();
    await store.signUp('new@test.local', 'pw');
    expect(store.getState()).toEqual({ status: 'signed_out', notice: 'confirm_email' });
  });

  it('a sign-up without confirmation signs straight in', async () => {
    const { store } = await setup();
    await store.start();
    await store.signUp('new@test.local', 'pw');
    await flush();
    expect(signedIn(store.getState()).user.email).toBe('new@test.local');
  });

  it('a sign-in error shows on the signed-out state', async () => {
    const { store } = await setup();
    await store.start();
    await store.signIn(A.email, 'nope');
    expect(store.getState()).toEqual({ status: 'signed_out', error: 'Wrong email or password.' });
  });

  it('recordVibe while signed out records nothing', async () => {
    const { backend, store } = await setup();
    await store.start();
    expect(await store.recordVibe({ scores: { cozy: 1 }, source: 'quiz' })).toEqual({ recorded: false, reason: 'signed_out' });
    expect(backend.inserts).toBe(0);
  });

  it('recordVibe rejects invalid scores', async () => {
    const { backend, store } = await setup();
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    expect(await store.recordVibe({ scores: { electric: 1 }, source: 'quiz' })).toEqual({ recorded: false, reason: 'invalid' });
    expect(backend.inserts).toBe(0);
  });

  it('recordVibe updates taste immediately', async () => {
    const { store } = await setup();
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    expect(await store.recordVibe({ scores: { quiet: 0.9, bogus: 1 }, source: 'quiz' })).toEqual({ recorded: true });
    const s = signedIn(store.getState());
    expect(s.events[0].scores).toEqual({ quiet: 0.9 });
    expect(s.taste.topVibes[0]).toEqual({ key: 'quiet', score: 0.9 });
    expect(s.taste.strength).toBeCloseTo(0.2, 6);
  });

  it('an insert failure reports an error and leaves state alone', async () => {
    const { backend, store } = await setup();
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    const before = store.getState();
    backend.failInsert = true;
    expect(await store.recordVibe({ scores: { cozy: 1 }, source: 'quiz' })).toEqual({ recorded: false, reason: 'error' });
    expect(store.getState()).toBe(before);
  });

  it('setEffectsEnabled is optimistic and reverts on failure', async () => {
    const { backend, store, states } = await setup();
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    await store.setEffectsEnabled(false);
    expect(signedIn(store.getState()).profile.effectsEnabled).toBe(false);
    expect(backend.profiles.get(A.id)?.effectsEnabled).toBe(false);

    backend.failSaveEffects = true;
    const pending = store.setEffectsEnabled(true);
    expect(signedIn(states.at(-1)!).profile.effectsEnabled).toBe(true);
    await pending;
    const s = signedIn(store.getState());
    expect(s.profile.effectsEnabled).toBe(false);
    expect(s.error).toBeTruthy();
  });

  it('clearHistory empties events and taste', async () => {
    const { backend, store } = await setup();
    backend.seed(A, [{ cozy: 1 }]);
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    await store.clearHistory();
    const s = signedIn(store.getState());
    expect(s.events).toEqual([]);
    expect(s.taste.strength).toBe(0);
    expect(backend.events.get(A.id)).toEqual([]);
  });

  it('events that resolve after sign-out are ignored', async () => {
    const { backend, store } = await setup();
    backend.seed(A, [{ cozy: 1 }]);
    await store.start();
    backend.holdEvents = deferred<void>();
    await store.signIn(A.email, 'pw');
    await store.signOut();
    backend.holdEvents.resolve();
    await flush();
    expect(store.getState()).toEqual({ status: 'signed_out' });
  });

  it("sign-out then sign-in as another user never exposes the first user's events", async () => {
    const { backend, store, states } = await setup();
    backend.seed(A, [{ cozy: 1 }]);
    backend.seed(B, [{ lively: 1 }]);
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    const aIds = new Set(backend.events.get(A.id)!.map((e) => e.id));

    backend.holdEvents = deferred<void>();
    await store.signOut();
    await store.signIn(B.email, 'pw');
    backend.holdEvents.resolve();
    await flush();

    expect(signedIn(store.getState()).user).toEqual(B);
    for (const s of states) {
      if (s.status === 'signed_in' && s.user.id === B.id) {
        expect(s.events.some((e) => aIds.has(e.id))).toBe(false);
        expect(s.taste.profile.tags.cozy).toBe(0);
      }
    }
  });

  it('switching user without a sign-out drops the old taste before loading', async () => {
    const { backend, store, states } = await setup();
    backend.seed(A, [{ cozy: 1 }]);
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    const from = states.length;
    backend.holdEvents = deferred<void>();
    backend.user = B;
    for (const l of backend.listeners) l(B);
    expect(store.getState()).toEqual({ status: 'loading' });
    backend.holdEvents.resolve();
    await flush();
    expect(states.slice(from).every((s) => s.status !== 'signed_in' || s.user.id === B.id)).toBe(true);
  });

  it('dev rows are ignored when includeDev is false', async () => {
    const { backend, store } = await setup({ includeDev: false });
    backend.seed(A, [{ cozy: 1 }], 'dev');
    await store.start();
    await store.signIn(A.email, 'pw');
    await flush();
    const s = signedIn(store.getState());
    expect(s.taste.strength).toBe(0);
    expect(s.taste.hasSample).toBe(false);
  });
});
