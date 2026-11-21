import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseBackend } from '../backend';

describe('createSupabaseBackend', () => {
  it('signs out this device locally, so a network failure cannot leave the session behind', async () => {
    const calls: unknown[] = [];
    const client = {
      auth: {
        signOut: async (options?: unknown) => {
          calls.push(options);
          return { error: null };
        },
      },
    } as unknown as SupabaseClient;
    await createSupabaseBackend(client).signOut();
    expect(calls).toEqual([{ scope: 'local' }]);
  });
});
