package id.btm.monitor.data.net

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * DTO sesuai docs/API.md bagian A (dan skema validasi backend/src/routes/android.js).
 * Server memakai additionalProperties=false, jadi JANGAN menambah field yang tidak ada di kontrak.
 * Field null tidak dikirim (explicitNulls = false).
 */
object ApiJson {
    @OptIn(ExperimentalSerializationApi::class)
    val instance: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
        isLenient = false
    }
}

// ---------------------------------------------------------------- register

@Serializable
data class RegisterRequest(
    @SerialName("pairing_code") val pairingCode: String,
    @SerialName("device_uuid") val deviceUuid: String,
    @SerialName("device_name") val deviceName: String? = null,
    @SerialName("device_model") val deviceModel: String? = null,
    @SerialName("manufacturer") val manufacturer: String? = null,
    @SerialName("android_version") val androidVersion: String? = null,
    @SerialName("app_version") val appVersion: String? = null,
)

@Serializable
data class RegisterResponse(
    @SerialName("device_id") val deviceId: String,
    @SerialName("device_uuid") val deviceUuid: String? = null,
    @SerialName("device_name") val deviceName: String? = null,
    @SerialName("device_token") val deviceToken: String,
    @SerialName("config") val config: DeviceConfig? = null,
)

// ---------------------------------------------------------------- config

@Serializable
data class DeviceConfig(
    @SerialName("device") val device: ConfigDevice? = null,
    @SerialName("heartbeat_interval_seconds") val heartbeatIntervalSeconds: Int = 60,
    @SerialName("min_app_version") val minAppVersion: String? = null,
    @SerialName("send_raw_text") val sendRawText: Boolean = true,
    @SerialName("max_request_skew_seconds") val maxRequestSkewSeconds: Int = 600,
    @SerialName("update_required") val updateRequired: Boolean = false,
    @SerialName("bank_sources") val bankSources: List<BankSourceDto> = emptyList(),
    @SerialName("config_version") val configVersion: String? = null,
    @SerialName("server_time") val serverTime: String? = null,
)

@Serializable
data class ConfigDevice(
    @SerialName("id") val id: String? = null,
    @SerialName("device_uuid") val deviceUuid: String? = null,
    @SerialName("device_name") val deviceName: String? = null,
)

@Serializable
data class BankSourceDto(
    @SerialName("id") val id: String? = null,
    @SerialName("bank_code") val bankCode: String? = null,
    @SerialName("bank_name") val bankName: String? = null,
    @SerialName("package_name") val packageName: String = "",
    @SerialName("account_alias") val accountAlias: String? = null,
    @SerialName("account_identifier") val accountIdentifier: String? = null,
    @SerialName("parser_key") val parserKey: String? = null,
    @SerialName("parser_version") val parserVersion: String? = null,
    @SerialName("is_default") val isDefault: Boolean = false,
    @SerialName("is_active") val isActive: Boolean = false,
)

// ---------------------------------------------------------------- heartbeat

@Serializable
data class HeartbeatRequest(
    /** WAJIB sama dengan device_uuid pemilik token. */
    @SerialName("device_id") val deviceId: String,
    @SerialName("heartbeat_id") val heartbeatId: String,
    @SerialName("trigger") val trigger: String,
    @SerialName("app_version") val appVersion: String,
    @SerialName("notification_access") val notificationAccess: Boolean,
    @SerialName("listener_connected") val listenerConnected: Boolean,
    @SerialName("network_connected") val networkConnected: Boolean,
    @SerialName("battery_optimization_exempt") val batteryOptimizationExempt: Boolean? = null,
    @SerialName("background_restricted") val backgroundRestricted: Boolean? = null,
    @SerialName("pending_queue") val pendingQueue: Int,
    @SerialName("failed_queue") val failedQueue: Int,
    @SerialName("last_notification_at") val lastNotificationAt: String? = null,
    @SerialName("last_listener_connected_at") val lastListenerConnectedAt: String? = null,
    @SerialName("last_successful_sync_at") val lastSuccessfulSyncAt: String? = null,
    @SerialName("last_error") val lastError: String? = null,
    @SerialName("reported_at") val reportedAt: String,
)

@Serializable
data class HeartbeatResponse(
    @SerialName("accepted") val accepted: Boolean = false,
    @SerialName("duplicate") val duplicate: Boolean = false,
    @SerialName("stale") val stale: Boolean = false,
    @SerialName("status") val status: String? = null,
    @SerialName("status_reason") val statusReason: String? = null,
    @SerialName("server_time") val serverTime: String? = null,
    @SerialName("config_version") val configVersion: String? = null,
    @SerialName("heartbeat_interval_seconds") val heartbeatIntervalSeconds: Int? = null,
    @SerialName("update_required") val updateRequired: Boolean? = null,
)

// ---------------------------------------------------------------- device events

@Serializable
data class DeviceEventDto(
    @SerialName("event_id") val eventId: String,
    @SerialName("event_type") val eventType: String,
    /** info | warning | error */
    @SerialName("severity") val severity: String,
    @SerialName("message") val message: String? = null,
    @SerialName("data") val data: JsonObject? = null,
    @SerialName("occurred_at") val occurredAt: String,
)

// ---------------------------------------------------------------- notifications

@Serializable
data class NotificationEventDto(
    @SerialName("event_id") val eventId: String,
    @SerialName("package_name") val packageName: String,
    @SerialName("notification_key") val notificationKey: String? = null,
    @SerialName("dedupe_key") val dedupeKey: String? = null,
    @SerialName("title") val title: String? = null,
    @SerialName("text") val text: String? = null,
    @SerialName("big_text") val bigText: String? = null,
    @SerialName("posted_at") val postedAt: String? = null,
    @SerialName("received_at") val receivedAt: String? = null,
    /** INCOMING_TRANSFER | OUTGOING_TRANSFER | NON_TRANSACTION | UNKNOWN */
    @SerialName("classification") val classification: String,
    /** PARSED | ERROR | IGNORED */
    @SerialName("parse_status") val parseStatus: String,
    @SerialName("parser_key") val parserKey: String? = null,
    @SerialName("parser_version") val parserVersion: String? = null,
    @SerialName("parse_error") val parseError: String? = null,
    @SerialName("parsed") val parsed: ParsedDto? = null,
)

@Serializable
data class ParsedDto(
    @SerialName("bank_code") val bankCode: String? = null,
    @SerialName("sender_name") val senderName: String? = null,
    @SerialName("amount") val amount: Long? = null,
    @SerialName("transaction_time") val transactionTime: String? = null,
    @SerialName("reference_number") val referenceNumber: String? = null,
    @SerialName("recipient_account") val recipientAccount: String? = null,
    @SerialName("notification_type") val notificationType: String? = null,
)

/** Respons /notifications/batch dan /devices/events. */
@Serializable
data class BatchResponse(
    @SerialName("results") val results: List<EventResultDto> = emptyList(),
)

@Serializable
data class EventResultDto(
    @SerialName("event_id") val eventId: String? = null,
    /** accepted | duplicate | rejected */
    @SerialName("status") val status: String? = null,
    @SerialName("transaction_id") val transactionId: String? = null,
    @SerialName("transaction_code") val transactionCode: String? = null,
    @SerialName("parse_status") val parseStatus: String? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("retryable") val retryable: Boolean? = null,
)

// ---------------------------------------------------------------- devices/me

@Serializable
data class DeviceMeDto(
    @SerialName("id") val id: String? = null,
    @SerialName("device_name") val deviceName: String? = null,
    @SerialName("status") val status: String? = null,
    @SerialName("status_reason") val statusReason: String? = null,
    @SerialName("status_source") val statusSource: String? = null,
    @SerialName("connection_state") val connectionState: String? = null,
    @SerialName("heartbeat_age_seconds") val heartbeatAgeSeconds: Double? = null,
    @SerialName("issues") val issues: List<IssueDto> = emptyList(),
    @SerialName("notification_access") val notificationAccess: Boolean? = null,
    @SerialName("listener_connected") val listenerConnected: Boolean? = null,
    @SerialName("last_heartbeat_at") val lastHeartbeatAt: String? = null,
    @SerialName("last_notification_at") val lastNotificationAt: String? = null,
    @SerialName("last_successful_sync_at") val lastSuccessfulSyncAt: String? = null,
    @SerialName("pending_queue") val pendingQueue: Int? = null,
    @SerialName("failed_queue") val failedQueue: Int? = null,
    @SerialName("is_active") val isActive: Boolean? = null,
)

@Serializable
data class IssueDto(
    @SerialName("code") val code: String? = null,
    @SerialName("severity") val severity: String? = null,
    @SerialName("message") val message: String? = null,
)

// ---------------------------------------------------------------- error

@Serializable
data class ErrorEnvelope(
    @SerialName("error") val error: ErrorBody? = null,
)

@Serializable
data class ErrorBody(
    @SerialName("code") val code: String? = null,
    @SerialName("message") val message: String? = null,
    @SerialName("details") val details: JsonElement? = null,
)
