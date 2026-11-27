// Webhook POS (PRD §7.3): outbox di database, HMAC-SHA256 + timestamp, retry backoff, idempotensi, delivery log.
import { hmacSha256, randomToken, notFound, truncate } from '../lib/util.js';

const BACKOFF_SECONDS = [30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400];
const STUCK_MINUTES = 5;

export function buildPaymentPayload({ eventId, order, trx, paidAt, matchType }) {
  return {
    event: 'payment.matched',
    event_id: eventId,
    order_id: order.order_id,
    transaction_id: trx.transaction_code,
    amount: Number(trx.amount),
    paid_at: new Date(paidAt).toISOString(),
    status: 'paid',
    match_type: matchType,
    bank_code: trx.bank_code,
    account_alias: trx.account_alias,
    sender_name: trx.sender_name,
    reference_number: trx.reference_number,
  };
}

/** Menulis event ke outbox di dalam transaksi DB yang sama dengan matching (atomik). */
export async function enqueuePaymentWebhook(tx, s, { order, trx, paidAt, matchType }) {
  if (!s['webhook.enabled']) return null; // POS dapat memakai GET /pos/orders/{id}/payment
  const eventId = `evt-${randomToken(12)}`;
  const payload = buildPaymentPayload({ eventId, order, trx, paidAt, matchType });
  return tx.one(
    `INSERT INTO webhook_deliveries (event_id, event_type, order_id, transaction_id, target_url, payload, max_attempts)
     VALUES ($1, 'payment.matched', $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (order_id) WHERE event_type = 'payment.matched' DO NOTHING
     RETURNING id`,
    [eventId, order.id, trx.id, s['webhook.url'] || null, JSON.stringify(payload), s['webhook.max_attempts']],
  );
}

export function signPayload(secret, timestamp, body) {
  return `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

export function createWebhookService({ db, settings, log, fetchImpl = globalThis.fetch }) {
  let running = false;

  async function send(url, secret, eventType, eventId, payload, timeoutMs) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'BankTransferMonitor-Webhook/1.0',
      'x-btm-event': eventType,
      'x-btm-event-id': eventId,
      'x-btm-timestamp': timestamp,
      'x-btm-signature': signPayload(secret, timestamp, body),
      'idempotency-key': eventId,
    };
    const started = Date.now();
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text().catch(() => '');
      return { ok: res.ok, status: res.status, body: truncate(text, 500), duration_ms: Date.now() - started };
    } catch (err) {
      return { ok: false, status: null, error: err.name === 'TimeoutError' ? `timeout ${timeoutMs}ms` : err.message, duration_ms: Date.now() - started };
    }
  }

  async function processDue(limit = 10) {
    if (running) return 0;
    running = true;
    try {
      const s = await settings.all();
      if (!s['webhook.enabled']) return 0;
      await db.query(
        `UPDATE webhook_deliveries SET status = 'FAILED', last_error = 'interrupted', updated_at = now()
         WHERE status = 'DELIVERING' AND updated_at < now() - make_interval(mins => $1)`,
        [STUCK_MINUTES],
      );
      const due = await db.tx((tx) => tx.many(
        `UPDATE webhook_deliveries SET status = 'DELIVERING', updated_at = now()
         WHERE id IN (
           SELECT id FROM webhook_deliveries
           WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= now()
           ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING *`,
        [limit],
      ));
      for (const d of due) await attempt(d, s);
      return due.length;
    } finally {
      running = false;
    }
  }

  async function attempt(d, s) {
    const url = s['webhook.url'] || d.target_url;
    const secret = s['webhook.secret'];
    let r;
    if (!url) r = { ok: false, status: null, error: 'URL webhook belum diatur', duration_ms: 0 };
    else if (!secret) r = { ok: false, status: null, error: 'Webhook secret belum diatur', duration_ms: 0 };
    else r = await send(url, secret, d.event_type, d.event_id, d.payload, s['webhook.timeout_ms']);

    const attempts = d.attempts + 1;
    const logEntry = { at: new Date().toISOString(), attempt: attempts, status_code: r.status, ok: r.ok, error: r.error ?? null, response: r.body ?? null, duration_ms: r.duration_ms };
    const attemptLog = [...(d.attempt_log ?? []), logEntry].slice(-20);
    if (r.ok) {
      await db.query(
        `UPDATE webhook_deliveries SET status = 'DELIVERED', attempts = $2, delivered_at = now(), last_attempt_at = now(),
           last_status_code = $3, last_error = NULL, target_url = $4, attempt_log = $5::jsonb, updated_at = now() WHERE id = $1`,
        [d.id, attempts, r.status, url, JSON.stringify(attemptLog)],
      );
      return true;
    }
    const dead = attempts >= d.max_attempts;
    const delay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
    await db.query(
      `UPDATE webhook_deliveries SET status = $2, attempts = $3, last_attempt_at = now(), last_status_code = $4,
         last_error = $5, target_url = COALESCE($6, target_url), attempt_log = $7::jsonb,
         next_attempt_at = now() + make_interval(secs => $8), updated_at = now() WHERE id = $1`,
      [d.id, dead ? 'DEAD' : 'FAILED', attempts, r.status, r.error ?? `HTTP ${r.status}`, url || null, JSON.stringify(attemptLog), delay],
    );
    log?.warn({ event_id: d.event_id, attempts, status: r.status, error: r.error }, 'webhook gagal');
    return false;
  }

  async function retry(id) {
    const row = await db.one(
      `UPDATE webhook_deliveries SET status = 'PENDING', next_attempt_at = now(), max_attempts = GREATEST(max_attempts, attempts + 1), updated_at = now()
       WHERE id = $1 AND status IN ('FAILED','DEAD','PENDING') RETURNING id`,
      [id],
    );
    if (!row) throw notFound('Delivery tidak ditemukan atau sudah terkirim');
    setImmediate(() => processDue().catch(() => {}));
    return row;
  }

  /** Mengirim event uji langsung (tidak masuk antrean retry) dan mencatat hasilnya. */
  async function sendTest() {
    const s = await settings.all();
    if (!s['webhook.url']) return { ok: false, error: 'URL webhook belum diatur' };
    if (!s['webhook.secret']) return { ok: false, error: 'Webhook secret belum diatur' };
    const eventId = `evt-test-${randomToken(8)}`;
    const payload = { event: 'webhook.test', event_id: eventId, sent_at: new Date().toISOString() };
    const r = await send(s['webhook.url'], s['webhook.secret'], 'webhook.test', eventId, payload, s['webhook.timeout_ms']);
    await db.query(
      `INSERT INTO webhook_deliveries (event_id, event_type, target_url, payload, status, attempts, last_attempt_at, delivered_at, last_status_code, last_error, attempt_log, max_attempts)
       VALUES ($1, 'webhook.test', $2, $3::jsonb, $4, 1, now(), CASE WHEN $5 THEN now() END, $6, $7, $8::jsonb, 1)`,
      [eventId, s['webhook.url'], JSON.stringify(payload), r.ok ? 'DELIVERED' : 'DEAD', r.ok, r.status, r.error ?? (r.ok ? null : `HTTP ${r.status}`), JSON.stringify([{ at: new Date().toISOString(), ...r }])],
    );
    return { ok: r.ok, status_code: r.status, error: r.error ?? null, response: r.body ?? null, duration_ms: r.duration_ms, event_id: eventId };
  }

  return { processDue, retry, sendTest };
}
