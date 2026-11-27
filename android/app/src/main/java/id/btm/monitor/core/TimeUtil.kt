package id.btm.monitor.core

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Utilitas waktu (murni JVM, tanpa API Android, agar bisa diuji dengan JUnit). */
object TimeUtil {
    /** ISO-8601 dengan offset, presisi milidetik. Contoh: 2026-11-27T10:00:00.000+07:00 */
    private val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)
    private val DISPLAY: DateTimeFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss", Locale.US)
    private val DISPLAY_SHORT: DateTimeFormatter = DateTimeFormatter.ofPattern("dd/MM HH:mm", Locale.US)

    const val UNKNOWN = "Belum diketahui"

    fun now(): Long = System.currentTimeMillis()

    fun iso(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        ISO.format(Instant.ofEpochMilli(epochMs).atZone(zone))

    fun iso(dateTime: ZonedDateTime): String = ISO.format(dateTime)

    /** ISO atau null bila nilai 0 / negatif (artinya belum pernah terjadi). */
    fun isoOrNull(epochMs: Long): String? = if (epochMs > 0) iso(epochMs) else null

    /** Parse ISO-8601 dengan offset ke epoch ms, null bila tidak valid. */
    fun parseIsoToEpoch(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return try {
            OffsetDateTime.parse(value).toInstant().toEpochMilli()
        } catch (e: Exception) {
            null
        }
    }

    fun display(epochMs: Long): String =
        if (epochMs > 0) DISPLAY.format(Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault())) else UNKNOWN

    fun displayShort(epochMs: Long): String =
        if (epochMs > 0) DISPLAY_SHORT.format(Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault())) else "-"

    /** Teks relatif sederhana, mis. "2 menit lalu". */
    fun relative(epochMs: Long, now: Long = now()): String {
        if (epochMs <= 0) return UNKNOWN
        val diff = (now - epochMs) / 1000
        return when {
            diff < 0 -> display(epochMs)
            diff < 60 -> "$diff detik lalu"
            diff < 3600 -> "${diff / 60} menit lalu"
            diff < 86_400 -> "${diff / 3600} jam lalu"
            else -> "${diff / 86_400} hari lalu"
        }
    }

    fun startOfToday(zone: ZoneId = ZoneId.systemDefault()): Long =
        LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli()
}
