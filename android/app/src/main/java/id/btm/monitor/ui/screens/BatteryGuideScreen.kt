package id.btm.monitor.ui.screens

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.btm.monitor.ui.BrandGuides
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.SystemIntents
import id.btm.monitor.ui.components.CheckState
import id.btm.monitor.ui.components.SectionCard
import id.btm.monitor.ui.components.StatusRow

/**
 * Panduan battery optimization per merek (PRD §3.4). Status hanya dari pemeriksaan nyata;
 * membuka halaman pengaturan TIDAK dianggap berhasil. Autostart tidak dapat diverifikasi,
 * sehingga hanya ditampilkan sebagai "dikonfirmasi pengguna".
 */
@Composable
fun BatteryGuideScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val status by vm.status.collectAsStateWithLifecycle()
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val guide = remember { BrandGuides.forManufacturer(Build.MANUFACTURER.orEmpty()) }
    val s = status

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SectionCard("Status saat ini (diperiksa langsung)") {
            StatusRow(
                "Pengecualian optimasi baterai",
                when (s?.batteryOptimizationExempt) { null -> CheckState.UNKNOWN; true -> CheckState.OK; false -> CheckState.BAD },
                when (s?.batteryOptimizationExempt) { null -> null; true -> "Dikecualikan"; false -> "Masih dioptimalkan" },
            )
            StatusRow(
                "Pembatasan latar belakang",
                when (s?.backgroundRestricted) { null -> CheckState.UNKNOWN; true -> CheckState.BAD; false -> CheckState.OK },
                when (s?.backgroundRestricted) { null -> null; true -> "Dibatasi"; false -> "Tidak dibatasi" },
            )
            StatusRow(
                "Autostart",
                CheckState.UNKNOWN,
                if (prefs.autostartConfirmed) "Dikonfirmasi pengguna" else "Belum dikonfirmasi",
                detail = "Tidak dapat diverifikasi otomatis",
            )
            Text(
                "Status diperbarui otomatis setelah Anda kembali dari halaman pengaturan.",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Button(onClick = { SystemIntents.requestIgnoreBatteryOptimizations(context) }, modifier = Modifier.fillMaxWidth()) {
            Text("Minta pengecualian optimasi baterai")
        }
        OutlinedButton(onClick = { SystemIntents.openBatteryOptimizationList(context) }, modifier = Modifier.fillMaxWidth()) {
            Text("Buka daftar optimasi baterai")
        }
        OutlinedButton(onClick = { SystemIntents.openAppDetails(context) }, modifier = Modifier.fillMaxWidth()) {
            Text("Buka info aplikasi (Baterai > Tidak dibatasi)")
        }
        if (guide.hasAutostart) {
            OutlinedButton(
                onClick = { SystemIntents.openAutostartSettings(context, Build.MANUFACTURER.orEmpty()) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Buka pengaturan autostart (jika tersedia)")
            }
        }

        SectionCard("Langkah untuk ${guide.brand}") {
            Text(
                "Terdeteksi: ${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})",
                style = MaterialTheme.typography.bodySmall,
            )
            guide.steps.forEachIndexed { i, step -> Text("${i + 1}. $step") }
        }

        SectionCard("Konfirmasi manual") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = prefs.autostartConfirmed, onCheckedChange = { vm.setAutostartConfirmed(it) })
                Text("Saya sudah mengizinkan autostart / aktivitas latar belakang untuk aplikasi ini")
            }
            Text(
                "Ini hanya catatan konfirmasi pengguna, bukan hasil verifikasi sistem.",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        SectionCard("Hal lain yang perlu dijaga") {
            Text("• Jangan Force Stop aplikasi ini; Force Stop menghentikan monitoring sampai aplikasi dibuka lagi.")
            Text("• Jangan aktifkan mode hemat daya ekstrem / ultra.")
            Text("• Pastikan notifikasi aplikasi bank diizinkan (lihat menu Sumber Bank).")
            Text("• Pastikan data seluler / Wi-Fi diizinkan di latar belakang untuk aplikasi ini.")
        }
    }
}
