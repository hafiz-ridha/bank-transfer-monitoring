package id.btm.monitor.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.btm.monitor.BuildConfig
import id.btm.monitor.data.prefs.PrefsView
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.components.CheckState
import id.btm.monitor.ui.components.InfoRow
import id.btm.monitor.ui.components.SectionCard
import id.btm.monitor.ui.components.WarningCard

/**
 * Pairing perangkat: URL server + kode pairing 8 karakter dari dashboard web.
 * Dipakai juga untuk pairing ulang saat token dicabut (antrean lokal tetap disimpan).
 */
@Composable
fun OnboardingScreen(vm: MainViewModel, prefs: PrefsView, repairMode: Boolean, snackbar: SnackbarHostState) {
    val busy by vm.busy.collectAsStateWithLifecycle()
    val initialUrl = prefs.apiBaseUrl?.removeSuffix("/api/v1").orEmpty()
    var url by rememberSaveable { mutableStateOf(initialUrl) }
    var code by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf(prefs.deviceName.orEmpty()) }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Bank Transfer Monitor", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Pasangkan HP ini dengan server. Buat perangkat di dashboard web (Perangkat > Tambah) " +
                    "untuk mendapatkan kode pairing 8 karakter (berlaku 24 jam, sekali pakai).",
                style = MaterialTheme.typography.bodyMedium,
            )

            if (prefs.needsRepair) {
                WarningCard(
                    title = "Perlu pairing ulang",
                    message = (prefs.repairReason ?: "Token perangkat tidak valid.") +
                        " Sinkronisasi dihentikan; antrean lokal tetap disimpan dan akan dikirim setelah pairing berhasil.",
                    state = CheckState.BAD,
                )
            } else if (repairMode) {
                WarningCard(
                    title = "Pairing ulang",
                    message = "Token lama tetap dipakai sampai pairing baru berhasil. Antrean lokal tidak dihapus.",
                )
            }

            OutlinedTextField(
                value = url,
                onValueChange = { url = it.trim() },
                label = { Text("URL server") },
                placeholder = { Text("https://api.contoh.co.id") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
                supportingText = {
                    Text(
                        if (BuildConfig.DEBUG) "Debug: http:// diizinkan untuk localhost, 10.0.2.2 (emulator) dan IP LAN."
                        else "Hanya HTTPS. Akhiran /api/v1 ditambahkan otomatis.",
                    )
                },
            )
            OutlinedTextField(
                value = code,
                onValueChange = { input -> code = input.uppercase().filter { it.isLetterOrDigit() }.take(20) },
                label = { Text("Kode pairing") },
                placeholder = { Text("AB3K9QXZ") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(100) },
                label = { Text("Nama perangkat (opsional)") },
                placeholder = { Text("Android Monitoring 01") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { vm.register(url, code, name) },
                    enabled = !busy && url.isNotBlank() && code.length >= 6,
                ) {
                    Text("Pasangkan perangkat")
                }
                if (busy) {
                    Spacer(Modifier.width(12.dp))
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                }
                if (repairMode && !prefs.needsRepair) {
                    Spacer(Modifier.width(12.dp))
                    OutlinedButton(onClick = { vm.cancelRepair() }, enabled = !busy) { Text("Batal") }
                }
            }

            SectionCard("Identitas perangkat ini") {
                InfoRow("Device UUID", prefs.deviceUuid)
                InfoRow("Versi aplikasi", BuildConfig.VERSION_NAME)
            }

            SectionCard("Setelah pairing") {
                Text("1. Berikan izin Notification Access untuk \"Pembaca Notifikasi Bank (BTM)\".")
                Text("2. Ikuti Panduan Baterai sesuai merek HP (menu Status Monitoring).")
                Text("3. Pastikan notifikasi aplikasi bank aktif dan sumber bank sudah diaktifkan di dashboard web.")
            }
        }
    }
}
