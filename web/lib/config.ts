// Konfigurasi publik dashboard.
// - Produksi (dashboard disajikan backend dalam satu container): nilai dibaca SAAT RUNTIME dari
//   /app-config.js (window.__BTM_CONFIG__) yang dibuat backend dari .env-nya. Ganti domain / kunci
//   Supabase cukup di .env backend lalu recreate container — tanpa build ulang dashboard.
// - Pengembangan (`next dev`): fallback ke NEXT_PUBLIC_* (.env.local). Akses process.env.NEXT_PUBLIC_*
//   harus literal agar di-inline oleh Next.js.

export type AuthMode = 'supabase' | 'dev';

type RuntimeConfig = { apiUrl?: string; authMode?: string; supabaseUrl?: string; supabaseAnonKey?: string };

declare global {
  interface Window {
    __BTM_CONFIG__?: RuntimeConfig;
  }
}

const buildTime: Required<RuntimeConfig> = {
  // Kosong = API di origin yang sama dengan dashboard (mode satu container).
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE ?? 'supabase',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

function pick(key: keyof RuntimeConfig): string {
  const runtime = typeof window !== 'undefined' ? window.__BTM_CONFIG__ : undefined;
  const v = runtime?.[key];
  return (typeof v === 'string' ? v : buildTime[key]).trim();
}

export const config = {
  /** URL dasar backend tanpa /api/v1; string kosong = origin yang sama. */
  get apiUrl(): string {
    return pick('apiUrl').replace(/\/+$/, '');
  },
  get authMode(): AuthMode {
    return pick('authMode').toLowerCase() === 'dev' ? 'dev' : 'supabase';
  },
  get supabaseUrl(): string {
    return pick('supabaseUrl');
  },
  get supabaseAnonKey(): string {
    return pick('supabaseAnonKey');
  },
  /** Alamat server yang ditampilkan ke pengguna (diisi di aplikasi Android / sistem POS). */
  get publicApiUrl(): string {
    const api = config.apiUrl;
    if (api) return api;
    return typeof window !== 'undefined' ? window.location.origin : '';
  },
  refreshMs: Math.max(5000, Number(process.env.NEXT_PUBLIC_REFRESH_MS ?? 15000) || 15000),
  appName: (process.env.NEXT_PUBLIC_APP_NAME ?? 'Bank Transfer Monitor').trim() || 'Bank Transfer Monitor',
};

export const apiBase = () => `${config.apiUrl}/api/v1`;
