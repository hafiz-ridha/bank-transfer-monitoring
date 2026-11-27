// Pengaturan sistem (tabel system_settings) dengan nilai default & cache singkat.
import { badRequest } from '../lib/util.js';

/**
 * Definisi pengaturan. `type` dipakai untuk validasi saat diubah dari dashboard.
 * `secret: true` => nilai disamarkan saat dibaca dari API.
 */
export const SETTING_DEFS = {
  // Umum
  'general.timezone': { type: 'timezone', default: 'Asia/Jakarta', group: 'general', label: 'Zona waktu operasional' },
  'general.business_name': { type: 'string', default: 'Bisnis Saya', group: 'general', label: 'Nama bisnis' },

  // Kesehatan perangkat (PRD §4.3)
  'device.heartbeat_interval_seconds': { type: 'int', min: 30, max: 900, default: 60, group: 'device', label: 'Interval heartbeat target (detik)' },
  'device.active_threshold_seconds': { type: 'int', min: 30, max: 3600, default: 120, group: 'device', label: 'Batas ACTIVE (detik sejak heartbeat terakhir)' },
  'device.inactive_threshold_seconds': { type: 'int', min: 60, max: 86400, default: 300, group: 'device', label: 'Batas INACTIVE (detik tanpa heartbeat)' },
  'device.queue_warning_threshold': { type: 'int', min: 1, max: 10000, default: 10, group: 'device', label: 'Antrean menumpuk jika ≥' },
  'device.sync_stale_minutes': { type: 'int', min: 1, max: 1440, default: 10, group: 'device', label: 'Sinkronisasi dianggap gagal jika antrean tertahan lebih dari (menit)' },
  'device.min_app_version': { type: 'string', default: '1.0.0', group: 'device', label: 'Versi aplikasi minimum yang didukung' },
  'device.warn_battery_optimization': { type: 'bool', default: true, group: 'device', label: 'Tandai WARNING jika optimasi baterai belum dikecualikan' },
  'device.send_raw_text': { type: 'bool', default: true, group: 'device', label: 'Kirim teks notifikasi mentah ke server (disimpan 30 hari)' },

  // Matching (PRD §6)
  'matching.auto_match_enabled': { type: 'bool', default: true, group: 'matching', label: 'Pencocokan otomatis aktif' },
  'matching.window_before_minutes': { type: 'int', min: 0, max: 1440, default: 5, group: 'matching', label: 'Toleransi transfer sebelum order dibuat (menit)' },
  'matching.default_window_minutes': { type: 'int', min: 1, max: 10080, default: 60, group: 'matching', label: 'Rentang matching jika order tanpa expires_at (menit)' },
  'matching.grace_after_minutes': { type: 'int', min: 0, max: 1440, default: 10, group: 'matching', label: 'Toleransi transfer setelah batas pembayaran (menit)' },
  'matching.min_auto_score': { type: 'int', min: 60, max: 100, default: 80, group: 'matching', label: 'Skor minimum untuk MATCHED otomatis' },
  'matching.name_match_threshold': { type: 'number', min: 0, max: 1, default: 0.6, group: 'matching', label: 'Ambang kemiripan nama pengirim' },

  // Retensi (PRD §11)
  'retention.raw_notification_days': { type: 'int', min: 1, max: 3650, default: 30, group: 'retention', label: 'Teks notifikasi mentah (hari)' },
  'retention.webhook_log_days': { type: 'int', min: 1, max: 3650, default: 30, group: 'retention', label: 'Log webhook (hari)' },
  'retention.heartbeat_days': { type: 'int', min: 7, max: 3650, default: 60, group: 'retention', label: 'Detail heartbeat (hari)' },
  'retention.device_event_days': { type: 'int', min: 7, max: 3650, default: 90, group: 'retention', label: 'Event perangkat (hari)' },
  'retention.transaction_days': { type: 'int', min: 365, max: 3650, default: 365, group: 'retention', label: 'Transaksi, order, matching (hari)' },
  'retention.purge_transactions_enabled': { type: 'bool', default: false, group: 'retention', label: 'Hapus otomatis transaksi melewati retensi (pastikan sudah diarsip)' },

  // Webhook POS (PRD §7.3)
  'webhook.enabled': { type: 'bool', default: false, group: 'webhook', label: 'Webhook aktif' },
  'webhook.url': { type: 'url', default: '', group: 'webhook', label: 'URL webhook POS' },
  'webhook.secret': { type: 'string', default: '', secret: true, group: 'webhook', label: 'Webhook secret (HMAC-SHA256)' },
  'webhook.max_attempts': { type: 'int', min: 1, max: 50, default: 10, group: 'webhook', label: 'Maksimal percobaan kirim' },
  'webhook.timeout_ms': { type: 'int', min: 1000, max: 60000, default: 10000, group: 'webhook', label: 'Timeout (ms)' },

  // Alert (PRD §5.3)
  'alerts.telegram_enabled': { type: 'bool', default: false, group: 'alerts', label: 'Kirim alert ke Telegram' },
  'alerts.telegram_chat_id': { type: 'string', default: '', group: 'alerts', label: 'Telegram chat ID' },
  'alerts.repeat_minutes': { type: 'int', min: 0, max: 1440, default: 30, group: 'alerts', label: 'Ulangi notifikasi alert terbuka tiap (menit, 0 = tidak)' },

  // Keamanan
  'security.max_request_skew_seconds': { type: 'int', min: 60, max: 86400, default: 600, group: 'security', label: 'Toleransi selisih jam request perangkat (detik)' },
};

function validateValue(key, value) {
  const def = SETTING_DEFS[key];
  if (!def) throw badRequest(`Pengaturan tidak dikenal: ${key}`);
  switch (def.type) {
    case 'int':
      if (!Number.isInteger(value)) throw badRequest(`${key} harus bilangan bulat`);
      if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
        throw badRequest(`${key} harus di antara ${def.min} dan ${def.max}`);
      }
      return value;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) throw badRequest(`${key} harus angka`);
      if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
        throw badRequest(`${key} harus di antara ${def.min} dan ${def.max}`);
      }
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw badRequest(`${key} harus true/false`);
      return value;
    case 'url':
      if (typeof value !== 'string') throw badRequest(`${key} harus string`);
      if (value && !/^https?:\/\/[^\s]+$/i.test(value)) throw badRequest(`${key} harus URL http(s) yang valid`);
      return value.trim();
    case 'timezone':
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
      } catch {
        throw badRequest(`${key}: zona waktu tidak valid`);
      }
      return value;
    default:
      if (typeof value !== 'string') throw badRequest(`${key} harus string`);
      return value.trim();
  }
}

export function createSettingsService(db, { ttlMs = 5000 } = {}) {
  let cache = null;
  let cachedAt = 0;

  async function loadAll() {
    if (cache && Date.now() - cachedAt < ttlMs) return cache;
    const rows = await db.many('SELECT key, value FROM system_settings');
    const values = {};
    for (const [key, def] of Object.entries(SETTING_DEFS)) values[key] = def.default;
    for (const r of rows) if (r.key in SETTING_DEFS) values[r.key] = r.value;
    cache = values;
    cachedAt = Date.now();
    return values;
  }

  return {
    invalidate() {
      cache = null;
    },
    async all() {
      return { ...(await loadAll()) };
    },
    async get(key) {
      return (await loadAll())[key];
    },
    /** Versi publik untuk dashboard: rahasia disamarkan. */
    async describe() {
      const values = await loadAll();
      return Object.entries(SETTING_DEFS).map(([key, def]) => {
        const raw = values[key];
        const value = def.secret ? (raw ? `••••${String(raw).slice(-4)}` : '') : raw;
        return { key, value, type: def.type, group: def.group, label: def.label, min: def.min, max: def.max, secret: !!def.secret, is_set: def.secret ? !!raw : undefined };
      });
    },
    async set(key, value, userId = null, dbx = db) {
      const v = validateValue(key, value);
      if (key === 'device.inactive_threshold_seconds' || key === 'device.active_threshold_seconds') {
        // Dibaca lewat executor yang sama (bisa berupa transaksi) agar tidak menunggu koneksi lain.
        const all = {};
        for (const [k, d] of Object.entries(SETTING_DEFS)) all[k] = d.default;
        for (const r of await dbx.many('SELECT key, value FROM system_settings')) all[r.key] = r.value;
        const active = key === 'device.active_threshold_seconds' ? v : all['device.active_threshold_seconds'];
        const inactive = key === 'device.inactive_threshold_seconds' ? v : all['device.inactive_threshold_seconds'];
        if (inactive <= active) throw badRequest('Batas INACTIVE harus lebih besar dari batas ACTIVE');
      }
      await dbx.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(v), userId],
      );
      cache = null;
      return v;
    },
  };
}
