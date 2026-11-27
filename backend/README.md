# Backend API — Bank Transfer Monitor

Node.js (≥ 20.12) + Fastify 5 + PostgreSQL (Supabase). Kontrak lengkap: [`../docs/API.md`](../docs/API.md).

## Menjalankan lokal tanpa Supabase

```bash
npm install
cp .env.development.example .env     # DB_DRIVER=pglite (PostgreSQL WASM, file di ./data/pglite) + AUTH_MODE=dev
npm run dev                          # http://localhost:4000  (migrasi otomatis untuk PGlite)
npm run seed:demo                    # di terminal lain: isi data demo lewat API
```

Login dashboard dev: email `admin@local.test`. Hanya satu proses yang boleh membuka folder PGlite; hapus `data/pglite` untuk database bersih.

## Menjalankan dengan Supabase

```bash
cp .env.example .env    # isi DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_ADMIN_EMAILS
npm run migrate
npm start
```

## Tes

```bash
npm test     # unit (status perangkat, skor matching, HMAC, CSV) + integrasi API end-to-end di PGlite
```

Tes integrasi mencakup Acceptance Criteria PRD §13 sisi server: registrasi & pencabutan token, anti-replay, heartbeat & histori, ACTIVE/WARNING/INACTIVE/PERMISSION_ERROR/UNKNOWN, alert heartbeat kedaluwarsa, transaksi tersimpan & tidak ganda saat retry, parsing error tidak membuat transaksi, filter/pagination/sorting/CSV, order POS idempoten, matching otomatis + webhook HMAC, AMBIGUOUS tanpa webhook, verifikasi/penolakan manual + audit log, transaksi/order tidak bisa dipakai dua kali, laporan, role admin/operator.

## Struktur

```
migrations/001_init.sql      skema (14 tabel, RLS aktif)
src/index.js                 entry (PM2)
src/app.js                   build Fastify + service
src/auth/                    Supabase JWT, device token, POS API key
src/services/
  deviceHealth.js            aturan status perangkat (fungsi murni)
  devices.js                 registrasi, heartbeat, event, config Android
  notifications.js           ingest notifikasi (idempoten)
  matching.js                matching engine + verifikasi manual
  webhooks.js                outbox, HMAC, retry
  alerts.js                  alert perangkat + Telegram
  orders.js, reports.js, retention.js, settings.js, audit.js
src/routes/                  android, pos, dashboard-*
src/jobs/scheduler.js        monitor perangkat (30 dtk), webhook (5 dtk), expiry, pemulihan matching, retensi harian
scripts/seed-demo.js         data demo via API
```

## Job latar

| Job | Interval | Fungsi |
|---|---|---|
| device-monitor | 30 dtk | hitung ulang status perangkat, buka/tutup alert, Telegram |
| webhook-worker | 5 dtk | kirim/ulang webhook `payment.matched` (backoff 30 dtk → 4 jam, maks 10x) |
| order-expiry | 60 dtk | order lewat batas + toleransi → `EXPIRED` |
| matching-recovery | 30 dtk | transaksi `PENDING` > 10 dtk dicocokkan ulang |
| retention | harian | hapus teks mentah/log lama sesuai Pengaturan > Retensi |
