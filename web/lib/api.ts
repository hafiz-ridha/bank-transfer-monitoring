// Klien API bertipe untuk backend Bank Transfer Monitor (docs/API.md bagian B).
// - Menyisipkan header Authorization: Bearer <token>
// - Mengurai error { error: { code, message, details } }
// - 401 => handler sesi berakhir (logout + arahkan ke /login); 403 => ApiError dengan pesan dari server
import { API_BASE } from './config';
import { currentToken } from './session';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isForbidden() {
    return this.status === 403;
  }
}

let unauthorizedHandler: ((err: ApiError) => void) | null = null;

export function setUnauthorizedHandler(fn: ((err: ApiError) => void) | null) {
  unauthorizedHandler = fn;
}

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

/** Membuat query string; nilai kosong/null dilewati, array digabung dengan koma. */
export function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Jangan panggil handler 401 global (dipakai saat cek sesi awal). */
  skipAuthRedirect?: boolean;
}

async function rawFetch(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const token = await currentToken();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    // Fastify menolak body kosong dengan content-type JSON, jadi selalu kirim objek.
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, { method, headers, body, signal: opts.signal, cache: 'no-store' });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', `Tidak dapat terhubung ke server API (${API_BASE}). Periksa koneksi internet atau konfigurasi NEXT_PUBLIC_API_URL.`);
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401 && !opts.skipAuthRedirect) unauthorizedHandler?.(err);
    throw err;
  }
  return res;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = `Permintaan gagal (HTTP ${res.status})`;
  let details: unknown;
  try {
    const j = await res.json();
    if (j?.error) {
      code = j.error.code ?? code;
      message = j.error.message ?? message;
      details = j.error.details;
    } else if (j?.message) {
      message = j.message;
      code = j.code ?? code;
    }
  } catch {
    // body bukan JSON
  }
  if (res.status === 403 && code === `HTTP_403`) message = 'Akses ditolak untuk role Anda';
  if (res.status === 429) message = message || 'Terlalu banyak permintaan, coba lagi sebentar lagi';
  return new ApiError(res.status, code, message, details);
}

/** Event global setelah mutasi berhasil (POST/PUT/PATCH) agar badge sidebar dll. ikut diperbarui. */
export const DATA_CHANGED_EVENT = 'btm:data-changed';

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawFetch(method, path, opts);
  if (method !== 'GET' && typeof window !== 'undefined') {
    setTimeout(() => window.dispatchEvent(new Event(DATA_CHANGED_EVENT)), 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : fallback;
}

/** Unduh file (mis. CSV) dengan header Authorization: ambil sebagai blob lalu simpan. */
async function download(path: string, query: Query | undefined, fallbackName: string): Promise<string> {
  const res = await rawFetch('GET', path, { query });
  const blob = await res.blob();
  const name = filenameFrom(res, fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

export const api = {
  get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, 'query' | 'body'>) => request<T>('GET', path, { ...opts, query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  download,
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
