package id.btm.monitor.parser

import java.time.ZoneId

/**
 * Memilih parser untuk sebuah notifikasi:
 *  1. `parser_key` dari konfigurasi sumber bank di server (bila dikenal aplikasi),
 *  2. parser bank yang menangani package tersebut,
 *  3. parser generik.
 */
class ParserRegistry(
    private val bankParsers: List<NotificationParser>,
    private val generic: NotificationParser,
) {
    val all: List<NotificationParser> get() = bankParsers + generic

    fun select(packageName: String, configuredParserKey: String?): NotificationParser {
        val key = configuredParserKey?.trim().orEmpty()
        if (key.isNotEmpty()) {
            if (key.equals(generic.parserKey, ignoreCase = true)) return generic
            bankParsers.firstOrNull { it.parserKey.equals(key, ignoreCase = true) }?.let { return it }
        }
        return bankParsers.firstOrNull { it.canHandle(packageName) } ?: generic
    }

    companion object {
        fun createDefault(zone: ZoneId = ZoneId.systemDefault()): ParserRegistry = ParserRegistry(
            bankParsers = listOf(
                BcaParser(zone),
                BriParser(zone),
                MandiriParser(zone),
                BniParser(zone),
                BsiParser(zone),
            ),
            generic = GenericParser(zone),
        )
    }
}
