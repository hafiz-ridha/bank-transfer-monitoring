package id.btm.monitor.parser

/**
 * Mesin template berbasis data.
 *
 * Template ditulis sebagai regex biasa (case-insensitive) dengan placeholder:
 *   {AMOUNT}        nominal dengan mata uang: "Rp 150.000", "Rp150.000,00", "IDR 150,000.00"
 *   {AMOUNT_PLAIN}  nominal tanpa mata uang tetapi berpemisah/desimal: "150.000,00", "150000.00"
 *   {SENDER}        nama pengirim (berhenti sebelum kata seperti "ke", "pada", "ref", "rp", ...)
 *   {REF}           nomor referensi alfanumerik 6-30 karakter
 *   {ACCOUNT}       nomor rekening, boleh disamarkan: "1234567890", "xxx1234", "****1234", "0412XXXXXX"
 *   {DATETIME}      "27/11/2026 10:00[:00]" (opsional "pukul"/"jam")
 *
 * ATURAN PENULISAN: gunakan (?:...) untuk grup biasa. Grup penangkap (...) HANYA boleh berasal
 * dari placeholder; konstruktor [CompiledTemplate] memvalidasi hal ini dan gagal bila dilanggar
 * (unit test akan menangkapnya).
 */
enum class Field { AMOUNT, AMOUNT_PLAIN, SENDER, REF, ACCOUNT, DATETIME }

data class TemplateDef(
    val id: String,
    val pattern: String,
    val notificationType: String = NotificationTypes.INCOMING_TRANSFER,
)

object Placeholders {
    const val AMOUNT = """((?:Rp\.?|IDR)\s*[0-9](?:[0-9.,]*[0-9])?)"""

    const val AMOUNT_PLAIN = """([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})"""

    /**
     * Nama pengirim: huruf/angka/spasi/titik/apostrof/strip, maks 60 karakter. Setiap karakter
     * berikutnya hanya diambil bila TIDAK diikuti kata penghenti, sehingga nama tidak "menelan"
     * bagian kalimat lain (mis. "... ke rekening ...").
     */
    const val SENDER =
        """([A-Za-z](?:(?!\s+(?:ke|kepada|pada|tgl|tanggal|ref|no|berita|ket|keterangan|sebesar|senilai|sejumlah|di|melalui|via|rp|idr|dengan|untuk|telah|saldo|berhasil|sukses)\b)[A-Za-z0-9 .'-]){0,59})"""

    const val REF = """([A-Za-z0-9]{6,30})"""

    const val ACCOUNT = """([xX*.]*[0-9][0-9-]{1,22}[0-9][xX*]*|[xX*.]+[0-9]{2,6})"""

    const val DATETIME =
        """([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}(?:[ ,]+(?:pukul\s+|jam\s+)?[0-9]{1,2}[.:][0-9]{2}(?:[.:][0-9]{2})?)?)"""

    fun regexFor(field: Field): String = when (field) {
        Field.AMOUNT -> AMOUNT
        Field.AMOUNT_PLAIN -> AMOUNT_PLAIN
        Field.SENDER -> SENDER
        Field.REF -> REF
        Field.ACCOUNT -> ACCOUNT
        Field.DATETIME -> DATETIME
    }
}

class CompiledTemplate(def: TemplateDef) {
    val id: String = def.id
    val notificationType: String = def.notificationType
    private val fields: List<Field>
    private val regex: Regex

    init {
        val fieldList = mutableListOf<Field>()
        val sb = StringBuilder()
        var last = 0
        for (m in PLACEHOLDER.findAll(def.pattern)) {
            sb.append(def.pattern, last, m.range.first)
            val field = Field.valueOf(m.groupValues[1])
            fieldList.add(field)
            sb.append(Placeholders.regexFor(field))
            last = m.range.last + 1
        }
        sb.append(def.pattern, last, def.pattern.length)
        regex = Regex(sb.toString(), RegexOption.IGNORE_CASE)
        fields = fieldList

        val groups = regex.toPattern().matcher("").groupCount()
        require(groups == fields.size) {
            "Template '$id': jumlah grup penangkap ($groups) != jumlah placeholder (${fields.size}). Gunakan (?:...)."
        }
        require(Field.AMOUNT in fields || Field.AMOUNT_PLAIN in fields) {
            "Template '$id' wajib memuat {AMOUNT} atau {AMOUNT_PLAIN}"
        }
    }

    /** Nilai per field (hanya yang tidak kosong), atau null bila template tidak cocok. */
    fun match(text: String): Map<Field, String>? {
        val m = regex.find(text) ?: return null
        val out = LinkedHashMap<Field, String>()
        fields.forEachIndexed { index, field ->
            val value = m.groupValues.getOrNull(index + 1)?.trim().orEmpty()
            if (value.isNotEmpty() && !out.containsKey(field)) out[field] = value
        }
        return out
    }

    private companion object {
        val PLACEHOLDER = Regex("""\{(AMOUNT_PLAIN|AMOUNT|SENDER|REF|ACCOUNT|DATETIME)\}""")
    }
}

/** Kumpulan kata kunci (regex, case-insensitive) untuk klasifikasi cadangan bila tidak ada template cocok. */
class KeywordRules(
    otpPatterns: List<String>,
    incomingStrongPatterns: List<String>,
    incomingWeakPatterns: List<String>,
    outgoingPatterns: List<String>,
    nonTransactionPatterns: List<String>,
    neutralPatterns: List<String>,
) {
    /** OTP / kode verifikasi: selalu NON_TRANSACTION, teks disamarkan. */
    val otp: List<Regex> = compile(otpPatterns)
    /** Frasa yang kuat menandakan uang masuk. */
    val incomingStrong: List<Regex> = compile(incomingStrongPatterns)
    /** Kata yang bisa berarti uang masuk tetapi juga "login/masuk aplikasi". */
    val incomingWeak: List<Regex> = compile(incomingWeakPatterns)
    /** Uang keluar / pembayaran: OUTGOING_TRANSFER (bukan transaksi masuk). */
    val outgoing: List<Regex> = compile(outgoingPatterns)
    /** Promo / info / bunga / refund: tidak boleh menjadi transaksi. */
    val nonTransaction: List<Regex> = compile(nonTransactionPatterns)
    /** Frasa yang dihapus sebelum pencarian kata kunci (mis. "kartu kredit" agar tidak dibaca "kredit"). */
    val neutral: List<Regex> = compile(neutralPatterns)

    private fun compile(list: List<String>): List<Regex> = list.map { Regex(it, RegexOption.IGNORE_CASE) }
}

data class BankSpec(
    val parserKey: String,
    val bankCode: String?,
    val version: String,
    val packages: Set<String>,
    /** Template transfer masuk khusus bank (dicoba lebih dulu). */
    val incomingTemplates: List<TemplateDef>,
    /** Juga mencoba template generik yang ketat setelah template bank. */
    val includeGenericTemplates: Boolean,
    val keywords: KeywordRules,
)

object SenderCleaner {
    /** Kata yang menandakan hasil tangkapan bukan nama orang/perusahaan -> template ditolak. */
    private val GARBAGE = Regex("""\b(?:rekening|rek|anda|kamu|akun|saldo|nominal|sebesar)\b""", RegexOption.IGNORE_CASE)
    private val WS = Regex("""\s+""")

    fun clean(raw: String?): String? {
        if (raw == null) return null
        val s = WS.replace(raw, " ").trim().trimEnd('.', ',', '-', ' ').trim()
        if (s.length < 2) return null
        if (GARBAGE.containsMatchIn(s)) return null
        return s
    }
}

object TextNormalizer {
    private val SPACES = Regex("[\t    ]+")

    /** Menyeragamkan spasi (termasuk NBSP), membuang baris kosong, menjaga pemisah baris. */
    fun normalize(input: String): String =
        input.replace("\r\n", "\n").replace('\r', '\n')
            .split('\n')
            .map { SPACES.replace(it, " ").trim() }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
}
