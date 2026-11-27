'use client';
// Klien Supabase (hanya untuk NEXT_PUBLIC_AUTH_MODE=supabase). Dibuat lazy di browser.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';

let client: SupabaseClient | null = null;

export const supabaseConfigured = () => !!config.supabaseUrl && !!config.supabaseAnonKey;

export function getSupabase(): SupabaseClient {
  if (typeof window === 'undefined') throw new Error('Supabase client hanya tersedia di browser');
  if (!supabaseConfigured()) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum diisi');
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'btm.supabase.auth',
      },
    });
  }
  return client;
}
