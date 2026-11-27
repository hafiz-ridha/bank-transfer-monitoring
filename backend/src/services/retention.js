// Retensi data operasional (PRD §11). Audit log tidak pernah dihapus otomatis.
export async function runRetention(db, settings, log) {
  const s = await settings.all();
  const out = {};
  const days = (k) => s[k];

  out.raw_notifications_purged = (await db.query(
    `UPDATE notification_events SET title = NULL, text = NULL, big_text = NULL, raw_purged_at = now()
     WHERE raw_purged_at IS NULL AND server_received_at < now() - make_interval(days => $1)`,
    [days('retention.raw_notification_days')],
  )).rowCount;

  out.webhook_logs_deleted = (await db.query(
    `DELETE FROM webhook_deliveries WHERE status IN ('DELIVERED','DEAD') AND created_at < now() - make_interval(days => $1)`,
    [days('retention.webhook_log_days')],
  )).rowCount;

  out.heartbeats_deleted = (await db.query(
    `DELETE FROM device_heartbeats WHERE received_at < now() - make_interval(days => $1)`,
    [days('retention.heartbeat_days')],
  )).rowCount;

  out.device_events_deleted = (await db.query(
    `DELETE FROM device_events WHERE occurred_at < now() - make_interval(days => $1)`,
    [days('retention.device_event_days')],
  )).rowCount;

  out.alerts_deleted = (await db.query(
    `DELETE FROM alerts WHERE status = 'RESOLVED' AND resolved_at < now() - make_interval(days => $1)`,
    [days('retention.device_event_days')],
  )).rowCount;

  if (s['retention.purge_transactions_enabled']) {
    // Hanya dijalankan bila diaktifkan admin — pastikan arsip pembukuan sudah dibuat (export/backup).
    const d = days('retention.transaction_days');
    await db.tx(async (tx) => {
      out.matches_deleted = (await tx.query(
        `DELETE FROM payment_matches WHERE created_at < now() - make_interval(days => $1)`, [d],
      )).rowCount;
      out.transactions_deleted = (await tx.query(
        `DELETE FROM incoming_transactions WHERE received_time < now() - make_interval(days => $1)`, [d],
      )).rowCount;
      out.orders_deleted = (await tx.query(
        `DELETE FROM pos_orders WHERE order_created_at < now() - make_interval(days => $1) AND status <> 'PENDING'`, [d],
      )).rowCount;
      out.notifications_deleted = (await tx.query(
        `DELETE FROM notification_events WHERE server_received_at < now() - make_interval(days => $1)`, [d],
      )).rowCount;
    });
  }
  log?.info(out, 'retensi selesai');
  return out;
}
