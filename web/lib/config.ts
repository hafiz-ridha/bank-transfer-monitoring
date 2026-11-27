// Konfigurasi publik (ditanam saat build). Akses process.env.NEXT_PUBLIC_* harus literal agar di-inline oleh Next.js.

export type AuthMode = 'supabase' | 'dev';

const rawMode = (process.env.NEXT_PUBLIC_AUTH_MODE ?? 'supabase').trim().toLowerCase();

export const config = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').trim().replace(/\/+$/, ''),
  authMode: (rawMode === 'dev' ? 'dev' : 'supabase') as AuthMode,
  supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseAnonKey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
  refreshMs: Math.max(5000, Number(process.env.NEXT_PUBLIC_REFRESH_MS ?? 15000) || 15000),
  appName: (process.env.NEXT_PUBLIC_APP_NAME ?? 'Bank Transfer Monitor').trim() || 'Bank Transfer Monitor',
};

export const API_BASE = `${config.apiUrl}/api/v1`;
