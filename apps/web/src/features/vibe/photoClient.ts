import { photoAccess, type PhotoAccessSource } from './photoAccess';

export type PhotoFailure = 'signed_out' | 'limit' | 'unreadable' | 'unavailable';
export type PhotoResult = { ok: true; description: string; remainingToday: number | null } | { ok: false; reason: PhotoFailure; message: string };
export interface PhotoClient {
  describe(file: File, question?: string): Promise<PhotoResult>;
  cached(file: File, question?: string): string | undefined;
  quota(): Promise<{ remainingToday: number | null; limit: number } | null>;
}
type Prepared = { mimeType: 'image/jpeg'; data: string };

export const PHOTO_MESSAGES: Record<PhotoFailure, string> = {
  signed_out: 'Sign in to use a photo.',
  limit: "You've used today's 5 photo reads. Remove the photo to send your words, or try again tomorrow.",
  unreadable: "We couldn't read that photo. Try another, or remove it to send your words.",
  unavailable: 'Photo reading is unavailable right now. Retry, or remove the photo to send your words.',
};
const DESCRIBE_URL = '/api/vibe/describe-image';
const QUOTA_URL = '/api/vibe/photo-quota';
const TIMEOUT_MS = 30_000;
const fail = (reason: PhotoFailure): PhotoResult => ({ ok: false, reason, message: PHOTO_MESSAGES[reason] });

export function createPhotoClient(deps: { access: Pick<PhotoAccessSource, 'getAccessToken'>; prepare?: (file: File) => Promise<Prepared>; fetchImpl?: typeof fetch }): PhotoClient {
  const prepare = deps.prepare ?? downscaleToJpeg;
  const doFetch = (input: string, init: RequestInit) => (deps.fetchImpl ?? fetch)(input, init);
  const cache = new WeakMap<File, Map<string, string>>();
  const inflight = new WeakMap<File, Map<string, Promise<PhotoResult>>>();
  const slot = <T>(m: WeakMap<File, Map<string, T>>, f: File) => { let s = m.get(f); if (!s) m.set(f, s = new Map()); return s; };

  async function run(file: File, question: string | undefined, key: string): Promise<PhotoResult> {
    const token = await deps.access.getAccessToken();
    if (!token) return fail('signed_out');
    let img: Prepared;
    try { img = await prepare(file); } catch { return fail('unreadable'); }
    try {
      const r = await doFetch(DESCRIBE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mimeType: img.mimeType, data: img.data, question }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await r.json().catch(() => ({}))) as { description?: unknown; remainingToday?: unknown; error?: unknown };
      if (r.ok && typeof body.description === 'string') {
        slot(cache, file).set(key, body.description);
        return { ok: true, description: body.description, remainingToday: typeof body.remainingToday === 'number' ? body.remainingToday : null };
      }
      if (r.status === 401) return fail('signed_out');
      if (r.status === 429) return fail(body.error === 'daily_limit' ? 'limit' : 'unavailable');
      if (r.status === 422) return fail('unreadable');
      return fail('unavailable');
    } catch { return fail('unavailable'); }
  }

  return {
    cached: (file, question) => cache.get(file)?.get(question ?? ''),
    async describe(file, question) {
      const key = question ?? '';
      const hit = cache.get(file)?.get(key);
      if (hit !== undefined) return { ok: true, description: hit, remainingToday: null };
      const pending = slot(inflight, file);
      const running = pending.get(key);
      if (running) return running;
      const p = run(file, question, key).finally(() => pending.delete(key));
      pending.set(key, p);
      return p;
    },
    async quota() {
      const token = await deps.access.getAccessToken();
      if (!token) return null;
      try {
        const r = await doFetch(QUOTA_URL, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!r.ok) return null;
        const b = (await r.json()) as { remainingToday?: unknown; limit?: unknown };
        if (typeof b.limit !== 'number') return null;
        return { remainingToday: typeof b.remainingToday === 'number' ? b.remainingToday : null, limit: b.limit };
      } catch { return null; }
    },
  };
}

export async function downscaleToJpeg(file: File, maxEdge = 1024): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    let blob: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
      blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    } else {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
      blob = await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85));
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mimeType: 'image/jpeg', data: btoa(bin) };
  } finally { bitmap.close(); }
}

export const photoClient = createPhotoClient({ access: photoAccess });
