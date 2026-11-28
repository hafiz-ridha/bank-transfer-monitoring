// POS API: daftar transaksi masuk & pencocokan (match) dari sistem POS dengan API key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let h;
let device;
let pos;
before(async () => {
  h = await setup();
  await h.call('PUT', '/api/v1/settings', { headers: h.admin, body: { values: { 'webhook.enabled': true, 'webhook.url': 'https://pos.example.test/webhook' } } });
  await h.call('POST', '/api/v1/settings/webhook/rotate-secret', { headers: h.admin });
  await h.createBankSource();
  device = await h.registerDevice();
  pos = await h.createPosKey();
});
after(async () => h.close());

const minutesFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString();
let seq = 0;
const newOrder = (amount, extra = {}) => ({
  order_id: `POS-M-${++seq}-${Date.now()}`, customer_name: 'Pelanggan', amount,
  payment_method: 'bank_transfer', created_at: minutesFromNow(-1), expires_at: minutesFromNow(30), ...extra,
});

async function incoming(amount, ref, sender = 'BUDI SANTOSO') {
  const n = await h.call('POST', '/api/v1/notifications', {
    headers: device.headers(), body: h.notification({ parsed: { amount, sender_name: sender, reference_number: ref } }),
  });
  assert.equal(n.status, 201, JSON.stringify(n.body));
  const row = await h.waitFor(async () => {
    const r = await h.db.one('SELECT transaction_code, match_status FROM incoming_transactions WHERE id = $1', [n.body.transaction_id]);
    return r && r.match_status !== 'PENDING' ? r : null;
  });
  return row;
}

test('GET /pos/transactions: wajib API key, filter nominal/status/since, paginasi', async () => {
  assert.equal((await h.call('GET', '/api/v1/pos/transactions')).status, 401);
  assert.equal((await h.call('GET', '/api/v1/pos/transactions', { headers: { 'x-api-key': 'btm_pos_salah' } })).status, 401);
  // Token dashboard tidak berlaku sebagai API key POS.
  assert.equal((await h.call('GET', '/api/v1/pos/transactions', { headers: h.admin })).status, 401);

  const t1 = await incoming(510000, 'REF-LIST-1');
  const mark = (await h.call('GET', '/api/v1/pos/transactions?amount=510000', { headers: pos })).body.data[0].recorded_at;
  const t2 = await incoming(520000, 'REF-LIST-2', 'SITI AMINAH');

  const all = await h.call('GET', '/api/v1/pos/transactions', { headers: pos });
  assert.equal(all.status, 200);
  assert.ok(all.body.pagination.total >= 2);
  assert.equal(all.body.data[0].transaction_id, t2.transaction_code, 'default terbaru dulu');
  const row = all.body.data.find((r) => r.transaction_id === t2.transaction_code);
  assert.deepEqual(Object.keys(row).sort(), [
    'account_alias', 'amount', 'bank_code', 'match_status', 'matched_at', 'order_id', 'received_time',
    'recorded_at', 'reference_number', 'sender_name', 'transaction_id', 'transaction_time',
  ]);
  assert.equal(row.amount, 520000);
  assert.equal(row.sender_name, 'SITI AMINAH');
  assert.equal(row.match_status, 'UNMATCHED');
  assert.equal(row.order_id, null);

  const byAmount = await h.call('GET', '/api/v1/pos/transactions?amount=510000', { headers: pos });
  assert.deepEqual(byAmount.body.data.map((r) => r.transaction_id), [t1.transaction_code]);

  const since = await h.call('GET', `/api/v1/pos/transactions?since=${encodeURIComponent(mark)}`, { headers: pos });
  assert.ok(since.body.data.every((r) => new Date(r.recorded_at) > new Date(mark)));
  assert.ok(since.body.data.some((r) => r.transaction_id === t2.transaction_code));
  assert.ok(!since.body.data.some((r) => r.transaction_id === t1.transaction_code));

  const unmatched = await h.call('GET', '/api/v1/pos/transactions?status=UNMATCHED&page_size=1', { headers: pos });
  assert.equal(unmatched.body.data.length, 1);
  assert.equal(unmatched.body.pagination.page_size, 1);
  assert.ok(unmatched.body.data.every((r) => r.match_status === 'UNMATCHED'));

  assert.equal((await h.call('GET', '/api/v1/pos/transactions?date_from=kemarin', { headers: pos })).status, 400);
});

test('POST /pos/orders/:id/match: POS menautkan transaksi ambigu, idempoten, aturan sama dengan dashboard', async () => {
  const o1 = newOrder(610000);
  const o2 = newOrder(610000);
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: o1 });
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: o2 });
  const trx = await incoming(610000, 'REF-POS-MATCH');
  assert.equal(trx.match_status, 'AMBIGUOUS');
  const sentBefore = h.sent.length;

  const res = await h.call('POST', `/api/v1/pos/orders/${o2.order_id}/match`, {
    headers: pos, body: { transaction_id: trx.transaction_code, note: 'Dicek kasir' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.paid, true);
  assert.equal(res.body.matched_by, 'MANUAL');
  assert.equal(res.body.transaction.transaction_id, trx.transaction_code);

  const t = await h.db.one('SELECT match_status, match_reason FROM incoming_transactions WHERE transaction_code = $1', [trx.transaction_code]);
  assert.equal(t.match_status, 'MANUAL_VERIFIED');
  assert.equal(t.match_reason, 'pos_verification');
  const log = await h.db.one(`SELECT actor_type, actor_label FROM audit_logs WHERE action = 'match.pos_verify' ORDER BY created_at DESC LIMIT 1`);
  assert.equal(log.actor_type, 'pos');

  // Webhook payment.matched tetap dikirim (order lunas), sama seperti verifikasi manual.
  await h.app.services.webhooks.processDue();
  assert.ok(h.sent.slice(sentBefore).some((s) => s.json.order_id === o2.order_id));

  // Retry pasangan yang sama -> 200, tetap lunas.
  const again = await h.call('POST', `/api/v1/pos/orders/${o2.order_id}/match`, { headers: pos, body: { transaction_id: trx.transaction_code } });
  assert.equal(again.status, 200);
  assert.equal(again.body.paid, true);

  // Transaksi yang sama ke order lain ditolak.
  const other = await h.call('POST', `/api/v1/pos/orders/${o1.order_id}/match`, { headers: pos, body: { transaction_id: trx.transaction_code } });
  assert.equal(other.status, 409);
  assert.equal(other.body.error.details.code, 'TRANSACTION_ALREADY_USED');
  assert.equal((await h.call('GET', `/api/v1/pos/orders/${o1.order_id}/payment`, { headers: pos })).body.paid, false);

  // Tercermin di daftar transaksi POS.
  const list = await h.call('GET', '/api/v1/pos/transactions?amount=610000', { headers: pos });
  assert.equal(list.body.data[0].order_id, o2.order_id);
  assert.equal(list.body.data[0].match_status, 'MANUAL_VERIFIED');
});

test('POST /pos/orders/:id/match: nominal beda, transaksi/order tidak ada, order batal ditolak', async () => {
  const order = newOrder(710000);
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: order });
  const wrong = await incoming(710500, 'REF-POS-WRONG');

  const diff = await h.call('POST', `/api/v1/pos/orders/${order.order_id}/match`, { headers: pos, body: { transaction_id: wrong.transaction_code } });
  assert.equal(diff.status, 400);

  const noTrx = await h.call('POST', `/api/v1/pos/orders/${order.order_id}/match`, { headers: pos, body: { transaction_id: 'TRX-TIDAK-ADA' } });
  assert.equal(noTrx.status, 404);

  const noOrder = await h.call('POST', '/api/v1/pos/orders/ORDER-TIDAK-ADA/match', { headers: pos, body: { transaction_id: wrong.transaction_code } });
  assert.equal(noOrder.status, 404);

  assert.equal((await h.call('POST', `/api/v1/pos/orders/${order.order_id}/match`, { headers: pos, body: {} })).status, 400);
  assert.equal((await h.call('POST', `/api/v1/pos/orders/${order.order_id}/match`, { body: { transaction_id: wrong.transaction_code } })).status, 401);

  const cancelled = newOrder(720000);
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: cancelled });
  await h.call('POST', `/api/v1/pos/orders/${cancelled.order_id}/cancel`, { headers: pos, body: {} });
  const late = await incoming(720000, 'REF-POS-CANCELLED');
  const res = await h.call('POST', `/api/v1/pos/orders/${cancelled.order_id}/match`, { headers: pos, body: { transaction_id: late.transaction_code } });
  assert.equal(res.status, 409);
});

test('pos_api.hidden_senders: pengirim tertentu disembunyikan dari API POS, tetap tampil di dashboard', async () => {
  const set = (value) => h.call('PUT', '/api/v1/settings', { headers: h.admin, body: { values: { 'pos_api.hidden_senders': value } } });
  // Teks dari form dashboard: satu per baris, spasi dirapikan, duplikat (beda huruf besar/kecil) dibuang.
  const saved = await set('PT GAJI\n  ibu   rina \n\nPT gaji\n50%');
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const def = saved.body.data.find((s) => s.key === 'pos_api.hidden_senders');
  assert.deepEqual(def.value, ['PT GAJI', 'ibu rina', '50%']);
  assert.equal(def.type, 'list');
  assert.equal((await set('x'.repeat(101))).status, 400);
  assert.equal((await set([1, 2])).status, 400);

  const gaji = await incoming(810000, 'REF-HIDE-1', 'PT GAJI KARYAWAN SEJAHTERA');
  const rina = await incoming(810000, 'REF-HIDE-2', 'IBU RINA SARI');
  const umum = await incoming(810000, 'REF-HIDE-3', 'BUDI 50X');

  // '%' di pengaturan diperlakukan sebagai teks biasa, bukan wildcard.
  const list = await h.call('GET', '/api/v1/pos/transactions?amount=810000', { headers: pos });
  assert.deepEqual(list.body.data.map((r) => r.transaction_id), [umum.transaction_code]);
  assert.equal(list.body.pagination.total, 1);
  assert.equal(list.body.totals.amount, 810000);

  // POS tidak bisa menautkan transaksi tersembunyi (seolah tidak ada).
  const order = newOrder(810000);
  await h.call('POST', '/api/v1/pos/orders', { headers: pos, body: order });
  const hidden = await h.call('POST', `/api/v1/pos/orders/${order.order_id}/match`, { headers: pos, body: { transaction_id: gaji.transaction_code } });
  assert.equal(hidden.status, 404);

  // Dashboard tetap menampilkan semuanya.
  const dash = await h.call('GET', '/api/v1/transactions?amount=810000', { headers: h.admin });
  const codes = dash.body.data.map((r) => r.transaction_code);
  for (const t of [gaji, rina, umum]) assert.ok(codes.includes(t.transaction_code));

  // Dikosongkan -> semua tampil lagi.
  assert.deepEqual((await set('')).body.data.find((s) => s.key === 'pos_api.hidden_senders').value, []);
  const all = await h.call('GET', '/api/v1/pos/transactions?amount=810000', { headers: pos });
  assert.equal(all.body.pagination.total, 3);
});

test('GET /pos/devices: status perangkat monitoring untuk POS tanpa data internal', async () => {
  assert.equal((await h.call('GET', '/api/v1/pos/devices')).status, 401);
  const hb = (over = {}) => ({
    device_id: device.uuid, heartbeat_id: crypto.randomUUID(), app_version: '1.0.0', notification_access: true, listener_connected: true,
    network_connected: true, battery_optimization_exempt: true, pending_queue: 0, reported_at: new Date().toISOString(), ...over,
  });
  assert.equal((await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: hb() })).body.status, 'ACTIVE');
  // Perangkat kedua baru dibuat (belum dipasangkan di HP).
  const pending = await h.call('POST', '/api/v1/devices', { headers: h.admin, body: { device_name: 'HP Cadangan' } });

  const r = await h.call('GET', '/api/v1/pos/devices', { headers: pos });
  assert.equal(r.status, 200);
  const main = r.body.data.find((d) => d.id === device.id);
  assert.equal(main.status, 'ACTIVE');
  assert.equal(main.notification_access, true);
  assert.equal(main.registered, true);
  for (const secret of ['device_uuid', 'token_issued_at', 'pairing_pending', 'pairing_expires_at', 'last_error']) {
    assert.ok(!(secret in main), `${secret} tidak boleh tampil di API POS`);
  }
  const spare = r.body.data.find((d) => d.id === pending.body.device.id);
  assert.equal(spare.registered, false);
  assert.equal(r.body.summary.total, 2);
  assert.equal(r.body.summary.active, 1);
  assert.equal(r.body.summary.monitoring_ok, true);

  // Izin notifikasi dicabut -> tidak ada perangkat ACTIVE -> monitoring_ok false.
  await h.call('POST', '/api/v1/devices/heartbeat', { headers: device.headers(), body: hb({ notification_access: false }) });
  const r2 = await h.call('GET', '/api/v1/pos/devices', { headers: pos });
  assert.equal(r2.body.data.find((d) => d.id === device.id).status, 'PERMISSION_ERROR');
  assert.equal(r2.body.summary.permission_error, 1);
  assert.equal(r2.body.summary.monitoring_ok, false);

  // Perangkat yang dinonaktifkan di dashboard tidak ditampilkan.
  await h.call('PATCH', `/api/v1/devices/${pending.body.device.id}`, { headers: h.admin, body: { is_active: false } });
  const r3 = await h.call('GET', '/api/v1/pos/devices', { headers: pos });
  assert.equal(r3.body.summary.total, 1);
  assert.ok(!r3.body.data.some((d) => d.id === pending.body.device.id));
});
