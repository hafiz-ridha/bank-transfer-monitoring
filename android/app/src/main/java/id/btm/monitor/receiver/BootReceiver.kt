package id.btm.monitor.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import id.btm.monitor.appContainer
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Pemulihan setelah reboot (BOOT_COMPLETED / QUICKBOOT_POWERON) dan update aplikasi
 * (MY_PACKAGE_REPLACED): jadwalkan ulang pekerjaan, minta rebind listener, catat event,
 * dan kirim heartbeat. Proses sudah dibuat sehingga Application.onCreate juga berjalan.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val isBoot = action == Intent.ACTION_BOOT_COMPLETED || action == ACTION_QUICKBOOT
        val isUpdate = action == Intent.ACTION_MY_PACKAGE_REPLACED
        if (!isBoot && !isUpdate) return

        val c = context.appContainer
        val pending = goAsync()
        c.appScope.launch {
            try {
                withTimeoutOrNull(9_000L) { c.onSystemStart(isBoot = isBoot) }
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        const val ACTION_QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON"
    }
}
