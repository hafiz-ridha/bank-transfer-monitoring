@file:OptIn(ExperimentalMaterial3Api::class)

package id.btm.monitor.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.btm.monitor.BuildConfig
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.db.DetectionEntity
import id.btm.monitor.data.db.SyncStatus
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.components.CheckState
import id.btm.monitor.ui.components.StatusBadge
import id.btm.monitor.ui.components.formatRupiah

private enum class HistoryFilter(val label: String) {
    ALL("Semua"),
    INCOMING("Transfer masuk"),
    ERROR("Parse error"),
    OTHER("Lainnya"),
}

private fun DetectionEntity.matches(filter: HistoryFilter): Boolean = when (filter) {
    HistoryFilter.ALL -> true
    HistoryFilter.INCOMING -> classification == "INCOMING_TRANSFER" && parseStatus == "PARSED"
    HistoryFilter.ERROR -> parseStatus == "ERROR"
    HistoryFilter.OTHER -> !(classification == "INCOMING_TRANSFER" && parseStatus == "PARSED") && parseStatus != "ERROR"
}

/** Histori deteksi 30 hari terakhir (lokal). */
@Composable
fun HistoryScreen(vm: MainViewModel) {
    val all by vm.detections.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(HistoryFilter.ALL) }
    val list = all.filter { it.matches(filter) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                HistoryFilter.entries.forEach { f ->
                    FilterChip(selected = f == filter, onClick = { filter = f }, label = { Text(f.label) })
                }
            }
        }
        if (list.isEmpty()) {
            item { Text("Belum ada notifikasi bank yang terdeteksi.", style = MaterialTheme.typography.bodyMedium) }
        }
        items(list, key = { it.id }) { d -> DetectionCard(d) }
    }
}

@Composable
private fun DetectionCard(d: DetectionEntity) {
    val isIncoming = d.classification == "INCOMING_TRANSFER" && d.parseStatus == "PARSED"
    val parseState = when {
        isIncoming -> CheckState.OK
        d.parseStatus == "ERROR" -> CheckState.BAD
        else -> CheckState.UNKNOWN
    }
    val syncState = when (d.syncStatus) {
        SyncStatus.SENT, SyncStatus.DUPLICATE -> CheckState.OK
        SyncStatus.FAILED -> CheckState.BAD
        else -> CheckState.WARN
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusBadge("${d.classification} / ${d.parseStatus}", parseState)
                StatusBadge("Sinkron: ${d.syncStatus}", syncState)
            }
            Text(
                "${d.bankCode ?: d.packageName}${d.accountAlias?.let { " • $it" } ?: ""}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            if (d.amount != null) {
                Text(formatRupiah(d.amount), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            d.senderName?.let { Text("Pengirim: $it", style = MaterialTheme.typography.bodyMedium) }
            d.referenceNumber?.let { Text("Referensi: $it", style = MaterialTheme.typography.bodySmall) }
            d.recipientAccount?.let { Text("Rekening tujuan: $it", style = MaterialTheme.typography.bodySmall) }
            d.parseError?.let {
                Text("Error: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            d.transactionCode?.let { Text("Transaksi server: $it", style = MaterialTheme.typography.bodySmall) }
            Text(
                "Diterima ${TimeUtil.display(d.receivedAt)} • ${d.parserVersion ?: "-"}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            // Teks mentah hanya ditampilkan di build debug (untuk validasi format parser).
            if (BuildConfig.DEBUG) {
                val raw = listOfNotNull(d.titleText, d.bodyText).joinToString("\n")
                if (raw.isNotBlank()) {
                    Text("Teks: $raw", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
