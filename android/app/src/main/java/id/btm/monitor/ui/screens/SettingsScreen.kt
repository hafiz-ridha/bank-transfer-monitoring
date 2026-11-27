package id.btm.monitor.ui.screens

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.btm.monitor.BuildConfig
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.components.InfoRow
import id.btm.monitor.ui.components.SectionCard

@Composable
fun SettingsScreen(vm: MainViewModel) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    var confirmRepair by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard("Server") {
            InfoRow("URL API", prefs.apiBaseUrl)
            InfoRow("Interval heartbeat", "${prefs.heartbeatIntervalSec} detik (diatur server)")
            InfoRow("Versi konfigurasi", prefs.configVersion)
            InfoRow("Versi minimal aplikasi", prefs.minAppVersion)
            OutlinedButton(onClick = { vm.refreshConfig() }) { Text("Tarik ulang konfigurasi") }
        }

        SectionCard("Perangkat") {
            InfoRow("Nama perangkat", prefs.deviceName)
            InfoRow("ID di server", prefs.serverDeviceId)
            InfoRow("Device UUID", prefs.deviceUuid)
            InfoRow("Dipasangkan", TimeUtil.display(prefs.registeredAt))
            InfoRow("Model", Build.MODEL)
            InfoRow("Produsen", Build.MANUFACTURER)
            InfoRow("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        }

        SectionCard("Aplikasi") {
            InfoRow("Versi", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            InfoRow("Build", BuildConfig.BUILD_TYPE)
            InfoRow("Package", BuildConfig.APPLICATION_ID)
        }

        SectionCard("Pairing ulang") {
            Text(
                "Gunakan bila perangkat dipindah ke server lain atau admin membuat kode pairing baru. " +
                    "Antrean lokal yang belum terkirim TIDAK dihapus.",
                style = MaterialTheme.typography.bodySmall,
            )
            OutlinedButton(onClick = { confirmRepair = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Pasangkan ulang perangkat")
            }
        }
    }

    if (confirmRepair) {
        AlertDialog(
            onDismissRequest = { confirmRepair = false },
            title = { Text("Pasangkan ulang?") },
            text = { Text("Anda akan diminta memasukkan URL server dan kode pairing baru dari dashboard. Token lama tetap dipakai sampai pairing baru berhasil.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmRepair = false
                    vm.startRepair()
                }) { Text("Lanjut") }
            },
            dismissButton = {
                TextButton(onClick = { confirmRepair = false }) { Text("Batal") }
            },
        )
    }
}
