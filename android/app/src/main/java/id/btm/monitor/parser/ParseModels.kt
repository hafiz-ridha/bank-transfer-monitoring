package id.btm.monitor.parser

/** Klasifikasi notifikasi (nilai enum = string yang dikirim ke API). */
enum class Classification { INCOMING_TRANSFER, OUTGOING_TRANSFER, NON_TRANSACTION, UNKNOWN }

/** Status parsing (nilai enum = string yang dikirim ke API). */
enum class ParseStatus { PARSED, ERROR, IGNORED }

/** Nilai `parsed.notification_type`. */
object NotificationTypes {
    const val INCOMING_TRANSFER = "INCOMING_TRANSFER"
    const val OUTGOING_TRANSFER = "OUTGOING_TRANSFER"
    const val OTP = "OTP"
    const val PROMO_INFO = "PROMO_INFO"
    const val INFO = "INFO"
    const val EMPTY = "EMPTY"
    const val UNKNOWN = "UNKNOWN"
}

data class ParsedFields(
    val bankCode: String? = null,
    val senderName: String? = null,
    /** Nominal dalam rupiah (integer, tanpa sen). */
    val amount: Long? = null,
    /** ISO-8601 dengan offset, atau null bila tidak tersedia. */
    val transactionTime: String? = null,
    val referenceNumber: String? = null,
    val recipientAccount: String? = null,
    val notificationType: String? = null,
)

data class ParseResult(
    val classification: Classification,
    val parseStatus: ParseStatus,
    val fields: ParsedFields? = null,
    val parseError: String? = null,
    /** true untuk OTP: teks mentah tidak disimpan/dikirim (PRD §10 meminimalkan data sensitif). */
    val redactRawText: Boolean = false,
    /** ID template yang cocok (untuk diagnosis). */
    val matchedTemplate: String? = null,
) {
    /** Hanya kombinasi ini yang boleh menjadi transaksi di server. */
    val isIncomingTransaction: Boolean
        get() = classification == Classification.INCOMING_TRANSFER &&
            parseStatus == ParseStatus.PARSED &&
            (fields?.amount ?: 0L) > 0L

    companion object {
        fun ignored(bankCode: String?, type: String, redact: Boolean = false) = ParseResult(
            classification = Classification.NON_TRANSACTION,
            parseStatus = ParseStatus.IGNORED,
            fields = ParsedFields(bankCode = bankCode, notificationType = type),
            redactRawText = redact,
        )

        /** Tampak seperti transaksi tetapi format tidak dikenali dengan yakin: JANGAN dianggap valid. */
        fun error(bankCode: String?, message: String, redact: Boolean = false) = ParseResult(
            classification = Classification.UNKNOWN,
            parseStatus = ParseStatus.ERROR,
            fields = ParsedFields(bankCode = bankCode, notificationType = NotificationTypes.UNKNOWN),
            parseError = message,
            redactRawText = redact,
        )
    }
}

/**
 * Kontrak parser notifikasi bank.
 * Implementasi wajib konservatif: lebih baik ERROR daripada menebak transaksi (PRD §3.7, §15).
 */
interface NotificationParser {
    /** Kunci parser, sama dengan `parser_key` sumber bank di server (mis. "bca"). */
    val parserKey: String

    /** Versi parser, mis. "bca-1.0.0" (dikirim sebagai parser_version). */
    val version: String

    /** Kode bank bawaan parser (null untuk parser generik). */
    val bankCode: String?

    fun canHandle(packageName: String): Boolean

    fun parse(title: String?, text: String?): ParseResult
}
