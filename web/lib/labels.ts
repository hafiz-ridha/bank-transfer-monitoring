// Label Bahasa Indonesia & warna untuk enum API.
import type { AlertStatus, CandidateStatus, ConnectionState, DeviceStatus, MatchStatus, OrderStatus, PaymentStatus, StatusSource, WebhookStatus } from './types';

export type Tone = 'green' | 'yellow' | 'red' | 'orange' | 'gray' | 'blue' | 'teal' | 'purple';

export const DEVICE_STATUS: Record<DeviceStatus, { label: string; tone: Tone; hint: string }> = {
  ACTIVE: { label: 'ACTIVE', tone: 'green', hint: 'Heartbeat terbaru diterima dan listener terhubung' },
  WARNING: { label: 'WARNING', tone: 'yellow', hint: 'Heartbeat terlambat atau ada kendala konfigurasi' },
  INACTIVE: { label: 'INACTIVE', tone: 'red', hint: 'Tidak ada heartbeat melewati ambang batas' },
  PERMISSION_ERROR: { label: 'PERMISSION ERROR', tone: 'red', hint: 'Notification Access tidak aktif' },
  DISCONNECTED: { label: 'DISCONNECTED', tone: 'orange', hint: 'Koneksi server tidak tersedia berdasarkan laporan terakhir perangkat' },
  UNKNOWN: { label: 'UNKNOWN', tone: 'gray', hint: 'Belum ada data status yang cukup' },
};

export function statusSourceLabel(source: StatusSource | null | undefined, reason?: string | null): string {
  if (source === 'device_reported') return 'Dilaporkan perangkat';
  if (source === 'inferred') return reason === 'heartbeat_late' ? 'Dugaan: heartbeat terlambat' : 'Dugaan: heartbeat hilang';
  return 'Belum ada laporan';
}

const STATUS_REASON: Record<string, string> = {
  ok: 'Normal',
  heartbeat_late: 'Heartbeat terlambat',
  heartbeat_missing: 'Heartbeat hilang',
  notification_access_disabled: 'Notification Access nonaktif',
  listener_disconnected: 'Listener terputus',
  device_reported_network_lost: 'Perangkat melaporkan koneksi terputus',
  never_reported: 'Belum pernah mengirim heartbeat',
  incomplete_report: 'Laporan perangkat belum lengkap',
  awaiting_heartbeat: 'Menunggu heartbeat pertama',
  battery_optimized: 'Belum dikecualikan dari optimasi baterai',
  background_restricted: 'Aktivitas background dibatasi',
  queue_backlog: 'Antrean menumpuk',
  sync_failed: 'Sinkronisasi gagal',
  unsupported_app_version: 'Versi aplikasi tidak didukung',
};

export const statusReasonLabel = (r: string | null | undefined) => (r ? STATUS_REASON[r] ?? r.replace(/_/g, ' ') : '-');

export const CONNECTION_STATE: Record<ConnectionState, { label: string; tone: Tone }> = {
  connected: { label: 'Terhubung', tone: 'green' },
  disconnected_reported: { label: 'Terputus (dilaporkan perangkat)', tone: 'orange' },
  disconnected_suspected: { label: 'Terputus (dugaan, heartbeat hilang)', tone: 'red' },
  unknown: { label: 'Tidak diketahui', tone: 'gray' },
};

export const MATCH_STATUS: Record<MatchStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Belum diproses', tone: 'gray' },
  MATCHED: { label: 'Matched', tone: 'green' },
  MANUAL_VERIFIED: { label: 'Manual Verified', tone: 'teal' },
  UNMATCHED: { label: 'Unmatched', tone: 'orange' },
  AMBIGUOUS: { label: 'Ambiguous', tone: 'yellow' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  IGNORED: { label: 'Diabaikan', tone: 'gray' },
};

export const MATCH_STATUS_ORDER: MatchStatus[] = ['MATCHED', 'MANUAL_VERIFIED', 'AMBIGUOUS', 'UNMATCHED', 'REJECTED', 'IGNORED', 'PENDING'];

const MATCH_REASON: Record<string, string> = {
  single_candidate: 'Satu kandidat memenuhi semua aturan',
  manual_verification: 'Diverifikasi manual',
  multiple_candidates: 'Lebih dari satu order kandidat',
  competing_transactions: 'Ada transfer lain dengan nominal sama untuk order ini',
  auto_match_disabled: 'Pencocokan otomatis dimatikan',
  score_below_threshold: 'Skor di bawah ambang otomatis',
  candidate_locked: 'Kandidat sedang terkunci',
  no_candidate: 'Tidak ada order yang cocok',
  candidates_rejected: 'Semua kandidat ditolak',
  candidates_settled: 'Kandidat sudah dibayar transaksi lain',
  ignored_by_user: 'Diabaikan pengguna',
  reopened: 'Dibuka kembali',
};
export const matchReasonLabel = (r: string | null | undefined) => (r ? MATCH_REASON[r] ?? r.replace(/_/g, ' ') : '-');

export const CANDIDATE_STATUS: Record<CandidateStatus, { label: string; tone: Tone }> = {
  CANDIDATE: { label: 'Kandidat', tone: 'blue' },
  MATCHED: { label: 'Matched', tone: 'green' },
  MANUAL_VERIFIED: { label: 'Manual Verified', tone: 'teal' },
  REJECTED: { label: 'Ditolak', tone: 'red' },
  SUPERSEDED: { label: 'Tidak berlaku', tone: 'gray' },
};

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Menunggu', tone: 'yellow' },
  PAID: { label: 'Lunas', tone: 'green' },
  EXPIRED: { label: 'Kedaluwarsa', tone: 'gray' },
  CANCELLED: { label: 'Dibatalkan', tone: 'red' },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  UNPAID: { label: 'Belum dibayar', tone: 'orange' },
  PAID: { label: 'Sudah dibayar', tone: 'green' },
};

export const ALERT_STATUS: Record<AlertStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Terbuka', tone: 'red' },
  ACKNOWLEDGED: { label: 'Diketahui', tone: 'yellow' },
  RESOLVED: { label: 'Selesai', tone: 'green' },
};

export const ALERT_TYPE: Record<string, string> = {
  HEARTBEAT_MISSING: 'Heartbeat hilang',
  NOTIFICATION_ACCESS_DISABLED: 'Notification Access dinonaktifkan',
  LISTENER_DISCONNECTED: 'Listener terputus',
  DEVICE_REPORTED_DISCONNECTED: 'Perangkat melaporkan koneksi terputus',
  QUEUE_BACKLOG: 'Antrean menumpuk',
  SYNC_FAILED: 'Sinkronisasi gagal',
  UNSUPPORTED_APP_VERSION: 'Versi aplikasi tidak didukung',
};

export const WEBHOOK_STATUS: Record<WebhookStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Menunggu', tone: 'yellow' },
  DELIVERING: { label: 'Mengirim', tone: 'blue' },
  DELIVERED: { label: 'Terkirim', tone: 'green' },
  FAILED: { label: 'Gagal (retry)', tone: 'orange' },
  DEAD: { label: 'Gagal permanen', tone: 'red' },
};

export const EVENT_TYPE: Record<string, string> = {
  APP_OPENED: 'Aplikasi dibuka',
  APP_UPDATED: 'Aplikasi diperbarui',
  APP_VERSION_CHANGED: 'Versi aplikasi berubah',
  BOOT_COMPLETED: 'Perangkat dinyalakan ulang',
  LISTENER_CONNECTED: 'Listener terhubung',
  LISTENER_DISCONNECTED: 'Listener terputus',
  LISTENER_LOST: 'Listener hilang (dari heartbeat)',
  LISTENER_RESTORED: 'Listener pulih (dari heartbeat)',
  LISTENER_REBIND_REQUESTED: 'Minta rebind listener',
  PERMISSION_GRANTED: 'Izin diberikan',
  PERMISSION_REVOKED: 'Izin dicabut',
  PERMISSION_LOST: 'Izin hilang (dari heartbeat)',
  PERMISSION_RESTORED: 'Izin pulih (dari heartbeat)',
  NETWORK_LOST: 'Internet terputus',
  NETWORK_RESTORED: 'Internet pulih',
  SYNC_FAILED: 'Sinkronisasi gagal',
  SYNC_RECOVERED: 'Sinkronisasi pulih',
  PARSER_ERROR: 'Error parser',
  BATTERY_OPTIMIZATION_CHANGED: 'Optimasi baterai berubah',
  BATTERY_EXEMPTION_GRANTED: 'Dikecualikan dari optimasi baterai',
  BATTERY_EXEMPTION_REMOVED: 'Pengecualian baterai dicabut',
  CLOCK_SKEW: 'Jam perangkat tidak sinkron',
  STATUS_CHANGED: 'Status berubah',
  TOKEN_REVOKED: 'Token dicabut',
  DEVICE_REGISTERED: 'Perangkat terdaftar',
  ERROR: 'Error',
  INFO: 'Info',
};

export const eventTypeLabel = (t: string) => EVENT_TYPE[t] ?? t;

export function severityTone(s: string | null | undefined): Tone {
  switch ((s ?? '').toLowerCase()) {
    case 'critical':
    case 'error':
      return 'red';
    case 'warning':
      return 'yellow';
    case 'info':
      return 'blue';
    default:
      return 'gray';
  }
}

export const SEVERITY_LABEL: Record<string, string> = { critical: 'Kritis', error: 'Error', warning: 'Peringatan', info: 'Info' };

export const ROLE_LABEL: Record<string, string> = { admin: 'Admin', operator: 'Operator' };

export const TRIGGER_LABEL: Record<string, string> = {
  periodic: 'Berkala',
  app_open: 'Aplikasi dibuka',
  service_change: 'Perubahan service',
  network_restored: 'Internet pulih',
  boot: 'Boot',
  manual: 'Manual',
};
