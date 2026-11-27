// Job latar belakang di dalam proses API (cukup untuk 1 bisnis, 1 instance PM2).
// Jika menjalankan lebih dari satu instance, set JOBS_ENABLED=false pada instance tambahan.
import { runRetention } from '../services/retention.js';

export function startJobs(app) {
  const { db, settings, alerts, webhooks, orders, matching } = app.services;
  const log = app.log.child({ component: 'jobs' });
  const timers = [];
  const busy = new Set();

  function every(name, ms, fn, { runAtStart = true } = {}) {
    const run = async () => {
      if (busy.has(name)) return;
      busy.add(name);
      try {
        await fn();
      } catch (err) {
        log.error({ err, job: name }, 'job gagal');
      } finally {
        busy.delete(name);
      }
    };
    timers.push(setInterval(run, ms));
    if (runAtStart) setTimeout(run, 2000);
  }

  // Status perangkat & alert — dievaluasi tiap 30 detik (alert ≤ 5 menit setelah heartbeat kedaluwarsa).
  every('device-monitor', 30_000, () => alerts.evaluateAll());

  // Pengiriman & retry webhook.
  every('webhook-worker', 5_000, () => webhooks.processDue(20));

  // Order kedaluwarsa.
  every('order-expiry', 60_000, () => orders.expireDue());

  // Pemulihan: transaksi PENDING yang belum sempat dicocokkan (mis. proses restart).
  every('matching-recovery', 30_000, async () => {
    const rows = await db.many(
      `SELECT id FROM incoming_transactions WHERE match_status = 'PENDING' AND created_at < now() - interval '10 seconds' ORDER BY created_at LIMIT 50`,
    );
    for (const r of rows) await matching.matchTransaction(r.id);
  });

  // Retensi harian (cek tiap jam, jalan sekali per hari).
  let lastRetentionDay = null;
  every('retention', 60 * 60_000, async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day === lastRetentionDay) return;
    lastRetentionDay = day;
    await runRetention(db, settings, log);
  }, { runAtStart: false });

  return () => timers.forEach(clearInterval);
}
