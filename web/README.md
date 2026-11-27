# Bank Transfer Monitor — Web Dashboard

Dashboard admin/operator (Next.js App Router + React + TypeScript) untuk **Bank Transfer Monitoring System**:
monitoring perangkat Android, transaksi masuk, verifikasi manual, order POS, laporan, sumber bank, pengaturan, pengguna, dan audit log.

- Semua data diambil **di sisi klien** dari backend (`NEXT_PUBLIC_API_URL` → `/api/v1/...`, kontrak di `../docs/API.md` bagian B) dengan header `Authorization: Bearer <token>`.
- Tanpa library UI/Tailwind: design system ada di `app/globals.css`. Dependensi runtime hanya `next`, `react`, `react-dom`, `@supabase/supabase-js`.
- Auto refresh 15 detik (dashboard, perangkat, detail perangkat, alert, antrean verifikasi) — dijeda saat tab browser tidak aktif.

## Struktur

```
app/
  layout.tsx, globals.css, not-found.tsx
  login/  lupa-password/  reset-password/      # halaman publik (auth)
  (app)/layout.tsx                             # guard login + sidebar
  (app)/page.tsx                               # Dashboard utama (PRD §5.1)
  (app)/devices/, devices/[id]/                # Monitoring perangkat (§5.2) + detail & riwayat
  (app)/alerts/                                # Alert perangkat (§5.3)
  (app)/transactions/, transactions/[id]/      # Transaksi masuk (§5.4) + verifikasi manual (§5.6)
  (app)/verification/                          # Antrean ambigu + transaksi tanpa order
  (app)/orders/, orders/[id]/                  # Order POS (§5.7)
  (app)/bank-sources/                          # Sumber bank (§5.8)
  (app)/reports/                               # Laporan (§5.9)
  (app)/settings/                              # Pengaturan, webhook, API key POS (§5.10)
  (app)/users/, (app)/audit/                   # khusus admin
components/   ui.tsx (kartu, badge, modal, tabel, pagination…), status.tsx, devices.tsx, alerts.tsx, audit.tsx, AppShell.tsx, toast.tsx
lib/          api.ts (klien API bertipe), auth.tsx, session.ts, supabase.ts, hooks.ts (useApi + polling), format.ts (Rp & tanggal), labels.ts, types.ts
```

## Variabel lingkungan

Salin `.env.example`. **Semua `NEXT_PUBLIC_*` ditanam saat `npm run build`** — setelah mengubah nilainya, build ulang lalu restart PM2.

| Variabel | Wajib | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ya | URL dasar backend tanpa `/api/v1`, mis. `https://api.contoh.co.id` (default `http://localhost:4000`) |
| `NEXT_PUBLIC_AUTH_MODE` | ya | `supabase` (produksi) atau `dev` (lokal: login hanya email, token `dev:<email>`, badge **MODE DEV**) |
| `NEXT_PUBLIC_SUPABASE_URL` | mode supabase | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | mode supabase | **anon/public key** (jangan service_role) |
| `NEXT_PUBLIC_REFRESH_MS` | tidak | Interval auto refresh (default `15000`, minimal `5000`) |
| `NEXT_PUBLIC_APP_NAME` | tidak | Nama aplikasi di sidebar/judul tab |

Backend harus mengizinkan origin dashboard di `CORS_ORIGINS` (mis. `https://dashboard.contoh.co.id`).

## Menjalankan lokal (mode dev, tanpa Supabase)

```bash
# 1) Backend (terminal 1) — .env backend: DB_DRIVER=pglite, AUTH_MODE=dev, BOOTSTRAP_ADMIN_EMAILS=admin@local.test
cd ../backend && npm install && npm run dev
npm run seed:demo          # opsional: data demo (perangkat, transaksi, order, alert)

# 2) Web (terminal 2)
cd ../web
npm install
cp .env.example .env.local # lalu set NEXT_PUBLIC_AUTH_MODE=dev, NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                # http://localhost:3000  → login sebagai admin@local.test
```

Jika port 3000 sudah terpakai: `npm run dev -- -p 3001` dan tambahkan origin tersebut ke `CORS_ORIGINS` backend
(mis. `CORS_ORIGINS=http://localhost:3000,http://localhost:3001 npm run dev`).

Perintah lain:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # build produksi (juga menjalankan pemeriksaan TypeScript)
npm start           # next start -p 3000
```

## Autentikasi & role

- **supabase**: login email + password (`signInWithPassword`), sesi disimpan & di-refresh otomatis oleh supabase-js, token `session.access_token` dikirim sebagai bearer.
  - *Lupa password* (`/lupa-password`) mengirim email reset → tautan membuka `/reset-password` untuk membuat password baru (`updateUser`).
  - Undangan pengguna baru (admin menambah user tanpa password) mendarat di *Site URL*; dashboard mendeteksi `type=invite` dan mengarahkan ke `/reset-password` untuk membuat password.
  - Di Supabase > Authentication > URL Configuration: *Site URL* = `https://dashboard.contoh.co.id`, *Redirect URLs* tambahkan `https://dashboard.contoh.co.id/**`.
- **dev**: hanya untuk lokal; backend juga harus `AUTH_MODE=dev`.
- Setelah login, `GET /api/v1/me` menentukan role. **Operator**: menu Pengguna & Audit disembunyikan; tombol ubah perangkat, sumber bank, pengaturan, webhook, API key disembunyikan (mode baca). Verifikasi manual tetap bisa.
- 401 dari API → sesi dihapus & diarahkan ke `/login`; 403 → pesan "Akses ditolak" (akun belum terdaftar/nonaktif atau role tidak cukup).

## Deploy di VPS (HestiaCP + PM2 + Nginx)

Ringkasan (lihat juga `../docs/DEPLOYMENT.md`):

```bash
cd /opt/btm/web
cp .env.example .env.production
nano .env.production        # NEXT_PUBLIC_API_URL=https://api.contoh.co.id
                            # NEXT_PUBLIC_AUTH_MODE=supabase
                            # NEXT_PUBLIC_SUPABASE_URL=...  NEXT_PUBLIC_SUPABASE_ANON_KEY=...
npm ci
npm run build
mkdir -p logs
pm2 start ecosystem.config.cjs   # proses "btm-web": next start -p 3000 -H 127.0.0.1
pm2 save                         # (sekali) pm2 startup  → ikuti instruksi agar jalan saat boot
```

Update versi: salin kode baru, lalu `npm ci && npm run build && pm2 restart btm-web`.

> Jangan menyalin `.env.local` ke server: Next.js memberi prioritas `.env.local` di atas `.env.production` saat build.

**Nginx (HestiaCP)**: buat domain `dashboard.contoh.co.id`, aktifkan SSL Let's Encrypt + *force HTTPS*, lalu pakai proxy template kustom
(`/usr/local/hestia/data/templates/web/nginx/btm-web.tpl` dan `.stpl`, salin struktur dari template default) dengan blok:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   Upgrade           $http_upgrade;
    proxy_set_header   Connection        "upgrade";
    proxy_read_timeout 60s;
}
location /_next/static/ {
    proxy_pass http://127.0.0.1:3000;
    expires 365d;
    add_header Cache-Control "public, immutable";
}
```

Pilih template tersebut di *Edit Web Domain > Proxy Template*. Port 3000 cukup terbuka untuk 127.0.0.1 saja (firewall hanya 22/80/443).

## Catatan

- CSV export (transaksi & laporan) diunduh lewat `fetch` + blob agar header Authorization ikut terkirim.
- Waktu ditampilkan di zona waktu operasional dari pengaturan `general.timezone` (default `Asia/Jakarta`); nominal memakai format `Rp 150.000`.
- Perintah aksi verifikasi (pilih/tolak kandidat, tautkan order, abaikan, buka kembali, catatan) selalu lewat modal konfirmasi dengan catatan opsional dan tercatat di audit log. Memverifikasi menandai order **lunas** dan memicu webhook `payment.matched` ke POS (bila webhook aktif).
