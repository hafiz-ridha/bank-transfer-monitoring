// Perhitungan status kesehatan perangkat (PRD §4.3) — fungsi murni, mudah diuji.
import { compareVersions } from '../lib/util.js';

export const DEVICE_STATUSES = ['ACTIVE', 'WARNING', 'INACTIVE', 'PERMISSION_ERROR', 'DISCONNECTED', 'UNKNOWN'];

const ms = (v) => (v ? new Date(v).getTime() : null);

/**
 * @param {object} device baris tabel devices
 * @param {object} s pengaturan (lihat SETTING_DEFS)
 * @param {Date} now
 * @returns {{status, reason, source, heartbeat_age_seconds, connection_state, issues: Array<{code, severity, message}>}}
 */
export function computeDeviceHealth(device, s, now = new Date()) {
  const activeSec = s['device.active_threshold_seconds'] ?? 120;
  const inactiveSec = s['device.inactive_threshold_seconds'] ?? 300;
  const queueThreshold = s['device.queue_warning_threshold'] ?? 10;
  const syncStaleMin = s['device.sync_stale_minutes'] ?? 10;
  const minVersion = s['device.min_app_version'] ?? '0.0.0';
  const warnBattery = s['device.warn_battery_optimization'] ?? true;

  const issues = [];
  const add = (code, severity, message) => issues.push({ code, severity, message });

  const hbAt = ms(device.last_heartbeat_at);
  const ageSec = hbAt === null ? null : Math.max(0, Math.round((now.getTime() - hbAt) / 1000));

  // Status koneksi: dibedakan antara laporan eksplisit perangkat dan dugaan karena heartbeat hilang.
  let connection_state = 'unknown';
  const networkReportedAfterHeartbeat = device.network_reported_at && hbAt !== null && ms(device.network_reported_at) >= hbAt;
  if (device.network_connected === false && (networkReportedAfterHeartbeat || hbAt === null || ageSec <= inactiveSec)) {
    connection_state = 'disconnected_reported';
  } else if (ageSec !== null && ageSec > inactiveSec) {
    connection_state = 'disconnected_suspected';
  } else if (ageSec !== null) {
    connection_state = 'connected';
  }

  if (hbAt === null) {
    add('NEVER_REPORTED', 'warning', 'Perangkat belum pernah mengirim heartbeat');
    return result('UNKNOWN', 'never_reported', 'none');
  }

  // Isu konfigurasi & operasional (dicatat apa pun statusnya agar terlihat di dashboard)
  if (device.notification_access === false) add('NOTIFICATION_ACCESS_DISABLED', 'critical', 'Notification Access tidak aktif — monitoring tidak dapat dijamin berjalan');
  if (device.listener_connected === false) add('LISTENER_DISCONNECTED', 'critical', 'Notification listener terputus menurut laporan perangkat');
  if (warnBattery && device.battery_optimization_exempt === false) add('BATTERY_OPTIMIZED', 'warning', 'Aplikasi belum dikecualikan dari optimasi baterai');
  if (device.background_restricted === true) add('BACKGROUND_RESTRICTED', 'warning', 'Aktivitas background aplikasi dibatasi sistem');
  if ((device.pending_queue ?? 0) >= queueThreshold) add('QUEUE_BACKLOG', 'warning', `Antrean belum terkirim menumpuk (${device.pending_queue})`);
  const lastSync = ms(device.last_successful_sync_at);
  if ((device.failed_queue ?? 0) > 0 || ((device.pending_queue ?? 0) > 0 && (lastSync === null || now.getTime() - lastSync > syncStaleMin * 60_000))) {
    add('SYNC_FAILED', 'warning', 'Perangkat belum berhasil menyinkronkan antrean');
  }
  if (device.app_version && compareVersions(device.app_version, minVersion) < 0) {
    add('UNSUPPORTED_APP_VERSION', 'warning', `Versi aplikasi ${device.app_version} di bawah minimum ${minVersion}`);
  }

  if (connection_state === 'disconnected_reported') {
    add('DEVICE_REPORTED_DISCONNECTED', 'warning', 'Perangkat melaporkan koneksi ke server tidak tersedia');
    return result('DISCONNECTED', 'device_reported_network_lost', 'device_reported');
  }
  if (ageSec > inactiveSec) {
    add('HEARTBEAT_MISSING', 'critical', `Tidak ada heartbeat selama ${formatAge(ageSec)}`);
    return result('INACTIVE', 'heartbeat_missing', 'inferred');
  }
  if (device.notification_access === false) {
    return result('PERMISSION_ERROR', 'notification_access_disabled', 'device_reported');
  }
  if (ageSec > activeSec) {
    add('HEARTBEAT_LATE', 'warning', `Heartbeat terlambat (${formatAge(ageSec)})`);
    return result('WARNING', 'heartbeat_late', 'inferred');
  }
  if (device.listener_connected === false) {
    return result('WARNING', 'listener_disconnected', 'device_reported');
  }
  if (device.listener_connected == null || device.notification_access == null) {
    add('INCOMPLETE_REPORT', 'warning', 'Laporan perangkat belum lengkap');
    return result('UNKNOWN', 'incomplete_report', 'none');
  }
  const configIssue = issues.find((i) => i.severity === 'warning');
  if (configIssue) {
    return result('WARNING', configIssue.code.toLowerCase(), 'device_reported');
  }
  return result('ACTIVE', 'ok', 'device_reported');

  function result(status, reason, source) {
    return { status, reason, source, heartbeat_age_seconds: ageSec, connection_state, issues };
  }
}

export function formatAge(sec) {
  if (sec == null) return '-';
  if (sec < 60) return `${sec} detik`;
  if (sec < 3600) return `${Math.floor(sec / 60)} menit`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} jam ${Math.floor((sec % 3600) / 60)} menit`;
  return `${Math.floor(sec / 86400)} hari`;
}
