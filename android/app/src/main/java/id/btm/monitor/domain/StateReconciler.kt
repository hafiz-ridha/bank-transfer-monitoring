package id.btm.monitor.domain

import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import id.btm.monitor.BuildConfig
import id.btm.monitor.core.AppLog
import id.btm.monitor.data.prefs.AppPrefs
import id.btm.monitor.service.BankNotificationListener
import id.btm.monitor.service.ListenerState

/**
 * Rekonsiliasi status (PRD §3.3, §3.5): mendeteksi perubahan izin Notification Access dan
 * pengecualian baterai, meminta rebind listener bila izin ada tetapi listener tidak terhubung,
 * dan mendeteksi update aplikasi.
 */
class StateReconciler(
    private val context: Context,
    private val prefs: AppPrefs,
    private val status: StatusChecker,
    private val events: DeviceEventRecorder,
) {
    /** Mencatat PERMISSION_GRANTED/REVOKED dan BATTERY_OPTIMIZATION_CHANGED bila berubah. */
    suspend fun checkTransitions() {
        val access = status.notificationAccessEnabled()
        val prevAccess = prefs.lastKnownNotificationAccess
        val accessInt = if (access) 1 else 0
        if (prevAccess != -1 && prevAccess != accessInt) {
            events.record(
                type = if (access) DeviceEventType.PERMISSION_GRANTED else DeviceEventType.PERMISSION_REVOKED,
                message = if (access) "Notification Access diaktifkan" else "Notification Access dicabut; monitoring tidak dapat dijamin",
            )
        }
        prefs.lastKnownNotificationAccess = accessInt

        val battery = status.batteryOptimizationExempt()
        if (battery != null) {
            val batteryInt = if (battery) 1 else 0
            val prev = prefs.lastKnownBatteryExempt
            if (prev != -1 && prev != batteryInt) {
                events.record(
                    type = DeviceEventType.BATTERY_OPTIMIZATION_CHANGED,
                    message = if (battery) "Aplikasi dikecualikan dari optimasi baterai" else "Aplikasi kembali dibatasi optimasi baterai",
                    data = mapOf("battery_optimization_exempt" to battery.toString()),
                )
            }
            prefs.lastKnownBatteryExempt = batteryInt
        }
    }

    /**
     * Minta sistem bind ulang listener bila izin aktif tetapi listener tidak terhubung.
     * Dibatasi sekali per 2 menit agar tidak membanjiri event.
     */
    suspend fun ensureListenerBound(reason: String): Boolean {
        if (ListenerState.isConnected) return false
        if (!status.notificationAccessEnabled()) return false
        val now = System.currentTimeMillis()
        if (now - prefs.lastRebindRequestAt < REBIND_THROTTLE_MS) return false
        prefs.lastRebindRequestAt = now
        val ok = requestRebind(context)
        events.record(
            type = DeviceEventType.LISTENER_REBIND_REQUESTED,
            message = "Listener tidak terhubung; requestRebind dipanggil ($reason)",
            data = mapOf("reason" to reason, "result" to if (ok) "requested" else "failed"),
        )
        return ok
    }

    /** Mencatat APP_UPDATED sekali bila versionCode berubah sejak proses terakhir. */
    suspend fun detectAppUpdate() {
        val current = BuildConfig.VERSION_CODE.toLong()
        val prev = prefs.lastVersionCode
        if (prev != current) {
            prefs.lastVersionCode = current
            if (prev != 0L) {
                events.record(
                    type = DeviceEventType.APP_UPDATED,
                    message = "Aplikasi diperbarui ke ${BuildConfig.VERSION_NAME}",
                    data = mapOf("from_version_code" to prev.toString(), "to_version_code" to current.toString()),
                )
            }
        }
    }

    companion object {
        private const val REBIND_THROTTLE_MS = 2 * 60_000L

        fun requestRebind(context: Context): Boolean = try {
            NotificationListenerService.requestRebind(ComponentName(context, BankNotificationListener::class.java))
            true
        } catch (e: Exception) {
            AppLog.w("requestRebind gagal", e)
            false
        }
    }
}
