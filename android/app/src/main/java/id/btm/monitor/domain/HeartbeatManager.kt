package id.btm.monitor.domain

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import id.btm.monitor.BuildConfig
import id.btm.monitor.core.AppLog
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.ConfigRepository
import id.btm.monitor.data.net.ApiClient
import id.btm.monitor.data.net.ApiResult
import id.btm.monitor.data.net.HeartbeatRequest
import id.btm.monitor.data.prefs.AppPrefs
import id.btm.monitor.receiver.HeartbeatAlarmReceiver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

/** Nilai `trigger` heartbeat sesuai kontrak API. */
object HeartbeatTrigger {
    const val PERIODIC = "periodic"
    const val APP_OPEN = "app_open"
    const val SERVICE_CHANGE = "service_change"
    const val NETWORK_RESTORED = "network_restored"
    const val BOOT = "boot"
    const val MANUAL = "manual"
}

/**
 * Heartbeat (PRD §4.2) dengan tiga lapis penjadwalan:
 *  1. Loop coroutine selama proses hidup (interval dari server, default 60 dtk). Proses aplikasi
 *     umumnya tetap hidup karena NotificationListenerService di-bind oleh sistem.
 *  2. AlarmManager.setAndAllowWhileIdle (INEXACT, tanpa SCHEDULE_EXACT_ALARM), dipasang ulang setiap
 *     tick. Membangunkan proses saat Doze/proses dimatikan; di Doze Android membatasinya ~1x/9 menit.
 *  3. WorkManager periodik 15 menit sebagai cadangan terakhir.
 * Heartbeat tambahan dikirim saat aplikasi dibuka, kondisi service berubah, jaringan pulih, dan boot.
 * Kegagalan tidak di-spam sebagai event; hanya dicatat sebagai last_error.
 */
class HeartbeatManager(
    private val context: Context,
    private val prefs: AppPrefs,
    private val api: ApiClient,
    private val status: StatusChecker,
    private val config: ConfigRepository,
    private val scope: CoroutineScope,
    private val beforeSend: suspend () -> Unit,
    private val afterTick: suspend () -> Unit,
) {
    private val mutex = Mutex()
    private var loopJob: Job? = null

    val intervalMs: Long get() = prefs.heartbeatIntervalSec.coerceIn(30, 900) * 1000L

    /** true bila heartbeat diterima server. */
    suspend fun send(trigger: String, force: Boolean = false): Boolean = mutex.withLock {
        if (!prefs.canSync) return@withLock false
        val now = System.currentTimeMillis()
        // Hindari heartbeat ganda dari loop + alarm + worker yang jatuh berdekatan.
        if (!force && now - prefs.lastHeartbeatSuccessAt < MIN_GAP_MS) return@withLock true

        try {
            beforeSend()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AppLog.w("reconcile sebelum heartbeat gagal", e)
        }

        val s = status.snapshot()
        val errorBeingReported = prefs.lastError
        val request = HeartbeatRequest(
            deviceId = prefs.deviceUuid,
            heartbeatId = UUID.randomUUID().toString(),
            trigger = trigger,
            appVersion = BuildConfig.VERSION_NAME,
            notificationAccess = s.notificationAccess,
            listenerConnected = s.listenerConnected,
            networkConnected = s.networkConnected,
            batteryOptimizationExempt = s.batteryOptimizationExempt,
            backgroundRestricted = s.backgroundRestricted,
            pendingQueue = s.pendingQueue,
            failedQueue = s.failedQueue,
            lastNotificationAt = TimeUtil.isoOrNull(prefs.lastNotificationAt),
            lastListenerConnectedAt = TimeUtil.isoOrNull(prefs.lastListenerConnectedAt),
            lastSuccessfulSyncAt = TimeUtil.isoOrNull(prefs.lastSuccessfulSyncAt),
            lastError = errorBeingReported?.take(1000),
            reportedAt = TimeUtil.iso(now),
        )
        prefs.lastHeartbeatAttemptAt = now

        when (val r = api.heartbeat(request)) {
            is ApiResult.Success -> {
                val body = r.body
                prefs.lastHeartbeatSuccessAt = System.currentTimeMillis()
                prefs.lastHeartbeatResult = if (body.stale) "OK (heartbeat lama, disimpan sebagai histori)" else "OK"
                prefs.serverStatus = body.status
                prefs.serverStatusReason = body.statusReason
                body.heartbeatIntervalSeconds?.let {
                    prefs.heartbeatIntervalSec = it.coerceIn(ConfigRepository.MIN_INTERVAL_SEC, ConfigRepository.MAX_INTERVAL_SEC)
                }
                body.updateRequired?.let { prefs.updateRequired = it }
                // last_error sudah dilaporkan; hapus bila belum diganti error baru.
                prefs.clearLastErrorIf(errorBeingReported)
                val serverVersion = body.configVersion
                if (serverVersion != null && serverVersion != prefs.configVersion) {
                    AppLog.d("config_version berubah -> ambil ulang konfigurasi")
                    config.refresh()
                }
                true
            }
            is ApiResult.HttpError -> {
                prefs.lastHeartbeatResult = "Gagal: ${r.describe()}"
                if (!r.isInvalidToken) prefs.setLastError("Heartbeat gagal: ${r.describe()}")
                false
            }
            is ApiResult.NetworkError -> {
                prefs.lastHeartbeatResult = "Gagal (jaringan): ${r.message}"
                prefs.setLastError("Heartbeat gagal (jaringan): ${r.message}")
                false
            }
        }
    }

    /** Loop heartbeat selama proses hidup. Aman dipanggil berkali-kali. */
    @Synchronized
    fun startLoop() {
        if (loopJob?.isActive == true) return
        loopJob = scope.launch {
            while (isActive) {
                if (prefs.canSync) {
                    try {
                        send(HeartbeatTrigger.PERIODIC)
                        afterTick()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        AppLog.w("heartbeat loop error", e)
                    }
                    armAlarm()
                }
                delay(intervalMs)
            }
        }
    }

    /** Alarm inexact yang tetap boleh berbunyi saat idle; dipasang ulang setiap tick. */
    fun armAlarm() {
        if (!prefs.canSync) return
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = Intent(context, HeartbeatAlarmReceiver::class.java).setAction(HeartbeatAlarmReceiver.ACTION)
        val pi = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_ALARM,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        try {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + intervalMs, pi)
        } catch (e: Exception) {
            AppLog.w("gagal memasang alarm heartbeat", e)
        }
    }

    fun cancelAlarm() {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = Intent(context, HeartbeatAlarmReceiver::class.java).setAction(HeartbeatAlarmReceiver.ACTION)
        val pi = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_ALARM,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE,
        ) ?: return
        am.cancel(pi)
    }

    private companion object {
        const val MIN_GAP_MS = 20_000L
        const val REQUEST_CODE_ALARM = 7001
    }
}
