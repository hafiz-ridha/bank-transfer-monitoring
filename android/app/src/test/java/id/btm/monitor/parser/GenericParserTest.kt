package id.btm.monitor.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class GenericParserTest {
    private val parser = GenericParser(ZoneId.of("Asia/Jakarta"))

    private fun assertIncoming(r: ParseResult, amount: Long, sender: String?) {
        assertEquals(Classification.INCOMING_TRANSFER, r.classification)
        assertEquals(ParseStatus.PARSED, r.parseStatus)
        assertEquals(amount, r.fields?.amount)
        assertEquals(sender, r.fields?.senderName)
        assertNull(r.fields?.bankCode)
        assertTrue(r.isIncomingTransaction)
    }

    private fun assertParseError(r: ParseResult) {
        assertEquals(ParseStatus.ERROR, r.parseStatus)
        assertEquals(Classification.UNKNOWN, r.classification)
        assertNotNull(r.parseError)
        assertFalse(r.isIncomingTransaction)
    }

    private fun assertIgnored(r: ParseResult) {
        assertEquals(Classification.NON_TRANSACTION, r.classification)
        assertEquals(ParseStatus.IGNORED, r.parseStatus)
        assertFalse(r.isIncomingTransaction)
    }

    @Test
    fun handlesAnyPackage() {
        assertTrue(parser.canHandle("com.bank.lain"))
        assertEquals("generic-1.0.0", parser.version)
    }

    @Test
    fun menerimaTransfer() {
        assertIncoming(
            parser.parse("Bank", "Anda menerima transfer sebesar Rp150.000,00 dari BUDI SANTOSO."),
            150_000,
            "BUDI SANTOSO",
        )
    }

    @Test
    fun masukKeRekening() {
        assertIncoming(parser.parse("Bank", "Rp 150.000 telah masuk ke rekening Anda dari BUDI"), 150_000, "BUDI")
    }

    @Test
    fun kirimanDari() {
        assertIncoming(parser.parse("Bank", "Kiriman dari BUDI SANTOSO sebesar Rp 75.000"), 75_000, "BUDI SANTOSO")
    }

    @Test
    fun transferMasukWithoutSender() {
        assertIncoming(parser.parse("Bank", "Transfer masuk: Rp 50.000"), 50_000, null)
    }

    @Test
    fun outgoingSentenceIsNeverReadAsIncoming() {
        // "transfer dari ... rekening Anda ke BUDI" adalah transfer KELUAR; nama pengirim tidak boleh
        // "menelan" frasa "rekening Anda ke BUDI". Hasil yang aman: parse error (perlu verifikasi).
        assertParseError(parser.parse("Bank", "Transfer dari rekening Anda ke BUDI sebesar Rp 150.000 berhasil"))
    }

    @Test
    fun incomingKeywordWithoutAmountIsParseError() {
        assertParseError(parser.parse("Bank", "Dana masuk ke rekening Anda. Cek aplikasi untuk detail"))
    }

    @Test
    fun loginNoticeIgnored() {
        assertIgnored(parser.parse("Bank", "Anda berhasil masuk ke aplikasi"))
    }

    @Test
    fun paymentWithThankYouIsOutgoing() {
        val r = parser.parse("Bank", "Pembayaran Rp 50.000 berhasil. Terima kasih")
        assertEquals(Classification.OUTGOING_TRANSFER, r.classification)
        assertEquals(50_000L, r.fields?.amount)
        assertFalse(r.isIncomingTransaction)
    }

    @Test
    fun balanceOnlyIsParseErrorNotTransaction() {
        assertParseError(parser.parse("Bank", "Saldo Anda Rp 2.500.000"))
    }

    @Test
    fun creditCardBillIgnored() {
        assertIgnored(parser.parse("Bank", "Tagihan kartu kredit Rp 1.200.000 jatuh tempo 05/12"))
    }

    @Test
    fun emptyIgnored() {
        val r = parser.parse(null, "   ")
        assertIgnored(r)
        assertEquals(NotificationTypes.EMPTY, r.fields?.notificationType)
    }

    @Test
    fun refundCreditIsParseErrorNotTransaction() {
        assertParseError(parser.parse("Bank", "Rp 150.000 telah masuk ke rekening Anda (refund pembelian)"))
    }
}
