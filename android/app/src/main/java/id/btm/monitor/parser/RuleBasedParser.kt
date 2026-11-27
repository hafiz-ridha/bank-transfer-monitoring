package id.btm.monitor.parser

import java.time.ZoneId

/**
 * Parser berbasis aturan ([BankSpec]). Semua parser bank adalah turunan kelas ini;
 * perbedaannya hanya pada data di [ParserRules].
 */
open class RuleBasedParser(
    protected val spec: BankSpec,
    private val zone: ZoneId = ZoneId.systemDefault(),
) : NotificationParser {

    override val parserKey: String get() = spec.parserKey
    override val version: String get() = spec.version
    override val bankCode: String? get() = spec.bankCode

    private val templates: List<CompiledTemplate> = buildList {
        spec.incomingTemplates.forEach { add(CompiledTemplate(it)) }
        if (spec.includeGenericTemplates) {
            ParserRules.GENERIC_TEMPLATES.forEach { add(CompiledTemplate(it)) }
        }
    }

    /** Untuk diagnosis/tes. */
    val templateIds: List<String> get() = templates.map { it.id }

    override fun canHandle(packageName: String): Boolean = packageName in spec.packages

    override fun parse(title: String?, text: String?): ParseResult {
        val full = TextNormalizer.normalize(listOfNotNull(title, text).joinToString("\n"))
        if (full.isBlank()) return ParseResult.ignored(bankCode, NotificationTypes.EMPTY)
        val k = spec.keywords

        // 1. Template transfer masuk yang dikenali dengan yakin.
        for (t in templates) {
            val m = t.match(full) ?: continue
            val result = fromTemplate(t, m, full, k) ?: continue
            return result
        }

        // 2. OTP / kode verifikasi.
        if (k.otp.anyMatch(full)) return ParseResult.ignored(bankCode, NotificationTypes.OTP, redact = true)

        // 3-7. Klasifikasi cadangan berbasis kata kunci (tidak pernah menghasilkan transaksi masuk).
        val scan = k.neutral.fold(full) { acc, rx -> rx.replace(acc, " ") }
        val hasAmount = ANY_AMOUNT.containsMatchIn(full)
        val strongIn = k.incomingStrong.anyMatch(scan)
        val weakIn = k.incomingWeak.anyMatch(scan)
        val out = k.outgoing.anyMatch(scan)
        val nonTx = k.nonTransaction.anyMatch(scan)

        return when {
            nonTx && !strongIn -> ParseResult.ignored(bankCode, NotificationTypes.PROMO_INFO)
            strongIn && out -> ParseResult.error(
                bankCode,
                "Kata kunci transfer masuk dan keluar ditemukan bersamaan; format tidak dikenali parser $version",
            )
            strongIn && hasAmount -> ParseResult.error(bankCode, "Format transfer masuk tidak dikenali parser $version")
            strongIn -> ParseResult.error(
                bankCode,
                "Kata kunci transfer masuk ditemukan tetapi nominal tidak dikenali parser $version",
            )
            out && weakIn && hasAmount -> ParseResult.error(
                bankCode,
                "Notifikasi ambigu (masuk/keluar) dengan nominal; format tidak dikenali parser $version",
            )
            out && weakIn -> ParseResult.ignored(bankCode, NotificationTypes.INFO)
            out -> outgoing(full)
            hasAmount -> ParseResult.error(
                bankCode,
                "Notifikasi berisi nominal tetapi format tidak dikenali parser $version",
            )
            else -> ParseResult.ignored(bankCode, NotificationTypes.INFO)
        }
    }

    /** null = template ditolak (mis. nama pengirim tidak masuk akal), lanjut ke template berikutnya. */
    private fun fromTemplate(
        t: CompiledTemplate,
        m: Map<Field, String>,
        full: String,
        k: KeywordRules,
    ): ParseResult? {
        val senderRaw = m[Field.SENDER]
        val sender = SenderCleaner.clean(senderRaw)
        if (senderRaw != null && sender == null) return null

        val amountRaw = m[Field.AMOUNT] ?: m[Field.AMOUNT_PLAIN] ?: return null

        if (k.otp.anyMatch(full)) {
            return ParseResult.error(
                bankCode,
                "Cocok format transfer masuk (${t.id}) tetapi mengandung kata OTP/kode verifikasi; perlu verifikasi manual",
                redact = true,
            )
        }
        if (k.nonTransaction.anyMatch(full)) {
            return ParseResult.error(
                bankCode,
                "Cocok format transfer masuk (${t.id}) tetapi mengandung kata promo/bunga/refund; perlu verifikasi manual",
            )
        }

        val amount = when (val a = AmountParser.parse(amountRaw)) {
            is AmountParser.Result.Ok -> a.value
            is AmountParser.Result.Invalid -> return ParseResult.error(
                bankCode,
                "Nominal tidak valid ('$amountRaw'): ${a.reason}",
            )
        }

        val account = m[Field.ACCOUNT] ?: ACCOUNT_TO.find(full)?.groupValues?.getOrNull(1)
        val reference = (m[Field.REF] ?: REF_LABELED.find(full)?.groupValues?.getOrNull(1))
            ?.takeIf { ref -> ref.count { it.isDigit() } >= 4 && ref != account }
        val dateTimeRaw = m[Field.DATETIME] ?: DATETIME_ANY.find(full)?.groupValues?.getOrNull(1)
        val transactionTime = dateTimeRaw?.let { TimeParser.parse(it, full, zone) }

        return ParseResult(
            classification = Classification.INCOMING_TRANSFER,
            parseStatus = ParseStatus.PARSED,
            fields = ParsedFields(
                bankCode = bankCode,
                senderName = sender,
                amount = amount,
                transactionTime = transactionTime,
                referenceNumber = reference,
                recipientAccount = account,
                notificationType = t.notificationType,
            ),
            matchedTemplate = t.id,
        )
    }

    private fun outgoing(full: String): ParseResult {
        val raw = ANY_AMOUNT.find(full)?.groupValues?.getOrNull(1)
        val amount = raw?.let { (AmountParser.parse(it) as? AmountParser.Result.Ok)?.value }
        return ParseResult(
            classification = Classification.OUTGOING_TRANSFER,
            parseStatus = if (amount != null) ParseStatus.PARSED else ParseStatus.IGNORED,
            fields = ParsedFields(
                bankCode = bankCode,
                amount = amount,
                notificationType = NotificationTypes.OUTGOING_TRANSFER,
            ),
        )
    }

    private fun List<Regex>.anyMatch(s: String): Boolean = any { it.containsMatchIn(s) }

    private companion object {
        val ANY_AMOUNT = Regex(Placeholders.AMOUNT, RegexOption.IGNORE_CASE)

        /** Rekening tujuan hanya bila didahului "ke rekening" (bukan rekening pengirim). */
        val ACCOUNT_TO = Regex("""\bke\s+(?:rekening|rek\.?)(?:\s+anda)?\s*""" + Placeholders.ACCOUNT, RegexOption.IGNORE_CASE)

        /** Nomor referensi hanya bila berlabel eksplisit (salah ambil referensi bisa membuat server menganggap duplikat). */
        val REF_LABELED = Regex(
            """\b(?:no\.?\s*ref(?:erensi)?|ref(?:erensi)?|no\.?\s*transaksi|id\s*transaksi)\s*[.:]?\s*([A-Za-z0-9]{8,30})""",
            RegexOption.IGNORE_CASE,
        )

        val DATETIME_ANY = Regex("""(?<![0-9])""" + Placeholders.DATETIME, RegexOption.IGNORE_CASE)
    }
}
