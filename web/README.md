# Bank Transfer Monitor — Web Dashboard

Dashboard admin/operator (Next.js App Router + React + TypeScript) untuk **Bank Transfer Monitoring System**: monitoring perangkat Android, transaksi masuk, verifikasi manual, order POS, laporan, sumber bank, pengaturan, pengguna, dan audit log.

- Semua data diambil **di sisi klien** dari backend (`/api/v1/...` di origin yang sama, kontrak di `../docs/API.md` bagian B) dengan header `Authorization: Bearer <token>`.
- Tanpa library UI/Tailwind: design system ada di `app/globals.css`. Dependensi runtime hanya `next`, `react`, `react-dom`, `@supabase/supabase-js`.
- Auto refresh 15 detik (dashboard, perangkat, detail perangkat, alert, antrean verifikasi), dijeda saat tab browser tidak aktif.

## Produksi: satu container dengan backend

Dashboard di-build sebagai **static export** (`npm run build` → folder `out/`), lalu disajikan oleh backend Fastify di origin yang sama:

| URL | Isi |
|---|---|
| `https://btm.contoh.co.id/` | Dashboard |
| `https://btm.contoh.co.id/api/v1/...` | API |

Image Docker di root repo (`../Dockerfile`) mem-build keduanya menjadi satu container. Lihat `../deploy/aapanel/README.md`.

- **Tidak ada `NEXT_PUBLIC_*` yang perlu diisi untuk produksi.** URL Supabase, anon key, dan mode auth dibaca **saat runtime** dari `/app-config.js`. File itu dibuat backend dari `.env`-nya (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AUTH_MODE`), sehingga ganti domain atau kunci cukup di `.env` backend, tanpa build ulang.
- API dipanggil di origin yang sama, jadi tidak perlu konfigurasi CORS.
- Halaman detail memakai query string (helper `lib/routes.ts`), karena static export tidak mendukung segmen dinamis `[id]`:
  - `/devices/detail?id=…`
  - `/transactions/detail?id=…`
  - `/orders/detail?id=…`

## Struktur

```
app/
  layout.tsx, globals.css, not-found.tsx       # layout memuat /app-config.js (beforeInteractive) di build produksi
  login/  lupa-password/  reset-password/      # halaman publik (auth)
  (app)/layout.tsx                             # guard login + sidebar
  (app)/page.tsx                               # Dashboard utama (PRD §5.1)
  (app)/devices/, devices/detail/              # Monitoring perangkat (§5.2) + detail & riwayat
  (app)/alerts/                                # Alert perangkat (§5.3)
  (app)/transactions/, transactions/detail/    # Transaksi masuk (§5.4) + verifikasi manual (§5.6)
  (app)/verification/                          # Antrean ambigu + transaksi tanpa order
  (app)/orders/, orders/detail/                # Order POS (§5.7)
  (app)/bank-sources/                          # Sumber bank (§5.8)
  (app)/reports/                               # Laporan (§5.9)
  (app)/settings/                              # Pengaturan, webhook, API key POS (§5.10)
  (app)/users/, (app)/audit/                   # khusus admin
components/   ui.tsx (kartu, badge, modal, tabel, pagination…), status.tsx, devices.tsx, alerts.tsx, audit.tsx, AppShell.tsx, toast.tsx
lib/          api.ts (klien API bertipe), config.ts (config runtime), routes.ts, auth.tsx, session.ts, supabase.ts, hooks.ts (useApi + polling), format.ts, labels.ts, types.ts
```

## Variabel lingkungan (pengembangan `npm run dev`)

Salin `.env.example` menjadi `.env.local`. Nilai ini hanya dipakai saat `next dev` (dashboard di port 3000, backend di port 4000).

| Variabel | Keterangan |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL backend tanpa `/api/v1`, mis. `http://localhost:4000`. Kosong = origin yang sama. |
| `NEXT_PUBLIC_AUTH_MODE` | `supabase`, atau `dev` (lokal: login hanya email, token `dev:<email>`, badge **MODE DEV**) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Untuk mode supabase saat `next dev`. Pakai **anon/public key**, jangan service_role. |
| `NEXT_PUBLIC_REFRESH_MS` | Interval auto refresh (default `15000`, minimal `5000`). Ditanam saat build. |
| `NEXT_PUBLIC_APP_NAME` | Nama aplikasi di sidebar/judul tab. Ditanam saat build. |

## Menjalankan lokal (mode dev, tanpa Supabase)

```bash
# 1) Backend (terminal 1) — .env backend: DB_DRIVER=pglite, AUTH_MODE=dev, BOOTSTRAP_ADMIN_EMAILS=admin@local.test
cd ../backend && npm install && npm run dev
npm run seed:demo          # opsional: data demo (perangkat, transaksi, order, alert)

# 2) Web (terminal 2) — hot reload
cd ../web
npm install
cp .env.example .env.local # lalu set NEXT_PUBLIC_AUTH_MODE=dev, NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                # http://localhost:3000  → login sebagai admin@local.test
```

Jika port 3000 sudah terpakai: jalankan `npm run dev -- -p 3001`, lalu tambahkan origin tersebut ke `CORS_ORIGINS` backend (mis. `CORS_ORIGINS=http://localhost:3000,http://localhost:3001`).

Mencoba mode produksi (satu origin) secara lokal: `npm run build`, lalu buka backend di http://localhost:4000. Backend otomatis menyajikan `../web/out`.

Perintah lain:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # static export ke out/ (juga menjalankan pemeriksaan TypeScript)
```

## Autentikasi & role

- **supabase**: login email + password (`signInWithPassword`). Sesi disimpan dan di-refresh otomatis oleh supabase-js, dan `session.access_token` dikirim sebagai bearer.
  - *Lupa password* (`/lupa-password`) mengirim email reset. Tautannya membuka `/reset-password` untuk membuat password baru (`updateUser`).
  - Undangan pengguna baru (admin menambah user tanpa password) mendarat di `/reset-password?mode=invite` untuk membuat password.
  - Di Supabase > Authentication > URL Configuration: *Site URL* = `https://btm.contoh.co.id`, dan *Redirect URLs* ditambah `https://btm.contoh.co.id/reset-password`.
- **dev**: hanya untuk lokal; backend juga harus `AUTH_MODE=dev`.
- Setelah login, `GET /api/v1/me` menentukan role.
  - **Operator** bekerja dalam mode baca. Menu Pengguna & Audit disembunyikan, begitu juga tombol ubah perangkat, sumber bank, pengaturan, webhook, dan API key. Verifikasi manual tetap bisa.
- Respons 401 dari API menghapus sesi dan mengarahkan ke `/login`.
- Respons 403 menampilkan pesan "Akses ditolak" (akun belum terdaftar/nonaktif, atau role tidak cukup).

## Deploy

- **aaPanel (Docker)**: `../deploy/aapanel/install.sh` mem-build dashboard + backend menjadi satu container.
- **VPS + PM2**: jalankan `npm ci && npm run build` di folder ini, lalu `pm2 reload btm-backend`. Backend menyajikan `web/out`, atau folder di `WEB_DIST_DIR`. Lihat `../docs/DEPLOYMENT.md`.

> Jangan menyalin `.env.local` ke server/image. Next.js memberi prioritas `.env.local` saat build (root `.dockerignore` sudah mengecualikannya).

## Catatan

- CSV export (transaksi & laporan) diunduh lewat `fetch` + blob agar header Authorization ikut terkirim.
- Waktu ditampilkan di zona waktu operasional dari pengaturan `general.timezone` (default `Asia/Jakarta`), dan nominal memakai format `Rp 150.000`.
- Aksi verifikasi (pilih/tolak kandidat, tautkan order, abaikan, buka kembali, catatan) selalu lewat modal konfirmasi dengan catatan opsional, dan tercatat di audit log.
- Memverifikasi menandai order **lunas** dan memicu webhook `payment.matched` ke POS (bila webhook aktif).
