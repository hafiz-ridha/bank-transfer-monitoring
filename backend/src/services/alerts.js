// Alert perangkat (PRD §5.3): ditampilkan di dashboard, opsional dikirim ke Telegram.
import { computeDeviceHealth } from './deviceHealth.js';
import { notFound } from '../lib/util.js';

// Kode isu kesehatan -> alert. Isu lain (mis. heartbeat terlambat 2–5 menit) cukup terlihat sebagai WARNING.
const ALERTABLE = {
  HEARTBEAT_MISSING: 'critical',
  NOTIFICATION_ACCESS_DISABLED: 'critical',
  LISTENER_DISCONNECTED: 'critical',
  DEVICE_REPORTED_DISCONNECTED: 'warning',
  QUEUE_BACKLOG: 'warning',
  SYNC_FAILED: 'warning',
  UNSUPPORTED_APP_VERSION: 'warning',
};

export function createAlertService({ db, settings, devices, log, telegramBotToken, fetchImpl = globalThis.fetch }) {
  async function notifyTelegram(text) {
    const s = await settings.all();
    if (!s['alerts.telegram_enabled'] || !telegramBotToken || !s['alerts.telegram_chat_id']) return false;
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: s['alerts.telegram_chat_id'], text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log?.warn({ status: res.status }, 'telegram gagal');
      return res.ok;
    } catch (err) {
      log?.warn({ err: err.message }, 'telegram gagal');
      return false;
    }
  }

  /** Mengevaluasi seluruh perangkat aktif: memperbarui status & membuka/menutup alert. */
  async function evaluateAll(now = new Date()) {
    const s = await settings.all();
    const rows = await db.many('SELECT id FROM devices WHERE is_active AND registered_at IS NOT NULL');
    const opened = [];
    const resolved = [];
    for (const { id } of rows) {
      await db.tx(async (tx) => {
        const d = await tx.one('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [id]);
        const updated = await devices.applyStatus(tx, d, s, now);
        const health = computeDeviceHealth(updated, s, now);
        const wanted = health.issues.filter((i) => ALERTABLE[i.code]);
        for (const issue of wanted) {
          const a = await tx.one(
            `INSERT INTO alerts (device_id, alert_type, severity, message, data)
             VALUES ($1,$2,$3,$4,$5::jsonb)
             ON CONFLICT (device_id, alert_type) WHERE status <> 'RESOLVED' DO UPDATE SET message = EXCLUDED.message
             RETURNING *, (xmax = 0) AS inserted`,
            [id, issue.code, ALERTABLE[issue.code], issue.message, JSON.stringify({ status: health.status })],
          );
          if (a.inserted) opened.push({ alert: a, device: updated });
        }
        const closed = await tx.many(
          `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
           WHERE device_id = $1 AND status <> 'RESOLVED' AND NOT (alert_type = ANY($2::text[]))
           RETURNING *`,
          [id, wanted.map((i) => i.code)],
        );
        for (const c of closed) resolved.push({ alert: c, device: updated });
      });
    }

    for (const { alert, device } of opened) {
      const icon = alert.severity === 'critical' ? '🔴' : '🟡';
      const sent = await notifyTelegram(`${icon} [${device.device_name}] ${alert.message}\nStatus: ${device.status}`);
      if (sent) await db.query('UPDATE alerts SET last_notified_at = now(), notify_count = notify_count + 1 WHERE id = $1', [alert.id]);
    }
    for (const { alert, device } of resolved) {
      await notifyTelegram(`✅ [${device.device_name}] Pulih: ${alert.message}`);
    }
    if (s['alerts.repeat_minutes'] > 0 && s['alerts.telegram_enabled']) {
      const repeat = await db.many(
        `SELECT a.*, d.device_name FROM alerts a JOIN devices d ON d.id = a.device_id
         WHERE a.status = 'OPEN' AND a.last_notified_at IS NOT NULL AND a.last_notified_at < now() - make_interval(mins => $1)`,
        [s['alerts.repeat_minutes']],
      );
      for (const a of repeat) {
        const sent = await notifyTelegram(`⏰ Masih terjadi — [${a.device_name}] ${a.message}`);
        if (sent) await db.query('UPDATE alerts SET last_notified_at = now(), notify_count = notify_count + 1 WHERE id = $1', [a.id]);
      }
    }
    return { opened: opened.length, resolved: resolved.length };
  }

  async function list({ status, deviceId, limit = 100 }) {
    const where = [];
    const params = [];
    if (status === 'active') where.push(`a.status <> 'RESOLVED'`);
    else if (status && status !== 'all') { params.push(status); where.push(`a.status = $${params.length}`); }
    if (deviceId) { params.push(deviceId); where.push(`a.device_id = $${params.length}`); }
    params.push(Math.min(limit, 500));
    return db.many(
      `SELECT a.*, d.device_name FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (a.status = 'RESOLVED'), a.opened_at DESC LIMIT $${params.length}`,
      params,
    );
  }

  async function acknowledge(id, user) {
    const row = await db.one(
      `UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by = $2
       WHERE id = $1 AND status = 'OPEN' RETURNING *`,
      [id, user.id],
    );
    if (!row) throw notFound('Alert tidak ditemukan atau sudah ditangani');
    return row;
  }

  return { evaluateAll, list, acknowledge, notifyTelegram };
}
