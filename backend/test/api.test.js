// Tes integrasi end-to-end terhadap API (PGlite in-memory) — memetakan Acceptance Criteria PRD §13.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let h;
let device;
let pos;
before(async () => {
  h = await setup();
  await h.createBankSource();
  device = await h.registerDevice();
  pos = await h.createPosKey();
});
after(async () => h.close());

const minutesFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString();
let orderSeq = 0;
const newOrder = (amount, extra = {}) => ({
  order_id: `POS-TEST-${++orderSeq}-${Date.now()}`, customer_name: 'Budi Santoso', amount,
  payment_method: 'bank_transfer', created_at: minutesFromNow(-1), expires_at: minutesFromNow(30), ...extra,
});

test('registrasi perangkat: kode pairing sekali pakai, token unik', async () => {
  assert.equal(device.reg.status, 201);
  assert.ok(device.token.length > 30);
  const reuse = await h.call('POST', '/api/v1/devices/register', { body: { pairing_code: device.created.body.pairing_code, device_uuid: 'other-device-1' } });
  assert.equal(reuse.status, 401);
});

test('device auth: tanpa X-Request-Time atau jam berbeda jauh ditolak (anti replay)', async () => {
  const noTime = await h.call('GET', '/api/v1/devices/config', { headers: { authorization: `Bearer ${device.token}` } });
  assert.equal(noTime.status, 400);
  const skew = await h.call('GET', '/api/v1/devices/config', { headers: { authorization: `Bearer ${device.token}`, 'x-request-time': new Date(Date.now() - 3600_000).toISOString() } });
  assert.equal(skew.status, 401);
  assert.equal(skew.body.error.code, 'CLOCK_SKEW');
  const ok = await h.call('GET', '/api/v1/devices/config', { headers: device.headers() });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.bank_sources.length, 1);
});

test('heartbeat: status ACTIVE, histori tersimpan, PERMISSION_ERROR saat izin dicabut', async () => {
  const hb = (over = {}) => ({
    device_id: device.uuid, heartbeat_id: crypto.randomUUID(), app_version: '1.0.0', notification_access: true, listener_connected: true,
    network_connected: true, battery_optimization_exempt: true, pending_queue: 0, reported_at: new Date().toISOString(), ...over,
  });
  const r1 = await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: hb() });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.status, 'ACTIVE');

  const dup = hb();
  await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: dup });
  const again = await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: dup });
  assert.equal(again.body.duplicate, true);

  const wrong = await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: hb({ device_id: 'someone-else' }) });
  assert.equal(wrong.status, 403);

  const r2 = await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: hb({ notification_access: false }) });
  assert.equal(r2.body.status, 'PERMISSION_ERROR');

  const detail = await h.call('GET', `/api/v1/devices/${device.id}`, { headers: h.admin });
  assert.equal(detail.body.status, 'PERMISSION_ERROR');
  assert.equal(detail.body.notification_access, false);

  const events = await h.call('GET', `/api/v1/devices/${device.id}/events?type=PERMISSION_LOST`, { headers: h.admin });
  assert.equal(events.body.data.length, 1);

  const r3 = await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: hb() });
  assert.equal(r3.body.status, 'ACTIVE');

  const hist = await h.call('GET', `/api/v1/devices/${device.id}/heartbeats`, { headers: h.admin });
  assert.ok(hist.body.data.length >= 4);
});

test('device monitor: heartbeat kedaluwarsa => INACTIVE + alert, pulih => alert resolved', async () => {
  await h.db.query(`UPDATE devices SET last_heartbeat_at = now() - interval '6 minutes', network_reported_at = now() - interval '6 minutes' WHERE id = $1`, [device.id]);
  await h.app.services.alerts.evaluateAll();
  const d = await h.call('GET', `/api/v1/devices/${device.id}`, { headers: h.admin });
  assert.equal(d.body.status, 'INACTIVE');
  assert.equal(d.body.connection_state, 'disconnected_suspected');
  const alerts = await h.call('GET', '/api/v1/alerts', { headers: h.admin });
  assert.ok(alerts.body.data.some((a) => a.alert_type === 'HEARTBEAT_MISSING' && a.status === 'OPEN'));

  await h.call('POST', '/api/v1/devices/heartbeat', {
    headers: device.headers(),
    body: { device_id: device.uuid, notification_access: true, listener_connected: true, battery_optimization_exempt: true, reported_at: new Date().toISOString() },
  });
  await h.app.services.alerts.evaluateAll();
  const after2 = await h.call('GET', '/api/v1/alerts?status=RESOLVED', { headers: h.admin });
  assert.ok(after2.body.data.some((a) => a.alert_type === 'HEARTBEAT_MISSING'));
});

test('notifikasi: transaksi tersimpan, retry tidak menggandakan (event_id & dedupe_key)', async () => {
  const ev = h.notification({ parsed: { amount: 175000, reference_number: 'REF-DUP-1' } });
  const r1 = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: ev });
  assert.equal(r1.status, 201);
  assert.ok(r1.body.transaction_code.startsWith('TRX-'));
  const r2 = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: ev });
  assert.equal(r2.body.status, 'duplicate');
  assert.equal(r2.body.transaction_id, r1.body.transaction_id);
  // event_id baru tapi nomor referensi sama (mis. dua aplikasi bank) => tetap satu transaksi
  const r3 = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 175000, reference_number: 'REF-DUP-1' } }) });
  assert.equal(r3.body.status, 'duplicate');
  const list = await h.call('GET', '/api/v1/transactions?q=REF-DUP-1', { headers: h.admin });
  assert.equal(list.body.pagination.total, 1);
});

test('notifikasi: format tidak dikenali => parsing error, tidak membuat transaksi palsu', async () => {
  const ev = h.notification({ parse_status: 'ERROR', classification: 'UNKNOWN', parsed: null, parse_error: 'Format tidak dikenali', text: 'Format baru Rp 99.000' });
  const r = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: ev });
  assert.equal(r.status, 201);
  assert.equal(r.body.transaction_id, null);
  // PARSED tapi nominal tidak valid => diturunkan jadi ERROR oleh server
  const bad = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: -5 } }) });
  assert.equal(bad.body.transaction_id, null);
  assert.equal(bad.body.parse_status, 'ERROR');
  const errs = await h.call('GET', `/api/v1/devices/${device.id}/parse-errors`, { headers: h.admin });
  assert.ok(errs.body.data.length >= 2);
  const sum = await h.call('GET', '/api/v1/dashboard/summary', { headers: h.admin });
  assert.ok(sum.body.today.parse_error_count >= 2);
});

test('notifikasi dari package yang tidak dipilih diabaikan', async () => {
  const r = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ package_name: 'com.whatsapp' }) });
  assert.equal(r.body.parse_status, 'IGNORED');
  assert.equal(r.body.transaction_id, null);
});

test('POS: order idempoten, matching otomatis => MATCHED + webhook HMAC terkirim', async () => {
  await h.call('PUT', '/api/v1/settings', { headers: h.admin, body: { values: { 'webhook.enabled': true, 'webhook.url': 'https://pos.example.test/webhook' } } });
  const sec = await h.call('POST', '/api/v1/settings/webhook/rotate-secret', { headers: h.admin });
  assert.ok(sec.body.secret.startsWith('whsec_'));

  const order = newOrder(212000);
  const c1 = await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: order });
  assert.equal(c1.status, 201);
  const c2 = await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: order });
  assert.equal(c2.status, 200);
  const c3 = await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: { ...order, amount: 1 } });
  assert.equal(c3.status, 409);

  const ev = h.notification({ parsed: { amount: 212000, sender_name: 'BUDI SANTOSO', reference_number: 'REF-MATCH-1' } });
  await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: ev });

  const pay = await h.waitFor(async () => {
    const r = await h.call('GET', `/api/v1/pos/orders/${order.order_id}/payment`, { headers: pos });
    return r.body.paid ? r : null;
  });
  assert.equal(pay.body.payment_status, 'PAID');
  assert.equal(pay.body.matched_by, 'AUTO');

  await h.app.services.webhooks.processDue();
  const hook = await h.waitFor(() => h.sent.find((s) => s.json.order_id === order.order_id));
  assert.equal(hook.json.event, 'payment.matched');
  assert.equal(hook.json.amount, 212000);
  assert.match(hook.headers['x-btm-signature'], /^sha256=[a-f0-9]{64}$/);
  const { signPayload } = await import('../src/services/webhooks.js');
  assert.equal(hook.headers['x-btm-signature'], signPayload(sec.body.secret, hook.headers['x-btm-timestamp'], hook.body));

  const deliveries = await h.call('GET', '/api/v1/webhook-deliveries', { headers: h.admin });
  assert.ok(deliveries.body.data.some((d) => d.pos_order_id === order.order_id && d.status === 'DELIVERED'));
});

test('transaksi tiba sebelum order => dicocokkan saat order dibuat', async () => {
  await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 333000, reference_number: 'REF-EARLY' } }) });
  await h.waitFor(async () => (await h.db.one(`SELECT match_status FROM incoming_transactions WHERE reference_number = 'REF-EARLY'`))?.match_status === 'UNMATCHED');
  const order = newOrder(333000, { created_at: minutesFromNow(0) });
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: order });
  const pay = await h.waitFor(async () => {
    const r = await h.call('GET', `/api/v1/pos/orders/${order.order_id}/payment`, { headers: pos });
    return r.body.paid ? r : null;
  });
  assert.equal(pay.body.transaction.reference_number, 'REF-EARLY');
});

test('dua order nominal sama => AMBIGUOUS, tidak ada webhook; admin verifikasi => MANUAL_VERIFIED', async () => {
  const before = h.sent.length;
  const o1 = newOrder(444000, { customer_name: 'Rina' });
  const o2 = newOrder(444000, { customer_name: 'Sari' });
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: o1 });
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: o2 });
  const n = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 444000, sender_name: 'SARI DEWI', reference_number: 'REF-AMB' } }) });
  const trxId = n.body.transaction_id;
  await h.waitFor(async () => (await h.db.one('SELECT match_status FROM incoming_transactions WHERE id = $1', [trxId])).match_status === 'AMBIGUOUS');
  await h.app.services.webhooks.processDue();
  assert.equal(h.sent.filter((s) => [o1.order_id, o2.order_id].includes(s.json.order_id)).length, 0, 'webhook tidak boleh terkirim untuk ambigu');
  const p1 = await h.call('GET', `/api/v1/pos/orders/${o1.order_id}/payment`, { headers: pos });
  assert.equal(p1.body.paid, false);
  assert.equal(p1.body.review_pending, true);

  const detail = await h.call('GET', `/api/v1/transactions/${trxId}`, { headers: h.admin });
  assert.equal(detail.body.candidates.length, 2);
  const sari = detail.body.candidates.find((c) => c.order_id === o2.order_id);
  const rina = detail.body.candidates.find((c) => c.order_id === o1.order_id);
  assert.ok(sari.score > rina.score, 'nama yang cocok menambah skor');

  const rej = await h.call('POST', `/api/v1/matches/${rina.id}/reject`, { headers: h.admin, body: { note: 'Bukan Rina' } });
  assert.equal(rej.body.status, 'REJECTED');
  const ver = await h.call('POST', `/api/v1/matches/${sari.id}/verify`, { headers: h.admin, body: { note: 'Dicek mutasi' } });
  assert.equal(ver.status, 200);
  assert.equal(ver.body.status, 'MANUAL_VERIFIED');

  // transaksi tidak dapat dipakai dua kali
  const again = await h.call('POST', `/api/v1/transactions/${trxId}/assign`, { headers: h.admin, body: { order_id: o1.order_id } });
  assert.equal(again.status, 409);

  await h.app.services.webhooks.processDue();
  const hook = await h.waitFor(() => h.sent.find((s) => s.json.order_id === o2.order_id));
  assert.equal(hook.json.match_type, 'manual');
  assert.ok(h.sent.length > before);

  const audit = await h.call('GET', `/api/v1/audit-logs?entity_type=transaction&entity_id=${trxId}`, { headers: h.admin });
  const actions = audit.body.data.map((a) => a.action);
  assert.ok(actions.includes('match.reject') && actions.includes('match.manual_verify'));
});

test('dua transfer nominal sama untuk satu order => keduanya AMBIGUOUS (konflik)', async () => {
  const o = newOrder(555000);
  await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 555000, reference_number: 'REF-C1' } }) });
  await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 555000, reference_number: 'REF-C2' } }) });
  await h.waitFor(async () => (await h.db.one(`SELECT count(*) AS n FROM incoming_transactions WHERE reference_number IN ('REF-C1','REF-C2') AND match_status = 'UNMATCHED'`)).n === 2);
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: o });
  await h.waitFor(async () => (await h.db.one(`SELECT count(*) AS n FROM incoming_transactions WHERE reference_number IN ('REF-C1','REF-C2') AND match_status = 'AMBIGUOUS'`)).n === 2);
  const p = await h.call('GET', `/api/v1/pos/orders/${o.order_id}/payment`, { headers: pos });
  assert.equal(p.body.paid, false);
});

test('order dibayar tidak dapat dipakai lagi oleh transfer berikutnya', async () => {
  const o = newOrder(666000);
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: o });
  await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 666000, reference_number: 'REF-P1' } }) });
  await h.waitFor(async () => (await h.call('GET', `/api/v1/pos/orders/${o.order_id}/payment`, { headers: pos })).body.paid);
  const second = await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 666000, reference_number: 'REF-P2' } }) });
  await h.waitFor(async () => (await h.db.one('SELECT match_status FROM incoming_transactions WHERE id = $1', [second.body.transaction_id])).match_status === 'UNMATCHED');
  const paidOnce = await h.db.one(`SELECT count(*) AS n FROM payment_matches pm JOIN pos_orders o ON o.id = pm.order_id WHERE o.order_id = $1 AND pm.status IN ('MATCHED','MANUAL_VERIFIED')`, [o.order_id]);
  assert.equal(paidOnce.n, 1);
});

test('transaksi: filter, pagination, sorting, export CSV, abaikan', async () => {
  const list = await h.call('GET', '/api/v1/transactions?page=1&page_size=2&sort=amount&order=desc&bank_code=BCA', { headers: h.admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 2);
  assert.ok(list.body.data[0].amount >= list.body.data[1].amount);
  const filtered = await h.call('GET', '/api/v1/transactions?status=MATCHED,MANUAL_VERIFIED&amount_min=200000', { headers: h.admin });
  assert.ok(filtered.body.data.every((t) => ['MATCHED', 'MANUAL_VERIFIED'].includes(t.match_status) && t.amount >= 200000));
  const csv = await h.call('GET', '/api/v1/transactions/export.csv', { headers: h.admin });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.raw.includes('Transaction ID'));

  const unmatched = await h.db.one(`SELECT id FROM incoming_transactions WHERE match_status = 'UNMATCHED' LIMIT 1`);
  const ig = await h.call('POST', `/api/v1/transactions/${unmatched.id}/ignore`, { headers: h.admin, body: { note: 'Transfer pribadi' } });
  assert.equal(ig.body.status, 'IGNORED');
});

test('laporan & ringkasan dashboard', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const r = await h.call('GET', `/api/v1/reports?granularity=day&from=${today.slice(0, 8)}01&to=${today}`, { headers: h.admin });
  assert.equal(r.status, 200);
  assert.ok(r.body.totals.count >= 5);
  assert.ok(r.body.by_bank.length >= 1);
  assert.ok(r.body.pos_reconciliation.orders_paid >= 3);
  const s = await h.call('GET', '/api/v1/dashboard/summary', { headers: h.admin });
  assert.ok(s.body.today.total_count >= 5);
  assert.equal(s.body.devices.length, 1);
});

test('role: operator tidak bisa ubah pengaturan, bisa melihat transaksi', async () => {
  const u = await h.call('POST', '/api/v1/users', { headers: h.admin, body: { email: 'op@test.local', role: 'operator' } });
  assert.equal(u.status, 201);
  const op = { authorization: 'Bearer dev:op@test.local' };
  assert.equal((await h.call('GET', '/api/v1/transactions', { headers: op })).status, 200);
  assert.equal((await h.call('PUT', '/api/v1/settings', { headers: op, body: { values: { 'matching.min_auto_score': 90 } } })).status, 403);
  assert.equal((await h.call('GET', '/api/v1/transactions', { headers: { authorization: 'Bearer dev:stranger@test.local' } })).status, 403);
  assert.equal((await h.call('GET', '/api/v1/transactions')).status, 401);
});

test('POS API key salah ditolak; token perangkat dicabut ditolak', async () => {
  assert.equal((await h.call('GET', '/api/v1/pos/orders/x/payment', { headers: { 'x-api-key': 'salah' } })).status, 401);
  await h.call('POST', `/api/v1/devices/${device.id}/revoke-token`, { headers: h.admin });
  const r = await h.call('GET', '/api/v1/devices/config', { headers: device.headers() });
  assert.equal(r.status, 401);
});
