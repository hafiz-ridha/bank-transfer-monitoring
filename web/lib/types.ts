// Tipe data sesuai kontrak API v1 (docs/API.md bagian B).

export type Role = 'admin' | 'operator';
export type ISODate = string;

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

export interface ListResponse<T> {
  data: T[];
}

export interface Me {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  last_login_at: ISODate | null;
}

// ------------------------------------------------------------------ perangkat
export type DeviceStatus = 'ACTIVE' | 'WARNING' | 'INACTIVE' | 'PERMISSION_ERROR' | 'DISCONNECTED' | 'UNKNOWN';
export type StatusSource = 'device_reported' | 'inferred' | 'none';
export type ConnectionState = 'connected' | 'disconnected_reported' | 'disconnected_suspected' | 'unknown';

export interface DeviceIssue {
  code: string;
  severity: 'warning' | 'critical';
  message: string;
}

export interface Device {
  id: string;
  device_uuid: string | null;
  device_name: string;
  device_model: string | null;
  manufacturer: string | null;
  android_version: string | null;
  app_version: string | null;
  status: DeviceStatus;
  status_reason: string | null;
  status_source: StatusSource | null;
  status_changed_at: ISODate | null;
  connection_state?: ConnectionState;
  heartbeat_age_seconds?: number | null;
  issues: DeviceIssue[];
  notification_access: boolean | null;
  listener_connected: boolean | null;
  battery_optimization_exempt: boolean | null;
  background_restricted: boolean | null;
  network_connected: boolean | null;
  last_seen_at: ISODate | null;
  last_heartbeat_at: ISODate | null;
  last_reported_at: ISODate | null;
  last_listener_connected_at: ISODate | null;
  last_notification_at: ISODate | null;
  last_successful_sync_at: ISODate | null;
  pending_queue: number | null;
  failed_queue: number | null;
  last_error: string | null;
  is_active: boolean;
  registered: boolean;
  registered_at: ISODate | null;
  token_issued_at: ISODate | null;
  token_revoked_at: ISODate | null;
  pairing_pending: boolean;
  pairing_expires_at: ISODate | null;
  created_at: ISODate;
}

export interface PairingResponse {
  device: Device;
  pairing_code: string;
}

export interface DeviceHealth {
  device_id: string;
  status: DeviceStatus;
  status_reason: string | null;
  status_source: StatusSource | null;
  connection_state: ConnectionState;
  heartbeat_age_seconds: number | null;
  issues: DeviceIssue[];
  checks: {
    listener_connected: boolean | null;
    notification_access: boolean | null;
    network_connected: boolean | null;
    battery_optimization_exempt: boolean | null;
    background_restricted: boolean | null;
    pending_queue: number | null;
    failed_queue: number | null;
  };
  timestamps: {
    last_heartbeat_at: ISODate | null;
    last_listener_connected_at: ISODate | null;
    last_notification_at: ISODate | null;
    last_successful_sync_at: ISODate | null;
    last_seen_at: ISODate | null;
  };
  last_error: string | null;
  last_24h: {
    heartbeats: number;
    listener_down: number;
    permission_down: number;
    max_pending_queue: number | null;
    parse_errors: number;
  };
}

export interface Heartbeat {
  id: string;
  heartbeat_id: string | null;
  trigger: string | null;
  app_version: string | null;
  notification_access: boolean | null;
  listener_connected: boolean | null;
  network_connected: boolean | null;
  battery_optimization_exempt: boolean | null;
  background_restricted: boolean | null;
  pending_queue: number | null;
  failed_queue: number | null;
  last_notification_at: ISODate | null;
  last_successful_sync_at: ISODate | null;
  last_error: string | null;
  reported_at: ISODate | null;
  received_at: ISODate;
  gap_seconds: number | null;
}

export interface DeviceEvent {
  id: string;
  event_id: string | null;
  event_type: string;
  source: 'device' | 'server' | string;
  severity: string;
  message: string | null;
  data: unknown;
  occurred_at: ISODate;
  received_at: ISODate;
}

export interface ParseErrorRow {
  id: string;
  event_id: string;
  package_name: string;
  title: string | null;
  text: string | null;
  parser_key: string | null;
  parser_version: string | null;
  parse_error: string | null;
  server_received_at: ISODate;
  device_received_at: ISODate | null;
  account_alias: string | null;
  bank_code: string | null;
}

export interface AppVersionRow {
  app_version: string;
  first_seen_at: ISODate;
  last_seen_at: ISODate;
  heartbeats: number;
}

// ------------------------------------------------------------------ alert
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface Alert {
  id: string;
  device_id: string | null;
  device_name: string | null;
  alert_type: string;
  severity: 'warning' | 'critical';
  message: string;
  status: AlertStatus;
  data: unknown;
  opened_at: ISODate;
  acknowledged_at: ISODate | null;
  acknowledged_by: string | null;
  resolved_at: ISODate | null;
  last_notified_at: ISODate | null;
  notify_count: number;
}

// ------------------------------------------------------------------ transaksi
export type MatchStatus = 'PENDING' | 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'MANUAL_VERIFIED' | 'REJECTED' | 'IGNORED';
export type CandidateStatus = 'CANDIDATE' | 'MATCHED' | 'MANUAL_VERIFIED' | 'REJECTED' | 'SUPERSEDED';

export interface Transaction {
  id: string;
  transaction_code: string;
  bank_code: string;
  account_alias: string | null;
  bank_source_id: string | null;
  sender_name: string | null;
  amount: number;
  transaction_time: ISODate | null;
  received_time: ISODate;
  reference_number: string | null;
  recipient_account: string | null;
  notification_type: string | null;
  parser_version: string | null;
  match_status: MatchStatus;
  match_reason: string | null;
  match_score: number | null;
  matched_at: ISODate | null;
  note: string | null;
  created_at: ISODate;
  pos_order_id: string | null;
  pos_customer_name: string | null;
  candidate_count: number;
}

export interface TransactionList extends Paged<Transaction> {
  totals: { count: number; amount: number };
}

export interface ScoreBreakdown {
  amount: number;
  time: number;
  name: number;
  account: number;
}

export interface Candidate {
  id: string;
  status: CandidateStatus;
  score: number;
  score_breakdown: ScoreBreakdown | null;
  reasons: string[] | null;
  note: string | null;
  decided_at: ISODate | null;
  decided_by_email: string | null;
  order_uuid: string;
  order_id: string;
  customer_name: string | null;
  amount: number;
  order_created_at: ISODate;
  expires_at: ISODate | null;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
}

export interface NotificationDetail {
  id: string;
  event_id: string;
  package_name: string;
  title: string | null;
  text: string | null;
  big_text: string | null;
  posted_at: ISODate | null;
  device_received_at: ISODate | null;
  server_received_at: ISODate;
  parser_key: string | null;
  parser_version: string | null;
  parsed: Record<string, unknown> | null;
  raw_purged_at: ISODate | null;
  device_name: string | null;
}

export interface AuditEntry {
  id: string | number;
  actor_type: 'user' | 'device' | 'pos' | 'system' | string;
  actor_id?: string | null;
  actor_label: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  before?: unknown;
  after?: unknown;
  note: string | null;
  ip?: string | null;
  user_agent?: string | null;
  created_at: ISODate;
}

export interface TransactionDetail {
  transaction: Transaction;
  candidates: Candidate[];
  notification: NotificationDetail | null;
  audit: AuditEntry[];
}

export interface OrderOption {
  id: string;
  order_id: string;
  customer_name: string | null;
  amount: number;
  order_created_at: ISODate;
  expires_at: ISODate | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
}

export interface MatchRow {
  id: string;
  status: CandidateStatus;
  score: number;
  score_breakdown: ScoreBreakdown | null;
  reasons: string[] | null;
  note: string | null;
  created_at: ISODate;
  decided_at: ISODate | null;
  transaction_id: string;
  transaction_code: string;
  sender_name: string | null;
  amount: number;
  bank_code: string;
  account_alias: string | null;
  transaction_time: ISODate | null;
  received_time: ISODate;
  match_status: MatchStatus;
  match_reason: string | null;
  order_uuid: string;
  order_id: string;
  customer_name: string | null;
  order_created_at: ISODate;
  expires_at: ISODate | null;
  order_status: OrderStatus;
}

// ------------------------------------------------------------------ order POS
export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PAID';

export interface Order {
  id: string;
  order_id: string;
  customer_name: string | null;
  amount: number;
  payment_method: string;
  destination_account: string | null;
  order_created_at: ISODate;
  expires_at: ISODate | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  paid_transaction_id: string | null;
  paid_at: ISODate | null;
  matched_by: 'AUTO' | 'MANUAL' | null;
  metadata: Record<string, unknown> | null;
  created_at: ISODate;
  updated_at: ISODate;
  transaction_code?: string | null;
  paid_sender_name?: string | null;
  candidate_count?: number;
}

export interface OrderCandidate {
  id: string;
  status: CandidateStatus;
  score: number;
  score_breakdown: ScoreBreakdown | null;
  reasons: string[] | null;
  note: string | null;
  decided_at: ISODate | null;
  transaction_id: string;
  transaction_code: string;
  sender_name: string | null;
  amount: number;
  bank_code: string;
  account_alias: string | null;
  transaction_time: ISODate | null;
  received_time: ISODate;
  match_status: MatchStatus;
}

export interface OrderWebhook {
  id: string;
  event_id: string;
  event_type: string;
  status: WebhookStatus;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  delivered_at: ISODate | null;
  created_at: ISODate;
}

export interface OrderDetail {
  order: Order;
  transaction: (Partial<Transaction> & { id: string; transaction_code: string }) | null;
  candidates: OrderCandidate[];
  webhooks: OrderWebhook[];
}

// ------------------------------------------------------------------ dashboard & laporan
export interface DashboardSummary {
  timezone: string;
  today: {
    total_count: number;
    total_amount: number;
    matched_count: number;
    auto_matched_count: number;
    manual_verified_count: number;
    unmatched_count: number;
    ambiguous_count: number;
    ignored_count: number;
    matched_amount: number;
    parse_error_count: number;
  };
  last_transaction_at: ISODate | null;
  ambiguous_open: number;
  pending_orders: { n: number; amount: number };
  webhooks: { failed: number; pending: number };
  devices: Device[];
  pending_queue_total: number;
  alerts: Alert[];
}

export interface ReportRow {
  period: string;
  count: number;
  amount: number;
  matched_count: number;
  matched_amount: number;
  manual_verified_count: number;
  manual_verified_amount: number;
  unmatched_count: number;
  unmatched_amount: number;
  ambiguous_count: number;
  ignored_count: number;
}

export interface Report {
  granularity: 'day' | 'month';
  from: string;
  to: string;
  timezone: string;
  rows: ReportRow[];
  by_bank: { bank_code: string; account_alias: string | null; count: number; amount: number; matched_count: number }[];
  totals: Partial<Omit<ReportRow, 'period'>>;
  pos_reconciliation: {
    orders_total: number;
    orders_amount: number;
    orders_paid: number;
    orders_paid_amount: number;
    paid_auto: number;
    paid_manual: number;
    orders_expired: number;
    orders_cancelled: number;
    orders_pending: number;
    transactions_without_order: number;
    transactions_without_order_amount: number;
  };
}

// ------------------------------------------------------------------ sumber bank
export interface BankSource {
  id: string;
  bank_code: string;
  bank_name: string;
  package_name: string;
  account_alias: string;
  account_identifier: string | null;
  account_holder: string | null;
  parser_key: string | null;
  parser_version: string | null;
  is_default: boolean;
  is_active: boolean;
  last_notification_at: ISODate | null;
  last_parse_error_at: ISODate | null;
  last_parse_error: string | null;
  parse_errors_7d: number;
  transaction_count: number;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface BankNotification {
  id: string;
  event_id: string;
  title: string | null;
  text: string | null;
  classification: string;
  parse_status: 'PARSED' | 'ERROR' | 'IGNORED';
  parse_error: string | null;
  parser_version: string | null;
  parsed: Record<string, unknown> | null;
  server_received_at: ISODate;
  transaction_id: string | null;
}

// ------------------------------------------------------------------ pengaturan
export type SettingType = 'int' | 'number' | 'bool' | 'string' | 'url' | 'timezone';
export type SettingValue = string | number | boolean;

export interface SettingDef {
  key: string;
  value: SettingValue;
  type: SettingType;
  group: string;
  label: string;
  min?: number;
  max?: number;
  secret: boolean;
  is_set?: boolean;
}

export interface WebhookTestResult {
  ok: boolean;
  status_code: number | null;
  error: string | null;
  response: unknown;
  duration_ms: number;
  event_id: string;
}

export type WebhookStatus = 'PENDING' | 'DELIVERING' | 'DELIVERED' | 'FAILED' | 'DEAD';

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  status: WebhookStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: ISODate | null;
  last_attempt_at: ISODate | null;
  delivered_at: ISODate | null;
  last_status_code: number | null;
  last_error: string | null;
  attempt_log: unknown;
  payload: unknown;
  target_url?: string | null;
  pos_order_id: string | null;
  transaction_code: string | null;
  created_at: ISODate;
}

export interface ApiClient {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: ISODate | null;
  created_at: ISODate;
  revoked_at: ISODate | null;
  api_key?: string;
}

// ------------------------------------------------------------------ pengguna
export interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  last_login_at: ISODate | null;
  created_at: ISODate;
  invited?: boolean;
}
