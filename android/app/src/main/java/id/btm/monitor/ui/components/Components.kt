package id.btm.monitor.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.ui.theme.StatusColors
import java.text.NumberFormat
import java.util.Locale

/** Hasil pemeriksaan untuk ditampilkan. UNKNOWN tidak pernah ditampilkan sebagai OK. */
enum class CheckState { OK, WARN, BAD, UNKNOWN }

fun boolState(value: Boolean?, okWhen: Boolean = true): CheckState = when (value) {
    null -> CheckState.UNKNOWN
    okWhen -> CheckState.OK
    else -> CheckState.BAD
}

fun CheckState.color(): Color = when (this) {
    CheckState.OK -> StatusColors.Ok
    CheckState.WARN -> StatusColors.Warn
    CheckState.BAD -> StatusColors.Bad
    CheckState.UNKNOWN -> StatusColors.Unknown
}

fun CheckState.defaultLabel(): String = when (this) {
    CheckState.OK -> "OK"
    CheckState.WARN -> "Perlu perhatian"
    CheckState.BAD -> "Bermasalah"
    CheckState.UNKNOWN -> TimeUtil.UNKNOWN
}

private val LOCALE_ID: Locale = Locale.forLanguageTag("id-ID")

fun formatRupiah(amount: Long?): String =
    if (amount == null) "-" else "Rp " + NumberFormat.getIntegerInstance(LOCALE_ID).format(amount)

@Composable
fun SectionCard(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
fun StatusDot(state: CheckState) {
    Box(
        Modifier
            .size(12.dp)
            .background(state.color(), CircleShape),
    )
}

/** Baris status dengan indikator warna. [value] default diambil dari state. */
@Composable
fun StatusRow(label: String, state: CheckState, value: String? = null, detail: String? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        StatusDot(state)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (!detail.isNullOrBlank()) {
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(
            value ?: state.defaultLabel(),
            style = MaterialTheme.typography.bodyMedium,
            color = state.color(),
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
fun InfoRow(label: String, value: String?) {
    Row(Modifier.fillMaxWidth()) {
        Text(
            label,
            modifier = Modifier.weight(0.45f),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            if (value.isNullOrBlank()) TimeUtil.UNKNOWN else value,
            modifier = Modifier.weight(0.55f),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
fun StatusBadge(text: String, state: CheckState) {
    Text(
        text,
        modifier = Modifier
            .background(state.color().copy(alpha = 0.15f), RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
        style = MaterialTheme.typography.labelMedium,
        color = state.color(),
        fontWeight = FontWeight.SemiBold,
    )
}

/** Kartu peringatan (mis. jam tidak sinkron, versi tidak didukung). */
@Composable
fun WarningCard(title: String, message: String, state: CheckState = CheckState.WARN) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = state.color().copy(alpha = 0.12f)),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = state.color(), fontWeight = FontWeight.Bold)
            Text(message, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
