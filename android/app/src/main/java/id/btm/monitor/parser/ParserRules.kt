package id.btm.monitor.parser

/**
 * ============================================================================================
 *  ATURAN PARSER (DATA-DRIVEN) — SATU-SATUNYA BERKAS YANG BIASANYA PERLU DIUBAH
 * ============================================================================================
 *
 * TODO(validasi-format-bank): SEMUA template di bawah adalah DUGAAN berdasarkan pola umum
 *  notifikasi bank Indonesia. Format notifikasi asli belum diketahui (PRD §19 keputusan #1).
 *  Sebelum produksi:
 *   1. Pasang aplikasi bank di HP target, aktifkan monitoring, lakukan transfer masuk/keluar uji.
 *   2. Buka menu "Histori Deteksi" (build debug) untuk melihat teks mentah yang tertangkap,
 *      atau lihat dashboard web > Perangkat > Parse errors.
 *   3. Tambahkan/ubah template agar cocok, naikkan `version` (mis. "bca-1.0.1"), lalu tambahkan
 *      contoh teks ASLI (data pribadi disamarkan) ke app/src/test/.../BankParsersTest.kt.
 *   4. Jalankan unit test: ./gradlew :app:testDebugUnitTest
 *  Sampai divalidasi, notifikasi yang tidak cocok template akan tercatat sebagai parse ERROR
 *  (tidak membuat transaksi palsu) — perilaku ini disengaja.
 *
 * Urutan keputusan (lihat RuleBasedParser):
 *   1. Template transfer masuk (bank, lalu generik) cocok -> PARSED/INCOMING_TRANSFER,
 *      kecuali nominal tidak valid atau ada kata OTP/promo -> ERROR/UNKNOWN.
 *   2. Kata OTP -> NON_TRANSACTION/IGNORED (teks disamarkan).
 *   3. Promo/info tanpa frasa masuk kuat -> NON_TRANSACTION/IGNORED.
 *   4. Frasa masuk kuat (dengan/tanpa nominal, atau bercampur kata keluar) -> ERROR/UNKNOWN.
 *   5. Kata keluar -> OUTGOING_TRANSFER (bukan transaksi masuk).
 *   6. Ada nominal tetapi format tidak dikenali -> ERROR/UNKNOWN.
 *   7. Selain itu -> NON_TRANSACTION/IGNORED.
 */
object ParserRules {

    val DEFAULT_KEYWORDS = KeywordRules(
        otpPatterns = listOf(
            """\botp\b""",
            """kode\s+(?:verifikasi|otentikasi|autentikasi|rahasia|aktivasi|keamanan|unik)""",
            """one[\s-]?time\s+password""",
        ),
        incomingStrongPatterns = listOf(
            """\b(?:transfer|trf|dana|uang|kiriman)\s+masuk\b""",
            """\b(?:menerima|terima)\s+(?:transfer|dana|uang|kiriman)""",
            """\b(?:transfer|kiriman)\s+dari\b""",
            """\bmasuk\s+ke\s+(?:rekening|rek)\b""",
            """\b(?:di)?kredit(?:kan)?\b""",
            """\bcr\b""",
            """\bincoming\s+transfer\b""",
            """\bcredit(?:ed)?\b""",
            """\btelah\s+diterima\b""",
            """\bditerima\s+dari\b""",
        ),
        incomingWeakPatterns = listOf(
            """\bmasuk\b""",
            """\bditerima\b""",
            """\bmenerima\b""",
            """\bterima\b""",
        ),
        outgoingPatterns = listOf(
            """\bkeluar\b""",
            """\bdebit\b""",
            """\bdidebit(?:kan)?\b""",
            """\bdb\b""",
            """\bberhasil\s+(?:transfer|mengirim|kirim)\b""",
            """\btransfer\s+(?:ke|kepada)\b""",
            """\b(?:transfer|pembayaran|transaksi)\s+berhasil\b""",
            """\bpembayaran\b""",
            """\bpembelian\b""",
            """\bbayar\b""",
            """\btarik\s+tunai\b""",
            """\bpenarikan\b""",
            """\btop\s?-?up\b""",
            """\bisi\s+ulang\b""",
            """\btelah\s+ditransfer\b""",
            """\bmengirim\b""",
            """\bkirim\s+uang\b""",
            """\bdari\s+(?:rekening|rek)\s+anda\b""",
        ),
        nonTransactionPatterns = listOf(
            """\bpromo\b""",
            """\bdiskon\b""",
            """\bcash\s?back\b""",
            """\bvoucher\b""",
            """\bhadiah\b""",
            """\bundian\b""",
            """\bpenawaran\b""",
            """\bgratis\b""",
            """\bpoin\b""",
            """\bbunga\b""",
            """\brefund\b""",
            """\bpengembalian\s+dana\b""",
            """\breversal\b""",
            """\bkoreksi\b""",
            """\btagihan\b""",
            """\bjatuh\s+tempo\b""",
            """\bpengingat\b""",
            """\breminder\b""",
            """\bcicilan\b""",
            """\bpinjaman\b""",
            """\bajukan\b""",
            """\bmenangkan\b""",
        ),
        neutralPatterns = listOf(
            """\bkartu\s+kredit\b""",
            """\bcredit\s+card\b""",
            """\bterima\s*kasih\b""",
        ),
    )

    /** Template generik yang ketat: frasa masuk eksplisit yang langsung diikuti nominal. */
    val GENERIC_TEMPLATES: List<TemplateDef> = listOf(
        TemplateDef(
            "generic-transfer-masuk",
            """\b(?:transfer|trf|dana|uang|kiriman)\s+masuk\s*[-:]?\s*(?:sebesar\s+|senilai\s+|sejumlah\s+)?{AMOUNT}(?:[^\n]*?\bdari\s+{SENDER})?""",
        ),
        TemplateDef(
            "generic-menerima",
            """\b(?:menerima|terima)\s+(?:transfer|kiriman|dana|uang)(?:\s+(?:masuk|dana|uang))?\s+(?:sebesar\s+|senilai\s+|sejumlah\s+)?{AMOUNT}(?:[^\n]*?\bdari\s+{SENDER})?""",
        ),
        TemplateDef(
            "generic-masuk-ke-rekening",
            """{AMOUNT}\s+(?:telah\s+|sudah\s+)?(?:masuk|diterima|dikreditkan)\s+(?:ke|di)\s+(?:rekening|rek\.?)(?:\s+anda)?(?:\s*{ACCOUNT})?(?:[^\n]*?\bdari\s+{SENDER})?""",
        ),
        TemplateDef(
            "generic-kiriman-dari",
            """\b(?:transfer|kiriman)\s+dari\s+{SENDER}\s+(?:sebesar\s+|senilai\s+|sejumlah\s+)?{AMOUNT}""",
        ),
        TemplateDef(
            "generic-rekening-dikredit",
            """\b(?:rekening|rek\.?)(?:\s+anda)?\s*{ACCOUNT}\s+(?:telah\s+)?dikredit(?:kan)?\s+(?:sebesar\s+|senilai\s+)?{AMOUNT}(?:[^\n]*?\bdari\s+{SENDER})?""",
        ),
    )

    val GENERIC = BankSpec(
        parserKey = "generic",
        bankCode = null,
        version = "generic-1.0.0",
        packages = emptySet(),
        incomingTemplates = GENERIC_TEMPLATES,
        includeGenericTemplates = false,
        keywords = DEFAULT_KEYWORDS,
    )

    // TODO(validasi-format-bank): BCA mobile / myBCA — cocokkan dengan notifikasi asli.
    val BCA = BankSpec(
        parserKey = "bca",
        bankCode = "BCA",
        version = "bca-1.0.0",
        packages = setOf("com.bca", "com.bca.mybca.omni.android"),
        incomingTemplates = listOf(
            TemplateDef(
                "bca-dana-masuk",
                """\bdana\s+masuk\s*[-:]?\s*{AMOUNT}\s+dari\s+{SENDER}(?:[^\n]*?\bke\s+(?:rekening|rek\.?)\s*{ACCOUNT})?""",
            ),
            // Gaya mutasi: "TRSF E-BANKING CR 2711/FTSCY/WS95051 150000.00 BUDI SANTOSO"
            TemplateDef(
                "bca-trsf-cr",
                """\bTRSF\s+E-BANKING\s+CR\s+(?:[A-Z0-9/]+\s+){0,2}{AMOUNT_PLAIN}\s+{SENDER}""",
            ),
        ),
        includeGenericTemplates = true,
        keywords = DEFAULT_KEYWORDS,
    )

    // TODO(validasi-format-bank): BRImo — cocokkan dengan notifikasi asli.
    val BRI = BankSpec(
        parserKey = "bri",
        bankCode = "BRI",
        version = "bri-1.0.0",
        packages = setOf("id.co.bri.brimo"),
        incomingTemplates = listOf(
            TemplateDef(
                "bri-rekening-dikredit",
                """\b(?:rekening|rek\.?)(?:\s+anda)?\s*{ACCOUNT}\s+(?:telah\s+)?dikredit(?:kan)?\s+(?:sebesar\s+|senilai\s+)?{AMOUNT}(?:[^\n]*?\bdari\s+{SENDER})?(?:[^\n]*?\b(?:pada|tgl\.?|tanggal)\s+{DATETIME})?""",
            ),
            TemplateDef(
                "bri-transfer-masuk-dari",
                """\btransfer\s+masuk\s+(?:sebesar\s+)?{AMOUNT}\s+dari\s+{SENDER}(?:\s+(?:pada|tgl\.?|tanggal)\s+{DATETIME})?""",
            ),
        ),
        includeGenericTemplates = true,
        keywords = DEFAULT_KEYWORDS,
    )

    // TODO(validasi-format-bank): Livin' by Mandiri — cocokkan dengan notifikasi asli.
    val MANDIRI = BankSpec(
        parserKey = "mandiri",
        bankCode = "MANDIRI",
        version = "mandiri-1.0.0",
        packages = setOf("id.bmri.livin"),
        incomingTemplates = listOf(
            TemplateDef(
                "mandiri-menerima-transfer",
                """\b(?:kamu|anda)\s+(?:telah\s+|baru\s+saja\s+)?menerima\s+(?:transfer|dana|uang)\s+(?:sebesar\s+)?{AMOUNT}\s+dari\s+{SENDER}""",
            ),
            TemplateDef(
                "mandiri-masuk-ke-rekening",
                """{AMOUNT}\s+(?:telah\s+)?masuk\s+ke\s+(?:rekening|rek\.?)\s*{ACCOUNT}(?:[^\n]*?\bdari\s+{SENDER})?""",
            ),
        ),
        includeGenericTemplates = true,
        keywords = DEFAULT_KEYWORDS,
    )

    // TODO(validasi-format-bank): BNI Mobile Banking & wondr by BNI — cocokkan dengan notifikasi asli.
    val BNI = BankSpec(
        parserKey = "bni",
        bankCode = "BNI",
        version = "bni-1.0.0",
        packages = setOf("src.com.bni", "id.bni.wondr"),
        incomingTemplates = listOf(
            TemplateDef(
                "bni-transfer-masuk",
                """\btransfer\s+masuk\s+{AMOUNT}\s+dari\s+{SENDER}(?:[^\n]*?\bke\s+(?:rekening|rek\.?)\s*{ACCOUNT})?""",
            ),
        ),
        includeGenericTemplates = true,
        keywords = DEFAULT_KEYWORDS,
    )

    // TODO(validasi-format-bank): BSI Mobile — cocokkan dengan notifikasi asli.
    val BSI = BankSpec(
        parserKey = "bsi",
        bankCode = "BSI",
        version = "bsi-1.0.0",
        packages = setOf("com.bsm.activity2"),
        incomingTemplates = listOf(
            TemplateDef(
                "bsi-dana-masuk",
                """\bdana\s+masuk\s+sebesar\s+{AMOUNT}\s+dari\s+{SENDER}(?:[^\n]*?\b(?:no\.?\s*ref(?:erensi)?|ref(?:erensi)?)\s*[.:]?\s*{REF})?""",
            ),
        ),
        includeGenericTemplates = true,
        keywords = DEFAULT_KEYWORDS,
    )

    val BANKS: List<BankSpec> = listOf(BCA, BRI, MANDIRI, BNI, BSI)
}
