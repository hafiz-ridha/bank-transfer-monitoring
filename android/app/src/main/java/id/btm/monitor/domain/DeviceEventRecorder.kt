package id.btm.monitor.domain

import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.db.OutboxDao
import id.btm.monitor.data.db.OutboxEntity
import id.btm.monitor.data.db.OutboxType
import id.btm.monitor.data.net.DeviceEventDto
import id.btm.monitor.data.prefs.AppPrefs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

/** event_type yang diterima server (docs/API.md "POST /devices/events"). */
object DeviceEventType {
    const val APP_OPENED = "APP_OPENED"
    const val APP_UPDATED = "APP_UPDATED"
    const val BOOT_COMPLETED = "BOOT_COMPLETED"
    const val LISTENER_CONNECTED = "LISTENER_CONNECTED"
    const val LISTENER_DISCONNECTED = "LISTENER_DISCONNECTED"
    const val LISTENER_REBIND_REQUESTED = "LISTENER_REBIND_REQUESTED"
    const val PERMISSION_GRANTED = "PERMISSION_GRANTED"
    const val PERMISSION_REVOKED = "PERMISSION_REVOKED"
    const val NETWORK_LOST = "NETWORK_LOST"
    const val NETWORK_RESTORED = "NETWORK_RESTORED"
    const val SYNC_FAILED = "SYNC_FAILED"
    const val SYNC_RECOVERED = "SYNC_RECOVERED"
    const val PARSER_ERROR = "PARSER_ERROR"
    const val BATTERY_OPTIMIZATION_CHANGED = "BATTERY_OPTIMIZATION_CHANGED"
    const val CLOCK_SKEW = "CLOCK_SKEW"
    const val ERROR = "ERROR"
    const val INFO = "INFO"

    fun defaultSeverity(type: String): String = when (type) {
        LISTENER_DISCONNECTED, PERMISSION_REVOKED, SYNC_FAILED, ERROR, PARSER_ERROR -> "error"
        NETWORK_LOST, CLOCK_SKEW, BATTERY_OPTIMIZATION_CHANGED, LISTENER_REBIND_REQUESTED -> "warning"
        else -> "info"
    }
}

/**
 * Mencatat event perangkat ke antrean lokal (Room) lebih dulu, lalu memicu sinkronisasi.
 * Event yang terjadi saat offline (mis. NETWORK_LOST) tetap terkirim belakangan dengan occurred_at asli.
 */
class DeviceEventRecorder(
    private val prefs: AppPrefs,
    private val outbox: OutboxDao,
    private val json: Json,
    private val requestSync: () -> Unit,
) {
    suspend fun record(
        type: String,
        message: String? = null,
        data: Map<String, String?> = emptyMap(),
        severity: String = DeviceEventType.defaultSeverity(type),
        occurredAt: Long = System.currentTimeMillis(),
        syncNow: Boolean = true,
    ) {
        // Tanpa pairing tidak ada identitas perangkat di server; kondisi tetap terlihat lewat heartbeat nanti.
        if (!prefs.isRegistered) return
        val eventId = UUID.randomUUID().toString()
        val payload = DeviceEventDto(
            eventId = eventId,
            eventType = type,
            severity = severity,
            message = message?.take(2000),
            data = if (data.isEmpty()) null else buildJsonObject {
                data.forEach { (k, v) -> if (v != null) put(k, v) }
            },
            occurredAt = TimeUtil.iso(occurredAt),
        )
        val now = System.currentTimeMillis()
        outbox.insert(
            OutboxEntity(
                eventId = eventId,
                type = OutboxType.DEVICE_EVENT,
                payloadJson = json.encodeToString(DeviceEventDto.serializer(), payload),
                summary = if (message.isNullOrBlank()) type else "$type: ${message.take(80)}",
                createdAt = now,
                updatedAt = now,
            ),
        )
        if (syncNow) requestSync()
    }
}
