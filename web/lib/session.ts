// Sumber token bearer untuk API (dipakai lib/api.ts & lib/auth.tsx).
import { config } from './config';
import { getSupabase, supabaseConfigured } from './supabase';

export const DEV_TOKEN_KEY = 'btm.devToken';

export function readDevToken(): string | null {
  try {
    return window.localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Token saat ini: `dev:<email>` (mode dev) atau access_token Supabase (otomatis di-refresh oleh supabase-js). */
export async function currentToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (config.authMode === 'dev') return readDevToken();
  if (!supabaseConfigured()) return null;
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
