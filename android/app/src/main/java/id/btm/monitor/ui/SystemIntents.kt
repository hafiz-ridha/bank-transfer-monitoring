package id.btm.monitor.ui

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import id.btm.monitor.service.BankNotificationListener

/** Membuka halaman pengaturan sistem, dengan fallback bila halaman tidak tersedia di ROM tertentu. */
object SystemIntents {

    fun openNotificationAccess(context: Context): Boolean {
        val candidates = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val cn = ComponentName(context, BankNotificationListener::class.java)
            candidates += Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, cn.flattenToString())
        }
        candidates += Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        candidates += appDetails(context)
        return start(context, candidates)
    }

    /**
     * Meminta pengecualian optimasi baterai. Status sebenarnya SELALU dibaca ulang dari
     * PowerManager.isIgnoringBatteryOptimizations — membuka halaman ini tidak berarti berhasil.
     */
    @SuppressLint("BatteryLife")
    fun requestIgnoreBatteryOptimizations(context: Context): Boolean = start(
        context,
        listOf(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")),
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            appDetails(context),
        ),
    )

    fun openBatteryOptimizationList(context: Context): Boolean = start(
        context,
        listOf(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), appDetails(context)),
    )

    fun openAppDetails(context: Context): Boolean = start(context, listOf(appDetails(context)))

    fun openAppNotificationSettings(context: Context, packageName: String): Boolean = start(
        context,
        listOf(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)),
        ),
    )

    /** Halaman autostart khusus vendor (komponen tidak resmi; bisa tidak ada di versi ROM tertentu). */
    fun openAutostartSettings(context: Context, manufacturer: String): Boolean {
        val m = manufacturer.lowercase()
        val components = when {
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> listOf(
                ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            )
            m.contains("oppo") || m.contains("realme") || m.contains("oneplus") -> listOf(
                ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
            )
            m.contains("vivo") || m.contains("iqoo") -> listOf(
                ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
            )
            m.contains("huawei") || m.contains("honor") -> listOf(
                ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            )
            else -> emptyList()
        }
        val intents = components.map { Intent().setComponent(it) } + appDetails(context)
        return start(context, intents)
    }

    private fun appDetails(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))

    private fun start(context: Context, intents: List<Intent>): Boolean {
        for (intent in intents) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            } catch (e: ActivityNotFoundException) {
                // coba kandidat berikutnya
            } catch (e: SecurityException) {
                // komponen vendor tidak diekspor
            }
        }
        return false
    }
}
