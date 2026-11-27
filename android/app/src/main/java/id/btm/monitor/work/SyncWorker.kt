package id.btm.monitor.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import id.btm.monitor.appContainer
import id.btm.monitor.core.AppLog
import id.btm.monitor.core.Notifications
import kotlinx.coroutines.CancellationException

/** Mengirim antrean notifikasi (/notifications/batch) dan event perangkat (/devices/events). */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val c = applicationContext.appContainer
        return try {
            val outcome = c.syncEngine.syncAll()
            AppLog.d("sync: ${outcome.describe()}")
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AppLog.w("sync worker error", e)
            c.prefs.setLastError("Sinkronisasi error: ${e.javaClass.simpleName}")
            Result.retry()
        }
    }

    /** Wajib untuk expedited work di Android 8-11 (dijalankan sebagai foreground service singkat). */
    override suspend fun getForegroundInfo(): ForegroundInfo = Notifications.syncForegroundInfo(applicationContext)
}
