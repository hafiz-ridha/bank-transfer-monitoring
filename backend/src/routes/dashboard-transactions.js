// Dashboard: Incoming Transactions (§5.4), Payment Matching (§5.5), Manual Verification (§5.6), POS Orders (§5.7), Reports (§5.9)
import { notFound, pageParams, pagination, sortClause, toCsv, badRequest, forbidden } from '../lib/util.js';
import { transactionFilters, TRANSACTION_SELECT, TRANSACTION_SORTS } from '../services/reports.js';
import { audit, userActor } from '../services/audit.js';
import { HIDDEN_SENDERS_KEY, matchingSenderRules, withPosVisibility } from '../lib/posVisibility.js';

const uuidParam = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
const noteBody = { type: 'object', properties: { note: { type: ['string', 'null'], maxLength: 1000 } } };
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const listQuery = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    page_size: { type: 'integer', minimum: 1, maximum: 200 },
    date_from: { type: 'string', pattern: dateRe.source },
    date_to: { type: 'string', pattern: dateRe.source },
    bank_code: { type: 'string', maxLength: 30 },
    bank_source_id: { type: 'string', format: 'uuid' },
    amount: { type: 'integer', minimum: 0 },
    amount_min: { type: 'integer', minimum: 0 },
    amount_max: { type: 'integer', minimum: 0 },
    status: { type: 'string', maxLength: 200 },
    q: { type: 'string', maxLength: 100 },
    sort: { type: 'string', maxLength: 40 },
    order: { type: 'string', enum: ['asc', 'desc'] },
    pos_visibility: { type: 'string', enum: ['visible', 'hidden'] },
  },
};

const posVisibilityBody = {
  type: 'object',
  required: ['hidden'],
  additionalProperties: false,
  properties: {
    hidden: { type: 'boolean' },
    note: { type: ['string', 'null'], maxLength: 1000 },
    // Admin: berlakukan juga untuk nama pengirim (tambah/hapus di pengaturan pos_api.hidden_senders).
    sender_rule: { type: 'boolean' },
  },
};

export default async function dashboardTransactionRoutes(app) {
  const { db, matching, orders, reports, settings } = app.services;
  const anyUser = { preHandler: app.requireUser() };

  /** Tanggal hari ini (YYYY-MM-DD) di zona waktu operasional, bukan UTC. */
  async function localToday() {
    const tz = await settings.get('general.timezone');
    return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  }

  const hiddenSenders = async () => (await settings.get(HIDDEN_SENDERS_KEY)) ?? [];

  async function queryTransactions(q, limitSql) {
    const tz = await settings.get('general.timezone');
    const senders = await hiddenSenders();
    const f = transactionFilters(q, tz, { hiddenSenders: senders });
    const order = sortClause(q, TRANSACTION_SORTS, 'received_time');
    const rows = await db.many(`${TRANSACTION_SELECT} ${f.sql} ORDER BY ${order} ${limitSql}`, f.params);
    return { rows: rows.map((r) => withPosVisibility(r, senders)), f };
  }

  app.get('/transactions', { ...anyUser, schema: { querystring: listQuery } }, async (req) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const tz = await settings.get('general.timezone');
    const f = transactionFilters(req.query, tz, { hiddenSenders: await hiddenSenders() });
    const totals = await db.one(
      `SELECT count(*) AS n, COALESCE(sum(t.amount),0)::bigint AS amount FROM incoming_transactions t LEFT JOIN pos_orders o ON o.id = t.matched_order_id ${f.sql}`,
      f.params,
    );
    const { rows } = await queryTransactions(req.query, `LIMIT ${pageSize} OFFSET ${offset}`);
    return { data: rows, pagination: pagination(page, pageSize, totals.n), totals: { count: totals.n, amount: totals.amount } };
  });

  app.get('/transactions/export.csv', { ...anyUser, schema: { querystring: listQuery } }, async (req, reply) => {
    const { rows } = await queryTransactions(req.query, 'LIMIT 50000');
    const tz = await settings.get('general.timezone');
    const fmt = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: tz }) : '');
    const csv = toCsv([
      { label: 'Transaction ID', key: 'transaction_code' },
      { label: 'Waktu Transaksi', value: (r) => fmt(r.transaction_time) },
      { label: 'Waktu Diterima', value: (r) => fmt(r.received_time) },
      { label: 'Bank', key: 'bank_code' },
      { label: 'Rekening', key: 'account_alias' },
      { label: 'Nama Pengirim', key: 'sender_name' },
      { label: 'Nominal', key: 'amount' },
      { label: 'No Referensi', key: 'reference_number' },
      { label: 'Status Matching', key: 'match_status' },
      { label: 'POS Order ID', key: 'pos_order_id' },
      { label: 'Skor', key: 'match_score' },
      { label: 'Tampil di API POS', value: (r) => (r.pos_visible ? 'Ya' : r.pos_hidden ? 'Tidak (disembunyikan manual)' : 'Tidak (aturan pengirim)') },
      { label: 'Catatan', key: 'note' },
    ], rows);
    const name = `transaksi_${req.query.date_from ?? 'awal'}_${req.query.date_to ?? 'akhir'}.csv`;
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(csv);
  });

  app.get('/transactions/:id', { ...anyUser, schema: { params: uuidParam } }, async (req) => {
    const row = await db.one(`${TRANSACTION_SELECT} WHERE t.id = $1`, [req.params.id]);
    if (!row) throw notFound('Transaksi tidak ditemukan');
    const t = withPosVisibility(row, await hiddenSenders());
    const candidates = await db.many(
      `SELECT pm.id, pm.status, pm.score, pm.score_breakdown, pm.reasons, pm.note, pm.decided_at, u.email AS decided_by_email,
         o.id AS order_uuid, o.order_id, o.customer_name, o.amount, o.order_created_at, o.expires_at, o.status AS order_status, o.payment_status
       FROM payment_matches pm JOIN pos_orders o ON o.id = pm.order_id LEFT JOIN users u ON u.id = pm.decided_by
       WHERE pm.transaction_id = $1 ORDER BY (pm.status = 'CANDIDATE') DESC, pm.score DESC`,
      [t.id],
    );
    const notification = await db.one(
      `SELECT ne.id, ne.event_id, ne.package_name, ne.title, ne.text, ne.big_text, ne.posted_at, ne.device_received_at, ne.server_received_at,
         ne.parser_key, ne.parser_version, ne.parsed, ne.raw_purged_at, d.device_name
       FROM incoming_transactions it JOIN notification_events ne ON ne.id = it.notification_event_id LEFT JOIN devices d ON d.id = ne.device_id
       WHERE it.id = $1`,
      [t.id],
    );
    const history = await db.many(
      `SELECT id, actor_type, actor_label, action, note, after, created_at FROM audit_logs
       WHERE entity_type = 'transaction' AND entity_id = $1 ORDER BY created_at DESC`,
      [t.id],
    );
    return { transaction: t, candidates, notification, audit: history };
  });

  // Order yang dapat dipilih manual untuk transaksi ini (nominal sama & belum dibayar), termasuk di luar rentang waktu.
  app.get('/transactions/:id/order-options', { ...anyUser, schema: { params: uuidParam } }, async (req) => {
    const t = await db.one('SELECT amount FROM incoming_transactions WHERE id = $1', [req.params.id]);
    if (!t) throw notFound('Transaksi tidak ditemukan');
    return {
      data: await db.many(
        `SELECT id, order_id, customer_name, amount, order_created_at, expires_at, status, payment_status FROM pos_orders
         WHERE amount = $1 AND payment_status = 'UNPAID' AND status IN ('PENDING','EXPIRED')
         ORDER BY order_created_at DESC LIMIT 50`,
        [t.amount],
      ),
    };
  });

  app.post('/transactions/:id/ignore', { ...anyUser, schema: { params: uuidParam, body: noteBody } }, async (req) =>
    matching.ignore(req.params.id, req.user, req.body?.note, req));

  app.post('/transactions/:id/reopen', { ...anyUser, schema: { params: uuidParam, body: noteBody } }, async (req) =>
    matching.reopen(req.params.id, req.user, req.body?.note, req));

  app.post('/transactions/:id/rematch', { ...anyUser, schema: { params: uuidParam } }, async (req) =>
    matching.matchTransaction(req.params.id));

  app.post('/transactions/:id/assign', {
    ...anyUser,
    schema: {
      params: uuidParam,
      body: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string', minLength: 1, maxLength: 100 }, note: { type: ['string', 'null'], maxLength: 1000 } } },
    },
  }, async (req) => matching.assign(req.params.id, req.body.order_id, req.user, req.body.note, req));

  app.post('/transactions/:id/notes', {
    ...anyUser,
    schema: { params: uuidParam, body: { type: 'object', required: ['note'], properties: { note: { type: 'string', minLength: 1, maxLength: 1000 } } } },
  }, async (req) => {
    const row = await db.tx(async (tx) => {
      const r = await tx.one('UPDATE incoming_transactions SET note = $2, updated_at = now() WHERE id = $1 RETURNING id, note', [req.params.id, req.body.note]);
      if (!r) throw notFound('Transaksi tidak ditemukan');
      await audit(tx, { actor: userActor(req.user), action: 'transaction.note', entityType: 'transaction', entityId: r.id, note: req.body.note, req });
      return r;
    });
    return row;
  });

  /**
   * Sembunyikan / tampilkan lagi transaksi di API POS (GET /pos/transactions & POST /pos/orders/:id/match).
   * Tidak memengaruhi dashboard maupun pencocokan otomatis. `sender_rule` (admin): ikut menambah nama
   * pengirim ke pengaturan pos_api.hidden_senders, atau menghapus aturan pengirim yang menyembunyikannya.
   */
  app.post('/transactions/:id/pos-visibility', { ...anyUser, schema: { params: uuidParam, body: posVisibilityBody } }, async (req) => {
    const { hidden, note = null, sender_rule: senderRule = false } = req.body;
    if (senderRule && req.user.role !== 'admin') throw forbidden('Hanya admin yang dapat mengubah aturan nama pengirim');
    const rulesBefore = await hiddenSenders();
    let rulesChanged = false;
    const row = await db.tx(async (tx) => {
      const cur = await tx.one('SELECT id, transaction_code, sender_name, pos_hidden FROM incoming_transactions WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Transaksi tidak ditemukan');
      let rules = rulesBefore;
      if (senderRule) {
        const sender = String(cur.sender_name ?? '').trim().replace(/\s+/g, ' ');
        if (!sender) throw badRequest('Transaksi ini tidak memiliki nama pengirim');
        const matched = matchingSenderRules(sender, rulesBefore);
        rules = hidden
          ? (matched.length ? rulesBefore : [...rulesBefore, sender])
          : rulesBefore.filter((n) => !matched.includes(n));
        if (rules.length !== rulesBefore.length) {
          await settings.set(HIDDEN_SENDERS_KEY, rules, req.user.id, tx);
          await audit(tx, {
            actor: userActor(req.user), action: 'settings.update', entityType: 'settings',
            before: { [HIDDEN_SENDERS_KEY]: rulesBefore }, after: { [HIDDEN_SENDERS_KEY]: rules }, note, req,
          });
          rulesChanged = true;
        }
      }
      const updated = cur.pos_hidden === hidden ? cur : await tx.one(
        `UPDATE incoming_transactions SET pos_hidden = $2, pos_hidden_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
         WHERE id = $1 RETURNING id, transaction_code, sender_name, pos_hidden`,
        [cur.id, hidden],
      );
      if (cur.pos_hidden !== hidden || rulesChanged) {
        await audit(tx, {
          actor: userActor(req.user), action: hidden ? 'transaction.pos_hide' : 'transaction.pos_show',
          entityType: 'transaction', entityId: cur.id,
          before: { pos_hidden: cur.pos_hidden },
          after: { pos_hidden: hidden, ...(rulesChanged ? { hidden_senders: rules } : {}) },
          note, req,
        });
      }
      return { ...updated, rules };
    });
    if (rulesChanged) settings.invalidate();
    const { rules, ...t } = row;
    return withPosVisibility(t, rules);
  });

  // ---------------------------------------------------------------- matches
  app.get('/matches', anyUser, async (req) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const params = [];
    const where = [];
    const status = String(req.query.status ?? 'CANDIDATE').toUpperCase().split(',');
    params.push(status);
    where.push(`pm.status = ANY($${params.length}::text[])`);
    if (req.query.transaction_status) {
      params.push(String(req.query.transaction_status).toUpperCase().split(','));
      where.push(`t.match_status = ANY($${params.length}::text[])`);
    }
    if (req.query.transaction_id) { params.push(req.query.transaction_id); where.push(`pm.transaction_id = $${params.length}`); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = (await db.one(`SELECT count(*) AS n FROM payment_matches pm JOIN incoming_transactions t ON t.id = pm.transaction_id ${whereSql}`, params)).n;
    const rows = await db.many(
      `SELECT pm.id, pm.status, pm.score, pm.score_breakdown, pm.reasons, pm.note, pm.created_at, pm.decided_at,
         t.id AS transaction_id, t.transaction_code, t.sender_name, t.amount, t.bank_code, t.account_alias, t.transaction_time, t.received_time, t.match_status, t.match_reason,
         o.id AS order_uuid, o.order_id, o.customer_name, o.order_created_at, o.expires_at, o.status AS order_status
       FROM payment_matches pm JOIN incoming_transactions t ON t.id = pm.transaction_id JOIN pos_orders o ON o.id = pm.order_id
       ${whereSql} ORDER BY t.received_time DESC, pm.score DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { data: rows, pagination: pagination(page, pageSize, total) };
  });

  app.post('/matches/:id/verify', { ...anyUser, schema: { params: uuidParam, body: noteBody } }, async (req) =>
    matching.verify(req.params.id, req.user, req.body?.note, req));

  app.post('/matches/:id/reject', { ...anyUser, schema: { params: uuidParam, body: noteBody } }, async (req) =>
    matching.reject(req.params.id, req.user, req.body?.note, req));

  // ---------------------------------------------------------------- POS orders (tampilan dashboard)
  app.get('/orders', anyUser, async (req) => {
    const pp = pageParams(req.query);
    const tz = await settings.get('general.timezone');
    const { rows, total } = await orders.list(req.query, pp, tz);
    return { data: rows, pagination: pagination(pp.page, pp.pageSize, total) };
  });
  app.get('/orders/:id', anyUser, async (req) => orders.get(req.params.id));

  // ---------------------------------------------------------------- reports
  app.get('/reports', anyUser, async (req) => {
    const { granularity = 'day' } = req.query;
    const today = await localToday();
    const from = req.query.from ?? `${today.slice(0, 8)}01`;
    const to = req.query.to ?? today;
    if (!dateRe.test(from) || !dateRe.test(to)) throw badRequest('Format tanggal harus YYYY-MM-DD');
    if (from > to) throw badRequest('Tanggal awal harus sebelum tanggal akhir');
    return reports.report({ granularity, from, to });
  });

  app.get('/reports/export.csv', anyUser, async (req, reply) => {
    const today = await localToday();
    const from = req.query.from ?? `${today.slice(0, 8)}01`;
    const to = req.query.to ?? today;
    if (!dateRe.test(from) || !dateRe.test(to)) throw badRequest('Format tanggal harus YYYY-MM-DD');
    const r = await reports.report({ granularity: req.query.granularity ?? 'day', from, to });
    const csv = toCsv([
      { label: 'Periode', key: 'period' },
      { label: 'Jumlah Transfer', key: 'count' },
      { label: 'Total Nominal', key: 'amount' },
      { label: 'Matched (otomatis)', key: 'matched_count' },
      { label: 'Nominal Matched', key: 'matched_amount' },
      { label: 'Manual Verified', key: 'manual_verified_count' },
      { label: 'Nominal Manual Verified', key: 'manual_verified_amount' },
      { label: 'Unmatched', key: 'unmatched_count' },
      { label: 'Nominal Unmatched', key: 'unmatched_amount' },
      { label: 'Ambiguous', key: 'ambiguous_count' },
      { label: 'Diabaikan', key: 'ignored_count' },
    ], r.rows);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="laporan_${from}_${to}.csv"`).send(csv);
  });
}
