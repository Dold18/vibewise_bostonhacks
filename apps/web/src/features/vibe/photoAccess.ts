import type { AccountState } from '../account';

export type PhotoAccessStatus = 'loading' | 'unavailable' | 'signed_out' | 'signed_in';
export interface PhotoAccessSource {
  status(): PhotoAccessStatus;
  subscribe(cb: () => void): () => void;
  getAccessToken(): Promise<string | null>;
  requestSignIn(): void;
}

export function fromAccountStore(
  store: { getState(): AccountState; subscribe(cb: (s: AccountState) => void): () => void; getAccessToken(): Promise<string | null> },
  openSignIn: () => void,
): PhotoAccessSource {
  return {
    status: () => store.getState().status,
    subscribe: cb => store.subscribe(() => cb()),
    getAccessToken: () => store.getAccessToken(),
    requestSignIn: openSignIn,
  };
}

function createPhotoAccess(): PhotoAccessSource & { connect(source: PhotoAccessSource): () => void } {
  let source: PhotoAccessSource | null = null;
  let unsub: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(l => l());
  return {
    status: () => source?.status() ?? 'loading',
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getAccessToken: async () => (source ? source.getAccessToken() : null),
    requestSignIn: () => source?.requestSignIn(),
    connect(next) {
      unsub?.();
      source = next;
      const mine = next.subscribe(notify);
      unsub = mine;
      notify();
      return () => {
        if (source !== next) return;
        mine(); source = null; unsub = null; notify();
      };
    },
  };
}

export const photoAccess = createPhotoAccess();
