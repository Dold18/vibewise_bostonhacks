/** Signed-in photo routes. Never logs or echoes request bodies, tokens, descriptions or upstream error messages. */
import { Router } from 'express';
import type { PhotoAuth, PhotoQuota } from './photoAuth.ts';
import type { PhotoDescriber, PhotoInput } from './photoDescriber.ts';
export const DAILY_PHOTO_LIMIT = 5;
export interface PhotoDeps { auth(): PhotoAuth | null; describer(): PhotoDescriber; unlimited(): boolean }
const MIMES = ['image/jpeg', 'image/png', 'image/webp'], B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** A quiz prompt is up to 500 characters (validQuestion), and the question sent is the prompt. */
const MAX_QUESTION = 500;
function parse(body: unknown): PhotoInput | null {
 const b = body as { mimeType?: unknown; data?: unknown; question?: unknown } | null;
 if (!b || typeof b.mimeType !== 'string' || !MIMES.includes(b.mimeType) || typeof b.data !== 'string' || !b.data || !B64.test(b.data)) return null;
 if (b.question !== undefined && (typeof b.question !== 'string' || b.question.length > MAX_QUESTION)) return null;
 return { mimeType: b.mimeType as PhotoInput['mimeType'], data: b.data, ...(b.question ? { question: b.question } : {}) };
}
export function createPhotoRoutes(deps: PhotoDeps): Router {
 const router = Router();
 const authenticate = async (req: { headers: { authorization?: string } }, res: { status(n: number): { json(b: unknown): void } }): Promise<PhotoQuota | null> => {
  const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
  if (!m) { res.status(401).json({ error: 'Sign in to use a photo.' }); return null; }
  const auth = deps.auth();
  if (!auth) { res.status(503).json({ error: 'Photo reading is not configured.' }); return null; }
  let quota: PhotoQuota | null;
  try { quota = await auth.verify(m[1]); } catch { res.status(503).json({ error: 'Photo reading is unavailable.' }); return null; }
  if (!quota) { res.status(401).json({ error: 'Sign in to use a photo.' }); return null; }
  return quota;
 };
 router.get('/photo-quota', async (req, res) => {
  const quota = await authenticate(req, res); if (!quota) return;
  if (deps.unlimited()) { res.json({ remainingToday: null, limit: DAILY_PHOTO_LIMIT }); return; }
  try { res.json({ remainingToday: Math.max(0, await quota.remaining(DAILY_PHOTO_LIMIT)), limit: DAILY_PHOTO_LIMIT }); } catch { res.status(503).json({ error: 'Photo reading is unavailable.' }); }
 });
 router.post('/describe-image', async (req, res) => {
  const quota = await authenticate(req, res); if (!quota) return;
  const input = parse(req.body);
  if (!input) { res.status(400).json({ error: 'Invalid photo request.' }); return; }
  const unlimited = deps.unlimited(), abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
   if (!unlimited && (await quota.remaining(DAILY_PHOTO_LIMIT)) <= 0) { res.status(429).json({ error: 'daily_limit', remainingToday: 0 }); return; }
   const description = await deps.describer().describe(input, abort.signal);
   // The client left while the photo was read: send nothing and don't charge a use for a description nobody receives.
   if (abort.signal.aborted || res.destroyed) return;
   if (!description) { res.status(422).json({ error: 'unreadable' }); return; }
   let remainingToday: number | null = null;
   if (!unlimited) {
    remainingToday = await quota.record(DAILY_PHOTO_LIMIT);
    if (remainingToday < 0) { res.status(429).json({ error: 'daily_limit', remainingToday: 0 }); return; }
   }
   res.json({ description, remainingToday });
  } catch { if (!res.headersSent && !res.destroyed) res.status(503).json({ error: 'Photo reading is unavailable.' }); }
 });
 return router;
}
