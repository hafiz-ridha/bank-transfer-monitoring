package id.btm.monitor.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.db.OutboxEntity
import id.btm.monitor.data.db.OutboxStatus
import id.btm.monitor.data.db.OutboxType
import id.btm.monitor.ui.MainViewModel
import id.btm.monitor.ui.components.CheckState
import id.btm.monitor.ui.components.InfoRow
import id.btm.monitor.ui.components.SectionCard
import id.btm.monitor.ui.components.StatusBadge

/** Antrean sinkronisasi (PRD §3.8): pending / sending / failed, dengan retry manual untuk yang gagal. */
@Composable
fun QueueScreen(vm: MainViewModel) {
    val queue by vm.queue.collectAsStateWithLifecycle()
    val sent by vm.recentlySent.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val prefs by vm.prefs.collectAsStateWithLifecycle()

    val pending = queue.count { it.status == OutboxStatus.PENDING || it.status == OutboxStatus.SENDING }
    val failed = queue.count { it.status == OutboxStatus.FAILED }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            SectionCard("Ringkasan antrean") {
                InfoRow("Belum terkirim", pending.toString())
                InfoRow("Gagal (tidak dicoba otomatis)", failed.toString())
                InfoRow("Sinkronisasi berhasil terakhir", TimeUtil.display(prefs.lastSuccessfulSyncAt))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { vm.syncNow() }, enabled = !busy) { Text("Sinkronkan sekarang") }
                    OutlinedButton(onClick = { vm.retryAllFailed() }, enabled = failed > 0) { Text("Coba ulang yang gagal") }
                }
                Text(
                    "Event dihapus dari antrean hanya setelah server mengonfirmasi (accepted/duplicate).",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (queue.isEmpty()) {
            item { Text("Antrean kosong.", style = MaterialTheme.typography.bodyMedium) }
        }
        items(queue, key = { it.id }) { row -> QueueRow(row, onRetry = { vm.retryOne(row.id) }) }

        if (sent.isNotEmpty()) {
            item {
                Text(
                    "Terkirim (24 jam terakhir)",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            items(sent, key = { "sent-" + it.id }) { row -> QueueRow(row, onRetry = null) }
        }
    }
}

@Composable
private fun QueueRow(row: OutboxEntity, onRetry: (() -> Unit)?) {
    val state = when (row.status) {
        OutboxStatus.SENT -> CheckState.OK
        OutboxStatus.FAILED -> CheckState.BAD
        else -> CheckState.WARN
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusBadge(row.status, state)
                StatusBadge(if (row.type == OutboxType.NOTIFICATION) "Notifikasi" else "Event perangkat", CheckState.UNKNOWN)
            }
            Text(row.summary ?: row.eventId, style = MaterialTheme.typography.bodyMedium)
            Text(
                "Dibuat ${TimeUtil.display(row.createdAt)} • percobaan ${row.attempts}" +
                    if (row.status == OutboxStatus.PENDING && row.nextAttemptAt > System.currentTimeMillis()) {
                        " • berikutnya ${TimeUtil.displayShort(row.nextAttemptAt)}"
                    } else {
                        ""
                    },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            row.lastError?.let {
                Text("Error: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            if (onRetry != null && row.status == OutboxStatus.FAILED) {
                TextButton(onClick = onRetry) { Text("Coba ulang") }
            }
        }
    }
}
