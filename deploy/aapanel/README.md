# Installer Backend untuk aaPanel (Docker)

Menjalankan backend Bank Transfer Monitor sebagai container Docker di server aaPanel, di belakang reverse proxy HTTPS milik aaPanel.

```
Android / POS / Dashboard ──HTTPS──> aaPanel Website (Nginx + SSL) ──> 127.0.0.1:4000 ──> container btm-backend
                                                                                           │
                                                   Supabase PostgreSQL + Auth  <───────────┘  (atau container btm-postgres)
```

## Prasyarat

1. aaPanel terpasang (Ubuntu/Debian/CentOS) dengan akses SSH root.
2. **aaPanel > App Store > Docker** terpasang (menyertakan Docker Compose v2).
3. Project Supabase (lihat `docs/DEPLOYMENT.md` §1): connection string *Session pooler* (port 5432), `SUPABASE_URL`, `service_role key`.
4. Dua subdomain mengarah ke IP server, mis. `api.domainanda.com` (backend) dan `dashboard.domainanda.com` (web).

## Instalasi

Lewat SSH (atau aaPanel > Terminal):

```bash
mkdir -p /www/dk_project && cd /www/dk_project
git clone https://github.com/hafiz-ridha/bank-transfer-monitoring.git
cd bank-transfer-monitoring/deploy/aapanel
sudo bash install.sh
```

Repository privat: `git clone` akan meminta username GitHub dan **Personal Access Token** (bukan password).

Installer akan menanyakan:

| Pertanyaan | Keterangan |
|---|---|
| Database 1/2 | **1 = Supabase** (disarankan, sesuai PRD). 2 = PostgreSQL 16 di container `btm-postgres` (password dibuat otomatis, data di volume `btm-pgdata`). Login dashboard tetap memakai Supabase Auth. |
| `DATABASE_URL` | Connection string Supabase (input disembunyikan). Port 6543 / transaction pooler tidak didukung. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Untuk verifikasi login dashboard & manajemen user. Service role key hanya disimpan di server ini. |
| Email admin pertama | Otomatis menjadi admin saat login pertama ke dashboard. |
| URL web dashboard | Untuk CORS, mis. `https://dashboard.domainanda.com`. |
| Port backend | Default 4000, hanya terbuka di `127.0.0.1`. |
| Token bot Telegram | Opsional, untuk alert perangkat offline. |

Hasilnya:
- `deploy/aapanel/.env` (chmod 600) berisi semua konfigurasi & rahasia — jangan di-commit.
- Image dibangun dari folder `backend/`, container `btm-backend` dijalankan dengan `restart: unless-stopped`, migrasi database dijalankan otomatis saat start, lalu installer menunggu `/readyz` sehat.

Opsi lain:
- `sudo bash install.sh --reconfigure` — ubah konfigurasi.
- `sudo bash install.sh --image` — pakai image siap pakai `ghcr.io/hafiz-ridha/bank-transfer-monitoring-backend:latest` (dibangun GitHub Actions) tanpa build di server. Jika package GHCR privat: `echo <PAT read:packages> | docker login ghcr.io -u hafiz-ridha --password-stdin`.
- Non-interaktif (otomasi): `BTM_NONINTERACTIVE=1 DB_CHOICE=1 DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... BOOTSTRAP_ADMIN_EMAILS=... CORS_ORIGINS=... bash install.sh`

## Reverse proxy & SSL di aaPanel

1. **Website > Add site** → domain `api.domainanda.com`, PHP: *Pure static* (tidak perlu database/FTP).
2. Buka pengaturan site → **Reverse proxy** → *Add reverse proxy*: nama `btm`, **Target URL `http://127.0.0.1:4000`**, *Send Domain* `$host`.
3. **SSL** → Let's Encrypt → aktifkan **Force HTTPS**.
4. Cek: `https://api.domainanda.com/readyz` → `{"ok":true,"db":"pg"}`.

Jangan membuka port 4000/5433 di firewall aaPanel — keduanya hanya mendengarkan di `127.0.0.1`.

## Operasional

| Kebutuhan | Perintah (dari `deploy/aapanel`) |
|---|---|
| Status | `docker compose ps` (atau aaPanel > Docker > Containers) |
| Log | `docker compose logs -f backend` |
| Restart | `docker compose restart backend` |
| Update versi | `sudo bash update.sh` (git pull + build + restart, menunggu `/readyz`) |
| Berhenti | `docker compose down` (data Supabase/volume tetap aman) |

**Backup** (PRD §11): gunakan `ops/backup/backup.sh` di host.
- Mode Supabase: `DATABASE_URL` sama dengan di `.env`.
- Mode PostgreSQL lokal: `DATABASE_URL=postgresql://btm:<POSTGRES_PASSWORD>@127.0.0.1:5433/btm` (password ada di `.env`). Pasang `postgresql-client` versi 16 di host.

## Web dashboard

Web dashboard (`web/`) dapat dijalankan dengan Node.js + PM2 di aaPanel (aaPanel > Website > Node project) atau sebagai situs terpisah — lihat `web/README.md`. Set `NEXT_PUBLIC_API_URL=https://api.domainanda.com`.

## Pemecahan masalah

| Gejala | Penyebab umum |
|---|---|
| `/readyz` 503 atau container restart terus | `DATABASE_URL` salah, password belum di-URL-encode, atau memakai port 6543. Cek `docker compose logs backend`. |
| `SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib` | Nilai kosong di `.env` → `install.sh --reconfigure`. |
| Dashboard: CORS error | `CORS_ORIGINS` harus sama persis dengan origin dashboard (termasuk `https://`, tanpa `/` di akhir). |
| Android: `CLOCK_SKEW` | Jam HP tidak otomatis. Aktifkan tanggal & waktu otomatis. |
| 502 Bad Gateway di domain | Container belum jalan atau port target reverse proxy berbeda dengan `BTM_PORT`. |
