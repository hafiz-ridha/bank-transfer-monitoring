# Bank Transfer Monitor — Kontrak API v1

Base URL: `https://btm.contoh.co.id/api/v1` (lokal: `http://localhost:4000/api/v1`). Dashboard disajikan di origin yang sama (`/`). Semua body JSON UTF-8.
Waktu: ISO-8601 (`2026-11-27T10:00:00+07:00` atau `...Z`). Nominal: integer rupiah (tanpa desimal).

## Konvensi umum

| Hal | Format |
|---|---|
| Error | `{ "error": { "code": "STRING", "message": "teks (Bahasa Indonesia)", "details": any? } }` |
| Daftar berhalaman | `{ "data": [...], "pagination": { "page", "page_size", "total", "total_pages" } }` — query `page` (mulai 1), `page_size` (maks 200) |
| Sorting | query `sort=<kolom>` & `order=asc|desc` |
| Validasi gagal | 400 `VALIDATION_ERROR` |
| Rate limit | 429 `RATE_LIMITED` |

Kode error penting (kode yang lebih spesifik untuk 409 ada di `error.details.code`): `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INVALID_DEVICE_TOKEN` (401), `CLOCK_SKEW` (401), `MISSING_REQUEST_TIME` (400), `INVALID_PAIRING_CODE` (401), `INVALID_API_KEY` (401), `ORDER_ID_CONFLICT` (409), `INTERNAL_ERROR` (500).

## Enum

- **Status perangkat**: `ACTIVE`, `WARNING`, `INACTIVE`, `PERMISSION_ERROR`, `DISCONNECTED`, `UNKNOWN`
  - `status_source`: `device_reported` | `inferred` | `none` (DISCONNECTED dari laporan perangkat vs INACTIVE dugaan heartbeat hilang)
  - `connection_state`: `connected` | `disconnected_reported` | `disconnected_suspected` | `unknown`
- **Status matching transaksi** (`match_status`): `PENDING` (belum diproses), `MATCHED`, `UNMATCHED`, `AMBIGUOUS`, `MANUAL_VERIFIED`, `REJECTED`, `IGNORED`
- **Status kandidat** (`payment_matches.status`): `CANDIDATE`, `MATCHED`, `MANUAL_VERIFIED`, `REJECTED`, `SUPERSEDED`
- **Order**: `status` = `PENDING|PAID|EXPIRED|CANCELLED`, `payment_status` = `UNPAID|PAID`, `matched_by` = `AUTO|MANUAL|null`
- **Alert**: `status` = `OPEN|ACKNOWLEDGED|RESOLVED`, `severity` = `warning|critical`, `alert_type` = `HEARTBEAT_MISSING|NOTIFICATION_ACCESS_DISABLED|LISTENER_DISCONNECTED|DEVICE_REPORTED_DISCONNECTED|QUEUE_BACKLOG|SYNC_FAILED|UNSUPPORTED_APP_VERSION`
- **Webhook delivery**: `PENDING|DELIVERING|DELIVERED|FAILED|DEAD`
- **Role**: `admin` (semua), `operator` (lihat semua data + verifikasi manual; tidak bisa ubah pengaturan, perangkat, sumber bank, user, API key)

---

## A. Android Monitoring App

Header untuk semua endpoint kecuali `register`:

```
Authorization: Bearer <device_token>
X-Request-Time: <ISO-8601 waktu kirim, atau epoch ms>   # proteksi replay; selisih > 10 menit => 401 CLOCK_SKEW
```

Penanganan respons di aplikasi:
- `401 INVALID_DEVICE_TOKEN` → token dicabut: hentikan sinkronisasi, tampilkan layar registrasi ulang (data antrean lokal TIDAK dihapus).
- `401 CLOCK_SKEW` → tampilkan peringatan "aktifkan tanggal & waktu otomatis"; `details.server_time` tersedia; retry nanti.
- `400 VALIDATION_ERROR` → event tidak akan pernah diterima: tandai `failed` (tidak di-retry otomatis), tampilkan di Antrean.
- `429` / `5xx` / jaringan gagal → retry dengan backoff.

### POST /devices/register
Tanpa auth (rate limit 10/menit/IP). Admin membuat perangkat di dashboard → mendapat **kode pairing** 8 karakter (berlaku 24 jam, sekali pakai).

Request:
```json
{ "pairing_code": "AB3K9QXZ", "device_uuid": "uuid-acak-dibuat-saat-instal",
  "device_name": "opsional", "device_model": "SM-A155F", "manufacturer": "samsung",
  "android_version": "14", "app_version": "1.0.0" }
```
Response 201:
```json
{ "device_id": "uuid-server", "device_uuid": "...", "device_name": "Android Monitoring 01",
  "device_token": "rahasia-simpan-terenkripsi", "config": { ...sama dengan GET /devices/config } }
```

### GET /devices/config
```json
{
  "device": { "id": "uuid", "device_uuid": "...", "device_name": "..." },
  "heartbeat_interval_seconds": 60,
  "min_app_version": "1.0.0",
  "send_raw_text": true,
  "max_request_skew_seconds": 600,
  "update_required": false,
  "bank_sources": [
    { "id": "uuid", "bank_code": "BCA", "bank_name": "Bank Central Asia", "package_name": "com.bca",
      "account_alias": "BCA Utama", "account_identifier": "1234", "parser_key": "bca",
      "parser_version": "bca-1.0.0", "is_default": true, "is_active": true }
  ],
  "config_version": "a1b2c3d4e5f6",
  "server_time": "2026-11-27T03:00:00.000Z"
}
```
Aplikasi hanya membaca notifikasi dari `package_name` yang `is_active=true`. Ambil ulang config saat `config_version` di respons heartbeat berubah.

### POST /devices/heartbeat
Request (field selain yang wajib boleh dihilangkan):
```json
{
  "device_id": "<device_uuid>",                 // wajib, harus sama dengan perangkat pemilik token
  "heartbeat_id": "uuid",                       // idempotensi
  "trigger": "periodic|app_open|service_change|network_restored|boot|manual",
  "app_version": "1.0.0",
  "notification_access": true,                  // wajib
  "listener_connected": true,                   // wajib
  "network_connected": true,
  "battery_optimization_exempt": true,          // hasil PowerManager.isIgnoringBatteryOptimizations
  "background_restricted": false,               // ActivityManager.isBackgroundRestricted
  "pending_queue": 0,
  "failed_queue": 0,
  "last_notification_at": "2026-11-27T10:00:00+07:00",
  "last_listener_connected_at": "2026-11-27T09:00:00+07:00",
  "last_successful_sync_at": "2026-11-27T10:00:30+07:00",
  "last_error": null,
  "reported_at": "2026-11-27T10:01:00+07:00"   // wajib, jam perangkat saat heartbeat dibuat
}
```
Response 200:
```json
{ "accepted": true, "duplicate": false, "stale": false, "status": "ACTIVE", "status_reason": "ok",
  "server_time": "...", "config_version": "a1b2c3d4e5f6", "heartbeat_interval_seconds": 60, "update_required": false }
```
Heartbeat lama (dari antrean offline) diterima & disimpan sebagai histori tetapi tidak menimpa kondisi terbaru (`stale: true`).

### POST /devices/events
```json
{ "events": [ { "event_id": "uuid", "event_type": "LISTENER_DISCONNECTED", "severity": "error",
                "message": "teks", "data": { }, "occurred_at": "..." } ] }
```
`event_type` yang diterima: `APP_OPENED, APP_UPDATED, BOOT_COMPLETED, LISTENER_CONNECTED, LISTENER_DISCONNECTED, LISTENER_REBIND_REQUESTED, PERMISSION_GRANTED, PERMISSION_REVOKED, NETWORK_LOST, NETWORK_RESTORED, SYNC_FAILED, SYNC_RECOVERED, PARSER_ERROR, BATTERY_OPTIMIZATION_CHANGED, CLOCK_SKEW, ERROR, INFO`. Maks 200 per request.

Response: `{ "results": [ { "event_id": "...", "status": "accepted|duplicate|rejected", "error"?: "..." } ] }`

### POST /notifications  dan  POST /notifications/batch
Satu event (`/notifications`) atau `{ "events": [ ...maks 100 ] }` (`/batch`). Event:
```json
{
  "event_id": "uuid-dibuat-di-perangkat",       // wajib, idempotensi
  "package_name": "com.bca",                     // wajib
  "notification_key": "sbn.key",
  "dedupe_key": "sha256(package|title|text|notification.when)",  // anti-duplikat saat notifikasi diposting ulang
  "title": "teks mentah (jika send_raw_text)", "text": "...", "big_text": "...",
  "posted_at": "...", "received_at": "...",
  "classification": "INCOMING_TRANSFER|OUTGOING_TRANSFER|NON_TRANSACTION|UNKNOWN",   // wajib
  "parse_status": "PARSED|ERROR|IGNORED",                                              // wajib
  "parser_key": "bca", "parser_version": "bca-1.0.0", "parse_error": null,
  "parsed": { "bank_code": "BCA", "sender_name": "BUDI SANTOSO", "amount": 150000,
              "transaction_time": "...", "reference_number": "...", "recipient_account": "1234",
              "notification_type": "INCOMING_TRANSFER" }
}
```
Aturan: transaksi hanya dibuat jika `parse_status=PARSED`, `classification=INCOMING_TRANSFER`, `parsed.amount` integer > 0, dan package terdaftar & aktif. Format tidak dikenali yang tampak seperti transaksi → kirim `parse_status=ERROR`, `classification=UNKNOWN`, `parse_error` terisi (server mencatat, TIDAK membuat transaksi). Promo/OTP → `NON_TRANSACTION` + `IGNORED`.

Response `/notifications`: 201 (accepted) / 200 (duplicate) / 503 (rejected, retry).
Response `/batch` 200: `{ "results": [ { "event_id", "status": "accepted|duplicate|rejected", "transaction_id"?, "transaction_code"?, "parse_status"?, "error"?, "retryable"? } ] }`
→ Hapus dari antrean lokal **hanya** event dengan status `accepted` atau `duplicate`. `rejected` + `retryable:true` dicoba ulang.

### GET /devices/me
Objek Device (lihat B) untuk perangkat pemilik token — dipakai layar Status Monitoring.

---

## B. Web Dashboard

Header: `Authorization: Bearer <Supabase access_token>`. Mode pengembangan (`AUTH_MODE=dev` di backend): `Bearer dev:<email>`.
Akun harus terdaftar di tabel `users` (admin menambahkan lewat `/users`; email di `BOOTSTRAP_ADMIN_EMAILS` otomatis menjadi admin saat login pertama). 403 jika tidak terdaftar/nonaktif.

### Objek Device
```json
{ "id", "device_uuid", "device_name", "device_model", "manufacturer", "android_version", "app_version",
  "status", "status_reason", "status_source", "status_changed_at", "connection_state", "heartbeat_age_seconds",
  "issues": [ { "code": "BATTERY_OPTIMIZED", "severity": "warning|critical", "message": "..." } ],
  "notification_access", "listener_connected", "battery_optimization_exempt", "background_restricted", "network_connected",
  "last_seen_at", "last_heartbeat_at", "last_reported_at", "last_listener_connected_at", "last_notification_at",
  "last_successful_sync_at", "pending_queue", "failed_queue", "last_error", "is_active",
  "registered", "registered_at", "token_issued_at", "token_revoked_at", "pairing_pending", "pairing_expires_at", "created_at" }
```
Boolean kondisi bisa `null` (belum dilaporkan).

### Objek Alert
`{ id, device_id, device_name, alert_type, severity, message, status, data, opened_at, acknowledged_at, acknowledged_by, resolved_at, last_notified_at, notify_count }`

### Objek Transaksi (daftar)
`{ id, transaction_code ("TRX-000001"), bank_code, account_alias, bank_source_id, sender_name, amount, transaction_time, received_time, reference_number, recipient_account, notification_type, parser_version, match_status, match_reason, match_score, matched_at, note, created_at, pos_order_id, pos_customer_name, candidate_count }`

### Endpoint

| Method & path | Role | Keterangan |
|---|---|---|
| `GET /me` | semua | `{ id, email, full_name, role, is_active, last_login_at }` |
| `GET /dashboard/summary` | semua | lihat di bawah |
| `GET /devices` | semua | `{ data: [Device] }` |
| `POST /devices` `{device_name}` | admin | 201 `{ device: Device, pairing_code }` (Device lengkap dengan data kesehatan, sama seperti GET) |
| `GET /devices/:id` | semua | Device |
| `PATCH /devices/:id` `{device_name?, is_active?}` | admin | Device |
| `POST /devices/:id/pairing-code` | admin | `{ device, pairing_code }` — mencabut token lama |
| `POST /devices/:id/revoke-token` | admin | Device |
| `GET /devices/:id/health` | semua | `{ device_id, status, status_reason, status_source, connection_state, heartbeat_age_seconds, issues, checks:{listener_connected, notification_access, network_connected, battery_optimization_exempt, background_restricted, pending_queue, failed_queue}, timestamps:{last_heartbeat_at, last_listener_connected_at, last_notification_at, last_successful_sync_at, last_seen_at}, last_error, last_24h:{heartbeats, listener_down, permission_down, max_pending_queue, parse_errors} }` |
| `GET /devices/:id/heartbeats` | semua | berhalaman; baris `{ id, heartbeat_id, trigger, app_version, notification_access, listener_connected, network_connected, battery_optimization_exempt, background_restricted, pending_queue, failed_queue, last_notification_at, last_successful_sync_at, last_error, reported_at, received_at, gap_seconds }` |
| `GET /devices/:id/events?type=A,B&severity=` | semua | berhalaman; baris `{ id, event_id, event_type, source (device/server), severity, message, data, occurred_at, received_at }` |
| `GET /devices/:id/parse-errors` | semua | berhalaman; `{ id, event_id, package_name, title, text, parser_key, parser_version, parse_error, server_received_at, device_received_at, account_alias, bank_code }` |
| `GET /devices/:id/app-versions` | semua | `{ data: [{ app_version, first_seen_at, last_seen_at, heartbeats }] }` |
| `GET /alerts?status=active|all|OPEN|ACKNOWLEDGED|RESOLVED&device_id=` | semua | `{ data: [Alert] }` (default `active` = belum resolved, `all` = semua) |
| `POST /alerts/:id/acknowledge` | semua | Alert |
| `GET /transactions` | semua | filter: `date_from`, `date_to` (YYYY-MM-DD, zona waktu operasional), `bank_code`, `bank_source_id`, `amount`, `amount_min`, `amount_max`, `status` (koma: `MATCHED,MANUAL_VERIFIED`), `q` (nama/referensi/TRX/order/alias), `sort` = `received_time|transaction_time|amount|sender_name|bank_code|match_status`, `pos_visibility` = `visible|hidden` (tampil / disembunyikan di API POS); respons berhalaman + `totals: { count, amount }`. Tiap baris juga berisi `pos_hidden` (disembunyikan manual), `pos_hidden_at`, `pos_hidden_rules` (aturan nama pengirim yang cocok), `pos_visible` |
| `GET /transactions/export.csv` | semua | filter sama, file CSV |
| `GET /transactions/:id` | semua | `{ transaction, candidates: [Candidate], notification: {...}|null, audit: [{ id, actor_type, actor_label, action, note, after, created_at }] }` |
| `GET /transactions/:id/order-options` | semua | order UNPAID nominal sama (PENDING/EXPIRED), untuk tautkan manual |
| `POST /transactions/:id/assign` `{order_id, note?}` | semua | tautkan manual → `MANUAL_VERIFIED` |
| `POST /transactions/:id/ignore` `{note?}` | semua | → `IGNORED` |
| `POST /transactions/:id/reopen` `{note?}` | semua | IGNORED/REJECTED → dicocokkan ulang |
| `POST /transactions/:id/rematch` | semua | jalankan matching ulang |
| `POST /transactions/:id/notes` `{note}` | semua | catatan |
| `POST /transactions/:id/pos-visibility` `{hidden, note?, sender_rule?}` | semua (`sender_rule`: admin) | sembunyikan (`hidden: true`) / tampilkan lagi transaksi di API POS. `sender_rule: true` ikut menambah nama pengirim ke `pos_api.hidden_senders` (saat menyembunyikan) atau menghapus aturan pengirim yang cocok (saat menampilkan). Tidak memengaruhi dashboard & pencocokan otomatis. Respons `{ id, transaction_code, sender_name, pos_hidden, pos_hidden_rules, pos_visible }`; audit `transaction.pos_hide` / `transaction.pos_show` |
| `GET /matches?status=CANDIDATE&transaction_status=AMBIGUOUS` | semua | antrean verifikasi; baris `{ id, status, score, score_breakdown, reasons, note, created_at, decided_at, transaction_id, transaction_code, sender_name, amount, bank_code, account_alias, transaction_time, received_time, match_status, match_reason, order_uuid, order_id, customer_name, order_created_at, expires_at, order_status }` |
| `POST /matches/:id/verify` `{note?}` | semua | pilih kandidat → `MANUAL_VERIFIED` + webhook |
| `POST /matches/:id/reject` `{note?}` | semua | tolak kandidat |
| `GET /orders` | semua | filter `status`, `payment_status`, `date_from`, `date_to`, `amount_min`, `amount_max`, `q`; `sort` = `created_at|amount|expires_at|paid_at|order_id`; baris = kolom `pos_orders` + `transaction_code`, `paid_sender_name`, `candidate_count` |
| `GET /orders/:id` (uuid atau order_id POS) | semua | `{ order, transaction, candidates, webhooks }` |
| `GET /reports?granularity=day|month&from=&to=` | semua | lihat di bawah |
| `GET /reports/export.csv` | semua | CSV rekap |
| `GET /bank-sources` | semua | `{ data: [{ id, bank_code, bank_name, package_name, account_alias, account_identifier, account_holder, parser_key, parser_version, is_default, is_active, last_notification_at, last_parse_error_at, last_parse_error, parse_errors_7d, transaction_count, created_at, updated_at }] }` |
| `POST /bank-sources` | admin | `{ bank_code (A-Z0-9_), bank_name, package_name, account_alias, account_identifier?, account_holder?, parser_key?, is_default?, is_active? }` |
| `PATCH /bank-sources/:id` | admin | field yang sama (parsial) |
| `GET /bank-sources/:id/notifications` | semua | 50 notifikasi terakhir |
| `GET /settings` | semua | `{ data: [{ key, value, type (int/number/bool/string/url/timezone), group, label, min, max, secret, is_set }] }` |
| `PUT /settings` `{ values: { key: value } }` | admin | `{ data: [...] }` |
| `POST /settings/webhook/rotate-secret` | admin | `{ secret }` (ditampilkan sekali) |
| `POST /settings/webhook/test` | admin | `{ ok, status_code, error, response, duration_ms, event_id }` |
| `GET /webhook-deliveries?status=` | semua | berhalaman; `{ id, event_id, event_type, status, attempts, max_attempts, next_attempt_at, last_attempt_at, delivered_at, last_status_code, last_error, attempt_log, payload, pos_order_id, transaction_code, created_at }` |
| `POST /webhook-deliveries/:id/retry` | admin | kirim ulang |
| `GET /api-clients` | admin | `{ data: [{ id, name, key_prefix, scopes, is_active, last_used_at, created_at, revoked_at }] }` |
| `POST /api-clients` `{name}` | admin | 201 + `api_key` (ditampilkan sekali) |
| `POST /api-clients/:id/revoke` | admin | |
| `GET /users` | admin | `{ data: [{ id, email, full_name, role, is_active, last_login_at, created_at }] }` |
| `POST /users` `{email, role, full_name?, password?}` | admin | tanpa password → undangan email Supabase |
| `PATCH /users/:id` `{role?, is_active?, full_name?}` | admin | |
| `GET /audit-logs?entity_type=&entity_id=&action=&actor_type=` | admin | berhalaman. `entity_type`: `transaction` (id = UUID transaksi), `order` (id = order_id POS), `device`, `bank_source`, `settings`, `api_client`, `user`, `webhook_delivery` |

Candidate: `{ id, status, score, score_breakdown: { amount, time, name, account }, reasons: [string], note, decided_at, decided_by_email, order_uuid, order_id, customer_name, amount, order_created_at, expires_at, order_status, payment_status }`

`GET /dashboard/summary`:
```json
{ "timezone": "Asia/Jakarta",
  "today": { "total_count", "total_amount", "matched_count", "auto_matched_count", "manual_verified_count",
             "unmatched_count", "ambiguous_count", "ignored_count", "matched_amount", "parse_error_count" },
  "last_transaction_at": "...", "ambiguous_open": 0,
  "pending_orders": { "n": 0, "amount": 0 }, "webhooks": { "failed": 0, "pending": 0 },
  "devices": [Device], "pending_queue_total": 0, "alerts": [Alert] }
```

`GET /reports`:
```json
{ "granularity": "day", "from": "2026-11-01", "to": "2026-11-27", "timezone": "Asia/Jakarta",
  "rows": [ { "period": "2026-11-27", "count", "amount", "matched_count", "matched_amount", "manual_verified_count",
              "manual_verified_amount", "unmatched_count", "unmatched_amount", "ambiguous_count", "ignored_count" } ],
  "by_bank": [ { "bank_code", "account_alias", "count", "amount", "matched_count" } ],
  "totals": { ...jumlah semua kolom numerik rows },
  "pos_reconciliation": { "orders_total", "orders_amount", "orders_paid", "orders_paid_amount", "paid_auto", "paid_manual",
                          "orders_expired", "orders_cancelled", "orders_pending", "transactions_without_order", "transactions_without_order_amount" } }
```

Kunci pengaturan (grup): `general.*` (timezone, business_name) · `device.*` (heartbeat_interval_seconds, active_threshold_seconds, inactive_threshold_seconds, queue_warning_threshold, sync_stale_minutes, min_app_version, warn_battery_optimization, send_raw_text) · `matching.*` (auto_match_enabled, window_before_minutes, default_window_minutes, grace_after_minutes, min_auto_score, name_match_threshold) · `retention.*` · `webhook.*` (enabled, url, secret, max_attempts, timeout_ms) · `alerts.*` (telegram_enabled, telegram_chat_id, repeat_minutes) · `security.max_request_skew_seconds`.

---

## C. POS Integration

Header: `X-API-Key: btm_pos_...` (dibuat admin di dashboard > Pengaturan > API).

### POST /pos/orders
```json
{ "order_id": "POS-20261127-001", "customer_name": "Pelanggan", "amount": 150000,
  "payment_method": "bank_transfer", "destination_account": "opsional, mis. 1234",
  "created_at": "2026-11-27T10:00:00+07:00", "expires_at": "2026-11-27T10:30:00+07:00", "metadata": {} }
```
- 201 order baru, 200 order yang sama dikirim ulang (idempoten), 409 `ORDER_ID_CONFLICT` jika `order_id` sama dengan data berbeda.
- Respons: `{ "created": true, "order": <Payment> }`

### GET /pos/orders/{order_id}/payment → Payment
```json
{ "order_id": "POS-20261127-001", "amount": 150000, "status": "PAID", "payment_status": "PAID", "paid": true,
  "paid_at": "2026-11-27T03:05:00.000Z", "matched_by": "AUTO", "review_pending": false, "expires_at": "...",
  "transaction": { "transaction_id": "TRX-000001", "bank_code": "BCA", "account_alias": "BCA Utama",
                   "sender_name": "BUDI SANTOSO", "amount": 150000, "reference_number": null,
                   "transaction_time": "...", "received_time": "..." } }
```
`review_pending: true` = ada transfer yang cocok tetapi ambigu dan menunggu verifikasi admin (order belum dianggap lunas).

### POST /pos/orders/{order_id}/cancel → Payment (409 jika sudah dibayar)

### GET /pos/transactions → daftar transaksi masuk (baca saja)

Query (semua opsional):

| Parameter | Keterangan |
|---|---|
| `date_from`, `date_to` | `YYYY-MM-DD`, zona waktu operasional (pengaturan `general.timezone`) |
| `since` | ISO 8601. Hanya transaksi yang **dicatat server** setelah waktu ini (bandingkan dengan `recorded_at`), untuk polling inkremental. |
| `status` | `match_status`, bisa dipisah koma, mis. `UNMATCHED,AMBIGUOUS` |
| `amount`, `amount_min`, `amount_max` | Nominal (Rupiah, bilangan bulat) |
| `bank_code` | mis. `BCA` |
| `page`, `page_size` | Default `1` & `50`, `page_size` maksimal 200 |
| `order` | `desc` (default, terbaru dulu) atau `asc`, berdasarkan `recorded_at` |

```json
{ "data": [
    { "transaction_id": "TRX-000012", "bank_code": "BCA", "account_alias": "BCA Toko", "sender_name": "SITI AMINAH",
      "amount": 77000, "reference_number": "BCA12127", "transaction_time": "...", "received_time": "...",
      "match_status": "UNMATCHED", "matched_at": null, "order_id": null, "recorded_at": "2026-11-28T01:44:14.512Z" } ],
  "pagination": { "page": 1, "page_size": 50, "total": 1, "total_pages": 1 },
  "totals": { "count": 1, "amount": 77000 } }
```

- `order_id` diisi bila transaksi sudah tertaut ke order (`MATCHED` / `MANUAL_VERIFIED`).
- Polling: simpan `recorded_at` terbesar yang sudah diproses, lalu panggil `?since=<nilai itu>&order=asc`.
- **Tidak ditampilkan** (dan tidak bisa ditautkan lewat API POS):
  - transaksi yang disembunyikan dari dashboard: menu **Transaksi masuk** → tombol **🙈 Sembunyikan** (atau **Sembunyikan dari API POS** di halaman detail);
  - transaksi dari pengirim di **Pengaturan → API POS** (`pos_api.hidden_senders`).

  Transaksi itu tetap tampil di dashboard (filter **API POS: Disembunyikan**) dan tetap ikut pencocokan otomatis.

### GET /pos/devices → status perangkat monitoring (baca saja)

Status HP Android yang membaca notifikasi bank, dihitung server dari heartbeat (PRD §4.3). Hanya perangkat yang aktif di dashboard yang ditampilkan.

```json
{ "data": [
    { "id": "808401f1-…", "device_name": "Android Monitoring 01", "status": "ACTIVE", "status_reason": "ok",
      "status_source": "device_reported", "connection_state": "connected", "heartbeat_age_seconds": 42,
      "issues": [], "notification_access": true, "listener_connected": true, "network_connected": true,
      "battery_optimization_exempt": true, "last_heartbeat_at": "...", "last_notification_at": "...",
      "last_successful_sync_at": "...", "pending_queue": 0, "failed_queue": 0,
      "device_model": "SM-A155F", "app_version": "1.0.0", "registered": true } ],
  "summary": { "total": 1, "active": 1, "warning": 0, "inactive": 0, "permission_error": 0, "disconnected": 0,
               "unknown": 0, "monitoring_ok": true, "checked_at": "2026-11-28T03:00:00.000Z" } }
```

- `status`:
  - `ACTIVE`: heartbeat ≤ 2 menit.
  - `WARNING`: 2–5 menit, atau ada masalah ringan (antrean menumpuk, optimasi baterai).
  - `INACTIVE`: > 5 menit tanpa heartbeat.
  - `PERMISSION_ERROR`: Notification Access dicabut.
  - `DISCONNECTED`, `UNKNOWN`: belum pernah melapor atau laporan tidak lengkap.
- `summary.monitoring_ok` = minimal satu perangkat `ACTIVE`. Bila `false`, POS sebaiknya memperingatkan kasir bahwa transfer tidak terdeteksi otomatis dan perlu cek mutasi manual.
- `issues[]`: `{ code, severity, message }`, berisi rincian masalah (bahasa Indonesia), mis. listener terputus atau antrean belum terkirim.
- `connection_state`: `connected`, `disconnected_reported` (HP melapor listener terputus), `disconnected_suspected` (heartbeat terlambat), atau `unknown`.
- `registered: false` = perangkat sudah dibuat di dashboard tetapi belum dipasangkan di HP.

### POST /pos/orders/{order_id}/match → Payment

Sistem POS menautkan transaksi masuk ke order, misalnya untuk transfer ambigu atau terlambat yang sudah dicek kasir.

```json
{ "transaction_id": "TRX-000012", "note": "opsional, dicatat di audit log" }
```

- Aturan sama dengan verifikasi manual di dashboard: nominal transaksi = nominal order, transaksi belum dipakai order lain, dan order belum lunas atau dibatalkan. Order `EXPIRED` boleh ditautkan (transfer terlambat).
- Hasil: transaksi `MANUAL_VERIFIED` (alasan `pos_verification`), order `PAID` dengan `matched_by: "MANUAL"`, audit log `match.pos_verify` (aktor: nama API key). Webhook `payment.matched` tetap dikirim bila aktif.
- 200: berhasil, atau pasangan yang sama sudah tertaut sebelumnya (aman di-retry).
- 400: nominal berbeda atau body tidak valid.
- 404: order tidak ada, atau transaksi tidak ada / disembunyikan dari API POS.
- 409: `error.details.code` = `TRANSACTION_ALREADY_USED` (transaksi sudah untuk order lain), `ORDER_ALREADY_PAID`, atau order dibatalkan.

### Webhook `payment.matched`
Dikirim (POST) ke URL di pengaturan saat order lunas (otomatis, verifikasi manual, atau match dari POS). **Tidak pernah** dikirim untuk transaksi ambigu.

Headers:
```
Content-Type: application/json
X-BTM-Event: payment.matched
X-BTM-Event-Id: evt-xxxx          (sama dengan header Idempotency-Key)
X-BTM-Timestamp: 1764212700       (epoch detik)
X-BTM-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
```
Body:
```json
{ "event": "payment.matched", "event_id": "evt-123456", "order_id": "POS-20261127-001", "transaction_id": "TRX-000001",
  "amount": 150000, "paid_at": "2026-11-27T03:05:00.000Z", "status": "paid", "match_type": "auto|manual",
  "bank_code": "BCA", "account_alias": "BCA Utama", "sender_name": "BUDI SANTOSO", "reference_number": null }
```
POS harus: (1) verifikasi signature dengan perbandingan waktu-konstan, (2) tolak timestamp > 5 menit, (3) proses idempoten berdasarkan `event_id`/`order_id`, (4) balas 2xx dalam 10 detik. Non-2xx/timeout di-retry dengan backoff (30 dtk → 4 jam, maks 10 kali, lalu `DEAD`; admin dapat kirim ulang).

Contoh verifikasi (Node.js):
```js
import crypto from 'node:crypto';
function verify(req, rawBody, secret) {
  const ts = req.headers['x-btm-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const got = req.headers['x-btm-signature'] ?? '';
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

---

## D. Health
- `GET /healthz` → `{ ok: true }` (proses hidup)
- `GET /readyz` → `{ ok: true, db }` atau 503 (database tidak dapat dijangkau)
- `GET /app-config.js` → konfigurasi publik dashboard (`window.__BTM_CONFIG__`: `supabaseUrl`, `supabaseAnonKey`, `authMode`); hanya bila dashboard tersedia. Tanpa dashboard, `GET /` menjawab info service JSON.
