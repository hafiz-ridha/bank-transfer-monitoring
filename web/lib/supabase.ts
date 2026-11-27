'use client';
// Klien Supabase (hanya untuk mode auth supabase). Dibuat lazy di browser.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';

let client: SupabaseClient | null = null;

export const supabaseConfigured = () => !!config.supabaseUrl && !!config.supabaseAnonKey;

export function getSupabase(): SupabaseClient {
  if (typeof window === 'undefined') throw new Error('Supabase client hanya tersedia di browser');
  if (!supabaseConfigured()) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY belum diisi di .env server');
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
