package id.btm.monitor.domain

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import id.btm.monitor.data.db.OutboxDao
import id.btm.monitor.data.db.OutboxType
import id.btm.monitor.service.ListenerState
import id.btm.monitor.service.NetworkMonitor

/** Hasil pemeriksaan NYATA kondisi perangkat (tidak ada nilai yang diasumsikan). */
data class StatusSnapshot(
    val notificationAccess: Boolean,
    val listenerConnected: Boolean,
    val networkConnected: Boolean,
    /** null = tidak dapat diperiksa. */
    val batteryOptimizationExempt: Boolean?,
    /** null = tidak tersedia (Android < 9). */
    val backgroundRestricted: Boolean?,
    val pendingQueue: Int,
    val failedQueue: Int,
    val pendingEvents: Int,
    val failedEvents: Int,
    val checkedAt: Long,
)

class StatusChecker(
    private val context: Context,
    private val outbox: OutboxDao,
    private val network: NetworkMonitor,
) {
    fun notificationAccessEnabled(): Boolean = try {
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    } catch (e: Exception) {
        false
    }

    fun batteryOptimizationExempt(): Boolean? = try {
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName)
    } catch (e: Exception) {
        null
    }

    fun backgroundRestricted(): Boolean? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
        return try {
            context.getSystemService(ActivityManager::class.java)?.isBackgroundRestricted
        } catch (e: Exception) {
            null
        }
    }

    suspend fun snapshot(): StatusSnapshot = StatusSnapshot(
        notificationAccess = notificationAccessEnabled(),
        listenerConnected = ListenerState.isConnected,
        networkConnected = network.isConnectedNow(),
        batteryOptimizationExempt = batteryOptimizationExempt(),
        backgroundRestricted = backgroundRestricted(),
        pendingQueue = outbox.countUnsent(OutboxType.NOTIFICATION),
        failedQueue = outbox.countFailed(OutboxType.NOTIFICATION),
        pendingEvents = outbox.countUnsent(OutboxType.DEVICE_EVENT),
        failedEvents = outbox.countFailed(OutboxType.DEVICE_EVENT),
        checkedAt = System.currentTimeMillis(),
    )
}
