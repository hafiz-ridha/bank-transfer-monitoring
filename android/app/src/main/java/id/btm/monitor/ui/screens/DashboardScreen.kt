package id.btm.monitor.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.btm.monitor.BuildConfig
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.prefs.PrefsView
import id.btm.monitor.domain.StatusSnapshot
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.Screen
import id.btm.monitor.ui.SystemIntents
import id.btm.monitor.ui.components.CheckState
import id.btm.monitor.ui.components.InfoRow
import id.btm.monitor.ui.components.SectionCard
import id.btm.monitor.ui.components.StatusRow
import id.btm.monitor.ui.components.WarningCard
import id.btm.monitor.ui.components.boolState

/** Status layanan monitoring: hanya OK bila izin aktif DAN listener benar-benar terhubung. */
fun monitoringState(s: StatusSnapshot?): CheckState = when {
    s == null -> CheckState.UNKNOWN
    !s.notificationAccess -> CheckState.BAD
    !s.listenerConnected -> CheckState.BAD
    else -> CheckState.OK
}

fun monitoringLabel(s: StatusSnapshot?): String = when {
    s == null -> TimeUtil.UNKNOWN
    !s.notificationAccess -> "Tidak berjalan (izin dicabut)"
    !s.listenerConnected -> "Listener tidak terhubung"
    else -> "Berjalan"
}

/** Koneksi server berdasarkan hasil heartbeat terakhir (bukan asumsi). */
fun serverState(p: PrefsView, now: Long): CheckState {
    if (p.lastHeartbeatAttemptAt == 0L) return CheckState.UNKNOWN
    if (p.clockSkew) return CheckState.BAD
    val lastOk = p.lastHeartbeatSuccessAt
    val staleAfter = maxOf(3L * p.heartbeatIntervalSec * 1000L, 5 * 60_000L)
    return when {
        lastOk >= p.lastHeartbeatAttemptAt && now - lastOk <= staleAfter -> CheckState.OK
        lastOk >= p.lastHeartbeatAttemptAt -> CheckState.WARN
        else -> CheckState.BAD
    }
}

fun serverLabel(p: PrefsView, now: Long): String = when (serverState(p, now)) {
    CheckState.OK -> "Terhubung"
    CheckState.WARN -> "Belum ada kabar terbaru"
    CheckState.BAD -> if (p.clockSkew) "Jam tidak sinkron" else "Gagal terhubung"
    CheckState.UNKNOWN -> TimeUtil.UNKNOWN
}

@Composable
fun GlobalWarnings(p: PrefsView) {
    if (p.clockSkew) {
        WarningCard(
            title = "Jam perangkat tidak sinkron",
            message = "Server menolak request karena selisih jam terlalu besar. Aktifkan \"Tanggal & waktu otomatis\" " +
                "di Pengaturan > Sistem > Tanggal & waktu." +
                (p.clockSkewServerTime?.let { " Waktu server: $it" } ?: ""),
            state = CheckState.BAD,
        )
    }
    if (p.updateRequired) {
        WarningCard(
            title = "Versi aplikasi tidak didukung",
            message = "Server meminta versi minimal ${p.minAppVersion ?: "-"}. Perbarui APK secepatnya.",
            state = CheckState.BAD,
        )
    }
}

@Composable
fun DashboardScreen(vm: MainViewModel, onNavigate: (Screen) -> Unit) {
    val context = LocalContext.current
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val today by vm.todayIncoming.collectAsStateWithLifecycle()
    val unsent by vm.unsentNotifications.collectAsStateWithLifecycle()
    val failed by vm.failedNotifications.collectAsStateWithLifecycle()
    val s = status
    val now = s?.checkedAt ?: System.currentTimeMillis()

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        GlobalWarnings(prefs)

        SectionCard("Kondisi monitoring") {
            StatusRow("Layanan monitoring", monitoringState(s), monitoringLabel(s))
            StatusRow(
                "Notification Access",
                boolState(s?.notificationAccess),
                when (s?.notificationAccess) { null -> null; true -> "Aktif"; false -> "Tidak aktif" },
            )
            StatusRow(
                "Koneksi internet",
                boolState(s?.networkConnected),
                when (s?.networkConnected) { null -> null; true -> "Terhubung"; false -> "Terputus" },
            )
            StatusRow(
                "Koneksi server",
                serverState(prefs, now),
                serverLabel(prefs, now),
                detail = prefs.serverStatus?.let { "Status di server: $it" + (prefs.serverStatusReason?.let { r -> " ($r)" } ?: "") },
            )
            if (s != null && !s.notificationAccess) {
                Button(onClick = { SystemIntents.openNotificationAccess(context) }) {
                    Text("Aktifkan Notification Access")
                }
            }
        }

        SectionCard("Ringkasan") {
            InfoRow("Transaksi masuk hari ini", today.toString())
            InfoRow("Antrean belum terkirim", if (failed > 0) "$unsent (gagal: $failed)" else unsent.toString())
            InfoRow(
                "Heartbeat terakhir",
                if (prefs.lastHeartbeatSuccessAt > 0) {
                    "${TimeUtil.display(prefs.lastHeartbeatSuccessAt)} (${TimeUtil.relative(prefs.lastHeartbeatSuccessAt, now)})"
                } else {
                    TimeUtil.UNKNOWN
                },
            )
            InfoRow("Notifikasi bank terakhir", TimeUtil.display(prefs.lastNotificationAt))
            InfoRow("Sinkronisasi berhasil terakhir", TimeUtil.display(prefs.lastSuccessfulSyncAt))
            InfoRow("Versi aplikasi", BuildConfig.VERSION_NAME)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { onNavigate(Screen.STATUS) }) { Text("Status detail") }
            OutlinedButton(onClick = { onNavigate(Screen.QUEUE) }) { Text("Antrean") }
        }
    }
}
