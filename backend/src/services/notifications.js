// Penerimaan notifikasi dari Android (PRD §3.7, §3.8). Penerimaan cepat & idempoten;
// matching dijalankan terpisah setelah commit agar penerimaan tidak terhambat (PRD §12 Performance).
import { accountMatches, toDate, truncate } from '../lib/util.js';

const MAX_AMOUNT = 1e13;

function pickSource(sources, parsed) {
  const active = sources.filter((s) => s.is_active);
  if (!active.length) return null;
  if (parsed?.recipient_account) {
    const byAccount = active.find((s) => s.account_identifier && accountMatches(s.account_identifier, parsed.recipient_account));
    if (byAccount) return byAccount;
  }
  return active.find((s) => s.is_default) ?? active[0];
}

/** Validasi ulang di server: transaksi hanya dibuat bila hasil parsing lengkap & masuk akal. */
export function validateParsed(ev) {
  if (ev.parse_status !== 'PARSED' || ev.classification !== 'INCOMING_TRANSFER') return { ok: false, reason: null };
  const p = ev.parsed ?? {};
  if (!Number.isInteger(p.amount) || p.amount <= 0 || p.amount >= MAX_AMOUNT) {
    return { ok: false, reason: 'Nominal hasil parsing tidak valid' };
  }
  if (p.transaction_time && Number.isNaN(new Date(p.transaction_time).getTime())) {
    return { ok: false, reason: 'Waktu transaksi hasil parsing tidak valid' };
  }
  return { ok: true };
}

export function createNotificationService({ db, log, onNewTransaction }) {
  async function ingestOne(device, ev) {
    const result = await db.tx(async (tx) => {
      const sources = await tx.many('SELECT * FROM bank_sources WHERE package_name = $1', [ev.package_name]);
      const source = pickSource(sources, ev.parsed);

      let parseStatus = ev.parse_status;
      let classification = ev.classification;
      let parseError = ev.parse_error ?? null;
      const check = validateParsed(ev);
      if (!source) {
        // Hanya notifikasi dari sumber bank yang dipilih & aktif yang diproses.
        parseStatus = 'IGNORED';
        parseError = sources.length ? 'Sumber bank nonaktif' : 'Package belum terdaftar sebagai sumber bank';
      } else if (ev.parse_status === 'PARSED' && ev.classification === 'INCOMING_TRANSFER' && !check.ok) {
        parseStatus = 'ERROR';
        parseError = check.reason;
      }

      const receivedTime = toDate(ev.received_at) ?? toDate(ev.posted_at) ?? new Date();
      const inserted = await tx.one(
        `INSERT INTO notification_events (event_id, device_id, bank_source_id, package_name, notification_key, dedupe_key,
           title, text, big_text, posted_at, device_received_at, classification, parse_status, parser_key, parser_version, parse_error, parsed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          ev.event_id, device.id, source?.id ?? null, ev.package_name, ev.notification_key ?? null, ev.dedupe_key ?? null,
          truncate(ev.title, 500) ?? null, truncate(ev.text, 4000) ?? null, truncate(ev.big_text, 4000) ?? null,
          toDate(ev.posted_at), receivedTime, classification, parseStatus, ev.parser_key ?? null, ev.parser_version ?? null,
          truncate(parseError, 1000), ev.parsed ? JSON.stringify(ev.parsed) : null,
        ],
      );

      if (!inserted) {
        const existing = await tx.one(
          `SELECT ne.event_id, ne.transaction_id, it.transaction_code FROM notification_events ne
           LEFT JOIN incoming_transactions it ON it.id = ne.transaction_id
           WHERE ne.event_id = $1 OR (ne.device_id = $2 AND ne.dedupe_key = $3) LIMIT 1`,
          [ev.event_id, device.id, ev.dedupe_key ?? null],
        );
        await tx.query('UPDATE devices SET last_successful_sync_at = now(), last_seen_at = now() WHERE id = $1', [device.id]);
        return { event_id: ev.event_id, status: 'duplicate', transaction_id: existing?.transaction_id ?? null, transaction_code: existing?.transaction_code ?? null };
      }

      await tx.query(
        `UPDATE devices SET last_successful_sync_at = now(), last_seen_at = now(),
           last_notification_at = GREATEST(last_notification_at, $2) WHERE id = $1`,
        [device.id, receivedTime],
      );
      if (source) {
        await tx.query(
          `UPDATE bank_sources SET last_notification_at = GREATEST(last_notification_at, $2),
             parser_version = COALESCE($3, parser_version),
             last_parse_error_at = CASE WHEN $4 THEN now() ELSE last_parse_error_at END,
             last_parse_error = CASE WHEN $4 THEN $5 ELSE last_parse_error END,
             updated_at = now()
           WHERE id = $1`,
          [source.id, receivedTime, ev.parser_version ?? null, parseStatus === 'ERROR', truncate(parseError, 500)],
        );
      }

      if (parseStatus !== 'PARSED' || classification !== 'INCOMING_TRANSFER' || !source) {
        return { event_id: ev.event_id, status: 'accepted', transaction_id: null, parse_status: parseStatus };
      }

      const p = ev.parsed;
      const trx = await tx.one(
        `INSERT INTO incoming_transactions (notification_event_id, device_id, bank_source_id, bank_code, account_alias, sender_name,
           amount, transaction_time, received_time, reference_number, recipient_account, notification_type, parser_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT DO NOTHING
         RETURNING id, transaction_code`,
        [
          inserted.id, device.id, source.id, p.bank_code || source.bank_code, source.account_alias, truncate(p.sender_name, 200) ?? null,
          p.amount, toDate(p.transaction_time), receivedTime, p.reference_number?.trim() || null, p.recipient_account ?? null,
          p.notification_type ?? 'INCOMING_TRANSFER', ev.parser_version ?? null,
        ],
      );
      if (!trx) {
        // Nomor referensi sama sudah tercatat (mis. notifikasi ganda dari dua aplikasi bank untuk rekening yang sama).
        const dup = await tx.one(
          `SELECT id, transaction_code FROM incoming_transactions WHERE bank_code = $1 AND reference_number = $2`,
          [p.bank_code || source.bank_code, p.reference_number?.trim() || null],
        );
        await tx.query(
          `UPDATE notification_events SET transaction_id = $2, parse_error = 'Duplikat nomor referensi' WHERE id = $1`,
          [inserted.id, dup?.id ?? null],
        );
        return { event_id: ev.event_id, status: 'duplicate', transaction_id: dup?.id ?? null, transaction_code: dup?.transaction_code ?? null };
      }
      await tx.query('UPDATE notification_events SET transaction_id = $2 WHERE id = $1', [inserted.id, trx.id]);
      return { event_id: ev.event_id, status: 'accepted', transaction_id: trx.id, transaction_code: trx.transaction_code, created: true };
    });

    if (result.created) {
      // Matching asinkron; jika proses mati sebelum ini berjalan, job pemulihan mengambil transaksi PENDING.
      setImmediate(() => onNewTransaction?.(result.transaction_id));
      delete result.created;
    }
    return result;
  }

  async function ingestBatch(device, events) {
    const results = [];
    for (const ev of events) {
      try {
        results.push(await ingestOne(device, ev));
      } catch (err) {
        log?.error({ err, event_id: ev.event_id }, 'gagal menyimpan notifikasi');
        results.push({ event_id: ev.event_id, status: 'rejected', error: 'Gagal diproses server, kirim ulang nanti', retryable: true });
      }
    }
    return results;
  }

  return { ingestOne, ingestBatch };
}
