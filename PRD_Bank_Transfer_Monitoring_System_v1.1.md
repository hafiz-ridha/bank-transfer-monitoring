# PRODUCT REQUIREMENTS DOCUMENT (PRD)

# Bank Transfer Monitoring System

**Versi:** 1.1\
**Tanggal:** 27 November 2026\
**Status:** Draft spesifikasi produk\
**Platform:** Android, Web Dashboard, Backend API\
**Nama produk sementara:** Bank Transfer Monitor

------------------------------------------------------------------------

## 1. Ringkasan Produk

### 1.1 Latar Belakang

Bank Transfer Monitoring System mendeteksi transfer masuk melalui
notifikasi aplikasi mobile banking yang terpasang pada perangkat
Android. Informasi transaksi dikirim ke server, disimpan sebagai
histori, lalu dicocokkan dengan pesanan dari aplikasi POS melalui API.

Sistem harus tetap melakukan monitoring meskipun aplikasi Android tidak
sedang dibuka. Dashboard web harus menunjukkan kondisi aktual perangkat,
layanan pembaca notifikasi, izin notifikasi, koneksi server, dan waktu
komunikasi terakhir.

### 1.2 Tujuan

-   Mengotomatiskan pemantauan transfer masuk.
-   Mengurangi pengecekan mutasi rekening secara manual.
-   Mempercepat konfirmasi pembayaran POS.
-   Menyimpan histori transfer masuk.
-   Menyediakan pencocokan pembayaran otomatis dan verifikasi manual.
-   Memberi tahu admin ketika aplikasi Android berhenti bekerja atau
    kehilangan koneksi.

### 1.3 Target Penggunaan

  Parameter             Target
  --------------------- --------------------
  Jumlah bisnis         1
  Jumlah lokasi         1
  Perangkat Android     1 perangkat utama
  Aplikasi bank         Multiple
  Rekening              Multiple
  Volume transaksi      50--100 per hari
  Histori operasional   365 hari
  Pengguna dashboard    Admin dan operator
  POS                   Integrasi API

------------------------------------------------------------------------

## 2. Arsitektur Sistem

### 2.1 Komponen

1.  **Android Monitoring App** --- membaca notifikasi bank.
2.  **Backend API** --- menerima dan memproses transaksi serta
    heartbeat.
3.  **Supabase PostgreSQL** --- menyimpan transaksi dan data
    operasional.
4.  **Web Dashboard** --- monitoring, histori, dan verifikasi.
5.  **POS Integration** --- menerima order dan status pembayaran.

### 2.2 Teknologi

  Komponen                Teknologi
  ----------------------- --------------------------------
  Android                 Kotlin
  UI Android              Jetpack Compose
  Notification Listener   NotificationListenerService
  Local database          Room SQLite
  Background sync         WorkManager
  Backend                 Node.js
  API Framework           Fastify
  Database                Supabase PostgreSQL
  Web                     Next.js + React
  Authentication          Supabase Auth
  Real-time               Supabase Realtime atau polling
  Deployment              VPS HestiaCP
  Process Manager         PM2
  API                     REST
  Webhook                 HMAC-SHA256

### 2.3 Alur Sistem

``` mermaid
flowchart TD
    A[Banking Applications] --> B[Android Notification Listener]
    B --> C[Transaction Parser]
    C --> D[Room Local Queue]
    D --> E[Backend API]
    E --> F[Transaction Processor]
    F --> G[Supabase PostgreSQL]
    G --> H[Matching Engine]
    I[POS API] --> G
    H --> J{Matching Result}
    J -->|Matched| K[POS Webhook]
    J -->|Ambiguous| L[Admin Verification]
    M[Android Heartbeat] --> E
    E --> N[Device Status Monitor]
    N --> O[Web Dashboard]
    G --> O
```

------------------------------------------------------------------------

## 3. Modul Android Monitoring App

### 3.1 Persyaratan Utama

Aplikasi Android wajib: - Membaca notifikasi dari aplikasi bank yang
dipilih. - Tetap bekerja ketika aplikasi tidak sedang dibuka. - Tetap
melakukan monitoring ketika layar perangkat mati, selama Android
mengizinkan. - Mengirim transaksi ke backend secara otomatis. -
Menyimpan transaksi sementara ketika internet terputus. - Mengirim
heartbeat untuk melaporkan kondisi perangkat. - Mendeteksi Notification
Access yang dicabut. - Menampilkan status layanan monitoring.

### 3.2 Background Notification Monitoring

Komponen utama menggunakan `NotificationListenerService`.

Ketentuan implementasi: 1. NotificationListenerService berjalan terpisah
dari Activity atau halaman aplikasi. 2. Pembacaan notifikasi tidak
bergantung pada halaman dashboard Android yang sedang terbuka. 3.
Service memproses notifikasi dari package name aplikasi bank yang
diizinkan. 4. Event transaksi disimpan ke Room SQLite. 5. Pengiriman ke
server dilakukan melalui mekanisme sinkronisasi yang tahan gangguan
jaringan. 6. Jika koneksi terputus, data disimpan dan dikirim ulang
ketika jaringan tersedia. 7. Service tidak boleh bergantung pada
tindakan manual membuka aplikasi setiap kali ada transaksi.

**Catatan teknis:** NotificationListenerService dikelola oleh sistem
Android dan tidak memerlukan foreground service khusus hanya untuk
membaca notifikasi. WorkManager digunakan untuk pekerjaan sinkronisasi
yang dapat ditunda. Jika aplikasi membutuhkan foreground service untuk
pekerjaan lain, penggunaan dan deklarasinya harus mengikuti aturan
Android yang berlaku.

### 3.3 Startup dan Pemulihan

Aplikasi harus: - Memeriksa status Notification Access. - Memeriksa
apakah listener terhubung. - Mendeteksi koneksi service yang terputus. -
Mencatat waktu service terakhir aktif. - Menjadwalkan sinkronisasi
ulang. - Memeriksa antrean transaksi yang belum dikirim. - Melakukan
rekonsiliasi status ketika aplikasi dibuka kembali.

Pada perangkat yang mendukung dan mengizinkan, aplikasi harus dapat
dipulihkan setelah reboot. Pengujian dilakukan pada versi Android dan
merek perangkat target.

Aplikasi tidak boleh menggunakan mekanisme yang melanggar pembatasan
Android atau menyamarkan status monitoring.

### 3.4 Battery Optimization

Aplikasi menyediakan panduan untuk: - Mengizinkan aplikasi berjalan di
background. - Mengatur baterai ke mode unrestricted atau pengecualian
optimasi baterai jika tersedia. - Mengizinkan autostart pada perangkat
yang memiliki fitur tersebut. - Mengizinkan notifikasi aplikasi. -
Menjaga koneksi jaringan background.

Pengaturan berbeda antara Samsung, Xiaomi, Oppo, Vivo, Realme, dan merek
lainnya. Aplikasi sebaiknya menampilkan panduan sesuai merek perangkat.

Aplikasi tidak boleh menganggap pengaturan battery optimization telah
berhasil hanya karena halaman pengaturannya telah dibuka.

### 3.5 Notification Access

Fitur: - Memeriksa izin Notification Access. - Menampilkan status
izin. - Mengarahkan pengguna ke halaman pengaturan Android jika izin
belum aktif. - Mendeteksi perubahan izin ketika aplikasi kembali
aktif. - Melaporkan status izin ke backend.

Jika izin dicabut, dashboard harus menunjukkan bahwa monitoring tidak
dapat dijamin berjalan.

### 3.6 Bank Source Management

Fitur: - Mengaktifkan beberapa aplikasi bank. - Mengidentifikasi package
name. - Mengatur alias rekening. - Menyimpan versi parser. - Menampilkan
notifikasi terakhir dari setiap aplikasi bank. - Menampilkan error
parser.

Sistem hanya memproses notifikasi yang dipilih pengguna.

### 3.7 Transaction Parser

Informasi yang diekstrak:

  Field               Keterangan
  ------------------- ---------------------------------
  Bank code           Identitas bank
  Sender name         Nama pengirim jika tersedia
  Amount              Nominal transfer
  Transaction time    Waktu transaksi jika tersedia
  Received time       Waktu notifikasi diterima
  Reference number    Nomor referensi jika tersedia
  Recipient account   Rekening penerima jika tersedia
  Notification type   Jenis notifikasi
  Parser version      Versi parser

Jika format tidak dikenali, transaksi tidak boleh otomatis dianggap
valid. Catat parsing error dan kirim metadata error yang diperlukan ke
server.

### 3.8 Local Queue dan Offline Sync

Menggunakan Room SQLite.

Fitur: - Menyimpan event lokal. - Status `pending`, `sending`, `sent`,
dan `failed`. - Retry otomatis. - Mencegah pengiriman berulang. -
Menghapus antrean lokal hanya setelah server mengonfirmasi penerimaan. -
Menampilkan jumlah antrean belum terkirim.

### 3.9 Android Dashboard

Menu: 1. Dashboard. 2. Sumber Bank. 3. Histori Deteksi. 4. Antrean
Sinkronisasi. 5. Status Monitoring. 6. Pengaturan.

Informasi utama: - Status monitoring service. - Notification Access. -
Koneksi internet. - Koneksi server. - Jumlah transaksi hari ini. -
Antrean belum terkirim. - Waktu heartbeat terakhir. - Versi aplikasi.

------------------------------------------------------------------------

## 4. Device Health Monitoring

### 4.1 Tujuan

Backend harus mengetahui apakah aplikasi Android masih berfungsi dan
dapat menerima notifikasi. Status tidak boleh hanya berdasarkan apakah
aplikasi pernah melakukan registrasi.

### 4.2 Heartbeat

Android mengirim heartbeat berkala ke backend.

Endpoint: `POST /api/v1/devices/heartbeat`

Interval target: - Heartbeat setiap 1 menit ketika kondisi perangkat
memungkinkan. - Sinkronisasi ulang ketika koneksi kembali tersedia. -
Heartbeat tambahan ketika aplikasi dibuka atau kondisi service berubah.

Heartbeat dapat tertunda karena Android membatasi aktivitas background.
Status server harus mempertimbangkan waktu komunikasi terakhir.

Contoh payload:

``` json
{
  "device_id": "device-001",
  "app_version": "1.0.0",
  "notification_access": true,
  "listener_connected": true,
  "network_connected": true,
  "battery_optimization_exempt": true,
  "pending_queue": 0,
  "last_notification_at": "2026-11-27T10:00:00+07:00",
  "reported_at": "2026-11-27T10:01:00+07:00"
}
```

### 4.3 Status Perangkat

  -----------------------------------------------------------------------
  Status                              Kondisi
  ----------------------------------- -----------------------------------
  ACTIVE                              Heartbeat terbaru dan listener
                                      terhubung

  WARNING                             Heartbeat terlambat atau ada
                                      kendala konfigurasi

  INACTIVE                            Tidak ada heartbeat melewati ambang
                                      batas

  PERMISSION ERROR                    Notification Access tidak aktif

  DISCONNECTED                        Koneksi server tidak tersedia
                                      berdasarkan laporan terakhir

  UNKNOWN                             Belum ada data status yang cukup
  -----------------------------------------------------------------------

Aturan awal: - **ACTIVE:** heartbeat diterima dalam 2 menit terakhir dan
listener terhubung. - **WARNING:** heartbeat terakhir 2--5 menit. -
**INACTIVE:** tidak ada heartbeat lebih dari 5 menit. - **PERMISSION
ERROR:** perangkat melaporkan Notification Access tidak aktif. -
**UNKNOWN:** perangkat belum pernah mengirim status atau status belum
dapat dipastikan.

Ambang batas dapat dikonfigurasi. Status DISCONNECTED harus dibedakan
antara laporan eksplisit perangkat dan dugaan berdasarkan heartbeat yang
hilang.

### 4.4 Status Listener

Backend menyimpan: - `listener_connected` - `notification_access` -
`last_listener_connected_at` - `last_notification_at` -
`last_heartbeat_at` - `last_successful_sync_at` - `pending_queue` -
`last_error`

Dashboard tidak hanya menunjukkan HP online/offline, tetapi juga kondisi
layanan pembaca notifikasi.

------------------------------------------------------------------------

## 5. Web Dashboard

### 5.1 Dashboard Utama

Menampilkan: - Total transfer hari ini. - Total nominal masuk. -
Transaksi matched. - Transaksi unmatched. - Transaksi ambiguous. -
Parsing error. - Status perangkat Android. - Status notification
listener. - Waktu heartbeat terakhir. - Waktu transaksi terakhir
terdeteksi. - Antrean transaksi yang belum terkirim.

### 5.2 Device Monitoring Dashboard --- Wajib MVP

Admin harus dapat melihat status aplikasi Android tanpa membuka aplikasi
Android secara langsung.

Tabel perangkat:

  Informasi              Contoh
  ---------------------- -----------------------
  Nama perangkat         Android Monitoring 01
  Model perangkat        Samsung Galaxy
  Status aplikasi        ACTIVE
  Listener status        Connected
  Notification Access    Enabled
  Internet               Connected
  Battery optimization   Exempt
  Last heartbeat         10:01:00
  Last notification      10:00:00
  Last successful sync   10:01:00
  Pending queue          0
  App version            1.0.0

Indikator visual: - Hijau: ACTIVE. - Kuning: WARNING. - Merah: INACTIVE
atau PERMISSION ERROR. - Abu-abu: UNKNOWN.

Halaman detail perangkat menampilkan: - Riwayat heartbeat. - Riwayat
service terputus. - Riwayat kehilangan izin. - Riwayat sinkronisasi
gagal. - Riwayat error parser. - Riwayat versi aplikasi. - Antrean
transaksi yang belum terkirim.

### 5.3 Alert Perangkat

Sistem memberi peringatan ketika: 1. Perangkat tidak mengirim heartbeat
lebih dari 5 menit. 2. Notification Access dinonaktifkan. 3. Listener
terputus berdasarkan laporan perangkat. 4. Antrean transaksi menumpuk.
5. Perangkat tidak berhasil sinkronisasi. 6. Aplikasi menggunakan versi
yang sudah tidak didukung.

Alert ditampilkan pada dashboard. Integrasi Telegram dapat ditambahkan
sebagai kanal notifikasi.

### 5.4 Incoming Transactions

Menampilkan: - Waktu transaksi dan waktu diterima. - Bank dan alias
rekening. - Nama pengirim. - Nominal. - Nomor referensi. - Status
matching. - POS Order ID.

Fitur filter tanggal, bank, rekening, nominal, status, pencarian,
pagination, sorting, dan export CSV.

### 5.5 Payment Matching

Status: - `MATCHED` - `UNMATCHED` - `AMBIGUOUS` - `MANUAL VERIFIED` -
`REJECTED` - `IGNORED`

Admin dapat melihat kandidat order dan alasan pencocokan.

### 5.6 Manual Verification

Admin dapat: - Memeriksa detail transfer. - Melihat daftar order
kandidat. - Memilih order yang benar. - Menolak kandidat. - Mengabaikan
transaksi. - Menambahkan catatan.

Semua tindakan dicatat dalam audit log.

### 5.7 POS Orders

Menampilkan Order ID, pelanggan, nominal, waktu order, batas pembayaran,
status pembayaran, dan Transaction ID.

### 5.8 Bank Source Management

Mengelola nama bank, package name, alias rekening, identitas rekening
jika tersedia, status aktif, versi parser, dan waktu notifikasi
terakhir.

### 5.9 Reports

Laporan rekap transfer harian/bulanan, total nominal, transaksi per
bank, matched/unmatched, manual verified, dan rekonsiliasi POS.

### 5.10 Users dan Settings

-   Login.
-   Role admin dan operator.
-   Pengaturan matching.
-   Pengaturan retensi.
-   Pengaturan webhook.
-   Pengaturan API.
-   Pengaturan timezone.
-   Pengaturan alert.

------------------------------------------------------------------------

## 6. Matching Engine

### 6.1 Aturan

-   Nominal harus sama.
-   Order masih pending.
-   Order belum dibayar.
-   Transaksi belum digunakan.
-   Waktu sesuai konfigurasi.
-   Nama pengirim menjadi informasi pendukung.
-   Rekening penerima digunakan jika tersedia dan tervalidasi.

### 6.2 Scoring Awal

  Kriteria                       Bobot
  -------------------------- ---------
  Nominal sama                      60
  Waktu sesuai                      20
  Nama pengirim sesuai              15
  Rekening penerima sesuai           5
  **Total**                    **100**

Skor merupakan heuristik, bukan probabilitas.

### 6.3 Keputusan

-   **MATCHED:** satu kandidat yang memenuhi seluruh aturan wajib tanpa
    konflik.
-   **AMBIGUOUS:** terdapat beberapa kandidat atau informasi belum
    cukup.
-   **UNMATCHED:** tidak ada kandidat yang sesuai.

Transaksi ambigu tidak boleh otomatis dikirim sebagai pembayaran
berhasil ke POS.

### 6.4 Proteksi Duplikasi

-   Unique transaction ID.
-   Unique payment match.
-   Database transaction.
-   Row-level locking.
-   Idempotency key.

------------------------------------------------------------------------

## 7. POS API Integration

### 7.1 Create Order

`POST /api/v1/pos/orders`

Contoh request:

``` json
{
  "order_id": "POS-20261127-001",
  "customer_name": "Pelanggan",
  "amount": 150000,
  "payment_method": "bank_transfer",
  "created_at": "2026-11-27T10:00:00+07:00",
  "expires_at": "2026-11-27T10:30:00+07:00"
}
```

### 7.2 Check Payment

`GET /api/v1/pos/orders/{order_id}/payment`

### 7.3 Payment Webhook

Event: `payment.matched`

Contoh payload:

``` json
{
  "event": "payment.matched",
  "event_id": "evt-123456",
  "order_id": "POS-20261127-001",
  "transaction_id": "TRX-000001",
  "amount": 150000,
  "paid_at": "2026-11-27T10:05:00+07:00",
  "status": "paid"
}
```

Keamanan: - HMAC-SHA256. - Timestamp signature. - Webhook secret. -
Retry. - Idempotency. - Delivery log.

------------------------------------------------------------------------

## 8. Backend API

### Android

-   `POST /api/v1/devices/register`
-   `POST /api/v1/devices/heartbeat`
-   `GET /api/v1/devices/config`
-   `POST /api/v1/notifications`
-   `POST /api/v1/notifications/batch`
-   `POST /api/v1/devices/events`

### Dashboard

-   `GET /api/v1/dashboard/summary`
-   `GET /api/v1/devices`
-   `GET /api/v1/devices/{id}`
-   `GET /api/v1/devices/{id}/health`
-   `GET /api/v1/devices/{id}/events`
-   `GET /api/v1/transactions`
-   `GET /api/v1/matches`
-   `POST /api/v1/matches/{id}/verify`
-   `POST /api/v1/matches/{id}/reject`
-   `GET /api/v1/reports`

### POS

-   `POST /api/v1/pos/orders`
-   `GET /api/v1/pos/orders/{order_id}/payment`

------------------------------------------------------------------------

## 9. Database Design

Tabel utama: 1. `users` 2. `devices` 3. `device_heartbeats` 4.
`device_events` 5. `bank_sources` 6. `notification_events` 7.
`incoming_transactions` 8. `pos_orders` 9. `payment_matches` 10.
`webhook_deliveries` 11. `audit_logs` 12. `system_settings`

Field tambahan pada `devices`: - `device_uuid` - `device_name` -
`app_version` - `status` - `notification_access` -
`listener_connected` - `battery_optimization_exempt` -
`network_connected` - `last_seen_at` - `last_notification_at` -
`last_successful_sync_at` - `pending_queue` - `last_error`

`device_heartbeats` menyimpan histori heartbeat, bukan hanya status
terbaru.

Ketentuan: - Nominal menggunakan BIGINT. - Timestamp menggunakan
TIMESTAMPTZ. - Unique constraint untuk event ID. - Index untuk tanggal,
nominal, bank, status, dan order ID. - RLS diaktifkan. - Service role
key hanya berada di backend.

------------------------------------------------------------------------

## 10. Keamanan

### Android

-   Device token unik dan dapat dicabut.
-   HTTPS.
-   Tidak menyimpan PIN atau password bank.
-   Hanya memproses notifikasi yang dipilih.
-   Penyimpanan token secara aman.
-   Meminimalkan penyimpanan data sensitif.

### Backend

-   Validasi request.
-   Rate limiting.
-   Device authentication.
-   Admin authentication.
-   Role-based access.
-   HMAC webhook.
-   Idempotency.
-   Audit log.
-   Proteksi replay request.

### Database

-   RLS.
-   Credential hanya di server.
-   Backup terenkripsi.
-   Akses data transaksi melalui backend.

------------------------------------------------------------------------

## 11. Retensi dan Backup

  Data                         Retensi Operasional
  ----------------------- ------------------------
  Incoming transactions                   365 hari
  POS orders                              365 hari
  Payment matches                         365 hari
  Raw notifications                        30 hari
  Webhook logs                             30 hari
  Application logs                         30 hari
  Heartbeat detail                     30--90 hari
  Device records                      Selama aktif
  Audit pembayaran          Sesuai kebutuhan audit

Backup: - Harian 7 hari. - Mingguan 4 minggu. - Bulanan 12 bulan. -
Salinan terenkripsi di luar VPS. - Tes restore bulanan.

Arsip transaksi yang dibutuhkan sebagai dokumen pembukuan harus
mengikuti kebijakan penyimpanan yang berlaku.

------------------------------------------------------------------------

## 12. Non-Functional Requirements

### Performance

-   Penerimaan notifikasi tidak boleh terhambat proses matching.
-   Dashboard mendukung pembaruan otomatis.
-   Query menggunakan index.
-   API mendukung pagination.

### Reliability

-   Local queue.
-   Retry.
-   Idempotency.
-   Heartbeat.
-   Device health monitoring.
-   Webhook retry.
-   Pemulihan setelah jaringan pulih.

### Background Reliability

-   Monitoring tidak bergantung pada Activity terbuka.
-   NotificationListenerService menjadi komponen pembaca notifikasi.
-   Status service dilaporkan ke backend.
-   Aplikasi memberikan panduan battery optimization.
-   Pengujian mencakup layar mati, aplikasi ditutup dari tampilan recent
    apps, reboot, kehilangan jaringan, dan pemulihan jaringan.
-   Force Stop oleh pengguna atau sistem, pencabutan izin, dan
    pembatasan vendor dapat menghentikan monitoring; kondisi tersebut
    harus terdeteksi atau ditandai sebagai status yang tidak dapat
    dipastikan.

### Scalability

-   Mendukung beberapa bank dan rekening.
-   Dapat dikembangkan menjadi multi-device dan multi-location.
-   Database dapat dimigrasikan ke PostgreSQL lain.

------------------------------------------------------------------------

## 13. Acceptance Criteria

### Android Monitoring

-   [ ] NotificationListenerService dapat membaca notifikasi bank yang
    diizinkan.
-   [ ] Monitoring tetap berjalan ketika halaman aplikasi ditutup.
-   [ ] Monitoring tetap bekerja ketika layar mati dalam kondisi Android
    mengizinkan.
-   [ ] Event disimpan ke Room SQLite.
-   [ ] Event dikirim otomatis ke server.
-   [ ] Event dikirim ulang ketika internet pulih.
-   [ ] Tidak ada transaksi ganda akibat retry.
-   [ ] Aplikasi mendeteksi Notification Access dicabut.
-   [ ] Aplikasi melaporkan status listener.
-   [ ] Aplikasi mengirim heartbeat.
-   [ ] Aplikasi menampilkan antrean transaksi.
-   [ ] Aplikasi memiliki panduan battery optimization.

### Web Device Monitoring

-   [ ] Dashboard menampilkan ACTIVE.
-   [ ] Dashboard menampilkan WARNING.
-   [ ] Dashboard menampilkan INACTIVE.
-   [ ] Dashboard menampilkan PERMISSION ERROR.
-   [ ] Dashboard menampilkan UNKNOWN.
-   [ ] Dashboard menampilkan status listener.
-   [ ] Dashboard menampilkan status Notification Access.
-   [ ] Dashboard menampilkan last heartbeat.
-   [ ] Dashboard menampilkan last notification.
-   [ ] Dashboard menampilkan last successful sync.
-   [ ] Dashboard menampilkan jumlah pending queue.
-   [ ] Dashboard menyimpan histori heartbeat.
-   [ ] Dashboard memberi peringatan ketika perangkat tidak aktif.

### Transaction Monitoring

-   [ ] Transaksi masuk tersimpan.
-   [ ] Transaksi dapat dicari dan difilter.
-   [ ] Status matching dapat dilihat.
-   [ ] Transaksi ambigu dapat diverifikasi.

### POS Integration

-   [ ] POS dapat mengirim order.
-   [ ] Matching engine berjalan.
-   [ ] Webhook dikirim ketika pembayaran valid.
-   [ ] Webhook tidak dikirim untuk transaksi ambigu.
-   [ ] Transaksi tidak dapat dipakai dua kali.

------------------------------------------------------------------------

## 14. Tahapan Pengembangan

### Phase 1 --- Backend Foundation

-   Database.
-   API.
-   Registrasi perangkat.
-   Heartbeat.
-   Device health status.
-   Transaction storage.

### Phase 2 --- Android Monitoring

-   Kotlin application.
-   NotificationListenerService.
-   Bank source filter.
-   Parser.
-   Room SQLite.
-   Background synchronization.
-   Battery optimization guidance.

### Phase 3 --- Web Dashboard

-   Dashboard transaksi.
-   Device monitoring.
-   Status service.
-   Heartbeat history.
-   Incoming transactions.
-   Manual verification.

### Phase 4 --- POS Integration

-   POS Orders API.
-   Matching engine.
-   Webhook.
-   Retry.
-   Idempotency.

### Phase 5 --- Production

-   Pengujian background.
-   Pengujian reboot.
-   Pengujian offline.
-   Pengujian keamanan.
-   Backup dan restore.
-   Monitoring server.

------------------------------------------------------------------------

## 15. Pengujian Wajib Android

Pengujian harus dilakukan pada perangkat fisik, bukan hanya emulator.

  -----------------------------------------------------------------------
  Skenario                            Hasil yang diharapkan
  ----------------------------------- -----------------------------------
  Aplikasi dibuka                     Monitoring aktif

  Aplikasi ditutup dari halaman utama Monitoring tetap berjalan

  Aplikasi tidak dibuka beberapa jam  Monitoring tetap berjalan selama
                                      Android mengizinkan

  Layar HP mati                       Notifikasi tetap dapat dibaca

  Internet dimatikan                  Event masuk antrean lokal

  Internet dihidupkan kembali         Event terkirim otomatis

  Notification Access dicabut         Dashboard menampilkan PERMISSION
                                      ERROR setelah status diketahui

  Service terputus                    Dashboard menunjukkan WARNING atau
                                      INACTIVE sesuai heartbeat

  HP direstart                        Monitoring pulih jika sistem
                                      mengizinkan

  Aplikasi di-force stop              Sistem menandai perangkat tidak
                                      aktif setelah heartbeat kedaluwarsa

  Baterai dibatasi                    Dashboard menampilkan kondisi
                                      terakhir dan peringatan jika
                                      diketahui

  Format notifikasi berubah           Parsing error tercatat, tidak
                                      membuat transaksi palsu
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 16. KPI dan Target Keberhasilan

  -----------------------------------------------------------------------
  KPI                                 Target
  ----------------------------------- -----------------------------------
  Volume                              50--100 transaksi/hari

  Deteksi notifikasi tersedia         Minimal 95% dalam pengujian normal

  Transaksi ganda diproses            0

  Salah matching otomatis             0 dalam acceptance testing

  Sinkronisasi setelah internet pulih Otomatis

  Device status                       Diperbarui berdasarkan heartbeat

  Alert perangkat tidak aktif         Maksimal 5 menit setelah heartbeat
                                      kedaluwarsa

  Backup                              Berhasil setiap hari
  -----------------------------------------------------------------------

Target deteksi berlaku pada kondisi perangkat dan notifikasi yang
mendukung. Sistem tidak menjamin bank selalu mengirim notifikasi.

------------------------------------------------------------------------

## 17. Batasan MVP

### Termasuk

-   Satu bisnis.
-   Satu lokasi.
-   Satu Android utama.
-   Multiple aplikasi bank.
-   Monitoring background.
-   Device health dashboard.
-   Histori transfer.
-   Matching otomatis.
-   Manual verification.
-   POS API.
-   Webhook.
-   Backup.

### Tidak termasuk

-   API bank langsung.
-   Pembayaran keluar.
-   Internet banking scraping.
-   OCR screenshot mutasi.
-   Rekonsiliasi rekening koran.
-   Multi-company.
-   Multi-location.
-   iOS.

------------------------------------------------------------------------

## 18. Definition of Done

MVP dinyatakan selesai jika: 1. Android dapat membaca notifikasi bank
yang didukung. 2. Monitoring tidak bergantung pada aplikasi yang sedang
dibuka. 3. Status perangkat dapat dilihat dari web dashboard. 4.
Dashboard dapat membedakan status aplikasi, listener, izin, dan koneksi.
5. Server dapat menerima heartbeat. 6. Server dapat menyimpan transaksi.
7. Dashboard menampilkan histori transaksi. 8. POS dapat mengirim order.
9. Matching engine dapat mencocokkan transaksi. 10. Admin dapat
memverifikasi transaksi ambigu. 11. POS menerima webhook pembayaran
valid. 12. Sistem mencegah duplikasi transaksi. 13. Backup dan restore
berhasil diuji.

------------------------------------------------------------------------

## 19. Keputusan yang Masih Perlu Ditetapkan

1.  Daftar bank yang didukung pada versi pertama.
2.  Merek dan model HP Android untuk perangkat monitoring utama.
3.  Apakah transaksi tanpa order POS tetap dicatat.
4.  Rentang waktu matching default.
5.  Apakah alert perangkat offline dikirim melalui Telegram.
6.  Distribusi APK internal atau Google Play.

**Status: PRD v1.1 --- Persyaratan background monitoring dan device
health dashboard telah menjadi bagian wajib MVP.**
