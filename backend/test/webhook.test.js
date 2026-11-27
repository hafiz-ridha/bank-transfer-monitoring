import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let h;
let fail = true;
const calls = [];
before(async () => {
  h = await setup({
    fetchImpl: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return fail ? new Response('down', { status: 503 }) : new Response('ok', { status: 200 });
    },
  });
});
after(async () => h.close());

test('webhook gagal di-retry dengan backoff, DEAD setelah maks percobaan, bisa dikirim ulang', async () => {
  await h.createBankSource();
  const device = await h.registerDevice();
  const pos = await h.createPosKey();
  await h.call('PUT', '/api/v1/settings', { headers: h.admin, body: { values: { 'webhook.enabled': true, 'webhook.url': 'https://pos.example.test/hook', 'webhook.max_attempts': 2 } } });
  await h.call('POST', '/api/v1/settings/webhook/rotate-secret', { headers: h.admin });

  const orderId = `POS-WH-${Date.now()}`;
  await h.call('POST', '/api/v1/pos/orders', {
    headers: pos,
    body: { order_id: orderId, amount: 99000, created_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 1800_000).toISOString() },
  });
  await h.call('POST', '/api/v1/notifications', { headers: device.headers(), body: h.notification({ parsed: { amount: 99000 } }) });
  const row = await h.waitFor(() => h.db.one(`SELECT * FROM webhook_deliveries WHERE event_type = 'payment.matched'`));

  await h.app.services.webhooks.processDue();
  let d = await h.db.one('SELECT * FROM webhook_deliveries WHERE id = $1', [row.id]);
  assert.equal(d.status, 'FAILED');
  assert.equal(d.attempts, 1);
  assert.equal(d.last_status_code, 503);
  assert.ok(new Date(d.next_attempt_at) > new Date(), 'backoff dijadwalkan');

  // percobaan kedua (paksa jatuh tempo) => DEAD karena max_attempts = 2
  await h.db.query('UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = $1', [row.id]);
  await h.app.services.webhooks.processDue();
  d = await h.db.one('SELECT * FROM webhook_deliveries WHERE id = $1', [row.id]);
  assert.equal(d.status, 'DEAD');
  assert.equal(d.attempt_log.length, 2);

  // admin kirim ulang setelah POS pulih; event_id tetap sama (idempoten di sisi POS)
  fail = false;
  const r = await h.call('POST', `/api/v1/webhook-deliveries/${row.id}/retry`, { headers: h.admin });
  assert.equal(r.status, 200);
  await h.app.services.webhooks.processDue();
  d = await h.db.one('SELECT * FROM webhook_deliveries WHERE id = $1', [row.id]);
  assert.equal(d.status, 'DELIVERED');
  assert.equal(new Set(calls.map((c) => c.event_id)).size, 1);
  assert.equal(calls[0].order_id, orderId);
});
