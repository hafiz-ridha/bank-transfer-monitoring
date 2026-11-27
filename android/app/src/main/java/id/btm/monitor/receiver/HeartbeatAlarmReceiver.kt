package id.btm.monitor.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import id.btm.monitor.appContainer
import id.btm.monitor.domain.HeartbeatTrigger
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Dipanggil AlarmManager (setAndAllowWhileIdle). Alarm "while idle" memberi jendela singkat
 * akses jaringan saat Doze, cukup untuk satu heartbeat. Dibatasi 9 detik (batas broadcast).
 */
class HeartbeatAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val c = context.appContainer
        val pending = goAsync()
        c.appScope.launch {
            try {
                withTimeoutOrNull(9_000L) { c.onBackgroundWake(HeartbeatTrigger.PERIODIC) }
            } finally {
                // Pastikan alarm berikutnya tetap terpasang walau heartbeat timeout.
                c.heartbeat.armAlarm()
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION = "id.btm.monitor.action.HEARTBEAT_ALARM"
    }
}
