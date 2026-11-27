import crypto from 'node:crypto';

// ---------------------------------------------------------------- errors
export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg, details) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Tidak terautentikasi', code = 'UNAUTHORIZED') => new HttpError(401, code, msg);
export const forbidden = (msg = 'Akses ditolak') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Data tidak ditemukan') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg, details) => new HttpError(409, 'CONFLICT', msg, details);

// ---------------------------------------------------------------- crypto
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const hmacSha256 = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const uuid = () => crypto.randomUUID();

// Kode pairing pendek yang mudah diketik di HP: 8 karakter tanpa huruf ambigu.
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function pairingCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  return out;
}
export const normalizePairingCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- semver
export function compareVersions(a, b) {
  const pa = String(a ?? '0').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b ?? '0').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ---------------------------------------------------------------- names
const NAME_NOISE = new Set([
  'BPK', 'BAPAK', 'PAK', 'IBU', 'BU', 'SDR', 'SDRI', 'SAUDARA', 'SAUDARI', 'TN', 'NY', 'NN', 'MR', 'MRS', 'MS',
  'PT', 'CV', 'TBK', 'UD', 'TOKO', 'HJ', 'H', 'DR', 'IR', 'ST', 'SE', 'SH', 'SKOM', 'SPD',
]);
const GENERIC_CUSTOMER = new Set(['PELANGGAN', 'CUSTOMER', 'UMUM', 'GUEST', 'TAMU', 'WALKIN', '-']);

export function normalizeName(name) {
  return String(name ?? '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NAME_NOISE.has(t));
}

/**
 * Kemiripan nama 0..1 (berbasis token; mendukung nama terpotong di notifikasi bank,
 * mis. "BUDI SANTOSO" vs "BUDI S"). Nama pelanggan generik selalu 0.
 */
export function nameSimilarity(a, b) {
  const ta = normalizeName(a);
  const tb = normalizeName(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.every((t) => GENERIC_CUSTOMER.has(t)) || tb.every((t) => GENERIC_CUSTOMER.has(t))) return 0;
  const matchToken = (x, y) => x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))
    || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set();
  let hits = 0;
  for (const s of shorter) {
    const idx = longer.findIndex((l, i) => !used.has(i) && matchToken(s, l));
    if (idx >= 0) { used.add(idx); hits++; }
  }
  const ratio = hits / longer.length;
  // Semua token nama yang lebih pendek ditemukan (nama terpotong/disingkat) => minimal 0.75.
  return hits === shorter.length ? Math.max(ratio, 0.75) : ratio;
}

export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');

/** Cocok jika digit yang tersedia di kedua sisi konsisten (mendukung nomor yang disamarkan / 4 digit terakhir). */
export function accountMatches(a, b) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (da.length < 3 || db.length < 3) return false;
  return da.endsWith(db) || db.endsWith(da) || da.slice(-4) === db.slice(-4);
}

// ---------------------------------------------------------------- pagination & sorting
export function pageParams(query, { defaultSize = 25, maxSize = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.page_size ?? String(defaultSize), 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pagination(page, pageSize, total) {
  return { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function sortClause(query, allowed, fallback) {
  const col = allowed[query.sort] ?? allowed[fallback];
  const dir = String(query.order ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir} NULLS LAST`;
}

// ---------------------------------------------------------------- CSV
export function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Cegah CSV/formula injection saat dibuka di spreadsheet.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- misc
export const truncate = (s, n) => (s == null ? s : String(s).length > n ? String(s).slice(0, n) + '…' : String(s));
export const toDate = (v) => (v ? new Date(v) : null);
export const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
