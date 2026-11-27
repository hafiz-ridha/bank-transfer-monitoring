// Format angka, rupiah, tanggal & durasi (Bahasa Indonesia, zona waktu operasional).

let currentTz = 'Asia/Jakarta';

/** Dipanggil oleh AuthProvider setelah membaca pengaturan general.timezone. */
export function setDisplayTimezone(tz: string | null | undefined) {
  if (!tz) return;
  try {
    new Intl.DateTimeFormat('id-ID', { timeZone: tz });
    currentTz = tz;
  } catch {
    // zona waktu tidak valid: abaikan, tetap pakai sebelumnya
  }
}

export const getDisplayTimezone = () => currentTz;

const rupiahFmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const numberFmt = new Intl.NumberFormat('id-ID');

/** Rp 150.000 */
export function rupiah(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '-';
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return rupiahFmt.format(v).replace(/ /g, ' ');
}

export function num(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '-';
  const v = Number(n);
  return Number.isFinite(v) ? numberFmt.format(v) : '-';
}

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, locale = 'id-ID'): Intl.DateTimeFormat {
  const key = `${locale}|${currentTz}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: currentTz });
    fmtCache.set(key, f);
  }
  return f;
}

/** 27 Nov 2026 10.01.05 */
export function dateTime(v: string | number | Date | null | undefined, withSeconds = true): string {
  const d = toDate(v);
  if (!d) return '-';
  const datePart = fmt({ day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  const timePart = fmt({ hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(d);
  return `${datePart} ${timePart}`;
}

/** 10.01.05 — atau dengan tanggal bila bukan hari ini (zona operasional). */
export function timeSmart(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '-';
  const dayKey = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA');
  const timePart = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
  if (dayKey.format(d) === dayKey.format(new Date())) return timePart;
  return `${fmt({ day: '2-digit', month: 'short' }).format(d)} ${timePart}`;
}

export function dateOnly(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '-';
  return fmt({ day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

/** YYYY-MM-DD hari ini di zona waktu operasional. */
export function todayYmd(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(d);
}

export function firstOfMonthYmd(): string {
  return `${todayYmd().slice(0, 8)}01`;
}

/** Durasi singkat dari detik: "45 detik", "3 menit", "2 jam 5 menit", "3 hari". */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '-';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} detik`;
  if (s < 3600) return `${Math.floor(s / 60)} menit`;
  if (s < 86400) {
    const m = Math.floor((s % 3600) / 60);
    return `${Math.floor(s / 3600)} jam${m ? ` ${m} menit` : ''}`;
  }
  const h = Math.floor((s % 86400) / 3600);
  return `${Math.floor(s / 86400)} hari${h ? ` ${h} jam` : ''}`;
}

/** "2 menit lalu" dari timestamp (atau umur dalam detik bila diberikan). */
export function timeAgo(v: string | number | Date | null | undefined, ageSeconds?: number | null): string {
  let sec: number | null = null;
  if (ageSeconds !== undefined && ageSeconds !== null && Number.isFinite(ageSeconds)) sec = ageSeconds;
  else {
    const d = toDate(v);
    if (!d) return '-';
    sec = (Date.now() - d.getTime()) / 1000;
  }
  if (sec < 0) return 'baru saja';
  if (sec < 10) return 'baru saja';
  return `${duration(sec)} lalu`;
}

export function secondsSince(v: string | null | undefined): number | null {
  const d = toDate(v);
  return d ? Math.max(0, (Date.now() - d.getTime()) / 1000) : null;
}

/** Nilai string input number -> number | undefined */
export function parseIntInput(v: string): number | undefined {
  const cleaned = v.replace(/[^\d]/g, '');
  if (!cleaned) return undefined;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function shortId(id: string | null | undefined): string {
  if (!id) return '-';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
