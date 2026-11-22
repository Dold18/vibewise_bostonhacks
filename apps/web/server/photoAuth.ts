/** Verifies a Supabase access token and exposes the per-user daily photo quota. Tokens are never logged. */
import { createClient } from '@supabase/supabase-js';
export interface PhotoQuota { remaining(limit: number): Promise<number>; record(limit: number): Promise<number> }
export interface PhotoAuth { verify(token: string): Promise<PhotoQuota | null> }
export function createSupabasePhotoAuth(o: { url?: string; key?: string }): PhotoAuth | null {
 const { url, key } = o; if (!url || !key) return null;
 return { async verify(token) {
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  const call = async (name: string, limit: number) => {
   const { data: n, error: e } = await client.rpc(name, { daily_limit: limit });
   if (e || typeof n !== 'number') throw Error('Quota unavailable');
   return n;
  };
  return { remaining: (limit) => call('vibe_photo_uses_remaining', limit), record: (limit) => call('record_vibe_photo_use', limit) };
 } };
}
