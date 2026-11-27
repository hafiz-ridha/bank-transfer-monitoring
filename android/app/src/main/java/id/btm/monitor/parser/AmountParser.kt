package id.btm.monitor.parser

/**
 * Mengubah teks nominal menjadi rupiah (Long) secara ketat.
 *
 * Didukung: "Rp 150.000", "Rp150.000,00", "Rp. 25.000,-", "IDR 150,000.00", "IDR 1,500", "150000".
 * Ditolak (Invalid): pemisah ribuan tidak konsisten ("1.5000"), sen bukan nol ("Rp 150.000,50"),
 * desimal 1 digit ("1.5"), nol / negatif, dan nilai >= 10^13 (batas server).
 */
object AmountParser {
    sealed class Result {
        data class Ok(val value: Long) : Result()
        data class Invalid(val reason: String) : Result()
    }

    /** Batas eksklusif sesuai validasi server (amount < 1e13). */
    const val MAX_EXCLUSIVE = 10_000_000_000_000L

    private val PREFIX = Regex("""^\s*(?:rp\.?|idr)\s*""", RegexOption.IGNORE_CASE)
    private val SHAPE = Regex("""^[0-9][0-9.,]*$""")

    fun parse(raw: String): Result {
        val s = raw.replace(PREFIX, "").trim().trimEnd('-').trimEnd(',', '.').trim()
        if (s.isEmpty() || !SHAPE.matches(s)) return Result.Invalid("format nominal tidak dikenal")

        val lastSep = s.indexOfLast { it == '.' || it == ',' }
        if (lastSep < 0) return toValue(s)

        val fracLen = s.length - lastSep - 1
        return when (fracLen) {
            3 -> {
                // Semua pemisah adalah pemisah ribuan dan harus konsisten.
                if (!validGrouping(s)) Result.Invalid("pemisah ribuan tidak konsisten") else toValue(digits(s))
            }
            2 -> {
                val decimalSep = s[lastSep]
                val intPart = s.substring(0, lastSep)
                val frac = s.substring(lastSep + 1)
                when {
                    intPart.isEmpty() -> Result.Invalid("bagian bulat kosong")
                    intPart.contains(decimalSep) -> Result.Invalid("pemisah desimal ambigu")
                    !validGrouping(intPart) -> Result.Invalid("pemisah ribuan tidak konsisten")
                    frac != "00" -> Result.Invalid("nominal mengandung sen ($frac)")
                    else -> toValue(digits(intPart))
                }
            }
            else -> Result.Invalid("jumlah digit setelah pemisah tidak dikenal")
        }
    }

    /** Pemisah ribuan harus satu jenis dan berkelompok 3 digit (atau tanpa pemisah sama sekali). */
    private fun validGrouping(s: String): Boolean {
        val seps = s.filter { it == '.' || it == ',' }.toSet()
        if (seps.isEmpty()) return true
        if (seps.size > 1) return false
        val sep = Regex.escape(seps.first().toString())
        return Regex("""^[0-9]{1,3}(?:$sep[0-9]{3})+$""").matches(s)
    }

    private fun digits(s: String): String = s.filter { it.isDigit() }

    private fun toValue(digitsOnly: String): Result {
        val trimmed = digitsOnly.trimStart('0')
        if (trimmed.isEmpty()) return Result.Invalid("nominal nol")
        if (trimmed.length > 13) return Result.Invalid("nominal terlalu besar")
        val v = trimmed.toLongOrNull() ?: return Result.Invalid("nominal tidak valid")
        if (v <= 0L) return Result.Invalid("nominal nol")
        if (v >= MAX_EXCLUSIVE) return Result.Invalid("nominal terlalu besar")
        return Result.Ok(v)
    }
}
