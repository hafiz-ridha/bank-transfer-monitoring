package id.btm.monitor.ui.screens

import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import id.btm.monitor.data.db.PackageStat
import id.btm.monitor.data.net.BankSourceDto
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.SystemIntents
import id.btm.monitor.ui.components.CheckState
import id.btm.monitor.ui.components.InfoRow
import id.btm.monitor.ui.components.SectionCard
import id.btm.monitor.ui.components.StatusBadge

/** Package yang dideklarasikan di <queries> manifest sehingga status pemasangannya dapat diperiksa. */
private val KNOWN_PACKAGES = setOf(
    "com.bca", "com.bca.mybca.omni.android", "id.co.bri.brimo", "id.bmri.livin",
    "src.com.bni", "id.bni.wondr", "com.bsm.activity2",
)

/** true/false bila dapat diperiksa; null bila package tidak terlihat karena batasan visibilitas paket. */
@Suppress("DEPRECATION")
private fun installedState(context: Context, pkg: String): Boolean? = try {
    context.packageManager.getPackageInfo(pkg, 0)
    true
} catch (e: PackageManager.NameNotFoundException) {
    if (pkg in KNOWN_PACKAGES) false else null
}

/**
 * Sumber bank diatur dari dashboard web (admin). Aplikasi hanya membaca notifikasi dari package
 * yang aktif di sini (PRD §3.6 "Sistem hanya memproses notifikasi yang dipilih pengguna").
 */
@Composable
fun BankSourcesScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val config by vm.config.collectAsStateWithLifecycle()
    val stats by vm.packageStats.collectAsStateWithLifecycle()
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val statsByPkg: Map<String, PackageStat> = stats.associateBy { it.packageName }
    val sources: List<BankSourceDto> = config?.bankSources.orEmpty()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionCard("Konfigurasi") {
                InfoRow("Versi konfigurasi", prefs.configVersion)
                InfoRow("Diambil", TimeUtil.display(prefs.configFetchedAt))
                InfoRow("Kirim teks mentah", if (prefs.sendRawText) "Ya" else "Tidak")
                Text(
                    "Sumber bank, alias rekening, dan status aktif diatur oleh admin di dashboard web.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = { vm.refreshConfig() }) { Text("Tarik ulang konfigurasi") }
            }
        }
        if (config == null) {
            item { Text("Konfigurasi belum dimuat dari server.") }
        } else if (sources.isEmpty()) {
            item { Text("Belum ada sumber bank di server. Tambahkan dari dashboard web.") }
        }
        items(sources, key = { it.id ?: (it.packageName + "|" + it.accountAlias) }) { src ->
            val parser = vm.c.parsers.select(src.packageName, src.parserKey)
            val stat = statsByPkg[src.packageName]
            val installed = installedState(context, src.packageName)
            SectionCard("${src.bankName ?: src.bankCode ?: "-"} — ${src.accountAlias ?: "-"}") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusBadge(if (src.isActive) "Aktif" else "Nonaktif", if (src.isActive) CheckState.OK else CheckState.UNKNOWN)
                    if (src.isDefault) StatusBadge("Default", CheckState.OK)
                    StatusBadge(
                        when (installed) { true -> "Terpasang"; false -> "Tidak terpasang"; null -> "Pemasangan tidak dapat diperiksa" },
                        when (installed) { true -> CheckState.OK; false -> CheckState.BAD; null -> CheckState.UNKNOWN },
                    )
                }
                InfoRow("Kode bank", src.bankCode)
                InfoRow("Package", src.packageName)
                InfoRow("Rekening", src.accountIdentifier?.let { "…" + it.takeLast(4) })
                InfoRow("Parser (server)", listOfNotNull(src.parserKey, src.parserVersion).joinToString(" / ").ifBlank { null })
                InfoRow("Parser (aplikasi)", parser.version)
                InfoRow("Notifikasi terakhir", stat?.let { TimeUtil.display(it.lastAt) })
                InfoRow("Terdeteksi (30 hari)", stat?.total?.toString() ?: "0")
                InfoRow("Error parser", stat?.errors?.toString() ?: "0")
                OutlinedButton(onClick = { SystemIntents.openAppNotificationSettings(context, src.packageName) }) {
                    Text("Pengaturan notifikasi aplikasi bank")
                }
            }
        }
    }
}
