package id.btm.monitor.parser

import id.btm.monitor.core.TimeUtil
import java.time.DateTimeException
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Parse waktu transaksi dari teks notifikasi (format Indonesia: dd/MM/yyyy HH:mm[:ss]).
 * Hanya mengembalikan nilai bila tanggal DAN jam ada serta valid; selain itu null
 * (server lalu memakai waktu notifikasi diterima).
 * Zona: WIB (+07), WITA (+08), WIT (+09) bila tertulis di teks; jika tidak, zona perangkat.
 */
object TimeParser {
    private val RX = Regex(
        """^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2,4})(?:[ ,]+(?:pukul\s+|jam\s+)?([0-9]{1,2})[.:]([0-9]{2})(?:[.:]([0-9]{2}))?)?$""",
        RegexOption.IGNORE_CASE,
    )
    private val WITA = Regex("""\bWITA\b""", RegexOption.IGNORE_CASE)
    private val WIT = Regex("""\bWIT\b""", RegexOption.IGNORE_CASE)
    private val WIB = Regex("""\bWIB\b""", RegexOption.IGNORE_CASE)

    fun parse(raw: String, context: String, defaultZone: ZoneId): String? {
        val m = RX.matchEntire(raw.trim()) ?: return null
        val g = m.groupValues
        if (g[4].isEmpty()) return null
        val yearText = g[3]
        val year = when (yearText.length) {
            2 -> 2000 + yearText.toInt()
            4 -> yearText.toInt()
            else -> return null
        }
        val ldt = try {
            LocalDateTime.of(year, g[2].toInt(), g[1].toInt(), g[4].toInt(), g[5].toInt(), g[6].ifEmpty { "0" }.toInt())
        } catch (e: DateTimeException) {
            return null
        }
        val zone: ZoneId = when {
            WITA.containsMatchIn(context) -> ZoneOffset.ofHours(8)
            WIT.containsMatchIn(context) -> ZoneOffset.ofHours(9)
            WIB.containsMatchIn(context) -> ZoneOffset.ofHours(7)
            else -> defaultZone
        }
        return TimeUtil.iso(ldt.atZone(zone))
    }
}
