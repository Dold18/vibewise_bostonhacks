import { messageText } from './photoMessage';
import type { PhotoClient, PhotoFailure } from './photoClient';

export type PreparedMessage = { ok: true; text: string; imageCount: 0 | 1 } | { ok: false; reason: PhotoFailure | 'empty' | 'stale'; message: string };

export async function prepareMessage(input: { text: string; photo: File | null; question?: string; client: Pick<PhotoClient, 'describe'>; isCurrent?: () => boolean }): Promise<PreparedMessage> {
  const { text, photo, question, client, isCurrent } = input;
  if (!photo) {
    const t = messageText(text);
    return t ? { ok: true, text: t, imageCount: 0 } : { ok: false, reason: 'empty', message: 'Add a few words or a photo first.' };
  }
  const r = await client.describe(photo, question);
  if (isCurrent && !isCurrent()) return { ok: false, reason: 'stale', message: '' };
  if (!r.ok) return r;
  return { ok: true, text: messageText(text, r.description), imageCount: 1 };
}
