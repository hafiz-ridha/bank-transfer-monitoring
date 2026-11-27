-- =====================================================================
-- Bank Transfer Monitoring System - skema awal (PRD v1.1 §9)
-- Portabel: Supabase PostgreSQL atau PostgreSQL 14+ lain.
-- Semua nominal BIGINT (rupiah, tanpa desimal), semua waktu TIMESTAMPTZ.
-- RLS diaktifkan pada semua tabel TANPA policy: akses hanya lewat backend
-- (koneksi role postgres / service role). Anon & authenticated tidak punya akses.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. users (profil & role dashboard; id = auth.users.id di Supabase Auth)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. devices
-- ---------------------------------------------------------------------
CREATE TABLE devices (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_uuid                 TEXT UNIQUE,              -- "device_id" yang dikirim Android
  device_name                 TEXT NOT NULL,
  device_model                TEXT,
  manufacturer                TEXT,
  android_version             TEXT,
  app_version                 TEXT,
  status                      TEXT NOT NULL DEFAULT 'UNKNOWN'
                              CHECK (status IN ('ACTIVE','WARNING','INACTIVE','PERMISSION_ERROR','DISCONNECTED','UNKNOWN')),
  status_reason               TEXT,
  status_source               TEXT CHECK (status_source IN ('device_reported','inferred','none')),
  status_changed_at           TIMESTAMPTZ,
  notification_access         BOOLEAN,
  listener_connected          BOOLEAN,
  battery_optimization_exempt BOOLEAN,
  background_restricted       BOOLEAN,
  network_connected           BOOLEAN,
  network_reported_at         TIMESTAMPTZ,
  last_seen_at                TIMESTAMPTZ,              -- request terautentikasi apa pun
  last_heartbeat_at           TIMESTAMPTZ,              -- waktu server menerima heartbeat
  last_reported_at            TIMESTAMPTZ,              -- jam perangkat saat heartbeat dibuat
  last_listener_connected_at  TIMESTAMPTZ,
  last_notification_at        TIMESTAMPTZ,
  last_successful_sync_at     TIMESTAMPTZ,
  pending_queue               INTEGER NOT NULL DEFAULT 0,
  failed_queue                INTEGER NOT NULL DEFAULT 0,
  last_error                  TEXT,
  token_hash                  TEXT UNIQUE,
  token_issued_at             TIMESTAMPTZ,
  token_revoked_at            TIMESTAMPTZ,
  pairing_code_hash           TEXT,
  pairing_expires_at          TIMESTAMPTZ,
  registered_at               TIMESTAMPTZ,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX devices_status_idx ON devices (status);

-- ---------------------------------------------------------------------
-- 3. device_heartbeats (histori, bukan hanya status terbaru)
-- ---------------------------------------------------------------------
CREATE TABLE device_heartbeats (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id                   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  heartbeat_id                TEXT,
  trigger                     TEXT,
  app_version                 TEXT,
  notification_access         BOOLEAN,
  listener_connected          BOOLEAN,
  network_connected           BOOLEAN,
  battery_optimization_exempt BOOLEAN,
  background_restricted       BOOLEAN,
  pending_queue               INTEGER,
  failed_queue                INTEGER,
  last_notification_at        TIMESTAMPTZ,
  last_listener_connected_at  TIMESTAMPTZ,
  last_successful_sync_at     TIMESTAMPTZ,
  last_error                  TEXT,
  reported_at                 TIMESTAMPTZ,
  received_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload                     JSONB
);
CREATE UNIQUE INDEX device_heartbeats_dedupe_idx ON device_heartbeats (device_id, heartbeat_id) WHERE heartbeat_id IS NOT NULL;
CREATE INDEX device_heartbeats_device_time_idx ON device_heartbeats (device_id, received_at DESC);

-- ---------------------------------------------------------------------
-- 4. device_events (riwayat service terputus, izin, sync gagal, versi, dll.)
-- ---------------------------------------------------------------------
CREATE TABLE device_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_id    TEXT,
  event_type  TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'device' CHECK (source IN ('device','server')),
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error')),
  message     TEXT,
  data        JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX device_events_dedupe_idx ON device_events (device_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX device_events_device_time_idx ON device_events (device_id, occurred_at DESC);
CREATE INDEX device_events_type_idx ON device_events (event_type);

-- ---------------------------------------------------------------------
-- 5. bank_sources (aplikasi bank + rekening)
-- ---------------------------------------------------------------------
CREATE TABLE bank_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_code             TEXT NOT NULL,
  bank_name             TEXT NOT NULL,
  package_name          TEXT NOT NULL,
  account_alias         TEXT NOT NULL,
  account_identifier    TEXT,           -- mis. 4 digit terakhir rekening, untuk rekening ganda di 1 aplikasi
  account_holder        TEXT,
  parser_key            TEXT,
  parser_version        TEXT,
  is_default            BOOLEAN NOT NULL DEFAULT TRUE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_notification_at  TIMESTAMPTZ,
  last_parse_error_at   TIMESTAMPTZ,
  last_parse_error      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_name, account_alias)
);
CREATE INDEX bank_sources_package_idx ON bank_sources (package_name);

-- ---------------------------------------------------------------------
-- 6. notification_events (notifikasi mentah + hasil parsing; teks mentah dihapus setelah 30 hari)
-- ---------------------------------------------------------------------
CREATE TABLE notification_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            TEXT NOT NULL UNIQUE,
  device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  bank_source_id      UUID REFERENCES bank_sources(id) ON DELETE SET NULL,
  package_name        TEXT NOT NULL,
  notification_key    TEXT,
  dedupe_key          TEXT,
  title               TEXT,
  text                TEXT,
  big_text            TEXT,
  posted_at           TIMESTAMPTZ,
  device_received_at  TIMESTAMPTZ,
  server_received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  classification      TEXT NOT NULL
                      CHECK (classification IN ('INCOMING_TRANSFER','OUTGOING_TRANSFER','NON_TRANSACTION','UNKNOWN')),
  parse_status        TEXT NOT NULL CHECK (parse_status IN ('PARSED','ERROR','IGNORED')),
  parser_key          TEXT,
  parser_version      TEXT,
  parse_error         TEXT,
  parsed              JSONB,
  transaction_id      UUID,
  raw_purged_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX notification_events_dedupe_idx ON notification_events (device_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_events_received_idx ON notification_events (server_received_at DESC);
CREATE INDEX notification_events_status_idx ON notification_events (parse_status, server_received_at DESC);

-- ---------------------------------------------------------------------
-- 7. pos_orders
-- ---------------------------------------------------------------------
CREATE TABLE pos_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             TEXT NOT NULL UNIQUE,
  customer_name        TEXT,
  amount               BIGINT NOT NULL CHECK (amount > 0),
  payment_method       TEXT NOT NULL DEFAULT 'bank_transfer',
  destination_account  TEXT,
  order_created_at     TIMESTAMPTZ NOT NULL,
  expires_at           TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED')),
  payment_status       TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID')),
  paid_transaction_id  UUID UNIQUE,
  paid_at              TIMESTAMPTZ,
  matched_by           TEXT CHECK (matched_by IN ('AUTO','MANUAL')),
  api_client_id        UUID,
  request_hash         TEXT,
  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pos_orders_amount_status_idx ON pos_orders (amount, status, payment_status);
CREATE INDEX pos_orders_created_idx ON pos_orders (order_created_at DESC);

-- ---------------------------------------------------------------------
-- 8. incoming_transactions
-- ---------------------------------------------------------------------
CREATE SEQUENCE incoming_transaction_seq;
CREATE TABLE incoming_transactions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_code       TEXT NOT NULL UNIQUE
                         DEFAULT ('TRX-' || lpad(nextval('incoming_transaction_seq')::text, 6, '0')),
  notification_event_id  UUID UNIQUE REFERENCES notification_events(id) ON DELETE SET NULL,
  device_id              UUID REFERENCES devices(id) ON DELETE SET NULL,
  bank_source_id         UUID REFERENCES bank_sources(id) ON DELETE SET NULL,
  bank_code              TEXT NOT NULL,
  account_alias          TEXT,
  sender_name            TEXT,
  amount                 BIGINT NOT NULL CHECK (amount > 0),
  transaction_time       TIMESTAMPTZ,
  received_time          TIMESTAMPTZ NOT NULL,
  reference_number       TEXT,
  recipient_account      TEXT,
  notification_type      TEXT,
  parser_version         TEXT,
  match_status           TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (match_status IN ('PENDING','MATCHED','UNMATCHED','AMBIGUOUS','MANUAL_VERIFIED','REJECTED','IGNORED')),
  match_reason           TEXT,
  matched_order_id       UUID UNIQUE REFERENCES pos_orders(id) ON DELETE SET NULL,
  match_score            INTEGER,
  matched_at             TIMESTAMPTZ,
  match_attempts         INTEGER NOT NULL DEFAULT 0,
  last_matched_at        TIMESTAMPTZ,
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Proteksi duplikasi: nomor referensi yang sama dari bank yang sama hanya boleh tercatat sekali.
CREATE UNIQUE INDEX incoming_transactions_reference_idx ON incoming_transactions (bank_code, reference_number) WHERE reference_number IS NOT NULL;
CREATE INDEX incoming_transactions_received_idx ON incoming_transactions (received_time DESC);
CREATE INDEX incoming_transactions_trx_time_idx ON incoming_transactions (transaction_time DESC);
CREATE INDEX incoming_transactions_amount_idx ON incoming_transactions (amount);
CREATE INDEX incoming_transactions_bank_idx ON incoming_transactions (bank_code, bank_source_id);
CREATE INDEX incoming_transactions_status_idx ON incoming_transactions (match_status, received_time DESC);

ALTER TABLE notification_events
  ADD CONSTRAINT notification_events_transaction_fk
  FOREIGN KEY (transaction_id) REFERENCES incoming_transactions(id) ON DELETE SET NULL;
ALTER TABLE pos_orders
  ADD CONSTRAINT pos_orders_paid_transaction_fk
  FOREIGN KEY (paid_transaction_id) REFERENCES incoming_transactions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 9. payment_matches (kandidat & keputusan pencocokan)
-- ---------------------------------------------------------------------
CREATE TABLE payment_matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL REFERENCES incoming_transactions(id) ON DELETE CASCADE,
  order_id         UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  score            INTEGER NOT NULL,
  score_breakdown  JSONB NOT NULL,
  reasons          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'CANDIDATE'
                   CHECK (status IN ('CANDIDATE','MATCHED','MANUAL_VERIFIED','REJECTED','SUPERSEDED')),
  decided_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, order_id)
);
-- Satu transaksi hanya untuk satu order, satu order hanya dibayar satu transaksi.
CREATE UNIQUE INDEX payment_matches_one_per_transaction ON payment_matches (transaction_id) WHERE status IN ('MATCHED','MANUAL_VERIFIED');
CREATE UNIQUE INDEX payment_matches_one_per_order ON payment_matches (order_id) WHERE status IN ('MATCHED','MANUAL_VERIFIED');
CREATE INDEX payment_matches_status_idx ON payment_matches (status, created_at DESC);

-- ---------------------------------------------------------------------
-- 10. webhook_deliveries (outbox + delivery log)
-- ---------------------------------------------------------------------
CREATE TABLE webhook_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  order_id          UUID REFERENCES pos_orders(id) ON DELETE SET NULL,
  transaction_id    UUID REFERENCES incoming_transactions(id) ON DELETE SET NULL,
  target_url        TEXT,
  payload           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','DELIVERING','DELIVERED','FAILED','DEAD')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 10,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at   TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  last_status_code  INTEGER,
  last_error        TEXT,
  attempt_log       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotensi: hanya satu event payment.matched per order.
CREATE UNIQUE INDEX webhook_deliveries_one_payment_per_order ON webhook_deliveries (order_id) WHERE event_type = 'payment.matched';
CREATE INDEX webhook_deliveries_queue_idx ON webhook_deliveries (status, next_attempt_at);

-- ---------------------------------------------------------------------
-- 11. audit_logs (tidak dihapus otomatis)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('user','device','pos','system')),
  actor_id     TEXT,
  actor_label  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  before       JSONB,
  after        JSONB,
  note         TEXT,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_time_idx ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------------
-- 12. system_settings
-- ---------------------------------------------------------------------
CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Tabel pendukung: alerts & api_clients (POS)
-- ---------------------------------------------------------------------
CREATE TABLE alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id        UUID REFERENCES devices(id) ON DELETE CASCADE,
  alert_type       TEXT NOT NULL,
  severity         TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  message          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  data             JSONB,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  notify_count     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX alerts_one_open_per_type ON alerts (device_id, alert_type) WHERE status <> 'RESOLVED';
CREATE INDEX alerts_status_idx ON alerts (status, opened_at DESC);

CREATE TABLE api_clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        JSONB NOT NULL DEFAULT '["pos"]'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
ALTER TABLE pos_orders
  ADD CONSTRAINT pos_orders_api_client_fk
  FOREIGN KEY (api_client_id) REFERENCES api_clients(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- RLS: aktif di semua tabel, tanpa policy => hanya backend (bypass RLS) yang bisa akses.
-- ---------------------------------------------------------------------
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_heartbeats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_sources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_matches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_clients           ENABLE ROW LEVEL SECURITY;
