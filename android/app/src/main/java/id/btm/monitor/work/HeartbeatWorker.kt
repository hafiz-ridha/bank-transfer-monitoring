package id.btm.monitor.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import id.btm.monitor.appContainer
import id.btm.monitor.core.AppLog
import id.btm.monitor.domain.HeartbeatTrigger
import kotlinx.coroutines.CancellationException

/**
 * Cadangan heartbeat (periodik 15 menit) + pemeliharaan: memastikan loop heartbeat & alarm aktif,
 * memeriksa listener, membersihkan histori lama, dan memicu sinkronisasi bila ada antrean.
 */
class HeartbeatWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val c = applicationContext.appContainer
        val trigger = inputData.getString(KEY_TRIGGER) ?: HeartbeatTrigger.PERIODIC
        return try {
            c.onBackgroundWake(trigger)
            c.runMaintenanceIfDue()
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AppLog.w("heartbeat worker error", e)
            Result.success()
        }
    }

    companion object {
        const val KEY_TRIGGER = "trigger"
    }
}
