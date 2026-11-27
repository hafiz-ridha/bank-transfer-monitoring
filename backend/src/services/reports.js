// Ringkasan dashboard (PRD §5.1), transaksi (§5.4), dan laporan (§5.9).

/** Membangun WHERE untuk daftar transaksi (dipakai list & export CSV). */
export function transactionFilters(q, tz) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (q.date_from) where.push(`t.received_time >= (${p(q.date_from)}::date)::timestamp AT TIME ZONE ${p(tz)}`);
  if (q.date_to) where.push(`t.received_time < ((${p(q.date_to)}::date) + 1)::timestamp AT TIME ZONE ${p(tz)}`);
  if (q.bank_code) where.push(`t.bank_code = ${p(q.bank_code)}`);
  if (q.bank_source_id) where.push(`t.bank_source_id = ${p(q.bank_source_id)}`);
  if (q.amount_min) where.push(`t.amount >= ${p(q.amount_min)}`);
  if (q.amount_max) where.push(`t.amount <= ${p(q.amount_max)}`);
  if (q.amount) where.push(`t.amount = ${p(q.amount)}`);
  if (q.status) {
    const list = String(q.status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    where.push(`t.match_status = ANY(${p(list)}::text[])`);
  }
  if (q.q) {
    const like = p(`%${q.q}%`);
    where.push(`(t.sender_name ILIKE ${like} OR t.reference_number ILIKE ${like} OR t.transaction_code ILIKE ${like} OR o.order_id ILIKE ${like} OR t.account_alias ILIKE ${like})`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export const TRANSACTION_SORTS = {
  received_time: 't.received_time',
  transaction_time: 'COALESCE(t.transaction_time, t.received_time)',
  amount: 't.amount',
  sender_name: 't.sender_name',
  bank_code: 't.bank_code',
  match_status: 't.match_status',
};

export const TRANSACTION_SELECT = `
  SELECT t.id, t.transaction_code, t.bank_code, t.account_alias, t.bank_source_id, t.sender_name, t.amount,
         t.transaction_time, t.received_time, t.reference_number, t.recipient_account, t.notification_type, t.parser_version,
         t.match_status, t.match_reason, t.match_score, t.matched_at, t.note, t.created_at,
         o.order_id AS pos_order_id, o.customer_name AS pos_customer_name,
         (SELECT count(*) FROM payment_matches pm WHERE pm.transaction_id = t.id AND pm.status = 'CANDIDATE') AS candidate_count
  FROM incoming_transactions t
  LEFT JOIN pos_orders o ON o.id = t.matched_order_id`;

export function createReportService({ db, settings }) {
  async function summary() {
    const s = await settings.all();
    const tz = s['general.timezone'];
    const today = await db.one(
      `WITH bounds AS (SELECT (date_trunc('day', now() AT TIME ZONE $1)) AT TIME ZONE $1 AS start)
       SELECT
         count(*) AS total_count,
         COALESCE(sum(amount), 0)::bigint AS total_amount,
         count(*) FILTER (WHERE match_status IN ('MATCHED','MANUAL_VERIFIED')) AS matched_count,
         count(*) FILTER (WHERE match_status = 'MATCHED') AS auto_matched_count,
         count(*) FILTER (WHERE match_status = 'MANUAL_VERIFIED') AS manual_verified_count,
         count(*) FILTER (WHERE match_status IN ('UNMATCHED','PENDING','REJECTED')) AS unmatched_count,
         count(*) FILTER (WHERE match_status = 'AMBIGUOUS') AS ambiguous_count,
         count(*) FILTER (WHERE match_status = 'IGNORED') AS ignored_count,
         COALESCE(sum(amount) FILTER (WHERE match_status IN ('MATCHED','MANUAL_VERIFIED')), 0)::bigint AS matched_amount
       FROM incoming_transactions, bounds WHERE received_time >= bounds.start`,
      [tz],
    );
    const parseErrors = await db.one(
      `SELECT count(*) AS n FROM notification_events
       WHERE parse_status = 'ERROR' AND server_received_at >= (date_trunc('day', now() AT TIME ZONE $1)) AT TIME ZONE $1`,
      [tz],
    );
    const lastTrx = await db.one('SELECT max(received_time) AS at FROM incoming_transactions');
    const needsReview = await db.one(
      `SELECT count(*) AS n FROM incoming_transactions WHERE match_status = 'AMBIGUOUS'`,
    );
    const pendingOrders = await db.one(`SELECT count(*) AS n, COALESCE(sum(amount),0)::bigint AS amount FROM pos_orders WHERE status = 'PENDING'`);
    const webhooks = await db.one(`SELECT count(*) FILTER (WHERE status IN ('FAILED','DEAD')) AS failed, count(*) FILTER (WHERE status = 'PENDING') AS pending FROM webhook_deliveries`);
    return {
      timezone: tz,
      today: { ...today, parse_error_count: parseErrors.n },
      last_transaction_at: lastTrx.at,
      ambiguous_open: needsReview.n,
      pending_orders: pendingOrders,
      webhooks,
    };
  }

  async function report({ granularity = 'day', from, to }) {
    const s = await settings.all();
    const tz = s['general.timezone'];
    const unit = granularity === 'month' ? 'month' : 'day';
    const fmt = unit === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const range = [from, to, tz];
    const rangeSql = `t.received_time >= ($1::date)::timestamp AT TIME ZONE $3 AND t.received_time < (($2::date) + 1)::timestamp AT TIME ZONE $3`;
    const rows = await db.many(
      `SELECT to_char(date_trunc('${unit}', t.received_time AT TIME ZONE $3), '${fmt}') AS period,
         count(*) AS count, COALESCE(sum(t.amount),0)::bigint AS amount,
         count(*) FILTER (WHERE t.match_status = 'MATCHED') AS matched_count,
         COALESCE(sum(t.amount) FILTER (WHERE t.match_status = 'MATCHED'),0)::bigint AS matched_amount,
         count(*) FILTER (WHERE t.match_status = 'MANUAL_VERIFIED') AS manual_verified_count,
         COALESCE(sum(t.amount) FILTER (WHERE t.match_status = 'MANUAL_VERIFIED'),0)::bigint AS manual_verified_amount,
         count(*) FILTER (WHERE t.match_status IN ('UNMATCHED','PENDING','REJECTED')) AS unmatched_count,
         COALESCE(sum(t.amount) FILTER (WHERE t.match_status IN ('UNMATCHED','PENDING','REJECTED')),0)::bigint AS unmatched_amount,
         count(*) FILTER (WHERE t.match_status = 'AMBIGUOUS') AS ambiguous_count,
         count(*) FILTER (WHERE t.match_status = 'IGNORED') AS ignored_count
       FROM incoming_transactions t WHERE ${rangeSql}
       GROUP BY 1 ORDER BY 1`,
      range,
    );
    const byBank = await db.many(
      `SELECT t.bank_code, t.account_alias, count(*) AS count, COALESCE(sum(t.amount),0)::bigint AS amount,
         count(*) FILTER (WHERE t.match_status IN ('MATCHED','MANUAL_VERIFIED')) AS matched_count
       FROM incoming_transactions t WHERE ${rangeSql}
       GROUP BY 1, 2 ORDER BY amount DESC`,
      range,
    );
    const pos = await db.one(
      `SELECT count(*) AS orders_total,
         COALESCE(sum(amount),0)::bigint AS orders_amount,
         count(*) FILTER (WHERE payment_status = 'PAID') AS orders_paid,
         COALESCE(sum(amount) FILTER (WHERE payment_status = 'PAID'),0)::bigint AS orders_paid_amount,
         count(*) FILTER (WHERE matched_by = 'AUTO') AS paid_auto,
         count(*) FILTER (WHERE matched_by = 'MANUAL') AS paid_manual,
         count(*) FILTER (WHERE status = 'EXPIRED') AS orders_expired,
         count(*) FILTER (WHERE status = 'CANCELLED') AS orders_cancelled,
         count(*) FILTER (WHERE status = 'PENDING') AS orders_pending
       FROM pos_orders o WHERE o.order_created_at >= ($1::date)::timestamp AT TIME ZONE $3 AND o.order_created_at < (($2::date) + 1)::timestamp AT TIME ZONE $3`,
      range,
    );
    const noOrder = await db.one(
      `SELECT count(*) AS n, COALESCE(sum(t.amount),0)::bigint AS amount FROM incoming_transactions t
       WHERE ${rangeSql} AND t.matched_order_id IS NULL AND t.match_status <> 'IGNORED'`,
      range,
    );
    const totals = rows.reduce((acc, r) => {
      for (const [k, v] of Object.entries(r)) if (k !== 'period') acc[k] = (acc[k] ?? 0) + Number(v);
      return acc;
    }, {});
    return {
      granularity: unit, from, to, timezone: tz, rows, by_bank: byBank, totals,
      pos_reconciliation: { ...pos, transactions_without_order: noOrder.n, transactions_without_order_amount: noOrder.amount },
    };
  }

  return { summary, report };
}
