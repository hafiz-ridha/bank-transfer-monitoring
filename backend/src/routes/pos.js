// POS API Integration (PRD §7)
import { HttpError, notFound, pageParams, pagination } from '../lib/util.js';
import { transactionFilters } from '../services/reports.js';
import { posActor } from '../services/audit.js';

const dateRe = '^\\d{4}-\\d{2}-\\d{2}$';

const transactionsQuery = {
  type: 'object',
  properties: {
    date_from: { type: 'string', pattern: dateRe },
    date_to: { type: 'string', pattern: dateRe },
    // Polling inkremental: hanya transaksi yang DICATAT server setelah waktu ini (bandingkan dengan recorded_at).
    since: { type: 'string', format: 'date-time' },
    status: { type: 'string', maxLength: 200 },
    amount: { type: 'integer', minimum: 1 },
    amount_min: { type: 'integer', minimum: 0 },
    amount_max: { type: 'integer', minimum: 0 },
    bank_code: { type: 'string', maxLength: 30 },
    page: { type: 'integer', minimum: 1 },
    page_size: { type: 'integer', minimum: 1, maximum: 200 },
    order: { type: 'string', enum: ['asc', 'desc'] },
  },
};

/** Bentuk transaksi untuk POS — sama dengan objek `transaction` pada respons Payment. */
const posTransaction = (r) => ({
  transaction_id: r.transaction_code,
  bank_code: r.bank_code,
  account_alias: r.account_alias,
  sender_name: r.sender_name,
  amount: r.amount,
  reference_number: r.reference_number,
  transaction_time: r.transaction_time,
  received_time: r.received_time,
  match_status: r.match_status,
  matched_at: r.matched_at,
  order_id: r.order_id,
  // Waktu dicatat server (monoton) — pakai nilai terbesar sebagai `since` untuk polling berikutnya.
  recorded_at: r.created_at,
});

/** Status perangkat monitoring untuk POS — tanpa data internal (token, pairing, UUID perangkat). */
const posDevice = (d) => ({
  id: d.id,
  device_name: d.device_name,
  status: d.status,
  status_reason: d.status_reason,
  status_source: d.status_source,
  connection_state: d.connection_state,
  heartbeat_age_seconds: d.heartbeat_age_seconds,
  issues: d.issues,
  notification_access: d.notification_access,
  listener_connected: d.listener_connected,
  network_connected: d.network_connected,
  battery_optimization_exempt: d.battery_optimization_exempt,
  last_heartbeat_at: d.last_heartbeat_at,
  last_notification_at: d.last_notification_at,
  last_successful_sync_at: d.last_successful_sync_at,
  pending_queue: d.pending_queue,
  failed_queue: d.failed_queue,
  device_model: d.device_model,
  app_version: d.app_version,
  registered: d.registered,
});

/** Pola ILIKE untuk pengirim yang disembunyikan dari API POS ("mengandung", tanpa beda besar/kecil). */
const hiddenSenderPatterns = (names) => names.map((n) => `%${String(n).replace(/[\\%_]/g, '\\$&')}%`);
/** Sama dengan filter SQL di atas, untuk satu nama pengirim. */
const isHiddenSender = (sender, names) => {
  const s = String(sender ?? '').toLowerCase();
  return !!s && names.some((n) => s.includes(String(n).toLowerCase()));
};

export default async function posRoutes(app) {
  const { db, orders, matching, settings, devices } = app.services;
  const auth = { preHandler: app.requirePos };
  const hiddenSenders = async () => (await settings.get('pos_api.hidden_senders')) ?? [];

  app.post('/orders', {
    ...auth,
    schema: {
      body: {
        type: 'object',
        required: ['order_id', 'amount', 'created_at'],
        additionalProperties: false,
        properties: {
          order_id: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._:\\-/]+$' },
          customer_name: { type: ['string', 'null'], maxLength: 200 },
          amount: { type: 'integer', minimum: 1, maximum: 9999999999999 },
          payment_method: { type: 'string', maxLength: 40 },
          destination_account: { type: ['string', 'null'], maxLength: 60 },
          created_at: { type: 'string', format: 'date-time' },
          expires_at: { type: ['string', 'null'], format: 'date-time' },
          metadata: { type: ['object', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const { order, created } = await orders.create(req.apiClient, req.body, req);
    const payment = await orders.payment(order.order_id);
    return reply.status(created ? 201 : 200).send({ created, order: payment });
  });

  app.get('/orders/:order_id/payment', auth, async (req) => orders.payment(req.params.order_id));

  app.post('/orders/:order_id/cancel', auth, async (req) => orders.cancel(req.apiClient, req.params.order_id, req));

  /**
   * POS menautkan transaksi masuk ke order (verifikasi dari kasir). Aturan sama dengan verifikasi
   * manual di dashboard: nominal wajib sama, transaksi belum dipakai order lain, order belum
   * lunas/dibatalkan. Idempoten: mengirim ulang pasangan yang sama -> 200 dengan status terkini.
   */
  app.post('/orders/:order_id/match', {
    ...auth,
    schema: {
      body: {
        type: 'object',
        required: ['transaction_id'],
        additionalProperties: false,
        properties: {
          transaction_id: { type: 'string', minLength: 1, maxLength: 40 },
          note: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
    },
  }, async (req) => {
    const orderId = req.params.order_id;
    const trx = await db.one('SELECT id, sender_name FROM incoming_transactions WHERE transaction_code = $1', [req.body.transaction_id]);
    // Transaksi yang disembunyikan dari API POS diperlakukan seperti tidak ada.
    if (!trx || isHiddenSender(trx.sender_name, await hiddenSenders())) throw notFound('Transaksi tidak ditemukan');
    try {
      await matching.assign(trx.id, orderId, null, req.body.note ?? null, req, {
        actor: posActor(req.apiClient),
        reason: 'pos_verification',
      });
    } catch (err) {
      // Pasangan yang sama sudah tertaut sebelumnya (retry dari POS) -> anggap berhasil.
      const o = await db.one('SELECT paid_transaction_id FROM pos_orders WHERE order_id = $1', [orderId]);
      if (!(err instanceof HttpError && o?.paid_transaction_id === trx.id)) throw err;
    }
    return orders.payment(orderId);
  });

  /**
   * Status perangkat Android monitoring (baca saja), dihitung server dari heartbeat (PRD §4.3).
   * Hanya perangkat yang aktif di dashboard. `monitoring_ok` = minimal satu perangkat ACTIVE,
   * sehingga POS bisa memperingatkan kasir bila deteksi transfer sedang tidak berjalan.
   */
  app.get('/devices', auth, async () => {
    const data = (await devices.list()).filter((d) => d.is_active).map(posDevice);
    const count = (st) => data.filter((d) => d.status === st).length;
    return {
      data,
      summary: {
        total: data.length,
        active: count('ACTIVE'),
        warning: count('WARNING'),
        inactive: count('INACTIVE'),
        permission_error: count('PERMISSION_ERROR'),
        disconnected: count('DISCONNECTED'),
        unknown: count('UNKNOWN'),
        monitoring_ok: data.some((d) => d.status === 'ACTIVE'),
        checked_at: new Date().toISOString(),
      },
    };
  });

  /**
   * Daftar transaksi masuk (baca saja) untuk POS: filter tanggal/status/nominal, paginasi.
   * Transaksi dari pengirim di pengaturan `pos_api.hidden_senders` tidak ditampilkan.
   */
  app.get('/transactions', { ...auth, schema: { querystring: transactionsQuery } }, async (req) => {
    const q = req.query;
    const { page, pageSize, offset } = pageParams(q, { defaultSize: 50 });
    const tz = await settings.get('general.timezone');
    const f = transactionFilters(q, tz);
    const params = [...f.params];
    const where = f.sql ? [f.sql.replace(/^WHERE /, '')] : [];
    if (q.since) {
      params.push(q.since);
      where.push(`t.created_at > $${params.length}::timestamptz`);
    }
    const hidden = await hiddenSenders();
    if (hidden.length) {
      params.push(hiddenSenderPatterns(hidden));
      where.push(`NOT (COALESCE(t.sender_name, '') ILIKE ANY($${params.length}::text[]))`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const from = 'FROM incoming_transactions t LEFT JOIN pos_orders o ON o.id = t.matched_order_id';
    const totals = await db.one(`SELECT count(*) AS n, COALESCE(sum(t.amount),0)::bigint AS amount ${from} ${whereSql}`, params);
    const rows = await db.many(
      `SELECT t.transaction_code, t.bank_code, t.account_alias, t.sender_name, t.amount, t.reference_number,
              t.transaction_time, t.received_time, t.match_status, t.matched_at, o.order_id, t.created_at
       ${from} ${whereSql}
       ORDER BY t.created_at ${dir}, t.id ${dir}
       LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { data: rows.map(posTransaction), pagination: pagination(page, pageSize, totals.n), totals: { count: totals.n, amount: totals.amount } };
  });
}
