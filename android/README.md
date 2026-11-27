# BTM Monitor — Aplikasi Android Monitoring

Aplikasi Android untuk **Bank Transfer Monitoring System**: membaca notifikasi aplikasi mobile banking
yang dipilih, mem-parsing transfer masuk, menyimpannya ke antrean lokal (Room), mengirimkannya ke backend,
dan melaporkan kesehatan perangkat lewat heartbeat. Kontrak API: `../docs/API.md` bagian A.

| Item | Nilai |
|---|---|
| Package | `id.btm.monitor` (debug: `id.btm.monitor.debug`) |
| minSdk / targetSdk | 26 (Android 8.0) / 35 |
| Teknologi | Kotlin 2.0.21, Jetpack Compose (Material 3), NotificationListenerService, Room (KSP), WorkManager, OkHttp, kotlinx.serialization |
| Build | AGP 8.7.3, Gradle 8.11.1, versi di `gradle/libs.versions.toml` |

---

## 1. Membuka proyek di Android Studio

**Prasyarat:** Android Studio Ladybug (2024.2) atau lebih baru, Android SDK Platform 35, JDK 17 atau 21
(JDK bawaan Android Studio sudah cukup).

1. Android Studio > **File > Open** > pilih folder `android/` ini.
2. Repositori ini **tidak** menyertakan `gradlew`, `gradlew.bat`, dan `gradle/wrapper/gradle-wrapper.jar`
   (berkas biner). Android Studio tetap bisa sinkronisasi karena membaca
   `gradle/wrapper/gradle-wrapper.properties` dan mengunduh Gradle 8.11.1 otomatis.
3. Untuk membuat skrip wrapper (perlu bila ingin build dari terminal / CI), pilih salah satu:
   - Android Studio: panel **Gradle** (kanan) > `BtmMonitor` > **Tasks > build setup > wrapper** (dobel klik), atau
   - bila Gradle terpasang di PC: `gradle wrapper --gradle-version 8.11.1` di folder `android/`.
4. Jika sinkronisasi gagal karena versi JDK: **Settings > Build, Execution, Deployment > Build Tools > Gradle >
   Gradle JDK** pilih JDK 17 atau 21 (mis. "jbr-17" / "jbr-21"). Gradle 8.11 mendukung JDK 17–23; JDK yang lebih
   baru membutuhkan upgrade Gradle.
5. Bila Android Studio menawarkan upgrade AGP/Kotlin, boleh ditunda; kombinasi versi saat ini sudah kompatibel.

## 2. Build APK

| Tujuan | Android Studio | Terminal (setelah wrapper dibuat) |
|---|---|---|
| Debug | **Build > Build App Bundle(s) / APK(s) > Build APK(s)** | `./gradlew :app:assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk` |
| Release | **Build > Generate Signed App Bundle / APK > APK** (buat/pilih keystore perusahaan) | `./gradlew :app:assembleRelease` (hasilnya *unsigned* sampai `signingConfigs` diatur) |
| Unit test parser | klik kanan `app/src/test` > **Run Tests** | `./gradlew :app:testDebugUnitTest` |

Catatan release:
- R8 (minify + shrink resources) aktif; aturan kotlinx.serialization ada di `app/proguard-rules.pro`.
- Simpan keystore di luar repositori (`*.jks` sudah di-`.gitignore`).
- Build release **hanya** menerima `https://`. Build debug juga menerima `http://` untuk localhost/LAN (lihat §8).

Instal ke HP (USB debugging aktif): `adb install -r app-debug.apk` (atau tombol **Run** di Android Studio).

## 3. Pairing perangkat

1. Dashboard web > **Perangkat > Tambah perangkat** → catat **kode pairing 8 karakter** (berlaku 24 jam, sekali pakai).
2. Di dashboard, pastikan **Sumber Bank** sudah dibuat dan **aktif** (package name aplikasi bank, alias rekening).
3. Buka aplikasi di HP → isi **URL server** (mis. `https://btm.contoh.co.id`, domain yang sama dengan dashboard; akhiran `/api/v1` ditambahkan otomatis)
   dan **kode pairing** → **Pasangkan perangkat**.
   - Emulator ke backend lokal (build debug): `http://10.0.2.2:4000`. HP fisik di LAN: `http://192.168.x.x:4000`.
4. Setelah berhasil, `device_token` disimpan terenkripsi (AES-256/GCM, kunci di Android Keystore).
   Konfigurasi (`bank_sources`, interval heartbeat) ikut diunduh.

**Pairing ulang**: bila admin mencabut token / membuat kode pairing baru, server membalas
`401 INVALID_DEVICE_TOKEN` → aplikasi berhenti sinkronisasi dan menampilkan layar pairing ulang.
**Antrean lokal tidak dihapus** dan dikirim setelah pairing berhasil. Pairing ulang manual: menu **Pengaturan**.

## 4. Memberikan Notification Access

Menu **Status Monitoring > Buka pengaturan Notification Access** → aktifkan **"Pembaca Notifikasi Bank (BTM)"**
(build debug muncul dengan nama aplikasi "BTM Monitor (debug)"). Kembali ke aplikasi: status berubah hijau
setelah sistem menghubungkan listener (biasanya < 2 detik).

- Android 13+: jika tombol izin abu-abu ("Restricted setting") karena APK dipasang di luar Play Store:
  **Pengaturan > Aplikasi > BTM Monitor > ⋮ (kanan atas) > Izinkan setelan terbatas**, lalu ulangi.
- Pastikan notifikasi **aplikasi bank** sendiri aktif (menu **Sumber Bank > Pengaturan notifikasi aplikasi bank**).
- Hanya package yang **aktif** di konfigurasi server yang dibaca; notifikasi lain diabaikan sebelum isinya dibaca.

## 5. Pengaturan baterai per merek

Menu **Status Monitoring > Panduan baterai & autostart** menampilkan langkah sesuai `Build.MANUFACTURER`.
Ringkasan:

| Merek | Langkah utama |
|---|---|
| Samsung | Aplikasi > BTM Monitor > Baterai > **Tidak dibatasi**; keluarkan dari "Aplikasi tidur"/"tidur nyenyak", tambahkan ke "Aplikasi tidak pernah tidur". |
| Xiaomi / Redmi / POCO | Keamanan > Izin > **Autostart** aktif; Penghemat baterai: **Tidak ada batasan**; kunci aplikasi di Recents. |
| OPPO | Baterai > Pengelolaan baterai aplikasi: izinkan aktivitas latar belakang & **peluncuran otomatis**; kunci di Recents. |
| vivo / iQOO | i Manager > **Mulai otomatis** aktif; Baterai > izinkan konsumsi daya latar belakang tinggi. |
| realme | Baterai > Pengelolaan baterai aplikasi: izinkan aktivitas latar belakang & **peluncuran otomatis**. |
| Lainnya | Aplikasi > BTM Monitor > Baterai > Tidak dibatasi; aktifkan autostart bila ada. Lihat dontkillmyapp.com. |

Status yang ditampilkan **selalu hasil pemeriksaan nyata**:
- Pengecualian optimasi baterai: `PowerManager.isIgnoringBatteryOptimizations`.
- Pembatasan latar belakang: `ActivityManager.isBackgroundRestricted` (Android 9+; di bawahnya "Belum diketahui").
- Autostart **tidak dapat diverifikasi** oleh aplikasi → hanya checkbox "dikonfirmasi pengguna", tidak pernah
  ditampilkan sebagai terverifikasi. Membuka halaman pengaturan tidak dianggap berhasil.

**Izin `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`** dipakai tombol "Minta pengecualian optimasi baterai".
Aman untuk distribusi **APK internal**. Di **Google Play** izin ini dibatasi kebijakan (hanya kategori
aplikasi tertentu) — keputusan distribusi masih terbuka (PRD §19 #6). Bila akan ke Play, hapus izin ini dari
`AndroidManifest.xml`; tombolnya otomatis jatuh ke halaman daftar optimasi baterai.

## 6. Cara kerja (ringkas)

```
Notifikasi bank ─► BankNotificationListener (NotificationListenerService, terpisah dari Activity)
   │  filter: hanya package aktif di config server; abaikan ongoing & group summary
   ▼
NotificationProcessor ─ dedupe_key = sha256(package|title|text|when) ─ parser ─►
   Room (detections + outbox) DALAM SATU TRANSAKSI  ─► WorkManager expedited "sync-now"
   ▼
SyncEngine ─► POST /notifications/batch (≤100) & POST /devices/events (≤200)
```

**Semantik antrean** (`outbox`): status `pending` → `sending` → `sent` / `failed`.
- `accepted` / `duplicate` → `sent` (baris dihapus otomatis setelah 24 jam; hanya setelah konfirmasi server).
- `rejected` + `retryable: true`, jaringan gagal, HTTP 5xx / 429 → kembali `pending` dengan backoff
  eksponensial (30 dtk, 1, 2, 4 … maks 30 menit + jitter).
- HTTP 400 `VALIDATION_ERROR` → `failed` (tidak di-retry otomatis; tombol **Coba ulang** di menu Antrean).
  Karena server menolak **seluruh batch** bila satu event invalid, batch dipecah dan dikirim satu per satu.
- `401 INVALID_DEVICE_TOKEN` → berhenti, antrean tetap; `401 CLOCK_SKEW` → peringatan "aktifkan tanggal & waktu
  otomatis", dicoba lagi 5 menit kemudian.
- Baris `sending` yang tertinggal karena crash dikembalikan ke `pending` setiap awal sinkronisasi.
- `event_id` (UUID) unik = kunci idempotensi, sehingga retry tidak membuat transaksi ganda.

**Heartbeat** (target 60 dtk, interval dari server): (1) loop coroutine selama proses hidup — proses tetap
hidup karena listener di-bind sistem; (2) `AlarmManager.setAndAllowWhileIdle` (inexact, tanpa
`SCHEDULE_EXACT_ALARM`) dipasang ulang tiap tick untuk membangunkan proses saat Doze; (3) WorkManager periodik
15 menit sebagai cadangan. Heartbeat tambahan: aplikasi dibuka, listener terhubung/terputus, jaringan pulih,
boot. Gagal kirim tidak di-spam — hanya dicatat sebagai `last_error` dan dilaporkan di heartbeat berikutnya.
Saat Doze, Android membatasi alarm ~1x per 9 menit; server menilai status dari waktu heartbeat terakhir.

**Event perangkat** yang dikirim: `APP_OPENED, APP_UPDATED, BOOT_COMPLETED, LISTENER_CONNECTED,
LISTENER_DISCONNECTED, LISTENER_REBIND_REQUESTED, PERMISSION_GRANTED/REVOKED, NETWORK_LOST/RESTORED,
SYNC_FAILED/RECOVERED, PARSER_ERROR, BATTERY_OPTIMIZATION_CHANGED, CLOCK_SKEW`.

**Foreground service**: tidak dipakai untuk membaca notifikasi (PRD §3.2). Satu-satunya pengecualian adalah
WorkManager *expedited work* di Android 8–11, yang oleh WorkManager dijalankan sebagai foreground service
singkat (notifikasi senyap "Mengirim data monitoring"). Android 12+ memakai expedited job tanpa notifikasi.

## 7. Uji wajib di perangkat fisik (PRD §15)

Siapkan: backend + dashboard web berjalan, HP sudah dipasangkan, Notification Access aktif, sumber bank aktif.
"Transfer uji" = transfer kecil dari rekening lain ke rekening yang dimonitor (atau minta rekan mengirim).

| # | Skenario | Cara melakukan | Hasil yang diharapkan | Cara memeriksa |
|---|---|---|---|---|
| 1 | Aplikasi dibuka | Buka aplikasi, lakukan transfer uji | Monitoring aktif | Dashboard Android: semua hijau; Histori Deteksi berisi transfer; dashboard web ACTIVE + transaksi baru |
| 2 | Aplikasi ditutup dari halaman utama | Tekan Home / Back sampai keluar, lalu transfer uji | Monitoring tetap berjalan | Transaksi muncul di dashboard web tanpa membuka aplikasi |
| 3 | Aplikasi tidak dibuka beberapa jam | Biarkan HP 3–6 jam (dicas & tidak dicas), lalu transfer uji | Monitoring tetap berjalan selama Android mengizinkan | Riwayat heartbeat di dashboard web tanpa celah panjang; transaksi tercatat |
| 4 | Layar HP mati | Kunci layar, tunggu 10 menit, transfer uji | Notifikasi tetap dapat dibaca | Transaksi muncul di dashboard web (boleh tertunda sampai jendela jaringan Doze) |
| 5 | Internet dimatikan | Notifikasi bank sendiri butuh internet, jadi putuskan akses **BTM Monitor saja**: Info aplikasi > Data seluler & Wi-Fi > nonaktifkan (nama menu beda per merek), atau hentikan sementara backend. Alternatif: aktifkan mode pesawat tepat setelah notifikasi bank muncul. Lalu transfer uji | Event masuk antrean lokal | Menu Antrean: event `pending` dengan error jaringan; Histori Deteksi berisi deteksi |
| 6 | Internet dihidupkan kembali | Nyalakan kembali jaringan | Event terkirim otomatis | Antrean kosong / `sent` dalam ≤1 menit; event `NETWORK_LOST` & `NETWORK_RESTORED` di riwayat event perangkat |
| 7 | Notification Access dicabut | Pengaturan > Akses notifikasi > matikan BTM | Dashboard menampilkan PERMISSION ERROR setelah status diketahui | Dashboard web PERMISSION_ERROR pada heartbeat berikutnya (≤60 dtk saat aplikasi aktif); aplikasi merah |
| 8 | Service terputus | Cabut lalu aktifkan lagi akses notifikasi, atau *Force stop* sebentar layanan via Developer options > Running services | Dashboard WARNING/INACTIVE sesuai heartbeat | Event `LISTENER_DISCONNECTED` / `LISTENER_CONNECTED`; status pulih setelah listener terhubung |
| 9 | HP direstart | Restart HP, jangan buka aplikasi, transfer uji setelah 2 menit | Monitoring pulih jika sistem mengizinkan | Event `BOOT_COMPLETED`, heartbeat `trigger=boot`; transaksi tercatat |
| 10 | Aplikasi di-force stop | Pengaturan > Aplikasi > BTM Monitor > Paksa berhenti | Perangkat ditandai tidak aktif setelah heartbeat kedaluwarsa | Dashboard web WARNING (2–5 mnt) lalu INACTIVE (>5 mnt). Buka aplikasi lagi → pulih |
| 11 | Baterai dibatasi | Set baterai aplikasi ke "Dibatasi" / masukkan ke "Aplikasi tidur" | Dashboard menampilkan kondisi terakhir & peringatan jika diketahui | Heartbeat melaporkan `battery_optimization_exempt=false` / `background_restricted=true`; isu di dashboard web |
| 12 | Format notifikasi berubah | Kirim notifikasi uji berformat tidak dikenal (mis. dari aplikasi uji dengan package sumber bank pada HP uji), atau tunggu perubahan format nyata | Parsing error tercatat, tidak membuat transaksi palsu | Histori Deteksi: `UNKNOWN/ERROR`; dashboard web > Perangkat > Parse errors; tidak ada transaksi baru |

Tips: build **debug** menampilkan teks mentah notifikasi di Histori Deteksi — gunakan untuk mengumpulkan contoh
format asli (§9). Build release tidak menampilkan/mencatat isi notifikasi di log.

## 8. Keamanan (PRD §10)

- **HTTPS saja** di release (`res/xml/network_security_config.xml`: cleartext ditolak) + `UrlPolicy` menolak `http://`.
- **Debug**: Network Security Config tidak bisa menyatakan rentang IP, jadi `src/debug/res/xml/network_security_config.xml`
  mengizinkan cleartext dan `core/UrlPolicy.kt` membatasi `http://` hanya untuk `localhost`, `127.0.0.1`,
  `10.0.2.2`, `*.local`, `10.x`, `172.16–31.x`, `192.168.x`.
- `device_token` dienkripsi AES-256/GCM dengan kunci AndroidKeyStore (tidak memakai EncryptedSharedPreferences).
- `android:allowBackup="false"` + `dataExtractionRules` mengecualikan semua data dari backup cloud & transfer antar-perangkat.
- Tidak menyimpan PIN/password bank. Notifikasi OTP/kode verifikasi disamarkan (tidak disimpan/dikirim teksnya).
- Log hanya aktif di build debug dan hanya berisi metadata (package, klasifikasi), bukan isi notifikasi.
- Teks mentah dikirim ke server hanya bila `send_raw_text=true` di pengaturan server (disimpan server 30 hari).

## 9. Menambah / menyesuaikan parser bank

Semua aturan ada di **`app/src/main/java/id/btm/monitor/parser/ParserRules.kt`** (data-driven).

> **TODO wajib sebelum produksi:** template saat ini adalah DUGAAN pola umum — format notifikasi asli belum
> diketahui (PRD §19 #1). Validasi dengan notifikasi nyata dari HP target.

Langkah:
1. Kumpulkan contoh: pasang build debug, lakukan transfer masuk/keluar uji, salin teks dari **Histori Deteksi**
   (atau dashboard web > Perangkat > Parse errors). Samarkan nama/rekening sebelum disimpan.
2. Tambah/ubah `TemplateDef` pada `BankSpec` bank terkait. Template = regex (case-insensitive) dengan placeholder:
   `{AMOUNT}` (Rp/IDR), `{AMOUNT_PLAIN}`, `{SENDER}`, `{REF}`, `{ACCOUNT}`, `{DATETIME}`.
   Gunakan `(?:...)` untuk grup biasa — grup penangkap hanya dari placeholder (divalidasi otomatis).
   Contoh:
   ```kotlin
   TemplateDef(
       "bca-dana-masuk-v2",
       """\bdana\s+masuk\s+{AMOUNT}\s+dari\s+{SENDER}(?:[^\n]*?\bref\s*[:.]?\s*{REF})?""",
   )
   ```
3. Naikkan `version` (mis. `bca-1.0.0` → `bca-1.0.1`) agar dashboard bisa membedakan hasil parser.
4. Tambahkan contoh teks asli + kasus negatif (OTP, promo, transfer keluar, login) ke
   `app/src/test/java/id/btm/monitor/parser/BankParsersTest.kt`, lalu jalankan `./gradlew :app:testDebugUnitTest`.
5. **Bank baru**: buat `BankSpec` baru di `ParserRules`, kelas `class XyzParser(...) : RuleBasedParser(ParserRules.XYZ, zone)`
   di `BankParsers.kt`, daftarkan di `ParserRegistry.createDefault()`, tambahkan package ke `<queries>` di manifest
   (opsional, hanya untuk status "terpasang"), lalu daftarkan sumber bank di dashboard web dengan `parser_key` yang sama.
   Sumber bank yang `parser_key`-nya tidak dikenal memakai **parser generik** yang konservatif.

Aturan keputusan (konservatif — lebih baik ERROR daripada transaksi palsu):
1. Template transfer masuk cocok → `PARSED / INCOMING_TRANSFER`, kecuali nominal tidak valid (mis. ada sen)
   atau teks memuat kata OTP/promo/bunga/refund → `ERROR / UNKNOWN`.
2. OTP / kode verifikasi → `IGNORED / NON_TRANSACTION` (teks disamarkan).
3. Promo/info → `IGNORED`. Kata keluar (keluar, debit, DB, transfer ke, pembayaran, …) → `OUTGOING_TRANSFER`.
4. Frasa masuk tanpa template cocok, atau ada nominal tetapi format tak dikenal → `ERROR / UNKNOWN` + `parse_error`.

Nominal: `Rp 150.000`, `Rp150.000,00`, `Rp. 25.000,-`, `IDR 150,000.00` → `150000` (Long rupiah).
Pemisah ribuan tidak konsisten atau sen ≠ 00 → ERROR.

## 10. Struktur kode

```
app/src/main/java/id/btm/monitor/
  BtmApp.kt, AppContainer.kt (DI manual + siklus hidup), MainActivity.kt
  core/      TimeUtil, Hashing, UrlPolicy, AppLog, Notifications
  data/      prefs/AppPrefs, security/SecureTokenStore, db/(Entities, OutboxDao, DetectionDao, AppDatabase),
             net/(ApiModels, ApiClient), ConfigRepository
  domain/    NotificationProcessor, SyncEngine, HeartbeatManager, StatusChecker, StateReconciler,
             DeviceEventRecorder, RegistrationRepository
  parser/    ParseModels, AmountParser, TimeParser, Template, ParserRules, RuleBasedParser, BankParsers, ParserRegistry
  service/   BankNotificationListener, NetworkMonitor, ListenerState
  work/      WorkScheduler, SyncWorker, HeartbeatWorker
  receiver/  BootReceiver, HeartbeatAlarmReceiver
  ui/        AppRoot (drawer 6 menu), MainViewModel, screens/*, components, theme
app/src/test/java/id/btm/monitor/parser/   unit test JUnit4 (parser, nominal, waktu, registry, dedupe)
```

## 11. Batasan yang diketahui

- Format notifikasi bank belum divalidasi (lihat §9).
- `Force Stop` menghentikan semua komponen sampai aplikasi dibuka lagi (perilaku Android); server menandai
  INACTIVE setelah heartbeat kedaluwarsa.
- Pembatasan vendor (MIUI, ColorOS, dll.) dapat menunda/mematikan proses meski pengaturan sudah benar —
  karena itu status selalu dinilai server dari heartbeat terakhir.
- Notifikasi gaya *inbox* yang menggabungkan beberapa transaksi dalam satu notifikasi hanya diparse transaksi
  pertamanya (umumnya tiap transaksi juga diposting sebagai notifikasi sendiri).
