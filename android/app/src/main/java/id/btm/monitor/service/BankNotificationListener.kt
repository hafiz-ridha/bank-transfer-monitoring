package id.btm.monitor.service

import android.app.Notification
import android.content.ComponentName
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import id.btm.monitor.appContainer
import id.btm.monitor.core.AppLog
import id.btm.monitor.domain.RawNotification
import kotlinx.coroutines.launch

/**
 * Pembaca notifikasi bank (PRD §3.2). Dikelola sistem Android dan berjalan terpisah dari Activity:
 * tidak bergantung pada halaman aplikasi yang sedang terbuka, tidak memerlukan foreground service.
 *
 * Privasi: notifikasi dari package yang TIDAK aktif di konfigurasi server diabaikan sebelum isinya
 * dibaca. Tidak ada isi notifikasi yang ditulis ke log.
 */
class BankNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        ListenerState.set(true)
        val c = applicationContext.appContainer
        c.onListenerConnected()
        // Pulihkan notifikasi yang masih ada di tray (mis. masuk saat listener terputus).
        val recent = try {
            activeNotifications?.toList().orEmpty()
        } catch (e: Exception) {
            emptyList()
        }
        val cutoff = System.currentTimeMillis() - RECOVERY_WINDOW_MS
        recent.filter { it.postTime >= cutoff }.forEach { handle(it) }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        ListenerState.set(false)
        val c = applicationContext.appContainer
        c.onListenerDisconnected()
        // Minta sistem mengikat ulang listener (dibatasi & dicatat di StateReconciler).
        try {
            NotificationListenerService.requestRebind(ComponentName(this, BankNotificationListener::class.java))
        } catch (e: Exception) {
            AppLog.w("requestRebind dari onListenerDisconnected gagal", e)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn != null) handle(sbn)
    }

    private fun handle(sbn: StatusBarNotification) {
        val c = applicationContext.appContainer
        val pkg = sbn.packageName ?: return
        if (pkg == packageName) return
        // Filter paling awal: hanya package bank yang dipilih & aktif.
        if (!c.configRepo.isActivePackage(pkg)) return
        val raw = extract(sbn) ?: return
        // Disimpan lewat scope aplikasi (bukan scope service) agar tidak terputus saat service di-unbind.
        c.appScope.launch {
            try {
                c.processor.process(raw)
            } catch (e: Exception) {
                AppLog.w("gagal memproses notifikasi $pkg", e)
                c.prefs.setLastError("Gagal memproses notifikasi $pkg: ${e.javaClass.simpleName}")
            }
        }
    }

    private fun extract(sbn: StatusBarNotification): RawNotification? {
        val n: Notification = sbn.notification ?: return null
        // Ringkasan grup menduplikasi notifikasi anak; notifikasi "ongoing" adalah status service app bank.
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return null
        if (sbn.isOngoing) return null
        val extras: Bundle = n.extras ?: return null
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
            ?: extras.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
            ?: extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
                ?.joinToString("\n") { it.toString() }
                ?.takeIf { it.isNotBlank() }
        if (title.isNullOrBlank() && text.isNullOrBlank() && bigText.isNullOrBlank()) return null
        return RawNotification(
            packageName = sbn.packageName,
            notificationKey = sbn.key,
            title = title,
            text = text,
            bigText = bigText,
            whenMs = n.`when`,
            postTime = sbn.postTime,
        )
    }

    private companion object {
        /** Notifikasi di tray yang lebih tua dari ini tidak diproses ulang saat listener terhubung. */
        const val RECOVERY_WINDOW_MS = 6 * 60 * 60_000L
    }
}
