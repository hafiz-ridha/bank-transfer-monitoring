# Bank Transfer Monitoring System

Implementasi MVP dari [PRD v1.1](PRD_Bank_Transfer_Monitoring_System_v1.1.md): deteksi transfer masuk dari notifikasi aplikasi mobile banking di Android, histori transaksi, pencocokan otomatis dengan order POS, verifikasi manual, webhook ke POS, dan monitoring kesehatan perangkat dari web.

```
android/   Android Monitoring App — Kotlin, Jetpack Compose, NotificationListenerService, Room, WorkManager
backend/   Backend API — Node.js, Fastify 5, PostgreSQL (Supabase), matching engine, webhook HMAC, job monitor perangkat
web/       Web Dashboard — Next.js + React, Supabase Auth
docs/      API.md (kontrak API), DEPLOYMENT.md (VPS HestiaCP + PM2), DECISIONS.md (default §19 & keputusan teknis)
deploy/    aapanel/ — installer backend sebagai container Docker di aaPanel
ops/       backup/ — backup terenkripsi harian + tes restore bulanan
.github/   workflows — build APK Android & image Docker backend (GHCR) otomatis
```

## Deploy

- **aaPanel (Docker)**: `sudo bash deploy/aapanel/install.sh` — lihat [deploy/aapanel/README.md](deploy/aapanel/README.md).
- **HestiaCP / VPS biasa (PM2)**: lihat [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **APK Android**: dibangun GitHub Actions setiap push ke `main` (tab *Actions* > *Android APK* > artifact). Tag `v1.0.0` membuat GitHub Release berisi APK. APK release bertanda tangan dibuat bila secret `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` diisi.

## Mulai cepat (lokal, tanpa Supabase)

```powershell
cd backend; npm install; Copy-Item .env.development.example .env; npm run dev
```

```powershell
cd backend; npm run seed:demo
```

```powershell
cd web; npm install; Copy-Item .env.example .env.local; npm run dev
```

Buka http://localhost:3000, login mode dev sebagai `admin@local.test`. Detail: [backend/README.md](backend/README.md), [web/README.md](web/README.md), [android/README.md](android/README.md).

## Status terhadap Acceptance Criteria (PRD §13)

Legenda: **T** = tercakup tes otomatis backend (`npm test`), **I** = diimplementasikan, wajib diuji di HP fisik (PRD §15), **U** = diverifikasi lewat UI dashboard.

| Kriteria | Status | Lokasi |
|---|---|---|
| NotificationListenerService membaca notifikasi bank yang diizinkan | I | `android/` listener + filter package dari config server |
| Monitoring tetap berjalan saat halaman aplikasi ditutup / layar mati | I | listener independen dari Activity; uji PRD §15 |
| Event disimpan ke Room & dikirim otomatis, dikirim ulang saat internet pulih | I | antrean Room + WorkManager + network callback |
| Tidak ada transaksi ganda akibat retry | T + I | `event_id`, `dedupe_key`, referensi unik (`api.test.js`) |
| Deteksi Notification Access dicabut, laporan status listener, heartbeat | T + I | heartbeat → `PERMISSION_ERROR`, event `PERMISSION_LOST` |
| Antrean transaksi & panduan battery optimization di aplikasi | I | layar Antrean Sinkronisasi & panduan per merek |
| Dashboard ACTIVE / WARNING / INACTIVE / PERMISSION ERROR / UNKNOWN | T + U | `deviceHealth.js` (unit test) + halaman Perangkat |
| Dashboard: status listener, Notification Access, last heartbeat/notification/sync, pending queue | U | halaman Perangkat & detail perangkat |
| Histori heartbeat tersimpan | T | tabel `device_heartbeats` |
| Peringatan saat perangkat tidak aktif (≤ 5 menit setelah kedaluwarsa) | T | job `device-monitor` tiap 30 dtk + tabel `alerts` (+ Telegram opsional) |
| Transaksi tersimpan, dapat dicari & difilter, status matching terlihat | T + U | `/transactions` + export CSV |
| Transaksi ambigu dapat diverifikasi | T + U | `/matches/:id/verify`, halaman detail transaksi |
| POS dapat mengirim order, matching engine berjalan | T | `/pos/orders`, `matching.js` |
| Webhook dikirim saat pembayaran valid, tidak untuk transaksi ambigu | T | outbox + HMAC-SHA256, retry & DEAD (`webhook.test.js`) |
| Transaksi tidak dapat dipakai dua kali | T | unique index + advisory lock + `FOR UPDATE` |
| Backup & restore | I | `ops/backup/` (jalankan & catat tes restore bulanan di VPS) |

## Yang masih perlu dilakukan sebelum produksi

1. **Validasi parser dengan notifikasi asli** dari setiap aplikasi bank di HP target (PRD §19 #1) — format di parser saat ini adalah perkiraan dan sengaja konservatif (format tak dikenal → parsing error, bukan transaksi).
2. **Build & uji aplikasi Android di HP fisik** sesuai checklist PRD §15 (`android/README.md`).
3. Buat project Supabase, deploy ke VPS (lihat [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)), jalankan backup harian & tes restore pertama.
4. Tetapkan keputusan PRD §19 yang masih terbuka — default sementara ada di [docs/DECISIONS.md](docs/DECISIONS.md).
