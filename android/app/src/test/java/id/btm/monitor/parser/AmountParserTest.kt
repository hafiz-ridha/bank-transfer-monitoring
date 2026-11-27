package id.btm.monitor.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AmountParserTest {

    private fun ok(raw: String): Long? = (AmountParser.parse(raw) as? AmountParser.Result.Ok)?.value

    private fun invalid(raw: String): Boolean = AmountParser.parse(raw) is AmountParser.Result.Invalid

    @Test
    fun parsesCommonIndonesianFormats() {
        assertEquals(150_000L, ok("Rp 150.000"))
        assertEquals(150_000L, ok("Rp150.000,00"))
        assertEquals(150_000L, ok("IDR 150,000.00"))
        assertEquals(1_500_000L, ok("Rp 1.500.000"))
        assertEquals(150_000L, ok("Rp 150000"))
        assertEquals(25_000L, ok("Rp. 25.000,-"))
        assertEquals(1_500L, ok("IDR 1,500"))
        assertEquals(1_000_000L, ok("Rp 1.000.000,00"))
        assertEquals(150_000L, ok("rp 150.000"))
    }

    @Test
    fun parsesPlainAmountsWithoutCurrency() {
        assertEquals(150_000L, ok("150000.00"))
        assertEquals(150_000L, ok("150.000,00"))
        assertEquals(150_000L, ok("150,000.00"))
    }

    @Test
    fun rejectsAmbiguousOrInvalidAmounts() {
        assertTrue("sen bukan nol", invalid("Rp 150.000,50"))
        assertTrue("grup ribuan salah", invalid("Rp 1.5000"))
        assertTrue("desimal 1 digit", invalid("Rp 1.5"))
        assertTrue("nol", invalid("Rp 0"))
        assertTrue("pemisah desimal ambigu", invalid("Rp 1.500.00"))
        assertTrue("pemisah campur", invalid("Rp 150,000.000"))
        assertTrue("bukan angka", invalid("abc"))
        assertTrue("terlalu besar", invalid("Rp 10.000.000.000.000"))
        assertTrue("kosong", invalid("Rp"))
    }
}
