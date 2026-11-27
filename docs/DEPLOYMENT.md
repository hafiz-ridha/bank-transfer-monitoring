# Panduan Deploy — VPS HestiaCP + PM2 + Supabase

> Memakai **aaPanel**? Gunakan installer container: [`deploy/aapanel/README.md`](../deploy/aapanel/README.md). Bagian Supabase (§1), setup awal aplikasi (§6), dan backup (§7) di bawah tetap berlaku.

Arsitektur produksi: **satu proses backend menyajikan API dan web dashboard di satu domain**.

```
Android (HTTPS) ─┐
POS (HTTPS) ─────┼─> Nginx (HestiaCP, SSL Let's Encrypt) ─> btm.contoh.co.id -> PM2: btm-backend (127.0.0.1:4000)
Browser admin ───┘                                            /          -> dashboard (static export web/out)
                                                              /api/v1/*  -> API
                                       btm-backend ──(pg, TLS)──> Supabase PostgreSQL
                                       browser / btm-backend ──> Supabase Auth
```

## 1. Supabase

1. Buat project (region terdekat, mis. Singapore).
2. **Database > Connection string**: pakai *Session pooler* (port 5432) atau *Direct connection*.
   Jangan pakai *Transaction pooler* (6543): backend memakai transaksi multi-statement, advisory lock, dan `SELECT … FOR UPDATE`.
3. **Authentication**:
   - Matikan *Allow new users to sign up* (akun dibuat admin dari dashboard).
   - *URL Configuration*: Site URL = `https://btm.contoh.co.id`, Redirect URLs tambahkan `https://btm.contoh.co.id/reset-password`.
   - Atur SMTP sendiri bila ingin undangan/reset password via email lebih andal.
4. Catat: `SUPABASE_URL`, `anon key` / publishable key (`SUPABASE_ANON_KEY`, dikirim ke browser untuk form login), `service_role key` (HANYA backend), connection string.
5. RLS: migrasi mengaktifkan RLS di semua tabel tanpa policy → data tidak bisa diakses via anon/authenticated key (PostgREST). Semua akses lewat backend.

## 2. Persiapan VPS

```bash
# Node.js 20 LTS / 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
sudo apt install -y postgresql-client gnupg rclone   # untuk backup
```

Buat user khusus (mis. `btm`) dan salin repo ke `/opt/btm`.

## 3. Backend

```bash
cd /opt/btm/backend
npm ci --omit=dev
cp .env.example .env && nano .env      # isi DATABASE_URL, SUPABASE_* (termasuk SUPABASE_ANON_KEY), DASHBOARD_URL, BOOTSTRAP_ADMIN_EMAILS
chmod 600 .env
npm run migrate                         # membuat semua tabel
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup                 # jalankan perintah yang dicetak pm2 startup
curl http://127.0.0.1:4000/readyz       # {"ok":true,"db":"pg"}
```

Catatan:
- Jalankan **satu** instance (`instances: 1`) — job monitor perangkat, webhook, expiry order, retensi berjalan di proses yang sama. Jika menambah instance, set `JOBS_ENABLED=false` di instance tambahan.
- Update aplikasi: `git pull && npm ci --omit=dev && npm run migrate && (cd ../web && npm ci && npm run build) && pm2 reload btm-backend`.

## 4. Web Dashboard (disajikan backend)

Dashboard di-build sebagai file statis (`web/out`). Backend otomatis menyajikannya di domain yang sama, jadi tidak perlu proses PM2 kedua. Nilai `NEXT_PUBLIC_*` juga tidak perlu diisi, karena URL Supabase dan anon key dibaca saat runtime dari `.env` backend lewat `/app-config.js`.

```bash
cd /opt/btm/web
npm ci && npm run build          # menghasilkan web/out
pm2 reload btm-backend           # log: "web dashboard disajikan dari backend"
```

Kalau folder dashboard ada di lokasi lain, isi `WEB_DIST_DIR=/path/ke/out` di `.env` backend. `WEB_DIST_DIR=` (kosong) berarti API saja.

## 5. Nginx di HestiaCP

1. HestiaCP > Web > Add domain `btm.contoh.co.id`, aktifkan SSL (Let's Encrypt) + *force HTTPS*.
2. Gunakan template proxy. Cara paling mudah: buat template kustom `/usr/local/hestia/data/templates/web/nginx/btm-api.tpl` dan `.stpl` berisi:

```nginx
# btm-api.stpl (bagian location; salin struktur dari template default.stpl untuk blok server/ssl)
location / {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    client_max_body_size 2m;
}
```

   Pilih template tersebut di pengaturan domain (*Proxy Template*). Dashboard dan API memakai proxy yang sama.
3. Backend sudah `TRUST_PROXY=true` agar IP klien (rate limit, audit log) benar.

## 6. Setup awal aplikasi

1. Login dashboard dengan email yang ada di `BOOTSTRAP_ADMIN_EMAILS` (buat user itu dulu di Supabase > Authentication > Add user) → otomatis menjadi admin.
2. **Sumber Bank**: tambah tiap aplikasi bank + alias rekening (cek package name di HP: Pengaturan > Aplikasi, atau `adb shell pm list packages | grep -i bank`).
3. **Perangkat**: Tambah perangkat → kode pairing 8 karakter (berlaku 24 jam) → masukkan di aplikasi Android bersama URL `https://btm.contoh.co.id`.
4. **Pengaturan > API**: buat API key untuk POS (ditampilkan sekali).
5. **Pengaturan > Webhook**: isi URL webhook POS, *Rotate secret* (berikan ke tim POS), aktifkan, *Kirim tes*.
6. **Pengaturan > Alert** (opsional Telegram): isi `TELEGRAM_BOT_TOKEN` di `.env` backend, lalu chat ID & aktifkan di dashboard.
7. Tambah user operator di menu **Pengguna**.

## 7. Backup & restore (PRD §11)

```bash
sudo mkdir -p /etc/btm && sudo cp /opt/btm/ops/backup/backup.env.example /etc/btm/backup.env && sudo chmod 600 /etc/btm/backup.env
# Buat keypair GPG di laptop admin (bukan di VPS), import PUBLIC key saja ke VPS:
gpg --import btm-backup-public.asc
rclone config                      # remote di luar VPS (B2/S3/Drive)
sudo crontab -e
#  15 2 * * *  /opt/btm/ops/backup/backup.sh       >> /var/log/btm-backup.log 2>&1
#  30 3 1 * *  /opt/btm/ops/backup/restore-test.sh >> /var/log/btm-restore-test.log 2>&1
```

- Harian 7, mingguan 4, bulanan 12; terenkripsi GPG; disalin ke luar VPS via rclone; notifikasi Telegram/healthcheck bila gagal.
- `restore-test.sh` butuh PostgreSQL lokal & **private key** GPG — idealnya dijalankan di mesin terpisah/laptop admin setiap bulan.
- Supabase Pro juga menyediakan backup harian sendiri; backup ini adalah salinan independen.

## 8. Monitoring server

- `pm2 monit`, `pm2 logs btm-backend`. Pasang `pm2 install pm2-logrotate`.
- Pantau `https://btm.contoh.co.id/readyz` dengan uptime monitor eksternal (UptimeRobot/healthchecks).
- Alert perangkat Android berjalan di backend (dashboard + Telegram); jika backend mati, alert tidak terkirim — karena itu pantau `/readyz` dari luar.

## 9. Checklist keamanan produksi

- [ ] `NODE_ENV=production`, `AUTH_MODE=supabase` (backend menolak start dengan mode dev/PGlite di produksi).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` & `DATABASE_URL` hanya di `.env` backend (chmod 600), tidak pernah di web/Android (`/app-config.js` hanya berisi URL Supabase + anon key).
- [ ] Sign-up publik Supabase dimatikan.
- [ ] HTTPS wajib (Android release hanya mengizinkan HTTPS).
- [ ] `DASHBOARD_URL` & `CORS_ORIGINS` = domain publik (dashboard dan API satu origin).
- [ ] Webhook secret dirotasi & disimpan di POS; POS memverifikasi signature + timestamp.
- [ ] Firewall: hanya 22/80/443 terbuka; port 4000 hanya 127.0.0.1.
- [ ] Backup harian berjalan & tes restore bulanan tercatat.
