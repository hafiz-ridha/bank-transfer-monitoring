package id.btm.monitor.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

/**
 * Contoh teks di bawah adalah SAMPEL BUATAN (belum divalidasi terhadap notifikasi asli).
 * TODO(validasi-format-bank): tambahkan contoh teks ASLI dari HP target (data pribadi disamarkan)
 * untuk setiap bank, termasuk kasus negatif (OTP, promo, transfer keluar, login).
 */
class BankParsersTest {
    private val zone: ZoneId = ZoneId.of("Asia/Jakarta")
    private val bca = BcaParser(zone)
    private val bri = BriParser(zone)
    private val mandiri = MandiriParser(zone)
    private val bni = BniParser(zone)
    private val bsi = BsiParser(zone)

    // ------------------------------------------------------------------ helper

    private fun assertIncoming(r: ParseResult, amount: Long, sender: String?) {
        assertEquals("classification", Classification.INCOMING_TRANSFER, r.classification)
        assertEquals("parse_status", ParseStatus.PARSED, r.parseStatus)
        assertEquals("amount", amount, r.fields?.amount)
        assertEquals("sender", sender, r.fields?.senderName)
        assertNull("parse_error", r.parseError)
        assertTrue(r.isIncomingTransaction)
    }

    private fun assertParseError(r: ParseResult) {
        assertEquals("parse_status", ParseStatus.ERROR, r.parseStatus)
        assertEquals("classification", Classification.UNKNOWN, r.classification)
        assertNotNull("parse_error wajib terisi", r.parseError)
        assertFalse("tidak boleh menjadi transaksi", r.isIncomingTransaction)
    }

    private fun assertIgnored(r: ParseResult) {
        assertEquals(Classification.NON_TRANSACTION, r.classification)
        assertEquals(ParseStatus.IGNORED, r.parseStatus)
        assertFalse(r.isIncomingTransaction)
    }

    private fun assertOutgoing(r: ParseResult, amount: Long?) {
        assertEquals(Classification.OUTGOING_TRANSFER, r.classification)
        assertEquals(amount, r.fields?.amount)
        assertFalse(r.isIncomingTransaction)
    }

    // ------------------------------------------------------------------ BCA

    @Test
    fun bca_danaMasuk() {
        val r = bca.parse("Dana Masuk", "Dana masuk Rp 150.000,00 dari BUDI SANTOSO ke rekening 1234567890")
        assertIncoming(r, 150_000, "BUDI SANTOSO")
        assertEquals("1234567890", r.fields?.recipientAccount)
        assertEquals("BCA", r.fields?.bankCode)
        assertEquals("bca-dana-masuk", r.matchedTemplate)
    }

    @Test
    fun bca_idrFormat() {
        assertIncoming(bca.parse("myBCA", "Dana masuk IDR 1,500,000.00 dari PT MAJU JAYA"), 1_500_000, "PT MAJU JAYA")
    }

    @Test
    fun bca_trsfCreditMutationStyle() {
        val r = bca.parse(null, "TRSF E-BANKING CR 2711/FTSCY/WS95051 150000.00 BUDI SANTOSO")
        assertIncoming(r, 150_000, "BUDI SANTOSO")
        assertEquals("bca-trsf-cr", r.matchedTemplate)
    }

    @Test
    fun bca_otpIgnoredAndRedacted() {
        val r = bca.parse("BCA", "Kode OTP Anda 123456. Jangan berikan kode ini kepada siapapun.")
        assertIgnored(r)
        assertTrue(r.redactRawText)
        assertEquals(NotificationTypes.OTP, r.fields?.notificationType)
    }

    @Test
    fun bca_outgoingTransfer() {
        assertOutgoing(bca.parse("BCA", "Transfer ke BUDI SANTOSO Rp 150.000 berhasil"), 150_000)
    }

    @Test
    fun bca_unknownFormatWithAmountIsParseError() {
        assertParseError(bca.parse("BCA", "Ada mutasi Rp 150.000 pada rekening Anda"))
    }

    @Test
    fun bca_changedIncomingFormatIsParseError() {
        // PRD §15 "Format notifikasi berubah": tercatat sebagai error, tidak membuat transaksi palsu.
        assertParseError(bca.parse("BCA", "Transfer masuk ke rekening Anda sebesar Rp 150.000 dari BUDI"))
    }

    @Test
    fun bca_promoIgnored() {
        assertIgnored(bca.parse("Promo", "Promo spesial! Cashback Rp 50.000 untuk transaksi QRIS"))
    }

    // ------------------------------------------------------------------ BRI

    @Test
    fun bri_rekeningDikreditWithTime() {
        val r = bri.parse(
            "BRImo",
            "Rekening 0412XXXXXX telah dikredit Rp150.000,00 dari BUDI SANTOSO pada 27/11/2026 10:00:00 WIB",
        )
        assertIncoming(r, 150_000, "BUDI SANTOSO")
        assertEquals("0412XXXXXX", r.fields?.recipientAccount)
        assertEquals("2026-11-27T10:00:00.000+07:00", r.fields?.transactionTime)
    }

    @Test
    fun bri_transferMasukWithDate() {
        val r = bri.parse("BRImo", "Transfer masuk Rp 250.000 dari SITI AMINAH tgl 27/11/2026 09:15 WIB")
        assertIncoming(r, 250_000, "SITI AMINAH")
        assertEquals("2026-11-27T09:15:00.000+07:00", r.fields?.transactionTime)
    }

    @Test
    fun bri_debitIsOutgoing() {
        assertOutgoing(bri.parse("BRImo", "Rekening 0412XXXXXX telah didebit Rp 50.000 untuk pembayaran PLN"), 50_000)
    }

    @Test
    fun bri_unknownWithAmountIsParseError() {
        assertParseError(bri.parse("BRImo", "Ada transaksi Rp 75.000 di rekening Anda"))
    }

    // ------------------------------------------------------------------ Mandiri

    @Test
    fun mandiri_menerimaTransfer() {
        assertIncoming(
            mandiri.parse("Livin' by Mandiri", "Kamu menerima transfer Rp 150.000 dari BUDI SANTOSO"),
            150_000,
            "BUDI SANTOSO",
        )
    }

    @Test
    fun mandiri_masukKeRekening() {
        val r = mandiri.parse("Dana Masuk", "Rp 1.250.000 telah masuk ke rekening ****1234 dari ANI LESTARI")
        assertIncoming(r, 1_250_000, "ANI LESTARI")
        assertEquals("****1234", r.fields?.recipientAccount)
        assertEquals("mandiri-masuk-ke-rekening", r.matchedTemplate)
    }

    @Test
    fun mandiri_verificationCodeIgnored() {
        val r = mandiri.parse("Livin'", "Kode verifikasi 123456 untuk transfer Rp 500.000 ke ANI. Jangan berikan kode ini")
        assertIgnored(r)
        assertTrue(r.redactRawText)
    }

    @Test
    fun mandiri_outgoing() {
        assertOutgoing(mandiri.parse("Livin'", "Transfer berhasil! Rp 200.000 ke ANI LESTARI"), 200_000)
    }

    @Test
    fun mandiri_amountWithCentsIsParseError() {
        assertParseError(mandiri.parse("Livin'", "Kamu menerima transfer Rp 150.000,50 dari BUDI"))
    }

    // ------------------------------------------------------------------ BNI

    @Test
    fun bni_handlesBothPackages() {
        assertTrue(bni.canHandle("src.com.bni"))
        assertTrue(bni.canHandle("id.bni.wondr"))
        assertFalse(bni.canHandle("com.bca"))
    }

    @Test
    fun bni_transferMasuk() {
        val r = bni.parse("BNI Mobile Banking", "Transfer masuk Rp150.000 dari BUDI SANTOSO ke rekening xxx1234")
        assertIncoming(r, 150_000, "BUDI SANTOSO")
        assertEquals("xxx1234", r.fields?.recipientAccount)
    }

    @Test
    fun bni_wondrUangMasuk() {
        assertIncoming(bni.parse("wondr", "Uang masuk Rp 300.000 dari CITRA"), 300_000, "CITRA")
    }

    @Test
    fun bni_incomingPhraseWithPromoWordIsParseError() {
        assertParseError(bni.parse("BNI", "Transfer masuk Rp 100.000 dan dapatkan cashback!"))
    }

    // ------------------------------------------------------------------ BSI

    @Test
    fun bsi_danaMasukWithReference() {
        val r = bsi.parse("BSI Mobile", "Dana masuk sebesar Rp 150.000,00 dari BUDI SANTOSO. Ref: FT26112700123")
        assertIncoming(r, 150_000, "BUDI SANTOSO")
        assertEquals("FT26112700123", r.fields?.referenceNumber)
    }

    @Test
    fun bsi_loginNoticeIgnored() {
        assertIgnored(bsi.parse("BSI Mobile", "Login berhasil pada perangkat baru"))
    }

    @Test
    fun bsi_changedFormatIsParseError() {
        assertParseError(bsi.parse("BSI Mobile", "Pemberitahuan: saldo bertambah Rp 150.000"))
    }
}
