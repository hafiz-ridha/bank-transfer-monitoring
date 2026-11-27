package id.btm.monitor.data.prefs

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID

/**
 * Preferensi NON-rahasia (SharedPreferences). Token perangkat TIDAK disimpan di sini,
 * melainkan di [id.btm.monitor.data.security.SecureTokenStore] (Android Keystore).
 *
 * Nilai waktu disimpan sebagai epoch ms; 0 berarti "belum pernah / belum diketahui".
 * Nilai tri-state disimpan sebagai Int: -1 = belum diketahui, 0 = false, 1 = true.
 */
class AppPrefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private val _changes = MutableStateFlow(0L)

    /** Bertambah setiap kali ada preferensi berubah; dipakai UI untuk membaca ulang snapshot. */
    val changes: StateFlow<Long> = _changes.asStateFlow()

    // Disimpan sebagai field agar tidak dikumpulkan GC (SharedPreferences hanya memegang weak reference).
    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        _changes.update { it + 1 }
    }

    init {
        sp.registerOnSharedPreferenceChangeListener(listener)
    }

    // ------------------------------------------------------------------ identitas perangkat

    /** UUID acak yang dibuat sekali saat instalasi (dikirim sebagai device_uuid / device_id heartbeat). */
    val deviceUuid: String
        @Synchronized get() {
            sp.getString(K_DEVICE_UUID, null)?.let { return it }
            val id = UUID.randomUUID().toString()
            sp.edit(commit = true) { putString(K_DEVICE_UUID, id) }
            return id
        }

    var apiBaseUrl: String?
        get() = sp.getString(K_BASE_URL, null)
        set(v) = setStr(K_BASE_URL, v)

    /** ID perangkat di server (device_id dari respons register). */
    var serverDeviceId: String?
        get() = sp.getString(K_SERVER_DEVICE_ID, null)
        set(v) = setStr(K_SERVER_DEVICE_ID, v)

    var deviceName: String?
        get() = sp.getString(K_DEVICE_NAME, null)
        set(v) = setStr(K_DEVICE_NAME, v)

    var registeredAt: Long
        get() = sp.getLong(K_REGISTERED_AT, 0L)
        set(v) = setLong(K_REGISTERED_AT, v)

    /** Token dicabut / tidak valid (401 INVALID_DEVICE_TOKEN): sinkronisasi berhenti, antrean disimpan. */
    var needsRepair: Boolean
        get() = sp.getBoolean(K_NEEDS_REPAIR, false)
        set(v) = setBool(K_NEEDS_REPAIR, v)

    var repairReason: String?
        get() = sp.getString(K_REPAIR_REASON, null)
        set(v) = setStr(K_REPAIR_REASON, v)

    val isRegistered: Boolean
        get() = serverDeviceId != null && apiBaseUrl != null

    /** Boleh mengirim ke server (terdaftar dan token tidak dicabut). */
    val canSync: Boolean
        get() = isRegistered && !needsRepair

    fun markNeedsRepair(reason: String) {
        sp.edit {
            putBoolean(K_NEEDS_REPAIR, true)
            putString(K_REPAIR_REASON, reason)
        }
    }

    // ------------------------------------------------------------------ konfigurasi server

    var configJson: String?
        get() = sp.getString(K_CONFIG_JSON, null)
        set(v) = setStr(K_CONFIG_JSON, v)

    var configVersion: String?
        get() = sp.getString(K_CONFIG_VERSION, null)
        set(v) = setStr(K_CONFIG_VERSION, v)

    var configFetchedAt: Long
        get() = sp.getLong(K_CONFIG_FETCHED_AT, 0L)
        set(v) = setLong(K_CONFIG_FETCHED_AT, v)

    var heartbeatIntervalSec: Int
        get() = sp.getInt(K_HB_INTERVAL, DEFAULT_HEARTBEAT_SEC)
        set(v) = sp.edit { putInt(K_HB_INTERVAL, v) }

    var updateRequired: Boolean
        get() = sp.getBoolean(K_UPDATE_REQUIRED, false)
        set(v) = setBool(K_UPDATE_REQUIRED, v)

    var minAppVersion: String?
        get() = sp.getString(K_MIN_APP_VERSION, null)
        set(v) = setStr(K_MIN_APP_VERSION, v)

    var sendRawText: Boolean
        get() = sp.getBoolean(K_SEND_RAW_TEXT, true)
        set(v) = setBool(K_SEND_RAW_TEXT, v)

    // ------------------------------------------------------------------ status listener / notifikasi

    var lastListenerConnectedAt: Long
        get() = sp.getLong(K_LISTENER_CONNECTED_AT, 0L)
        set(v) = setLong(K_LISTENER_CONNECTED_AT, v)

    var lastListenerDisconnectedAt: Long
        get() = sp.getLong(K_LISTENER_DISCONNECTED_AT, 0L)
        set(v) = setLong(K_LISTENER_DISCONNECTED_AT, v)

    var lastRebindRequestAt: Long
        get() = sp.getLong(K_REBIND_AT, 0L)
        set(v) = setLong(K_REBIND_AT, v)

    var lastNotificationAt: Long
        get() = sp.getLong(K_LAST_NOTIFICATION_AT, 0L)
        set(v) = setLong(K_LAST_NOTIFICATION_AT, v)

    // ------------------------------------------------------------------ sinkronisasi & error

    var lastSuccessfulSyncAt: Long
        get() = sp.getLong(K_LAST_SYNC_AT, 0L)
        set(v) = setLong(K_LAST_SYNC_AT, v)

    var syncFailing: Boolean
        get() = sp.getBoolean(K_SYNC_FAILING, false)
        set(v) = setBool(K_SYNC_FAILING, v)

    val lastError: String?
        get() = sp.getString(K_LAST_ERROR, null)

    val lastErrorAt: Long
        get() = sp.getLong(K_LAST_ERROR_AT, 0L)

    fun setLastError(message: String?) {
        sp.edit {
            if (message == null) {
                remove(K_LAST_ERROR)
                remove(K_LAST_ERROR_AT)
            } else {
                putString(K_LAST_ERROR, message.take(1000))
                putLong(K_LAST_ERROR_AT, System.currentTimeMillis())
            }
        }
    }

    /** Hapus last_error hanya jika belum berubah sejak dibaca (agar error baru tidak ikut terhapus). */
    @Synchronized
    fun clearLastErrorIf(expected: String?) {
        if (expected != null && lastError == expected) setLastError(null)
    }

    var lastCleanupAt: Long
        get() = sp.getLong(K_LAST_CLEANUP_AT, 0L)
        set(v) = setLong(K_LAST_CLEANUP_AT, v)

    // ------------------------------------------------------------------ heartbeat

    var lastHeartbeatAttemptAt: Long
        get() = sp.getLong(K_HB_ATTEMPT_AT, 0L)
        set(v) = setLong(K_HB_ATTEMPT_AT, v)

    var lastHeartbeatSuccessAt: Long
        get() = sp.getLong(K_HB_SUCCESS_AT, 0L)
        set(v) = setLong(K_HB_SUCCESS_AT, v)

    /** "OK" atau ringkasan kegagalan heartbeat terakhir. */
    var lastHeartbeatResult: String?
        get() = sp.getString(K_HB_RESULT, null)
        set(v) = setStr(K_HB_RESULT, v)

    /** Status perangkat menurut server pada heartbeat terakhir (ACTIVE/WARNING/...). */
    var serverStatus: String?
        get() = sp.getString(K_SERVER_STATUS, null)
        set(v) = setStr(K_SERVER_STATUS, v)

    var serverStatusReason: String?
        get() = sp.getString(K_SERVER_STATUS_REASON, null)
        set(v) = setStr(K_SERVER_STATUS_REASON, v)

    // ------------------------------------------------------------------ jam perangkat

    var clockSkewDetected: Boolean
        get() = sp.getBoolean(K_CLOCK_SKEW, false)
        set(v) = setBool(K_CLOCK_SKEW, v)

    var clockSkewServerTime: String?
        get() = sp.getString(K_CLOCK_SKEW_SERVER_TIME, null)
        set(v) = setStr(K_CLOCK_SKEW_SERVER_TIME, v)

    /** true bila ini transisi baru ke kondisi "jam tidak sinkron". */
    @Synchronized
    fun markClockSkew(serverTime: String?): Boolean {
        val wasSkewed = clockSkewDetected
        sp.edit {
            putBoolean(K_CLOCK_SKEW, true)
            if (serverTime != null) putString(K_CLOCK_SKEW_SERVER_TIME, serverTime)
        }
        return !wasSkewed
    }

    // ------------------------------------------------------------------ konfirmasi pengguna & state terakhir

    /** Autostart TIDAK dapat diverifikasi otomatis; ini hanya konfirmasi manual pengguna. */
    var autostartConfirmed: Boolean
        get() = sp.getBoolean(K_AUTOSTART_CONFIRMED, false)
        set(v) = setBool(K_AUTOSTART_CONFIRMED, v)

    var lastKnownNotificationAccess: Int
        get() = sp.getInt(K_LAST_ACCESS, -1)
        set(v) = sp.edit { putInt(K_LAST_ACCESS, v) }

    var lastKnownBatteryExempt: Int
        get() = sp.getInt(K_LAST_BATTERY, -1)
        set(v) = sp.edit { putInt(K_LAST_BATTERY, v) }

    var lastKnownNetwork: Int
        get() = sp.getInt(K_LAST_NETWORK, -1)
        set(v) = sp.edit { putInt(K_LAST_NETWORK, v) }

    var lastVersionCode: Long
        get() = sp.getLong(K_LAST_VERSION_CODE, 0L)
        set(v) = setLong(K_LAST_VERSION_CODE, v)

    /** Menghapus identitas pairing (dipanggil sebelum menyimpan registrasi baru). Antrean lokal TIDAK disentuh. */
    fun clearPairing() {
        sp.edit {
            remove(K_SERVER_DEVICE_ID)
            remove(K_DEVICE_NAME)
            remove(K_CONFIG_JSON)
            remove(K_CONFIG_VERSION)
            remove(K_SERVER_STATUS)
            remove(K_SERVER_STATUS_REASON)
        }
    }

    fun snapshot(): PrefsView = PrefsView(
        apiBaseUrl = apiBaseUrl,
        deviceUuid = deviceUuid,
        serverDeviceId = serverDeviceId,
        deviceName = deviceName,
        registered = isRegistered,
        registeredAt = registeredAt,
        needsRepair = needsRepair,
        repairReason = repairReason,
        heartbeatIntervalSec = heartbeatIntervalSec,
        updateRequired = updateRequired,
        minAppVersion = minAppVersion,
        sendRawText = sendRawText,
        configVersion = configVersion,
        configFetchedAt = configFetchedAt,
        lastListenerConnectedAt = lastListenerConnectedAt,
        lastListenerDisconnectedAt = lastListenerDisconnectedAt,
        lastNotificationAt = lastNotificationAt,
        lastSuccessfulSyncAt = lastSuccessfulSyncAt,
        lastError = lastError,
        lastErrorAt = lastErrorAt,
        lastHeartbeatAttemptAt = lastHeartbeatAttemptAt,
        lastHeartbeatSuccessAt = lastHeartbeatSuccessAt,
        lastHeartbeatResult = lastHeartbeatResult,
        serverStatus = serverStatus,
        serverStatusReason = serverStatusReason,
        clockSkew = clockSkewDetected,
        clockSkewServerTime = clockSkewServerTime,
        autostartConfirmed = autostartConfirmed,
    )

    private fun setStr(key: String, v: String?) = sp.edit { if (v == null) remove(key) else putString(key, v) }
    private fun setLong(key: String, v: Long) = sp.edit { putLong(key, v) }
    private fun setBool(key: String, v: Boolean) = sp.edit { putBoolean(key, v) }

    companion object {
        const val DEFAULT_HEARTBEAT_SEC = 60
        private const val FILE = "btm_prefs"

        private const val K_DEVICE_UUID = "device_uuid"
        private const val K_BASE_URL = "api_base_url"
        private const val K_SERVER_DEVICE_ID = "server_device_id"
        private const val K_DEVICE_NAME = "device_name"
        private const val K_REGISTERED_AT = "registered_at"
        private const val K_NEEDS_REPAIR = "needs_repair"
        private const val K_REPAIR_REASON = "repair_reason"
        private const val K_CONFIG_JSON = "config_json"
        private const val K_CONFIG_VERSION = "config_version"
        private const val K_CONFIG_FETCHED_AT = "config_fetched_at"
        private const val K_HB_INTERVAL = "heartbeat_interval_sec"
        private const val K_UPDATE_REQUIRED = "update_required"
        private const val K_MIN_APP_VERSION = "min_app_version"
        private const val K_SEND_RAW_TEXT = "send_raw_text"
        private const val K_LISTENER_CONNECTED_AT = "listener_connected_at"
        private const val K_LISTENER_DISCONNECTED_AT = "listener_disconnected_at"
        private const val K_REBIND_AT = "rebind_requested_at"
        private const val K_LAST_NOTIFICATION_AT = "last_notification_at"
        private const val K_LAST_SYNC_AT = "last_successful_sync_at"
        private const val K_SYNC_FAILING = "sync_failing"
        private const val K_LAST_ERROR = "last_error"
        private const val K_LAST_ERROR_AT = "last_error_at"
        private const val K_LAST_CLEANUP_AT = "last_cleanup_at"
        private const val K_HB_ATTEMPT_AT = "hb_attempt_at"
        private const val K_HB_SUCCESS_AT = "hb_success_at"
        private const val K_HB_RESULT = "hb_result"
        private const val K_SERVER_STATUS = "server_status"
        private const val K_SERVER_STATUS_REASON = "server_status_reason"
        private const val K_CLOCK_SKEW = "clock_skew"
        private const val K_CLOCK_SKEW_SERVER_TIME = "clock_skew_server_time"
        private const val K_AUTOSTART_CONFIRMED = "autostart_confirmed"
        private const val K_LAST_ACCESS = "last_known_notification_access"
        private const val K_LAST_BATTERY = "last_known_battery_exempt"
        private const val K_LAST_NETWORK = "last_known_network"
        private const val K_LAST_VERSION_CODE = "last_version_code"
    }
}

/** Snapshot nilai preferensi untuk UI (immutable). */
data class PrefsView(
    val apiBaseUrl: String?,
    val deviceUuid: String,
    val serverDeviceId: String?,
    val deviceName: String?,
    val registered: Boolean,
    val registeredAt: Long,
    val needsRepair: Boolean,
    val repairReason: String?,
    val heartbeatIntervalSec: Int,
    val updateRequired: Boolean,
    val minAppVersion: String?,
    val sendRawText: Boolean,
    val configVersion: String?,
    val configFetchedAt: Long,
    val lastListenerConnectedAt: Long,
    val lastListenerDisconnectedAt: Long,
    val lastNotificationAt: Long,
    val lastSuccessfulSyncAt: Long,
    val lastError: String?,
    val lastErrorAt: Long,
    val lastHeartbeatAttemptAt: Long,
    val lastHeartbeatSuccessAt: Long,
    val lastHeartbeatResult: String?,
    val serverStatus: String?,
    val serverStatusReason: String?,
    val clockSkew: Boolean,
    val clockSkewServerTime: String?,
    val autostartConfirmed: Boolean,
)
