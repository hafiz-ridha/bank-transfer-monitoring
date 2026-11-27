package id.btm.monitor.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import id.btm.monitor.core.AppLog
import java.util.concurrent.TimeUnit

/**
 * Penjadwalan WorkManager:
 *  - SYNC_NOW      : one-time, EXPEDITED, butuh jaringan, KEEP (dipicu setiap event baru)
 *  - SYNC_RETRY    : one-time dengan initialDelay sesuai backoff baris pending paling awal
 *  - SYNC_PERIODIC : 15 menit, butuh jaringan (cadangan)
 *  - HB_PERIODIC   : 15 menit (cadangan heartbeat + pemeliharaan)
 *  - HB_NOW        : heartbeat satu kali (mis. setelah boot)
 */
class WorkScheduler(context: Context) {
    private val appContext = context.applicationContext
    private val wm: WorkManager get() = WorkManager.getInstance(appContext)

    private val networkConstraint: Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun enqueueSyncNow() {
        try {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(networkConstraint)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .addTag(TAG)
                .build()
            wm.enqueueUniqueWork(SYNC_NOW, ExistingWorkPolicy.KEEP, request)
        } catch (e: Exception) {
            AppLog.w("enqueueSyncNow gagal", e)
        }
    }

    fun scheduleRetry(delayMs: Long) {
        try {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(networkConstraint)
                .setInitialDelay(delayMs.coerceAtLeast(5_000L), TimeUnit.MILLISECONDS)
                .addTag(TAG)
                .build()
            wm.enqueueUniqueWork(SYNC_RETRY, ExistingWorkPolicy.REPLACE, request)
        } catch (e: Exception) {
            AppLog.w("scheduleRetry gagal", e)
        }
    }

    fun schedulePeriodic() {
        try {
            val sync = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraint)
                .addTag(TAG)
                .build()
            wm.enqueueUniquePeriodicWork(SYNC_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, sync)

            val heartbeat = PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .addTag(TAG)
                .build()
            wm.enqueueUniquePeriodicWork(HB_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, heartbeat)
        } catch (e: Exception) {
            AppLog.w("schedulePeriodic gagal", e)
        }
    }

    fun enqueueHeartbeatNow(trigger: String) {
        try {
            val request = OneTimeWorkRequestBuilder<HeartbeatWorker>()
                .setConstraints(networkConstraint)
                .setInputData(workDataOf(HeartbeatWorker.KEY_TRIGGER to trigger))
                .addTag(TAG)
                .build()
            wm.enqueueUniqueWork(HB_NOW, ExistingWorkPolicy.REPLACE, request)
        } catch (e: Exception) {
            AppLog.w("enqueueHeartbeatNow gagal", e)
        }
    }

    companion object {
        const val TAG = "btm"
        const val SYNC_NOW = "btm-sync-now"
        const val SYNC_RETRY = "btm-sync-retry"
        const val SYNC_PERIODIC = "btm-sync-periodic"
        const val HB_PERIODIC = "btm-heartbeat-periodic"
        const val HB_NOW = "btm-heartbeat-now"
    }
}
