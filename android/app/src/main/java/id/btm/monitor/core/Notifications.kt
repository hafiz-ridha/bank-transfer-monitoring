package id.btm.monitor.core

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import id.btm.monitor.R

/**
 * Satu-satunya notifikasi milik aplikasi: dipakai WorkManager ketika menjalankan pekerjaan
 * sinkronisasi "expedited" di Android 8-11 (di versi tersebut WorkManager mewujudkan expedited
 * work sebagai foreground service singkat). Android 12+ memakai expedited job tanpa notifikasi.
 * Pembacaan notifikasi bank sendiri TIDAK memakai foreground service (PRD §3.2).
 */
object Notifications {
    const val CHANNEL_SYNC = "btm_sync"
    private const val NOTIFICATION_ID_SYNC = 4101

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_SYNC,
            context.getString(R.string.channel_sync_name),
            NotificationManager.IMPORTANCE_MIN,
        ).apply {
            description = context.getString(R.string.channel_sync_description)
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    fun syncForegroundInfo(context: Context): ForegroundInfo {
        val notification = NotificationCompat.Builder(context, CHANNEL_SYNC)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setContentTitle("Mengirim data monitoring")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .build()
        return ForegroundInfo(NOTIFICATION_ID_SYNC, notification)
    }
}
