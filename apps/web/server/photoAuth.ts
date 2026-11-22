/** Verifies a Supabase access token and exposes the per-user daily photo quota. Tokens are never logged. */
import { createClient } from '@supabase/supabase-js';
export interface PhotoQuota { remaining(limit: number): Promise<number>; record(limit: number): Promise<number> }
export interface PhotoAuth { verify(token: string): Promise<PhotoQuota | null> }
export const normalizeSupabaseUrl = (url: string) => url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
export function createSupabasePhotoAuth(o: { url?: string; key?: string; create?: typeof createClient }): PhotoAuth | null {
 const key = o.key, url = o.url ? normalizeSupabaseUrl(o.url) : '', make = o.create ?? createClient;
 if (!url || !key) return null;
 return { async verify(token) {
  const client = make(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error) { if (error.status === 401 || error.status === 403) return null; throw Error('Auth unavailable'); }
  if (!data?.user) return null;
  const call = async (name: string, limit: number) => {
   const { data: n, error: e } = await client.rpc(name, { daily_limit: limit });
   if (e || typeof n !== 'number') throw Error('Quota unavailable');
   return n;
  };
  return { remaining: (limit) => call('vibe_photo_uses_remaining', limit), record: (limit) => call('record_vibe_photo_use', limit) };
 } };
}
