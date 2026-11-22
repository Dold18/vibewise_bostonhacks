import { describe, expect, it, vi } from 'vitest';
import { createPhotoClient } from '../photoClient';
import { prepareMessage } from '../photoSend';
import { fromAccountStore, photoAccess } from '../photoAccess';

const file = () => ({ name: 'a.jpg', type: 'image/jpeg', size: 3 }) as unknown as File;
const prep = async () => ({ mimeType: 'image/jpeg' as const, data: 'QUJD' });
const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
const setup = (r: () => Response | Promise<Response>, token: string | null = 't') => {
  const fetchImpl = vi.fn(async () => r());
  const prepare = vi.fn(prep);
  const client = createPhotoClient({ access: { getAccessToken: async () => token }, prepare, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { client, fetchImpl, prepare };
};
const okRes = () => res(200, { description: 'Warm', remainingToday: 4 });

describe('photoClient', () => {
  it('posts and returns the description', async () => {
    const { client, fetchImpl } = setup(okRes);
    expect(await client.describe(file(), 'q')).toEqual({ ok: true, description: 'Warm', remainingToday: 4 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/vibe/describe-image');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(JSON.parse(init.body as string)).toEqual({ mimeType: 'image/jpeg', data: 'QUJD', question: 'q' });
  });
  it('caches per file and question', async () => {
    const { client, fetchImpl } = setup(okRes);
    const f = file();
    await client.describe(f, 'q');
    expect(client.cached(f, 'q')).toBe('Warm');
    await client.describe(f, 'q');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.describe(f, 'other');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('shares one request between concurrent calls', async () => {
    const { client, fetchImpl } = setup(okRes);
    const f = file();
    const [a, b] = await Promise.all([client.describe(f, 'q'), client.describe(f, 'q')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });
  it('is signed_out without a token and does no work', async () => {
    const { client, fetchImpl, prepare } = setup(okRes, null);
    expect(await client.describe(file())).toMatchObject({ ok: false, reason: 'signed_out', message: 'Sign in to use a photo.' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([
    [401, { error: 'x' }, 'signed_out'],
    [429, { error: 'daily_limit', remainingToday: 0 }, 'limit'],
    [429, { error: 'Vibe service is busy; please retry.' }, 'unavailable'],
    [422, { error: 'x' }, 'unreadable'],
    [503, { error: 'x' }, 'unavailable'],
  ])('maps %i %j to %s', async (status, body, reason) => {
    const { client } = setup(() => res(status, body));
    expect(await client.describe(file())).toMatchObject({ ok: false, reason });
  });
  it('maps network errors to unavailable', async () => {
    const { client } = setup(() => { throw new Error('net'); });
    expect(await client.describe(file())).toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('maps prepare failure to unreadable without fetching', async () => {
    const fetchImpl = vi.fn();
    const client = createPhotoClient({ access: { getAccessToken: async () => 't' }, prepare: async () => { throw new Error('bad'); }, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.describe(file())).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does not cache failures', async () => {
    const { client, fetchImpl } = setup(() => res(503, {}));
    const f = file();
    await client.describe(f);
    await client.describe(f);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('quota parses the body, null when signed out or 401', async () => {
    const q = setup(() => res(200, { remainingToday: 3, limit: 5 }));
    expect(await q.client.quota()).toEqual({ remainingToday: 3, limit: 5 });
    const [url, init] = q.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/vibe/photo-quota');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(await setup(() => res(401, {})).client.quota()).toBeNull();
    expect(await setup(() => res(200, {}), null).client.quota()).toBeNull();
  });
});

describe('prepareMessage', () => {
  const client = (r: unknown) => ({ describe: vi.fn(async () => r as never) });
  const ok = { ok: true, description: 'Warm', remainingToday: 4 };
  it('text only skips describe', async () => {
    const c = client(ok);
    expect(await prepareMessage({ text: ' Cozy ', photo: null, client: c })).toEqual({ ok: true, text: 'Cozy', imageCount: 0 });
    expect(c.describe).not.toHaveBeenCalled();
  });
  it('empty', async () => {
    expect(await prepareMessage({ text: '  ', photo: null, client: client(ok) })).toEqual({ ok: false, reason: 'empty', message: 'Add a few words or a photo first.' });
  });
  it('photo plus text, and photo only', async () => {
    expect(await prepareMessage({ text: 'Cozy', photo: file(), client: client(ok) })).toEqual({ ok: true, text: 'Cozy\nPhoto: Warm', imageCount: 1 });
    expect(await prepareMessage({ text: '', photo: file(), client: client(ok) })).toEqual({ ok: true, text: 'Photo: Warm', imageCount: 1 });
  });
  it('passes failures through', async () => {
    const fail = { ok: false, reason: 'limit', message: 'm' };
    expect(await prepareMessage({ text: 'a', photo: file(), client: client(fail) })).toEqual(fail);
  });
  it('stale when no longer current', async () => {
    const r = await prepareMessage({ text: 'a', photo: file(), client: client(ok), isCurrent: () => false });
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
  });
});

describe('photoAccess', () => {
  it('is loading before connect', async () => {
    expect(photoAccess.status()).toBe('loading');
    expect(await photoAccess.getAccessToken()).toBeNull();
  });
  it('fromAccountStore maps state and notifies', () => {
    let state: { status: string } = { status: 'signed_in' };
    const listeners: Array<(s: never) => void> = [];
    const store = { getState: () => state as never, subscribe: (cb: (s: never) => void) => { listeners.push(cb); return () => {}; }, getAccessToken: async () => 'tok' };
    const src = fromAccountStore(store, () => {});
    expect(src.status()).toBe('signed_in');
    const cb = vi.fn();
    src.subscribe(cb);
    state = { status: 'unavailable' };
    listeners.forEach(l => l(state as never));
    expect(cb).toHaveBeenCalled();
    expect(src.status()).toBe('unavailable');
  });
  it('connect notifies subscribers', () => {
    const cb = vi.fn();
    photoAccess.subscribe(cb);
    photoAccess.connect({ status: () => 'signed_out', subscribe: () => () => {}, getAccessToken: async () => null, requestSignIn: () => {} });
    expect(cb).toHaveBeenCalled();
    expect(photoAccess.status()).toBe('signed_out');
  });
});
