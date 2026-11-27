// Registrasi perangkat, heartbeat, event perangkat, dan konfigurasi untuk Android.
import {
  badRequest, conflict, notFound, unauthorized, normalizePairingCode, pairingCode, randomToken, sha256, toDate,
  compareVersions,
} from '../lib/util.js';
import { computeDeviceHealth } from './deviceHealth.js';
import { audit, deviceActor } from './audit.js';

const PAIRING_TTL_MINUTES = 60 * 24;

export const DEVICE_EVENT_TYPES = [
  'APP_OPENED', 'APP_UPDATED', 'BOOT_COMPLETED', 'LISTENER_CONNECTED', 'LISTENER_DISCONNECTED', 'LISTENER_REBIND_REQUESTED',
  'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'NETWORK_LOST', 'NETWORK_RESTORED', 'SYNC_FAILED', 'SYNC_RECOVERED',
  'PARSER_ERROR', 'BATTERY_OPTIMIZATION_CHANGED', 'CLOCK_SKEW', 'ERROR', 'INFO',
];

export function publicDevice(d, health) {
  if (!d) return null;
  return {
    id: d.id,
    device_uuid: d.device_uuid,
    device_name: d.device_name,
    device_model: d.device_model,
    manufacturer: d.manufacturer,
    android_version: d.android_version,
    app_version: d.app_version,
    status: health?.status ?? d.status,
    status_reason: health?.reason ?? d.status_reason,
    status_source: health?.source ?? d.status_source,
    status_changed_at: d.status_changed_at,
    connection_state: health?.connection_state,
    heartbeat_age_seconds: health?.heartbeat_age_seconds,
    issues: health?.issues ?? [],
    notification_access: d.notification_access,
    listener_connected: d.listener_connected,
    battery_optimization_exempt: d.battery_optimization_exempt,
    background_restricted: d.background_restricted,
    network_connected: d.network_connected,
    last_seen_at: d.last_seen_at,
    last_heartbeat_at: d.last_heartbeat_at,
    last_reported_at: d.last_reported_at,
    last_listener_connected_at: d.last_listener_connected_at,
    last_notification_at: d.last_notification_at,
    last_successful_sync_at: d.last_successful_sync_at,
    pending_queue: d.pending_queue,
    failed_queue: d.failed_queue,
    last_error: d.last_error,
    is_active: d.is_active,
    registered: !!d.token_hash && !d.token_revoked_at,
    registered_at: d.registered_at,
    token_issued_at: d.token_issued_at,
    token_revoked_at: d.token_revoked_at,
    pairing_pending: !!d.pairing_code_hash && d.pairing_expires_at && new Date(d.pairing_expires_at) > new Date(),
    pairing_expires_at: d.pairing_expires_at,
    created_at: d.created_at,
  };
}

export async function insertDeviceEvent(db, deviceId, ev) {
  const r = await db.query(
    `INSERT INTO device_events (device_id, event_id, event_type, source, severity, message, data, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT (device_id, event_id) WHERE event_id IS NOT NULL DO NOTHING`,
    [
      deviceId, ev.event_id ?? null, ev.event_type, ev.source ?? 'device', ev.severity ?? 'info',
      ev.message ?? null, ev.data ? JSON.stringify(ev.data) : null, ev.occurred_at ?? new Date(),
    ],
  );
  return r.rowCount > 0;
}

export function createDeviceService({ db, settings, log }) {
  async function createDevice({ device_name }, actorUser, req) {
    const code = pairingCode();
    const d = await db.tx(async (tx) => {
      const row = await tx.one(
        `INSERT INTO devices (device_name, pairing_code_hash, pairing_expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING *`,
        [device_name, sha256(code), PAIRING_TTL_MINUTES],
      );
      await audit(tx, { actor: { type: 'user', id: actorUser.id, label: actorUser.email }, action: 'device.create', entityType: 'device', entityId: row.id, after: { device_name }, req });
      return row;
    });
    return { device: publicDevice(d), pairing_code: code };
  }

  /** Membuat kode pairing baru; token lama dicabut (perangkat harus registrasi ulang). */
  async function regeneratePairing(deviceId, actorUser, req) {
    const code = pairingCode();
    const d = await db.tx(async (tx) => {
      const row = await tx.one(
        `UPDATE devices SET pairing_code_hash = $2, pairing_expires_at = now() + make_interval(mins => $3),
           token_revoked_at = CASE WHEN token_hash IS NOT NULL AND token_revoked_at IS NULL THEN now() ELSE token_revoked_at END,
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [deviceId, sha256(code), PAIRING_TTL_MINUTES],
      );
      if (!row) throw notFound('Perangkat tidak ditemukan');
      await insertDeviceEvent(tx, row.id, { event_type: 'TOKEN_REVOKED', source: 'server', severity: 'warning', message: 'Kode pairing baru dibuat; token lama dicabut' });
      await audit(tx, { actor: { type: 'user', id: actorUser.id, label: actorUser.email }, action: 'device.pairing_regenerate', entityType: 'device', entityId: row.id, req });
      return row;
    });
    return { device: publicDevice(d), pairing_code: code };
  }

  async function revokeToken(deviceId, actorUser, req) {
    return db.tx(async (tx) => {
      const row = await tx.one(
        `UPDATE devices SET token_revoked_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [deviceId],
      );
      if (!row) throw notFound('Perangkat tidak ditemukan');
      await insertDeviceEvent(tx, row.id, { event_type: 'TOKEN_REVOKED', source: 'server', severity: 'warning', message: 'Token perangkat dicabut oleh admin' });
      await audit(tx, { actor: { type: 'user', id: actorUser.id, label: actorUser.email }, action: 'device.token_revoke', entityType: 'device', entityId: row.id, req });
      return publicDevice(row);
    });
  }

  async function register(body, req) {
    const code = normalizePairingCode(body.pairing_code);
    if (code.length < 6) throw badRequest('Kode pairing tidak valid');
    return db.tx(async (tx) => {
      const d = await tx.one(
        `SELECT * FROM devices WHERE pairing_code_hash = $1 AND pairing_expires_at > now() AND is_active FOR UPDATE`,
        [sha256(code)],
      );
      if (!d) throw unauthorized('Kode pairing salah atau kedaluwarsa', 'INVALID_PAIRING_CODE');
      const other = await tx.one('SELECT id FROM devices WHERE device_uuid = $1 AND id <> $2', [body.device_uuid, d.id]);
      if (other) {
        // UUID perangkat ini pernah dipakai record lain: lepaskan dari record lama agar tidak bentrok.
        await tx.query(`UPDATE devices SET device_uuid = NULL, token_revoked_at = COALESCE(token_revoked_at, now()), updated_at = now() WHERE id = $1`, [other.id]);
      }
      const token = randomToken(32);
      const row = await tx.one(
        `UPDATE devices SET device_uuid = $2, device_model = $3, manufacturer = $4, android_version = $5, app_version = $6,
           device_name = COALESCE(NULLIF($7, ''), device_name),
           token_hash = $8, token_issued_at = now(), token_revoked_at = NULL,
           pairing_code_hash = NULL, pairing_expires_at = NULL, registered_at = now(), last_seen_at = now(),
           status = 'UNKNOWN', status_reason = 'awaiting_heartbeat', status_source = 'none', status_changed_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [d.id, body.device_uuid, body.device_model ?? null, body.manufacturer ?? null, body.android_version ?? null,
          body.app_version ?? null, body.device_name ?? '', sha256(token)],
      );
      await insertDeviceEvent(tx, row.id, { event_type: 'DEVICE_REGISTERED', source: 'server', message: `Registrasi ${body.manufacturer ?? ''} ${body.device_model ?? ''}`.trim(), data: { app_version: body.app_version } });
      await audit(tx, { actor: deviceActor(row), action: 'device.register', entityType: 'device', entityId: row.id, after: { device_uuid: body.device_uuid, device_model: body.device_model }, req });
      return { device: row, token };
    });
  }

  async function authenticate(token) {
    if (!token) return null;
    const d = await db.one(
      `SELECT * FROM devices WHERE token_hash = $1 AND token_revoked_at IS NULL AND is_active`,
      [sha256(token)],
    );
    return d;
  }

  async function touch(deviceId) {
    await db.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [deviceId]);
  }

  /** Memproses heartbeat; menyimpan histori, memperbarui status, dan mencatat perubahan kondisi. */
  async function heartbeat(device, hb) {
    const s = await settings.all();
    return db.tx(async (tx) => {
      const prev = await tx.one('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [device.id]);
      const inserted = await tx.query(
        `INSERT INTO device_heartbeats (device_id, heartbeat_id, trigger, app_version, notification_access, listener_connected,
           network_connected, battery_optimization_exempt, background_restricted, pending_queue, failed_queue,
           last_notification_at, last_listener_connected_at, last_successful_sync_at, last_error, reported_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
         ON CONFLICT (device_id, heartbeat_id) WHERE heartbeat_id IS NOT NULL DO NOTHING`,
        [
          device.id, hb.heartbeat_id ?? null, hb.trigger ?? 'periodic', hb.app_version ?? null, hb.notification_access,
          hb.listener_connected, hb.network_connected ?? true, hb.battery_optimization_exempt ?? null,
          hb.background_restricted ?? null, hb.pending_queue ?? 0, hb.failed_queue ?? 0, toDate(hb.last_notification_at),
          toDate(hb.last_listener_connected_at), toDate(hb.last_successful_sync_at), hb.last_error ?? null,
          toDate(hb.reported_at), JSON.stringify(hb),
        ],
      );
      if (inserted.rowCount === 0) {
        // Heartbeat duplikat (retry): tidak mengubah status.
        return { duplicate: true, device: prev };
      }

      // Heartbeat lama yang baru terkirim (antrean offline) tidak boleh menimpa kondisi yang lebih baru.
      // Toleransi = batas selisih jam yang diizinkan, agar koreksi jam perangkat (NTP) tidak membuat heartbeat diabaikan.
      const reportedAt = toDate(hb.reported_at) ?? new Date();
      const skewMs = (s['security.max_request_skew_seconds'] ?? 600) * 1000;
      const isLatest = !prev.last_reported_at || reportedAt.getTime() >= new Date(prev.last_reported_at).getTime() - skewMs;
      if (!isLatest) {
        await tx.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [device.id]);
        return { duplicate: false, stale: true, device: prev };
      }

      const events = [];
      const flip = (field, onTrue, onFalse, severityFalse = 'warning') => {
        if (hb[field] === undefined || hb[field] === null) return;
        if (prev[field] !== null && prev[field] !== hb[field]) {
          events.push(hb[field] ? { event_type: onTrue, severity: 'info' } : { event_type: onFalse, severity: severityFalse });
        }
      };
      flip('notification_access', 'PERMISSION_RESTORED', 'PERMISSION_LOST', 'error');
      flip('listener_connected', 'LISTENER_RESTORED', 'LISTENER_LOST', 'error');
      flip('battery_optimization_exempt', 'BATTERY_EXEMPTION_GRANTED', 'BATTERY_EXEMPTION_REMOVED');
      if (hb.app_version && prev.app_version && hb.app_version !== prev.app_version) {
        events.push({ event_type: 'APP_VERSION_CHANGED', severity: 'info', message: `${prev.app_version} → ${hb.app_version}`, data: { from: prev.app_version, to: hb.app_version } });
      }

      const row = await tx.one(
        `UPDATE devices SET
           app_version = COALESCE($2, app_version),
           notification_access = $3,
           listener_connected = $4,
           network_connected = $5,
           network_reported_at = now(),
           battery_optimization_exempt = COALESCE($6, battery_optimization_exempt),
           background_restricted = COALESCE($7, background_restricted),
           pending_queue = $8,
           failed_queue = $9,
           last_notification_at = GREATEST(last_notification_at, $10),
           last_listener_connected_at = GREATEST(last_listener_connected_at, $11),
           last_successful_sync_at = GREATEST(last_successful_sync_at, $12),
           last_error = $13,
           last_heartbeat_at = now(),
           last_reported_at = $14,
           last_seen_at = now(),
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          device.id, hb.app_version ?? null, hb.notification_access, hb.listener_connected, hb.network_connected ?? true,
          hb.battery_optimization_exempt ?? null, hb.background_restricted ?? null, hb.pending_queue ?? 0, hb.failed_queue ?? 0,
          toDate(hb.last_notification_at), toDate(hb.last_listener_connected_at), toDate(hb.last_successful_sync_at),
          hb.last_error ?? null, reportedAt,
        ],
      );
      for (const ev of events) await insertDeviceEvent(tx, device.id, { ...ev, source: 'server', occurred_at: reportedAt });
      const updated = await applyStatus(tx, row, s);
      return { duplicate: false, device: updated };
    });
  }

  /** Menghitung ulang status dan mencatat event STATUS_CHANGED bila berubah. Dipanggil dalam transaksi. */
  async function applyStatus(tx, row, s, now = new Date()) {
    const health = computeDeviceHealth(row, s, now);
    if (health.status === row.status && health.reason === row.status_reason) return row;
    const updated = await tx.one(
      `UPDATE devices SET status = $2, status_reason = $3, status_source = $4,
         status_changed_at = CASE WHEN status <> $2 THEN now() ELSE status_changed_at END, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [row.id, health.status, health.reason, health.source],
    );
    if (health.status !== row.status) {
      await insertDeviceEvent(tx, row.id, {
        event_type: 'STATUS_CHANGED', source: 'server',
        severity: ['INACTIVE', 'PERMISSION_ERROR', 'DISCONNECTED'].includes(health.status) ? 'error' : health.status === 'WARNING' ? 'warning' : 'info',
        message: `${row.status} → ${health.status} (${health.reason})`,
        data: { from: row.status, to: health.status, reason: health.reason, source: health.source },
      });
    }
    return updated;
  }

  async function recordEvents(device, events) {
    const results = [];
    const s = await settings.all();
    await db.tx(async (tx) => {
      for (const ev of events) {
        if (!DEVICE_EVENT_TYPES.includes(ev.event_type)) {
          results.push({ event_id: ev.event_id, status: 'rejected', error: 'event_type tidak dikenal' });
          continue;
        }
        const occurredAt = toDate(ev.occurred_at) ?? new Date();
        const ok = await insertDeviceEvent(tx, device.id, {
          event_id: ev.event_id, event_type: ev.event_type, source: 'device', severity: ev.severity ?? defaultSeverity(ev.event_type),
          message: ev.message, data: ev.data, occurred_at: occurredAt,
        });
        results.push({ event_id: ev.event_id, status: ok ? 'accepted' : 'duplicate' });
        if (!ok) continue;
        // Laporan eksplisit koneksi/izin/listener dari perangkat memperbarui kondisi terakhir bila lebih baru.
        if (ev.event_type === 'NETWORK_LOST' || ev.event_type === 'NETWORK_RESTORED') {
          await tx.query(
            `UPDATE devices SET network_connected = $2, network_reported_at = $3
             WHERE id = $1 AND (network_reported_at IS NULL OR network_reported_at <= $3)`,
            [device.id, ev.event_type === 'NETWORK_RESTORED', occurredAt],
          );
        } else if (ev.event_type === 'PERMISSION_REVOKED' || ev.event_type === 'PERMISSION_GRANTED') {
          await tx.query(
            `UPDATE devices SET notification_access = $2 WHERE id = $1 AND (last_reported_at IS NULL OR last_reported_at <= $3)`,
            [device.id, ev.event_type === 'PERMISSION_GRANTED', occurredAt],
          );
        } else if (ev.event_type === 'LISTENER_CONNECTED' || ev.event_type === 'LISTENER_DISCONNECTED') {
          const connected = ev.event_type === 'LISTENER_CONNECTED';
          await tx.query(
            `UPDATE devices SET listener_connected = $2,
               last_listener_connected_at = CASE WHEN $2 THEN GREATEST(last_listener_connected_at, $3) ELSE last_listener_connected_at END
             WHERE id = $1 AND (last_reported_at IS NULL OR last_reported_at <= $3)`,
            [device.id, connected, occurredAt],
          );
        } else if (ev.event_type === 'SYNC_FAILED') {
          await tx.query('UPDATE devices SET last_error = $2 WHERE id = $1', [device.id, ev.message ?? 'Sinkronisasi gagal']);
        }
      }
      const row = await tx.one('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [device.id]);
      await applyStatus(tx, row, s);
    });
    return results;
  }

  async function configFor(device) {
    const s = await settings.all();
    const sources = await db.many(
      `SELECT id, bank_code, bank_name, package_name, account_alias, account_identifier, parser_key, parser_version, is_default, is_active
       FROM bank_sources ORDER BY bank_code, account_alias`,
    );
    const payload = {
      device: { id: device.id, device_uuid: device.device_uuid, device_name: device.device_name },
      heartbeat_interval_seconds: s['device.heartbeat_interval_seconds'],
      min_app_version: s['device.min_app_version'],
      send_raw_text: s['device.send_raw_text'],
      max_request_skew_seconds: s['security.max_request_skew_seconds'],
      bank_sources: sources,
      update_required: device.app_version ? compareVersions(device.app_version, s['device.min_app_version']) < 0 : false,
    };
    payload.config_version = sha256(JSON.stringify(payload)).slice(0, 12);
    payload.server_time = new Date().toISOString();
    return payload;
  }

  async function list() {
    const s = await settings.all();
    const rows = await db.many('SELECT * FROM devices ORDER BY is_active DESC, created_at');
    const now = new Date();
    return rows.map((d) => publicDevice(d, computeDeviceHealth(d, s, now)));
  }

  async function get(id) {
    const d = await db.one('SELECT * FROM devices WHERE id = $1', [id]);
    if (!d) throw notFound('Perangkat tidak ditemukan');
    const s = await settings.all();
    return publicDevice(d, computeDeviceHealth(d, s, new Date()));
  }

  async function update(id, patch, actorUser, req) {
    return db.tx(async (tx) => {
      const before = await tx.one('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Perangkat tidak ditemukan');
      const row = await tx.one(
        `UPDATE devices SET device_name = COALESCE($2, device_name), is_active = COALESCE($3, is_active), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, patch.device_name ?? null, patch.is_active ?? null],
      );
      await audit(tx, {
        actor: { type: 'user', id: actorUser.id, label: actorUser.email }, action: 'device.update', entityType: 'device', entityId: id,
        before: { device_name: before.device_name, is_active: before.is_active }, after: { device_name: row.device_name, is_active: row.is_active }, req,
      });
      return publicDevice(row);
    });
  }

  return { createDevice, regeneratePairing, revokeToken, register, authenticate, touch, heartbeat, applyStatus, recordEvents, configFor, list, get, update };
}

function defaultSeverity(type) {
  if (['LISTENER_DISCONNECTED', 'PERMISSION_REVOKED', 'SYNC_FAILED', 'ERROR', 'PARSER_ERROR'].includes(type)) return 'error';
  if (['NETWORK_LOST', 'CLOCK_SKEW', 'BATTERY_OPTIMIZATION_CHANGED'].includes(type)) return 'warning';
  return 'info';
}

export { conflict };
