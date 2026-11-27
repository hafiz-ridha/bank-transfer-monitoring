'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, DATA_CHANGED_EVENT, type Query } from './api';
import { config } from './config';

/** Menjalankan fn berkala; berhenti saat tab tidak terlihat dan langsung refresh saat kembali terlihat. */
export function usePolling(fn: () => void, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') fnRef.current();
      }, ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fnRef.current();
        start();
      } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, enabled]);
}

export interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  updatedAt: Date | null;
  reload: () => Promise<void>;
  setData: (d: T | null) => void;
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'CLIENT_ERROR', (err as Error)?.message ?? String(err));
}

/**
 * GET data dari API. `path = null` => tidak memuat.
 * `poll: true` => auto refresh tiap NEXT_PUBLIC_REFRESH_MS (default 15 dtk), dijeda saat tab tersembunyi.
 */
export function useApi<T>(path: string | null, query?: Query, opts: { poll?: boolean | number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const reqId = useRef(0);
  const queryKey = JSON.stringify(query ?? {});

  const load = useCallback(async (silent: boolean) => {
    if (path === null) return;
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    try {
      const d = await api.get<T>(path, JSON.parse(queryKey) as Query);
      if (id !== reqId.current) return;
      setData(d);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      if (id !== reqId.current) return;
      setError(toApiError(err));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [path, queryKey]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const pollMs = typeof opts.poll === 'number' ? opts.poll : config.refreshMs;
  usePolling(() => void load(true), pollMs, !!opts.poll && path !== null);

  const reload = useCallback(() => load(true), [load]);
  return { data, error, loading, updatedAt, reload, setData };
}

/** Menjalankan fn setiap kali ada mutasi data berhasil (lihat DATA_CHANGED_EVENT). */
export function useOnDataChanged(fn: () => void) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    const h = () => fnRef.current();
    window.addEventListener(DATA_CHANGED_EVENT, h);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, h);
  }, []);
}

/** Status sederhana untuk aksi (POST/PATCH): busy + jalankan. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

/** Membaca query string URL sekali saat mount (tanpa useSearchParams agar halaman tetap statis). */
export function useInitialQuery(): URLSearchParams {
  const [params] = useState(() => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)));
  return params;
}
