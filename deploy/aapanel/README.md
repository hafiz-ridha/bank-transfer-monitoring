# Installer aaPanel (Docker): API + Dashboard dalam satu container

Menjalankan Bank Transfer Monitor sebagai **satu container Docker** (`btm-backend`) di server aaPanel. Container ini berisi backend API sekaligus web dashboard, dan berjalan di belakang reverse proxy HTTPS milik aaPanel. Cukup **satu domain** dan **satu reverse proxy**:

| URL | Isi |
|---|---|
| `https://btm.domainanda.com/` | Web dashboard (login, perangkat, transaksi, laporan, …) |
| `https://btm.domainanda.com/api/v1/…` | API untuk aplikasi Android, sistem POS, dan dashboard |
| `https://btm.domainanda.com/readyz` | Health check |

```
Browser admin ─┐
Android ───────┼─HTTPS─> aaPanel Website (Nginx + SSL) ─> 127.0.0.1:4000 ─> container btm-backend (API + dashboard)
POS ───────────┘                                                              │
                                     Supabase PostgreSQL + Auth  <────────────┘  (atau container btm-postgres)
```

Dashboard dan API berada di origin yang sama, jadi tidak ada konfigurasi CORS atau URL API terpisah. Konfigurasi dashboard (URL Supabase, anon key) dibaca saat runtime dari `.env`. Kalau domain atau kunci diganti, dashboard tidak perlu di-build ulang.

## Prasyarat

1. aaPanel terpasang (Ubuntu/Debian/CentOS) dengan akses SSH root.
2. **aaPanel > App Store > Docker** terpasang (menyertakan Docker Compose v2).
3. Project Supabase (lihat `docs/DEPLOYMENT.md` §1). Yang dibutuhkan: connection string *Session pooler* (port 5432), `SUPABASE_URL`, `service_role` / secret key, dan `anon` / publishable key.
4. Satu domain atau subdomain yang mengarah ke IP server, mis. `btm.domainanda.com`.
5. Build di server butuh RAM sekitar 2 GB, karena dashboard ikut di-build. Kalau RAM kurang, tambahkan swap atau pakai `--image` (lihat di bawah).

## Instalasi

Lewat SSH (atau aaPanel > Terminal):

```bash
mkdir -p /www/dk_project && cd /www/dk_project
git clone https://github.com/hafiz-ridha/bank-transfer-monitoring.git
cd bank-transfer-monitoring/deploy/aapanel
sudo bash install.sh
```

Repository ini privat, jadi `git clone` akan meminta username GitHub dan **Personal Access Token** (bukan password).

Installer akan menanyakan:

| Pertanyaan | Keterangan |
|---|---|
| Database 1/2 | **1 = Supabase** (disarankan, sesuai PRD). **2** = PostgreSQL 16 di container `btm-postgres`, dengan password dibuat otomatis dan data di volume `btm-pgdata`. Login dashboard tetap memakai Supabase Auth. |
| `DATABASE_URL` | Connection string Supabase (input disembunyikan). Ganti `[YOUR-PASSWORD]`. Port 6543 (transaction pooler) tidak didukung. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Untuk verifikasi login dan manajemen user. Service role key hanya disimpan di server dan **tidak** pernah dikirim ke browser. |
| `SUPABASE_ANON_KEY` | Anon / publishable key untuk form login dashboard di browser. |
| Email admin pertama | Otomatis menjadi admin saat login pertama ke dashboard. |
| URL publik | Domain dashboard + API, mis. `https://btm.domainanda.com`, tanpa `/` di akhir. |
| Port container | Default 4000, hanya terbuka di `127.0.0.1`. |
| Token bot Telegram | Opsional, untuk alert perangkat offline. |

Hasilnya:
- `deploy/aapanel/.env` (chmod 600) berisi semua konfigurasi dan rahasia. Jangan di-commit.
- Image dibangun dari root repo (`Dockerfile`, berisi dashboard + backend).
- Container `btm-backend` jalan dengan `restart: unless-stopped`, dan migrasi database berjalan otomatis saat start.
- Installer menunggu `/readyz` sehat dan memastikan halaman `/login` tersedia.

Opsi lain:
- `sudo bash install.sh --reconfigure`: ubah semua konfigurasi.
- `sudo bash install.sh --image`: pakai image siap pakai `ghcr.io/hafiz-ridha/bank-transfer-monitoring-backend:latest` yang dibangun GitHub Actions, tanpa build di server. Karena package GHCR privat, login dulu: `echo <PAT read:packages> | docker login ghcr.io -u hafiz-ridha --password-stdin`.
- Non-interaktif (otomasi): `BTM_NONINTERACTIVE=1 DB_CHOICE=1 DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... BOOTSTRAP_ADMIN_EMAILS=... PUBLIC_URL=https://btm.domainanda.com bash install.sh`

### Upgrade dari versi lama (API saja)

```bash
cd /www/dk_project/bank-transfer-monitoring && git pull
cd deploy/aapanel && sudo bash install.sh
```

Konfigurasi yang ada tetap dipakai. Installer hanya menanyakan nilai yang belum ada (`SUPABASE_ANON_KEY` dan URL publik), lalu mem-build ulang container.

Kalau sebelumnya kamu memakai dua subdomain (`api.` dan `dashboard.`), satu saja sudah cukup: dashboard sekarang tampil di domain API. Isi URL publik dengan domain yang di-reverse proxy ke container.

## Reverse proxy & SSL di aaPanel

1. **Website > Add site**: isi domain `btm.domainanda.com`, PHP: *Pure static* (tidak perlu database/FTP).
2. Buka pengaturan site → **Reverse proxy** → *Add reverse proxy*: nama `btm`, **Target URL `http://127.0.0.1:4000`**, *Send Domain* `$host`.
3. **SSL** → Let's Encrypt → aktifkan **Force HTTPS**.
4. **Supabase > Authentication > URL Configuration**:
   - *Site URL*: `https://btm.domainanda.com`
   - *Redirect URLs*: `https://btm.domainanda.com/reset-password`

   Ini dibutuhkan untuk link lupa password dan undangan user.
5. Cek hasilnya:
   - `https://btm.domainanda.com` menampilkan halaman login.
   - `https://btm.domainanda.com/readyz` menjawab `{"ok":true,"db":"pg"}`.
6. Di aplikasi Android dan sistem POS, isi URL server `https://btm.domainanda.com`.

Jangan membuka port 4000/5433 di firewall aaPanel. Keduanya hanya mendengarkan di `127.0.0.1`.

## Ganti domain

1. Arahkan domain baru di aaPanel (Website + reverse proxy + SSL seperti di atas).
2. Edit `deploy/aapanel/.env`:
   ```
   DASHBOARD_URL='https://domain-baru.com'
   CORS_ORIGINS='https://domain-baru.com'
   ```
3. Buat ulang container dengan `docker compose up -d --force-recreate backend`. `restart` saja tidak membaca ulang `.env`.
4. Perbarui *URL Configuration* di Supabase, lalu lakukan pairing ulang di aplikasi Android dengan URL baru.

## Operasional

| Kebutuhan | Perintah (dari `deploy/aapanel`) |
|---|---|
| Status | `docker compose ps` (atau aaPanel > Docker > Containers) |
| Log | `docker compose logs -f backend` |
| Restart | `docker compose restart backend` |
| Terapkan perubahan `.env` | `docker compose up -d --force-recreate backend` |
| Update versi | `sudo bash update.sh` (git pull + build + restart, menunggu `/readyz`) |
| Berhenti | `docker compose down` (data Supabase/volume tetap aman) |

**Backup** (PRD §11): gunakan `ops/backup/backup.sh` di host.
- Mode Supabase: `DATABASE_URL` sama dengan di `.env`.
- Mode PostgreSQL lokal: `DATABASE_URL=postgresql://btm:<POSTGRES_PASSWORD>@127.0.0.1:5433/btm` (password ada di `.env`). Pasang `postgresql-client` versi 16 di host.

## Pemecahan masalah

| Gejala | Penyebab umum |
|---|---|
| `/readyz` 503 atau container restart terus | `DATABASE_URL` salah, password belum di-URL-encode, atau memakai port 6543. Cek `docker compose logs backend`. |
| `SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib` | Nilai kosong di `.env` → `install.sh --reconfigure`. |
| Login: "Konfigurasi Supabase belum lengkap" | `SUPABASE_ANON_KEY` kosong di `.env` → isi, lalu `docker compose up -d --force-recreate backend`. |
| Link reset password / undangan ditolak | *Redirect URLs* di Supabase belum berisi `https://domain/reset-password`, atau `DASHBOARD_URL` di `.env` salah. |
| Domain menampilkan JSON `{"service":"Bank Transfer Monitor API",...}` | Image lama tanpa dashboard → `sudo bash update.sh`. |
| Build gagal / server hang saat build | RAM kurang untuk build dashboard → tambah swap, atau `sudo bash install.sh --image`. |
| Android: `CLOCK_SKEW` | Jam HP tidak diatur otomatis. Aktifkan tanggal & waktu otomatis. |
| 502 Bad Gateway di domain | Container belum jalan, atau port target reverse proxy berbeda dengan `BTM_PORT`. |
