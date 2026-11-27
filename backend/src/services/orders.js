// POS Orders (PRD §7.1, §7.2, §5.7)
import { conflict, notFound, sha256, toDate, badRequest } from '../lib/util.js';
import { audit, posActor } from './audit.js';

function requestHash(b) {
  return sha256(JSON.stringify([b.order_id, b.customer_name ?? null, Number(b.amount), b.payment_method ?? 'bank_transfer',
    b.destination_account ?? null, new Date(b.created_at).toISOString(), b.expires_at ? new Date(b.expires_at).toISOString() : null]));
}

export function publicPayment(o, trx, pendingReview = false) {
  return {
    order_id: o.order_id,
    amount: Number(o.amount),
    status: o.status,
    payment_status: o.payment_status,
    paid: o.payment_status === 'PAID',
    paid_at: o.paid_at,
    matched_by: o.matched_by,
    review_pending: pendingReview,
    expires_at: o.expires_at,
    transaction: trx
      ? {
        transaction_id: trx.transaction_code, bank_code: trx.bank_code, account_alias: trx.account_alias,
        sender_name: trx.sender_name, amount: Number(trx.amount), reference_number: trx.reference_number,
        transaction_time: trx.transaction_time, received_time: trx.received_time,
      }
      : null,
  };
}

export function createOrderService({ db, settings, log, onNewOrder }) {
  async function create(client, body, req) {
    const created = toDate(body.created_at);
    const expires = toDate(body.expires_at);
    if (!created || Number.isNaN(created.getTime())) throw badRequest('created_at tidak valid');
    if (expires && (Number.isNaN(expires.getTime()) || expires <= created)) throw badRequest('expires_at harus setelah created_at');
    if (body.payment_method && body.payment_method !== 'bank_transfer') throw badRequest('payment_method yang didukung: bank_transfer');
    const hash = requestHash(body);

    const res = await db.tx(async (tx) => {
      const row = await tx.one(
        `INSERT INTO pos_orders (order_id, customer_name, amount, payment_method, destination_account, order_created_at, expires_at, api_client_id, request_hash, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (order_id) DO NOTHING RETURNING *`,
        [body.order_id, body.customer_name ?? null, body.amount, body.payment_method ?? 'bank_transfer', body.destination_account ?? null,
          created, expires, client?.id ?? null, hash, body.metadata ? JSON.stringify(body.metadata) : null],
      );
      if (!row) {
        const existing = await tx.one('SELECT * FROM pos_orders WHERE order_id = $1', [body.order_id]);
        if (existing.request_hash !== hash) {
          throw conflict('order_id sudah dipakai dengan data berbeda', { code: 'ORDER_ID_CONFLICT' });
        }
        return { order: existing, created: false };
      }
      await audit(tx, { actor: posActor(client), action: 'pos.order_create', entityType: 'order', entityId: row.order_id, after: { amount: row.amount, expires_at: row.expires_at }, req });
      return { order: row, created: true };
    });
    if (res.created) setImmediate(() => onNewOrder?.(res.order));
    return res;
  }

  async function payment(orderId) {
    const o = await db.one('SELECT * FROM pos_orders WHERE order_id = $1', [orderId]);
    if (!o) throw notFound('Order tidak ditemukan');
    const trx = o.paid_transaction_id ? await db.one('SELECT * FROM incoming_transactions WHERE id = $1', [o.paid_transaction_id]) : null;
    const review = o.payment_status === 'UNPAID'
      ? await db.one(
        `SELECT 1 AS x FROM payment_matches pm JOIN incoming_transactions t ON t.id = pm.transaction_id
         WHERE pm.order_id = $1 AND pm.status = 'CANDIDATE' AND t.match_status = 'AMBIGUOUS' LIMIT 1`,
        [o.id],
      )
      : null;
    return publicPayment(o, trx, !!review);
  }

  async function cancel(client, orderId, req) {
    return db.tx(async (tx) => {
      const o = await tx.one('SELECT * FROM pos_orders WHERE order_id = $1 FOR UPDATE', [orderId]);
      if (!o) throw notFound('Order tidak ditemukan');
      if (o.payment_status === 'PAID') throw conflict('Order sudah dibayar, tidak dapat dibatalkan', { code: 'ORDER_ALREADY_PAID' });
      if (o.status === 'CANCELLED') return publicPayment(o, null);
      const row = await tx.one(`UPDATE pos_orders SET status = 'CANCELLED', updated_at = now() WHERE id = $1 RETURNING *`, [o.id]);
      await tx.query(`UPDATE payment_matches SET status = 'SUPERSEDED', updated_at = now() WHERE order_id = $1 AND status = 'CANDIDATE'`, [o.id]);
      await audit(tx, { actor: posActor(client), action: 'pos.order_cancel', entityType: 'order', entityId: o.order_id, req });
      return publicPayment(row, null);
    });
  }

  /** Order PENDING yang melewati batas pembayaran + toleransi ditandai EXPIRED. */
  async function expireDue() {
    const s = await settings.all();
    const rows = await db.many(
      `UPDATE pos_orders SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'PENDING' AND payment_status = 'UNPAID'
         AND COALESCE(expires_at, order_created_at + make_interval(mins => $1)) + make_interval(mins => $2) < now()
       RETURNING id`,
      [s['matching.default_window_minutes'], s['matching.grace_after_minutes']],
    );
    return rows.length;
  }

  async function list(q, { page, pageSize, offset }, tz) {
    const where = [];
    const params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.status) add('o.status = ?', q.status);
    if (q.payment_status) add('o.payment_status = ?', q.payment_status);
    if (q.date_from) { params.push(q.date_from, tz); where.push(`o.order_created_at >= ($${params.length - 1}::date)::timestamp AT TIME ZONE $${params.length}`); }
    if (q.date_to) { params.push(q.date_to, tz); where.push(`o.order_created_at < (($${params.length - 1}::date) + 1)::timestamp AT TIME ZONE $${params.length}`); }
    if (q.amount_min) add('o.amount >= ?', q.amount_min);
    if (q.amount_max) add('o.amount <= ?', q.amount_max);
    if (q.q) { params.push(`%${q.q}%`); where.push(`(o.order_id ILIKE $${params.length} OR o.customer_name ILIKE $${params.length})`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sorts = { created_at: 'o.order_created_at', amount: 'o.amount', expires_at: 'o.expires_at', paid_at: 'o.paid_at', order_id: 'o.order_id' };
    const sort = sorts[q.sort] ?? sorts.created_at;
    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const total = (await db.one(`SELECT count(*) AS n FROM pos_orders o ${whereSql}`, params)).n;
    const rows = await db.many(
      `SELECT o.*, t.transaction_code, t.sender_name AS paid_sender_name,
         (SELECT count(*) FROM payment_matches pm WHERE pm.order_id = o.id AND pm.status = 'CANDIDATE') AS candidate_count
       FROM pos_orders o LEFT JOIN incoming_transactions t ON t.id = o.paid_transaction_id
       ${whereSql} ORDER BY ${sort} ${dir} NULLS LAST LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { rows, total };
  }

  async function get(idOrOrderId) {
    const o = await db.one('SELECT * FROM pos_orders WHERE id::text = $1 OR order_id = $1', [idOrOrderId]);
    if (!o) throw notFound('Order tidak ditemukan');
    const trx = o.paid_transaction_id ? await db.one('SELECT * FROM incoming_transactions WHERE id = $1', [o.paid_transaction_id]) : null;
    const candidates = await db.many(
      `SELECT pm.*, t.transaction_code, t.sender_name, t.amount, t.bank_code, t.account_alias, t.transaction_time, t.received_time, t.match_status
       FROM payment_matches pm JOIN incoming_transactions t ON t.id = pm.transaction_id
       WHERE pm.order_id = $1 ORDER BY pm.score DESC`,
      [o.id],
    );
    const webhooks = await db.many(
      `SELECT id, event_id, event_type, status, attempts, last_status_code, last_error, delivered_at, created_at FROM webhook_deliveries WHERE order_id = $1 ORDER BY created_at DESC`,
      [o.id],
    );
    return { order: o, transaction: trx, candidates, webhooks };
  }

  return { create, payment, cancel, expireDue, list, get };
}
