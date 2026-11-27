# Keputusan Desain & Default Sementara

PRD §19 menyisakan enam keputusan. Implementasi memakai default berikut — semuanya dapat diubah tanpa mengubah kode kecuali disebutkan.

| # | Keputusan PRD §19 | Default yang dipakai | Cara mengubah |
|---|---|---|---|
| 1 | Daftar bank versi pertama | Parser Android untuk **BCA, BRI, Mandiri, BNI, BSI** + parser generik konservatif. Format notifikasi asli **belum divalidasi** — wajib diuji dengan notifikasi nyata dari HP target sebelum produksi. | Tambah/ubah parser di aplikasi Android (lihat `android/README.md`); daftarkan package di menu Sumber Bank. |
| 2 | Merek/model HP monitoring | Tidak bergantung merek. Panduan baterai tersedia untuk Samsung, Xiaomi/Redmi/POCO, Oppo, Vivo, Realme, lainnya. | Uji checklist PRD §15 pada HP terpilih. |
| 3 | Transaksi tanpa order POS tetap dicatat? | **Ya.** Tersimpan sebagai `UNMATCHED` (histori lengkap, bisa ditautkan manual atau diabaikan). | — |
| 4 | Rentang waktu matching default | Order `created_at − 5 menit` s/d `expires_at` (jika kosong: `created_at + 60 menit`) `+ 10 menit` toleransi. Dalam rentang inti = 20 poin waktu, hanya di toleransi = 10 poin. | Pengaturan > Matching. |
| 5 | Alert offline via Telegram? | Tersedia, **nonaktif** secara default. Alert selalu tampil di dashboard. | `TELEGRAM_BOT_TOKEN` di `.env` backend + Pengaturan > Alert. |
| 6 | Distribusi APK internal atau Google Play | Diasumsikan **APK internal**. Aplikasi memakai izin `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` yang dibatasi kebijakan Google Play. | Jika lewat Play Store, evaluasi ulang izin tersebut dan deklarasi Notification Listener. |

## Keputusan teknis penting

**Matching otomatis yang aman (target 0 salah match).** `MATCHED` hanya jika: tepat satu order kandidat, tidak ada transfer lain (nominal sama, belum dipakai) yang bersaing untuk order tersebut, dan skor ≥ 80 (nominal 60 + waktu 20 wajib terpenuhi penuh). Nama pengirim (15) dan rekening (5) hanya menambah informasi — tidak pernah memicu match sendirian. Semua kasus lain → `AMBIGUOUS` dan menunggu admin; webhook tidak dikirim.

**Proteksi duplikasi berlapis (PRD §6.4).**
- `event_id` unik per notifikasi + `dedupe_key` unik per perangkat (notifikasi yang diposting ulang).
- Nomor referensi unik per bank.
- `payment_matches`: maksimal satu match final per transaksi & per order (partial unique index); `incoming_transactions.matched_order_id` dan `pos_orders.paid_transaction_id` UNIQUE.
- Matching di dalam transaksi DB + `pg_advisory_xact_lock` per nominal + `SELECT … FOR UPDATE`.
- Outbox webhook ditulis di transaksi yang sama dengan matching; satu `payment.matched` per order (unique index), `event_id` dipakai sebagai idempotency key.

**Penerimaan tidak terhambat matching (PRD §12).** Endpoint notifikasi hanya menyimpan data lalu membalas; matching berjalan setelah commit. Job pemulihan mengambil transaksi `PENDING` bila proses sempat mati.

**Status perangkat.** Dihitung dari heartbeat terakhir (bukan sekadar registrasi): ACTIVE ≤ 2 menit & listener terhubung; WARNING 2–5 menit atau kendala konfigurasi (listener terputus, baterai belum dikecualikan, antrean menumpuk, sinkronisasi gagal, versi usang); INACTIVE > 5 menit; PERMISSION_ERROR jika Notification Access mati; UNKNOWN jika belum ada data. `DISCONNECTED` hanya dari laporan eksplisit perangkat (`status_source=device_reported`); heartbeat yang hilang ditandai `INACTIVE` dengan `status_source=inferred` dan `connection_state=disconnected_suspected`. Ambang dapat diubah di Pengaturan.

**Autentikasi.**
- Dashboard: Supabase Auth (JWT diverifikasi backend via Supabase, cache 60 dtk); role & status aktif di tabel `users`.
- Android: token acak 256-bit (disimpan hash SHA-256 di server), diperoleh dengan kode pairing sekali pakai dari admin, dapat dicabut; header `X-Request-Time` (toleransi 10 menit) sebagai proteksi replay + idempotensi `event_id`.
- POS: API key (hash SHA-256), dapat dicabut.

**Database portabel.** Tidak ada ketergantungan pada skema `auth` Supabase atau fungsi khusus Supabase; migrasi berjalan di PostgreSQL 14+ mana pun (PRD §12 Scalability). Pengujian otomatis memakai PGlite (PostgreSQL WASM).

**Retensi.** Teks notifikasi mentah dihapus setelah 30 hari (baris tetap ada), log webhook 30 hari, heartbeat 60 hari, event perangkat 90 hari. Transaksi/order/matching **tidak** dihapus otomatis kecuali admin mengaktifkan `retention.purge_transactions_enabled` (arsip pembukuan harus mengikuti kebijakan yang berlaku). Audit log tidak pernah dihapus otomatis.

## Di luar cakupan MVP (sesuai PRD §17)
API bank langsung, pembayaran keluar, scraping internet banking, OCR mutasi, rekonsiliasi rekening koran, multi-company/multi-location, iOS. Pembatalan pembayaran yang sudah `MATCHED` (reversal ke POS) juga belum ada — jika terjadi salah bayar, tangani di POS dan catat di dashboard.
