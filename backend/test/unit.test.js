import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeviceHealth } from '../src/services/deviceHealth.js';
import { scoreCandidate } from '../src/services/matching.js';
import { nameSimilarity, accountMatches, toCsv, compareVersions } from '../src/lib/util.js';
import { signPayload } from '../src/services/webhooks.js';
import crypto from 'node:crypto';

const S = {
  'device.active_threshold_seconds': 120,
  'device.inactive_threshold_seconds': 300,
  'device.queue_warning_threshold': 10,
  'device.sync_stale_minutes': 10,
  'device.min_app_version': '1.0.0',
  'device.warn_battery_optimization': true,
  'matching.window_before_minutes': 5,
  'matching.default_window_minutes': 60,
  'matching.grace_after_minutes': 10,
  'matching.name_match_threshold': 0.6,
};
const now = new Date('2026-11-27T03:05:00Z');
const ago = (sec) => new Date(now.getTime() - sec * 1000);
const healthy = {
  last_heartbeat_at: ago(30), notification_access: true, listener_connected: true, network_connected: true,
  battery_optimization_exempt: true, background_restricted: false, pending_queue: 0, failed_queue: 0,
  last_successful_sync_at: ago(30), app_version: '1.0.0', network_reported_at: ago(30),
};

test('device health: ACTIVE ketika heartbeat < 2 menit & listener terhubung', () => {
  assert.equal(computeDeviceHealth(healthy, S, now).status, 'ACTIVE');
});

test('device health: WARNING untuk heartbeat 2–5 menit', () => {
  const h = computeDeviceHealth({ ...healthy, last_heartbeat_at: ago(200), network_reported_at: ago(200) }, S, now);
  assert.equal(h.status, 'WARNING');
  assert.equal(h.reason, 'heartbeat_late');
});

test('device health: INACTIVE (dugaan) jika tidak ada heartbeat > 5 menit', () => {
  const h = computeDeviceHealth({ ...healthy, last_heartbeat_at: ago(301), network_reported_at: ago(301) }, S, now);
  assert.equal(h.status, 'INACTIVE');
  assert.equal(h.source, 'inferred');
  assert.equal(h.connection_state, 'disconnected_suspected');
  assert.ok(h.issues.some((i) => i.code === 'HEARTBEAT_MISSING'));
});

test('device health: PERMISSION_ERROR jika Notification Access dicabut', () => {
  const h = computeDeviceHealth({ ...healthy, notification_access: false }, S, now);
  assert.equal(h.status, 'PERMISSION_ERROR');
});

test('device health: DISCONNECTED hanya dari laporan eksplisit perangkat', () => {
  const h = computeDeviceHealth({ ...healthy, network_connected: false, network_reported_at: ago(10) }, S, now);
  assert.equal(h.status, 'DISCONNECTED');
  assert.equal(h.source, 'device_reported');
  assert.equal(h.connection_state, 'disconnected_reported');
});

test('device health: UNKNOWN jika belum pernah heartbeat', () => {
  assert.equal(computeDeviceHealth({}, S, now).status, 'UNKNOWN');
});

test('device health: WARNING jika listener terputus / baterai dibatasi / antrean menumpuk', () => {
  assert.equal(computeDeviceHealth({ ...healthy, listener_connected: false }, S, now).status, 'WARNING');
  assert.equal(computeDeviceHealth({ ...healthy, battery_optimization_exempt: false }, S, now).status, 'WARNING');
  assert.equal(computeDeviceHealth({ ...healthy, pending_queue: 12, last_successful_sync_at: ago(30) }, S, now).status, 'WARNING');
  assert.equal(computeDeviceHealth({ ...healthy, app_version: '0.9.0' }, S, now).status, 'WARNING');
});

test('matching score: nominal + waktu + nama + rekening', () => {
  const order = { amount: 150000, order_created_at: '2026-11-27T03:00:00Z', expires_at: '2026-11-27T03:30:00Z', customer_name: 'Budi Santoso', destination_account: '8881234' };
  const trx = { amount: 150000, transaction_time: '2026-11-27T03:05:00Z', sender_name: 'BPK BUDI SANTOSO', recipient_account: 'xxxx1234' };
  const c = scoreCandidate(trx, order, S);
  assert.deepEqual(c.breakdown, { amount: 60, time: 20, name: 15, account: 5 });
  assert.equal(c.score, 100);
});

test('matching score: nominal berbeda / di luar rentang / rekening beda => bukan kandidat', () => {
  const order = { amount: 150000, order_created_at: '2026-11-27T03:00:00Z', expires_at: '2026-11-27T03:30:00Z' };
  assert.equal(scoreCandidate({ amount: 150001, transaction_time: '2026-11-27T03:05:00Z' }, order, S), null);
  assert.equal(scoreCandidate({ amount: 150000, transaction_time: '2026-11-27T04:00:00Z' }, order, S), null);
  assert.equal(scoreCandidate({ amount: 150000, transaction_time: '2026-11-27T03:05:00Z', recipient_account: '9999' }, { ...order, destination_account: '1234' }, S), null);
});

test('matching score: dalam toleransi hanya 10 poin waktu', () => {
  const order = { amount: 50000, order_created_at: '2026-11-27T03:00:00Z', expires_at: '2026-11-27T03:30:00Z' };
  const c = scoreCandidate({ amount: 50000, transaction_time: '2026-11-27T02:57:00Z' }, order, S);
  assert.equal(c.breakdown.time, 10);
  assert.equal(c.score, 70);
});

test('nameSimilarity & accountMatches', () => {
  assert.ok(nameSimilarity('BUDI SANTOSO', 'Budi S') >= 0.75);
  assert.ok(nameSimilarity('SDR ANDI WIJAYA', 'Andi Wijaya') === 1);
  assert.equal(nameSimilarity('ANDI', 'Pelanggan'), 0);
  assert.equal(nameSimilarity('RINA', 'BUDI'), 0);
  assert.ok(accountMatches('1234567890', '****7890'));
  assert.ok(!accountMatches('1234567890', '5555'));
});

test('webhook signature HMAC-SHA256 dengan timestamp', () => {
  const body = JSON.stringify({ a: 1 });
  const sig = signPayload('secret', '1700000000', body);
  const expected = crypto.createHmac('sha256', 'secret').update(`1700000000.${body}`).digest('hex');
  assert.equal(sig, `sha256=${expected}`);
});

test('CSV aman dari formula injection', () => {
  const csv = toCsv([{ label: 'Nama', key: 'n' }], [{ n: '=HYPERLINK("x")' }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});

test('compareVersions', () => {
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0'), 0);
});
