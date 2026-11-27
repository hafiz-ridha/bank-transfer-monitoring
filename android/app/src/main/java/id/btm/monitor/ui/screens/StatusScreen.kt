package id.btm.monitor.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.Screen
import id.btm.monitor.ui.ServerDeviceState
import id.btm.monitor.ui.SystemIntents
import id.btm.monitor.ui.components.CheckState
import id.btm.monitor.ui.components.InfoRow
import id.btm.monitor.ui.components.SectionCard
import id.btm.monitor.ui.components.StatusRow
import id.btm.monitor.ui.components.boolState

/** Semua pemeriksaan berasal dari API sistem yang nyata; yang tidak dapat diperiksa ditandai "Belum diketahui". */
@Composable
fun StatusScreen(vm: MainViewModel, onNavigate: (Screen) -> Unit) {
    val context = LocalContext.current
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val server by vm.serverDevice.collectAsStateWithLifecycle()
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

        SectionCard("Pemeriksaan perangkat") {
            if (s == null) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            StatusRow(
                "Notification Access",
                boolState(s?.notificationAccess),
                when (s?.notificationAccess) { null -> null; true -> "Aktif"; false -> "Tidak aktif" },
            )
            StatusRow(
                "Listener terhubung",
                boolState(s?.listenerConnected),
                when (s?.listenerConnected) { null -> null; true -> "Terhubung"; false -> "Tidak terhubung" },
                detail = "Terakhir terhubung: ${TimeUtil.display(prefs.lastListenerConnectedAt)}\n" +
                    "Terakhir terputus: ${TimeUtil.display(prefs.lastListenerDisconnectedAt)}",
            )
            StatusRow(
                "Koneksi internet",
                boolState(s?.networkConnected),
                when (s?.networkConnected) { null -> null; true -> "Terhubung"; false -> "Terputus" },
            )
            StatusRow(
                "Optimasi baterai dikecualikan",
                when (s?.batteryOptimizationExempt) { null -> CheckState.UNKNOWN; true -> CheckState.OK; false -> CheckState.WARN },
                when (s?.batteryOptimizationExempt) { null -> null; true -> "Ya"; false -> "Tidak" },
                detail = "Dibaca dari PowerManager.isIgnoringBatteryOptimizations",
            )
            StatusRow(
                "Pembatasan latar belakang",
                when (s?.backgroundRestricted) { null -> CheckState.UNKNOWN; true -> CheckState.BAD; false -> CheckState.OK },
                when (s?.backgroundRestricted) { null -> if (s == null) null else "Tidak tersedia (Android < 9)"; true -> "Dibatasi"; false -> "Tidak dibatasi" },
            )
            StatusRow(
                "Autostart (khusus merek tertentu)",
                CheckState.UNKNOWN,
                if (prefs.autostartConfirmed) "Dikonfirmasi pengguna" else "Belum dikonfirmasi",
                detail = "Tidak dapat diverifikasi otomatis oleh aplikasi",
            )
            StatusRow(
                "Koneksi server",
                serverState(prefs, now),
                serverLabel(prefs, now),
            )
            StatusRow(
                "Jam perangkat",
                if (prefs.clockSkew) CheckState.BAD else if (prefs.lastHeartbeatSuccessAt > 0) CheckState.OK else CheckState.UNKNOWN,
                if (prefs.clockSkew) "Tidak sinkron" else if (prefs.lastHeartbeatSuccessAt > 0) "Sinkron" else null,
            )
            StatusRow(
                "Antrean transaksi",
                when {
                    s == null -> CheckState.UNKNOWN
                    s.failedQueue > 0 -> CheckState.BAD
                    s.pendingQueue > 0 -> CheckState.WARN
                    else -> CheckState.OK
                },
                if (s == null) null else "${s.pendingQueue} belum terkirim, ${s.failedQueue} gagal",
                detail = if (s == null) null else "Event perangkat: ${s.pendingEvents} belum terkirim, ${s.failedEvents} gagal",
            )
        }

        Button(onClick = { SystemIntents.openNotificationAccess(context) }, modifier = Modifier.fillMaxWidth()) {
            Text("Buka pengaturan Notification Access")
        }
        OutlinedButton(onClick = { onNavigate(Screen.BATTERY) }, modifier = Modifier.fillMaxWidth()) {
            Text("Panduan baterai & autostart")
        }

        SectionCard("Heartbeat") {
            InfoRow("Interval target", "${prefs.heartbeatIntervalSec} detik (dari server)")
            InfoRow("Percobaan terakhir", TimeUtil.display(prefs.lastHeartbeatAttemptAt))
            InfoRow("Berhasil terakhir", TimeUtil.display(prefs.lastHeartbeatSuccessAt))
            InfoRow("Hasil terakhir", prefs.lastHeartbeatResult)
            InfoRow(
                "Status di server",
                prefs.serverStatus?.let { st -> st + (prefs.serverStatusReason?.let { " ($it)" } ?: "") },
            )
            InfoRow("Notifikasi terakhir", TimeUtil.display(prefs.lastNotificationAt))
            InfoRow("Sinkronisasi berhasil", TimeUtil.display(prefs.lastSuccessfulSyncAt))
            InfoRow("Error terakhir", prefs.lastError?.let { "$it (${TimeUtil.display(prefs.lastErrorAt)})" } ?: "-")
            OutlinedButton(onClick = { vm.sendHeartbeat() }) { Text("Kirim heartbeat sekarang") }
        }

        SectionCard("Status menurut server (GET /devices/me)") {
            when (val st = server) {
                ServerDeviceState.Idle -> Text("Belum dimuat", style = MaterialTheme.typography.bodyMedium)
                ServerDeviceState.Loading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                is ServerDeviceState.Error -> Text("Gagal: ${st.message}", color = MaterialTheme.colorScheme.error)
                is ServerDeviceState.Loaded -> {
                    val d = st.device
                    InfoRow("Dimuat", TimeUtil.display(st.at))
                    InfoRow("Status", d.status)
                    InfoRow("Alasan", d.statusReason)
                    InfoRow("Sumber status", d.statusSource)
                    InfoRow("Koneksi", d.connectionState)
                    InfoRow("Umur heartbeat", d.heartbeatAgeSeconds?.let { "${it.toLong()} detik" })
                    InfoRow("Antrean (server)", d.pendingQueue?.toString())
                    if (d.issues.isEmpty()) {
                        Text("Tidak ada masalah tercatat", style = MaterialTheme.typography.bodySmall)
                    } else {
                        d.issues.forEach { issue ->
                            Text(
                                "• [${issue.severity ?: "-"}] ${issue.message ?: issue.code ?: "-"}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
            OutlinedButton(onClick = { vm.loadServerDevice() }) { Text("Muat status dari server") }
        }
    }
}
