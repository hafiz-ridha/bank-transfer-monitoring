'use client';
// Autentikasi dashboard: Supabase Auth (produksi) atau mode dev (token "dev:<email>").
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, setUnauthorizedHandler } from './api';
import { config, type AuthMode } from './config';
import { setDisplayTimezone } from './format';
import { DEV_TOKEN_KEY, currentToken } from './session';
import { getSupabase, supabaseConfigured } from './supabase';
import type { ListResponse, Me, SettingDef } from './types';

const FLASH_KEY = 'btm.flash';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'forbidden' | 'error';

interface AuthContextValue {
  mode: AuthMode;
  status: AuthStatus;
  user: Me | null;
  isAdmin: boolean;
  error: string | null;
  timezone: string;
  businessName: string | null;
  /** Pesan sekali tampil di halaman login (mis. sesi berakhir). */
  takeFlash: () => string | null;
  loginDev: (email: string) => Promise<void>;
  loginPassword: (email: string, password: string) => Promise<void>;
  logout: (flash?: string) => Promise<void>;
  retry: () => void;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Logout eksplisit: halaman login dibuka tanpa parameter ?next=
let explicitLogout = false;
export function consumeExplicitLogout(): boolean {
  const v = explicitLogout;
  explicitLogout = false;
  return v;
}

function setFlash(msg: string) {
  try {
    window.sessionStorage.setItem(FLASH_KEY, msg);
  } catch {
    /* abaikan */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [businessName, setBusinessName] = useState<string | null>(null);
  const loadingRef = useRef<Promise<void> | null>(null);
  const statusRef = useRef<AuthStatus>('loading');
  statusRef.current = status;

  const clearLocalSession = useCallback(async () => {
    if (config.authMode === 'dev') {
      try {
        window.localStorage.removeItem(DEV_TOKEN_KEY);
      } catch {
        /* abaikan */
      }
    } else if (supabaseConfigured()) {
      await getSupabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  }, []);

  /** Memuat profil (/me) dan pengaturan tampilan (zona waktu) untuk sesi saat ini. */
  const loadSession = useCallback(async () => {
    if (loadingRef.current) return loadingRef.current;
    const run = (async () => {
      try {
        const token = await currentToken();
        if (!token) {
          setUser(null);
          setStatus('anonymous');
          return;
        }
        const me = await api.get<Me>('/me', undefined, { skipAuthRedirect: true });
        try {
          const s = await api.get<ListResponse<SettingDef>>('/settings', undefined, { skipAuthRedirect: true });
          const tz = s.data.find((x) => x.key === 'general.timezone')?.value;
          const bn = s.data.find((x) => x.key === 'general.business_name')?.value;
          if (typeof tz === 'string' && tz) {
            setDisplayTimezone(tz);
            setTimezone(tz);
          }
          if (typeof bn === 'string') setBusinessName(bn || null);
        } catch {
          // pengaturan gagal dimuat: tetap gunakan Asia/Jakarta
        }
        setUser(me);
        setError(null);
        setStatus('authenticated');
      } catch (err) {
        const e = err as ApiError;
        if (e instanceof ApiError && e.status === 401) {
          await clearLocalSession();
          setUser(null);
          setError(e.message);
          setStatus('anonymous');
        } else if (e instanceof ApiError && e.status === 403) {
          setUser(null);
          setError(e.message || 'Akun Anda belum terdaftar atau dinonaktifkan.');
          setStatus('forbidden');
        } else {
          setError(e?.message ?? 'Gagal memuat sesi');
          setStatus('error');
        }
      } finally {
        loadingRef.current = null;
      }
    })();
    loadingRef.current = run;
    return run;
  }, [clearLocalSession]);

  // Inisialisasi sekali di browser
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current !== 'authenticated') return;
      setFlash('Sesi Anda telah berakhir. Silakan login kembali.');
      void clearLocalSession().then(() => {
        setUser(null);
        setStatus('anonymous');
      });
    });

    if (config.authMode === 'supabase') {
      if (!supabaseConfigured()) {
        setError('Konfigurasi Supabase belum lengkap: isi SUPABASE_URL dan SUPABASE_ANON_KEY di .env server, lalu jalankan ulang container.');
        setStatus('error');
        return;
      }
      // Tautan undangan / pemulihan password dari email Supabase mendarat dengan hash #...type=invite|recovery
      const hash = window.location.hash;
      const linkType = /type=(invite|recovery|signup|magiclink)/.exec(hash)?.[1] ?? null;
      const hashError = /error_description=([^&]+)/.exec(hash)?.[1];
      if (hashError) setFlash(decodeURIComponent(hashError.replace(/\+/g, ' ')));

      const sb = getSupabase();
      const { data: sub } = sb.auth.onAuthStateChange((event) => {
        // Jangan memanggil method supabase lain secara sinkron di callback ini (rawan deadlock).
        setTimeout(() => {
          if (event === 'PASSWORD_RECOVERY') {
            router.replace('/reset-password?mode=recovery');
          } else if (event === 'SIGNED_OUT') {
            setUser(null);
            setStatus('anonymous');
          } else if (event === 'SIGNED_IN' && statusRef.current !== 'authenticated') {
            void loadSession();
          }
        }, 0);
      });
      void loadSession().then(() => {
        if ((linkType === 'invite' || linkType === 'recovery') && !window.location.pathname.startsWith('/reset-password')) {
          router.replace(`/reset-password?mode=${linkType}`);
        }
      });
      return () => sub.subscription.unsubscribe();
    }

    void loadSession();
    return () => setUnauthorizedHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginDev = useCallback(async (email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean) throw new Error('Email wajib diisi');
    window.localStorage.setItem(DEV_TOKEN_KEY, `dev:${clean}`);
    setStatus('loading');
    await loadSession();
  }, [loadSession]);

  const loginPassword = useCallback(async (email: string, password: string) => {
    const { error: err } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      const msg = /invalid login credentials/i.test(err.message)
        ? 'Email atau password salah'
        : /email not confirmed/i.test(err.message)
          ? 'Email belum dikonfirmasi. Buka tautan undangan/konfirmasi di email Anda.'
          : err.message;
      throw new Error(msg);
    }
    setStatus('loading');
    await loadSession();
  }, [loadSession]);

  const logout = useCallback(async (flash?: string) => {
    explicitLogout = true;
    setTimeout(() => {
      explicitLogout = false;
    }, 3000);
    if (flash) setFlash(flash);
    if (config.authMode === 'supabase' && supabaseConfigured()) {
      await getSupabase().auth.signOut().catch(() => undefined);
    }
    await clearLocalSession();
    setUser(null);
    setStatus('anonymous');
    router.replace('/login');
  }, [clearLocalSession, router]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error: err } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password?mode=recovery`,
    });
    if (err) throw new Error(err.message);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error: err } = await getSupabase().auth.updateUser({ password });
    if (err) throw new Error(err.message);
  }, []);

  const takeFlash = useCallback(() => {
    try {
      const v = window.sessionStorage.getItem(FLASH_KEY);
      if (v) window.sessionStorage.removeItem(FLASH_KEY);
      return v;
    } catch {
      return null;
    }
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    void loadSession();
  }, [loadSession]);

  const value = useMemo<AuthContextValue>(() => ({
    mode: config.authMode,
    status,
    user,
    isAdmin: user?.role === 'admin',
    error,
    timezone,
    businessName,
    takeFlash,
    loginDev,
    loginPassword,
    logout,
    retry,
    requestPasswordReset,
    updatePassword,
  }), [status, user, error, timezone, businessName, takeFlash, loginDev, loginPassword, logout, retry, requestPasswordReset, updatePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}
