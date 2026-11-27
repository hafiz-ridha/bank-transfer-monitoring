// Matching Engine (PRD §6).
// Aturan wajib: nominal sama, order PENDING & UNPAID, transaksi belum dipakai, waktu dalam rentang konfigurasi,
// rekening penerima cocok bila order mensyaratkannya dan transaksi memuatnya.
// Skor (heuristik, bukan probabilitas): nominal 60, waktu 20 (10 jika hanya dalam toleransi), nama 15, rekening 5.
// MATCHED hanya jika tepat satu kandidat, tidak ada transaksi lain yang bersaing untuk order itu, dan skor ≥ ambang.
import { accountMatches, conflict, nameSimilarity, notFound, badRequest } from '../lib/util.js';
import { audit, systemActor } from './audit.js';
import { enqueuePaymentWebhook } from './webhooks.js';

export const FINAL_MATCH_STATUSES = ['MATCHED', 'MANUAL_VERIFIED', 'IGNORED'];
const REMATCHABLE = ['PENDING', 'UNMATCHED', 'REJECTED'];

export function trxTime(trx) {
  return new Date(trx.transaction_time ?? trx.received_time);
}

export function orderWindow(order, s) {
  const created = new Date(order.order_created_at);
  const before = (s['matching.window_before_minutes'] ?? 5) * 60_000;
  const grace = (s['matching.grace_after_minutes'] ?? 10) * 60_000;
  const end = order.expires_at
    ? new Date(order.expires_at)
    : new Date(created.getTime() + (s['matching.default_window_minutes'] ?? 60) * 60_000);
  return {
    start: created, end,
    toleranceStart: new Date(created.getTime() - before),
    toleranceEnd: new Date(end.getTime() + grace),
  };
}

/** Menilai satu pasangan transaksi–order. Mengembalikan null jika aturan wajib tidak terpenuhi. */
export function scoreCandidate(trx, order, s, bankSources = []) {
  const reasons = [];
  if (Number(trx.amount) !== Number(order.amount)) return null;
  reasons.push(`Nominal sama (Rp ${Number(order.amount).toLocaleString('id-ID')})`);

  const t = trxTime(trx).getTime();
  const w = orderWindow(order, s);
  let time = 0;
  if (t >= w.start.getTime() && t <= w.end.getTime()) {
    time = 20;
    reasons.push('Waktu transfer dalam rentang order');
  } else if (t >= w.toleranceStart.getTime() && t <= w.toleranceEnd.getTime()) {
    time = 10;
    reasons.push('Waktu transfer hanya dalam toleransi rentang order');
  } else {
    return null;
  }

  let account = 0;
  if (order.destination_account && trx.recipient_account) {
    if (!accountMatches(order.destination_account, trx.recipient_account)) return null;
    account = 5;
    reasons.push('Rekening penerima sesuai rekening tujuan order');
  } else if (trx.recipient_account) {
    const known = bankSources.some((b) => b.is_active && b.account_identifier && accountMatches(b.account_identifier, trx.recipient_account));
    if (known) {
      account = 5;
      reasons.push('Rekening penerima tervalidasi sebagai rekening terdaftar');
    }
  }

  let name = 0;
  const sim = nameSimilarity(trx.sender_name, order.customer_name);
  const threshold = s['matching.name_match_threshold'] ?? 0.6;
  if (sim >= threshold) {
    name = 15;
    reasons.push(`Nama pengirim sesuai (${Math.round(sim * 100)}%)`);
  } else if (sim > 0) {
    name = Math.round(15 * sim * 0.5);
    reasons.push(`Nama pengirim mirip sebagian (${Math.round(sim * 100)}%)`);
  } else if (trx.sender_name && order.customer_name) {
    reasons.push('Nama pengirim berbeda / tidak dapat dibandingkan');
  }

  const breakdown = { amount: 60, time, name, account };
  return { score: 60 + time + name + account, breakdown, reasons };
}

export function createMatchingService({ db, settings, log, onMatched }) {
  async function bankSources(tx) {
    return tx.many('SELECT account_identifier, is_active FROM bank_sources WHERE account_identifier IS NOT NULL');
  }

  async function lockAmount(tx, amount) {
    // Serialisasi pencocokan untuk nominal yang sama: mencegah dua transaksi berebut satu order.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`match:${amount}`]);
  }

  async function candidateOrdersFor(tx, trx, s) {
    const t = trxTime(trx);
    const before = s['matching.window_before_minutes'];
    const grace = s['matching.grace_after_minutes'];
    const def = s['matching.default_window_minutes'];
    return tx.many(
      `SELECT * FROM pos_orders
       WHERE amount = $1 AND status = 'PENDING' AND payment_status = 'UNPAID' AND paid_transaction_id IS NULL
         AND order_created_at - make_interval(mins => $3) <= $2
         AND COALESCE(expires_at, order_created_at + make_interval(mins => $4)) + make_interval(mins => $5) >= $2
       ORDER BY order_created_at
       FOR UPDATE`,
      [trx.amount, t, before, def, grace],
    );
  }

  /** Transaksi lain (belum dipakai, belum diabaikan) yang juga cocok untuk order ini => konflik. */
  async function competingTransactions(tx, order, excludeTrxId, s) {
    const w = orderWindow(order, s);
    const rows = await tx.many(
      `SELECT id, transaction_code FROM incoming_transactions
       WHERE amount = $1 AND id <> $2 AND matched_order_id IS NULL
         AND match_status IN ('PENDING','UNMATCHED','AMBIGUOUS')
         AND COALESCE(transaction_time, received_time) BETWEEN $3 AND $4
         AND NOT EXISTS (SELECT 1 FROM payment_matches pm WHERE pm.transaction_id = incoming_transactions.id AND pm.order_id = $5 AND pm.status = 'REJECTED')`,
      [order.amount, excludeTrxId, w.toleranceStart, w.toleranceEnd, order.id],
    );
    return rows;
  }

  async function upsertCandidate(tx, trxId, orderId, c) {
    return tx.one(
      `INSERT INTO payment_matches (transaction_id, order_id, score, score_breakdown, reasons, status)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'CANDIDATE')
       ON CONFLICT (transaction_id, order_id) DO UPDATE
         SET score = EXCLUDED.score, score_breakdown = EXCLUDED.score_breakdown, reasons = EXCLUDED.reasons,
             status = 'CANDIDATE', updated_at = now()
         WHERE payment_matches.status IN ('CANDIDATE','SUPERSEDED')
       RETURNING *`,
      [trxId, orderId, c.score, JSON.stringify(c.breakdown), JSON.stringify(c.reasons)],
    );
  }

  /** Menandai transaksi dibayarkan ke order (dipakai matching otomatis & verifikasi manual). */
  async function settle(tx, trx, order, matchRow, { manual, user, note, req, s }) {
    const status = manual ? 'MANUAL_VERIFIED' : 'MATCHED';
    await tx.query(
      `UPDATE payment_matches SET status = $2, decided_by = $3, decided_at = now(), note = COALESCE($4, note), updated_at = now() WHERE id = $1`,
      [matchRow.id, status, user?.id ?? null, note ?? null],
    );
    await tx.query(
      `UPDATE payment_matches SET status = 'SUPERSEDED', updated_at = now()
       WHERE status = 'CANDIDATE' AND id <> $1 AND (transaction_id = $2 OR order_id = $3)`,
      [matchRow.id, trx.id, order.id],
    );
    await tx.query(
      `UPDATE incoming_transactions SET match_status = $2, matched_order_id = $3, match_score = $4, matched_at = now(),
         match_reason = $5, note = COALESCE($6, note), updated_at = now() WHERE id = $1`,
      [trx.id, status, order.id, matchRow.score, manual ? 'manual_verification' : 'single_candidate', note ?? null],
    );
    await tx.query(
      `UPDATE pos_orders SET status = 'PAID', payment_status = 'PAID', paid_transaction_id = $2, paid_at = $4,
         matched_by = $3, updated_at = now() WHERE id = $1`,
      [order.id, trx.id, manual ? 'MANUAL' : 'AUTO', trxTime(trx)],
    );
    // Transaksi lain yang tadinya ambigu karena order ini, dievaluasi ulang setelah commit.
    const touched = await tx.many(
      `SELECT DISTINCT transaction_id FROM payment_matches WHERE order_id = $1 AND transaction_id <> $2`,
      [order.id, trx.id],
    );
    const paidAt = trxTime(trx);
    await enqueuePaymentWebhook(tx, s, { order, trx, paidAt, matchType: manual ? 'manual' : 'auto' });
    await audit(tx, {
      actor: manual ? { type: 'user', id: user.id, label: user.email } : systemActor,
      action: manual ? 'match.manual_verify' : 'match.auto',
      entityType: 'transaction', entityId: trx.id,
      after: { order_id: order.order_id, transaction_code: trx.transaction_code, score: matchRow.score, status },
      note, req,
    });
    return touched.map((r) => r.transaction_id);
  }

  /**
   * Menjalankan pencocokan untuk satu transaksi. Aman dipanggil berulang (idempoten).
   * @returns {Promise<{status, order_id?, candidates?}>}
   */
  async function matchTransaction(transactionId) {
    const s = await settings.all();
    let followUps = [];
    const result = await db.tx(async (tx) => {
      const pre = await tx.one('SELECT amount FROM incoming_transactions WHERE id = $1', [transactionId]);
      if (!pre) return { status: 'NOT_FOUND' };
      await lockAmount(tx, pre.amount);
      const trx = await tx.one('SELECT * FROM incoming_transactions WHERE id = $1 FOR UPDATE', [transactionId]);
      if (!REMATCHABLE.includes(trx.match_status) || trx.matched_order_id) return { status: trx.match_status, skipped: true };

      const orders = await candidateOrdersFor(tx, trx, s);
      const rejected = new Set((await tx.many(
        `SELECT order_id FROM payment_matches WHERE transaction_id = $1 AND status = 'REJECTED'`, [trx.id],
      )).map((r) => r.order_id));
      const sources = await bankSources(tx);

      const candidates = [];
      for (const o of orders) {
        if (rejected.has(o.id)) continue;
        const c = scoreCandidate(trx, o, s, sources);
        if (c) candidates.push({ order: o, ...c });
      }

      const rows = [];
      for (const c of candidates) rows.push({ c, row: await upsertCandidate(tx, trx.id, c.order.id, c) });

      let status;
      let reason;
      if (candidates.length === 0) {
        status = trx.match_status === 'REJECTED' ? 'REJECTED' : 'UNMATCHED';
        reason = 'no_candidate';
      } else if (candidates.length > 1) {
        status = 'AMBIGUOUS';
        reason = 'multiple_candidates';
      } else {
        const only = rows[0];
        const competitors = await competingTransactions(tx, only.c.order, trx.id, s);
        if (competitors.length > 0) {
          status = 'AMBIGUOUS';
          reason = 'competing_transactions';
          // Transaksi pesaing juga ditandai ambigu agar admin memutuskan keduanya.
          for (const comp of competitors) {
            const compTrx = await tx.one('SELECT * FROM incoming_transactions WHERE id = $1 FOR UPDATE', [comp.id]);
            const cc = scoreCandidate(compTrx, only.c.order, s, sources);
            if (cc) await upsertCandidate(tx, compTrx.id, only.c.order.id, cc);
            await tx.query(
              `UPDATE incoming_transactions SET match_status = 'AMBIGUOUS', match_reason = 'competing_transactions', last_matched_at = now(), updated_at = now()
               WHERE id = $1 AND match_status IN ('PENDING','UNMATCHED')`,
              [comp.id],
            );
          }
        } else if (!s['matching.auto_match_enabled']) {
          status = 'AMBIGUOUS';
          reason = 'auto_match_disabled';
        } else if (only.c.score < s['matching.min_auto_score']) {
          status = 'AMBIGUOUS';
          reason = 'score_below_threshold';
        } else if (!only.row) {
          status = 'AMBIGUOUS';
          reason = 'candidate_locked';
        } else {
          followUps = await settle(tx, trx, only.c.order, only.row, { manual: false, s });
          return { status: 'MATCHED', order_id: only.c.order.order_id, score: only.c.score };
        }
      }

      await tx.query(
        `UPDATE incoming_transactions SET match_status = $2, match_reason = $3, match_score = $4,
           match_attempts = match_attempts + 1, last_matched_at = now(), updated_at = now() WHERE id = $1`,
        [trx.id, status, reason, candidates.length ? Math.max(...candidates.map((c) => c.score)) : null],
      );
      return { status, reason, candidates: candidates.map((c) => ({ order_id: c.order.order_id, score: c.score })) };
    });
    if (result.status === 'MATCHED') onMatched?.();
    for (const id of followUps) {
      // Kandidat yang kini sudah tidak relevan; evaluasi ulang dilakukan untuk status UNMATCHED/REJECTED saja.
      await refreshAfterOrderPaid(id).catch((err) => log?.warn({ err }, 'refresh after paid gagal'));
    }
    return result;
  }

  /** Transaksi AMBIGUOUS yang semua kandidatnya kini sudah dibayar/hilang dikembalikan ke UNMATCHED. */
  async function refreshAfterOrderPaid(transactionId) {
    await db.tx(async (tx) => {
      const trx = await tx.one('SELECT * FROM incoming_transactions WHERE id = $1 FOR UPDATE', [transactionId]);
      if (!trx || trx.match_status !== 'AMBIGUOUS') return;
      const open = await tx.one(
        `SELECT count(*) AS n FROM payment_matches pm JOIN pos_orders o ON o.id = pm.order_id
         WHERE pm.transaction_id = $1 AND pm.status = 'CANDIDATE' AND o.payment_status = 'UNPAID' AND o.status = 'PENDING'`,
        [transactionId],
      );
      if (open.n === 0) {
        await tx.query(
          `UPDATE incoming_transactions SET match_status = 'UNMATCHED', match_reason = 'candidates_settled', updated_at = now() WHERE id = $1`,
          [transactionId],
        );
      }
    });
  }

  /** Dipanggil saat order baru masuk: transaksi yang tiba lebih dulu dicocokkan ulang. */
  async function matchForOrder(order) {
    const s = await settings.all();
    const w = orderWindow(order, s);
    const trxs = await db.many(
      `SELECT id FROM incoming_transactions
       WHERE amount = $1 AND matched_order_id IS NULL AND match_status IN ('PENDING','UNMATCHED','REJECTED')
         AND COALESCE(transaction_time, received_time) BETWEEN $2 AND $3
       ORDER BY COALESCE(transaction_time, received_time)`,
      [order.amount, w.toleranceStart, w.toleranceEnd],
    );
    const results = [];
    for (const t of trxs) results.push(await matchTransaction(t.id));
    return results;
  }

  async function loadDecisionContext(tx, matchId) {
    // Urutan kunci sama dengan matchTransaction (advisory lock dulu) untuk menghindari deadlock.
    const pre = await tx.one(
      `SELECT t.amount FROM payment_matches pm JOIN incoming_transactions t ON t.id = pm.transaction_id WHERE pm.id = $1`,
      [matchId],
    );
    if (!pre) throw notFound('Kandidat pencocokan tidak ditemukan');
    await lockAmount(tx, pre.amount);
    const m = await tx.one('SELECT * FROM payment_matches WHERE id = $1 FOR UPDATE', [matchId]);
    const trx = await tx.one('SELECT * FROM incoming_transactions WHERE id = $1 FOR UPDATE', [m.transaction_id]);
    const order = await tx.one('SELECT * FROM pos_orders WHERE id = $1 FOR UPDATE', [m.order_id]);
    return { m, trx, order };
  }

  function assertAssignable(trx, order) {
    if (trx.matched_order_id || ['MATCHED', 'MANUAL_VERIFIED'].includes(trx.match_status)) {
      throw conflict('Transaksi sudah digunakan untuk order lain', { code: 'TRANSACTION_ALREADY_USED' });
    }
    if (trx.match_status === 'IGNORED') throw conflict('Transaksi sudah diabaikan');
    if (order.payment_status === 'PAID' || order.paid_transaction_id) {
      throw conflict('Order sudah dibayar', { code: 'ORDER_ALREADY_PAID' });
    }
    if (order.status === 'CANCELLED') throw conflict('Order sudah dibatalkan');
    if (Number(trx.amount) !== Number(order.amount)) throw badRequest('Nominal transaksi dan order tidak sama');
  }

  /** Admin memilih kandidat yang benar. */
  async function verify(matchId, user, note, req) {
    let followUps = [];
    const s = await settings.all();
    const out = await db.tx(async (tx) => {
      const { m, trx, order } = await loadDecisionContext(tx, matchId);
      if (m.status !== 'CANDIDATE' && m.status !== 'SUPERSEDED') throw conflict(`Kandidat berstatus ${m.status}`);
      assertAssignable(trx, order);
      // Order EXPIRED tetap boleh diverifikasi manual (transfer terlambat), dicatat di audit.
      followUps = await settle(tx, trx, order, m, { manual: true, user, note, req, s });
      return { transaction_id: trx.id, order_id: order.order_id, status: 'MANUAL_VERIFIED' };
    });
    onMatched?.();
    for (const id of followUps) await refreshAfterOrderPaid(id).catch(() => {});
    return out;
  }

  /** Admin menolak satu kandidat. */
  async function reject(matchId, user, note, req) {
    return db.tx(async (tx) => {
      const { m, trx } = await loadDecisionContext(tx, matchId);
      if (m.status !== 'CANDIDATE') throw conflict(`Kandidat berstatus ${m.status}, tidak dapat ditolak`);
      await tx.query(
        `UPDATE payment_matches SET status = 'REJECTED', decided_by = $2, decided_at = now(), note = $3, updated_at = now() WHERE id = $1`,
        [m.id, user.id, note ?? null],
      );
      const remaining = await tx.one(
        `SELECT count(*) AS n FROM payment_matches WHERE transaction_id = $1 AND status = 'CANDIDATE'`, [trx.id],
      );
      let newStatus = trx.match_status;
      if (remaining.n === 0 && !FINAL_MATCH_STATUSES.includes(trx.match_status)) newStatus = 'REJECTED';
      await tx.query(
        `UPDATE incoming_transactions SET match_status = $2, match_reason = CASE WHEN $2 = 'REJECTED' THEN 'candidates_rejected' ELSE match_reason END, updated_at = now() WHERE id = $1`,
        [trx.id, newStatus],
      );
      await audit(tx, { actor: { type: 'user', id: user.id, label: user.email }, action: 'match.reject', entityType: 'transaction', entityId: trx.id, after: { match_id: m.id, order_uuid: m.order_id, transaction_status: newStatus }, note, req });
      return { match_id: m.id, status: 'REJECTED', transaction_status: newStatus };
    });
  }

  /** Admin menautkan transaksi ke order yang bukan kandidat otomatis (mis. transfer terlambat). */
  async function assign(transactionId, orderRef, user, note, req) {
    let followUps = [];
    const s = await settings.all();
    const out = await db.tx(async (tx) => {
      const pre = await tx.one('SELECT amount FROM incoming_transactions WHERE id = $1', [transactionId]);
      if (!pre) throw notFound('Transaksi tidak ditemukan');
      await lockAmount(tx, pre.amount);
      const trx = await tx.one('SELECT * FROM incoming_transactions WHERE id = $1 FOR UPDATE', [transactionId]);
      const order = await tx.one('SELECT * FROM pos_orders WHERE order_id = $1 OR id::text = $1 FOR UPDATE', [orderRef]);
      if (!order) throw notFound('Order tidak ditemukan');
      assertAssignable(trx, order);
      const c = scoreCandidate(trx, order, s, await bankSources(tx)) ?? {
        score: 60, breakdown: { amount: 60, time: 0, name: 0, account: 0 }, reasons: ['Nominal sama', 'Ditautkan manual di luar rentang waktu'],
      };
      const m = await tx.one(
        `INSERT INTO payment_matches (transaction_id, order_id, score, score_breakdown, reasons, status)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'CANDIDATE')
         ON CONFLICT (transaction_id, order_id) DO UPDATE SET status = 'CANDIDATE', updated_at = now()
         RETURNING *`,
        [trx.id, order.id, c.score, JSON.stringify(c.breakdown), JSON.stringify(c.reasons)],
      );
      followUps = await settle(tx, trx, order, m, { manual: true, user, note, req, s });
      return { transaction_id: trx.id, order_id: order.order_id, status: 'MANUAL_VERIFIED' };
    });
    onMatched?.();
    for (const id of followUps) await refreshAfterOrderPaid(id).catch(() => {});
    return out;
  }

  async function ignore(transactionId, user, note, req) {
    return db.tx(async (tx) => {
      const trx = await tx.one('SELECT * FROM incoming_transactions WHERE id = $1 FOR UPDATE', [transactionId]);
      if (!trx) throw notFound('Transaksi tidak ditemukan');
      if (['MATCHED', 'MANUAL_VERIFIED'].includes(trx.match_status)) throw conflict('Transaksi sudah dipakai untuk pembayaran order');
      await tx.query(
        `UPDATE incoming_transactions SET match_status = 'IGNORED', match_reason = 'ignored_by_user', note = COALESCE($2, note), updated_at = now() WHERE id = $1`,
        [trx.id, note ?? null],
      );
      await tx.query(`UPDATE payment_matches SET status = 'SUPERSEDED', updated_at = now() WHERE transaction_id = $1 AND status = 'CANDIDATE'`, [trx.id]);
      await audit(tx, { actor: { type: 'user', id: user.id, label: user.email }, action: 'transaction.ignore', entityType: 'transaction', entityId: trx.id, before: { match_status: trx.match_status }, after: { match_status: 'IGNORED' }, note, req });
      return { transaction_id: trx.id, status: 'IGNORED' };
    });
  }

  /** Mengembalikan transaksi IGNORED/REJECTED ke antrean matching. */
  async function reopen(transactionId, user, note, req) {
    await db.tx(async (tx) => {
      const trx = await tx.one('SELECT * FROM incoming_transactions WHERE id = $1 FOR UPDATE', [transactionId]);
      if (!trx) throw notFound('Transaksi tidak ditemukan');
      if (['MATCHED', 'MANUAL_VERIFIED'].includes(trx.match_status)) throw conflict('Transaksi sudah dipakai untuk pembayaran order');
      await tx.query(`UPDATE incoming_transactions SET match_status = 'PENDING', match_reason = 'reopened', updated_at = now() WHERE id = $1`, [trx.id]);
      await audit(tx, { actor: { type: 'user', id: user.id, label: user.email }, action: 'transaction.reopen', entityType: 'transaction', entityId: trx.id, before: { match_status: trx.match_status }, note, req });
    });
    return matchTransaction(transactionId);
  }

  return { matchTransaction, matchForOrder, verify, reject, assign, ignore, reopen };
}
