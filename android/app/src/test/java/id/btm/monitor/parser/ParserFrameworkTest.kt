package id.btm.monitor.parser

import id.btm.monitor.core.Hashing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class ParserFrameworkTest {
    private val zone: ZoneId = ZoneId.of("Asia/Jakarta")

    @Test
    fun allConfiguredTemplatesCompile() {
        // Konstruksi parser memvalidasi setiap template (jumlah grup == jumlah placeholder).
        val registry = ParserRegistry.createDefault(zone)
        registry.all.forEach { p ->
            val ids = (p as RuleBasedParser).templateIds
            assertTrue("${p.parserKey} tidak punya template", ids.isNotEmpty())
        }
    }

    @Test
    fun templateWithExtraCapturingGroupIsRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            CompiledTemplate(TemplateDef("bad", """(transfer) masuk {AMOUNT}"""))
        }
    }

    @Test
    fun templateWithoutAmountIsRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            CompiledTemplate(TemplateDef("no-amount", """dari {SENDER}"""))
        }
    }

    @Test
    fun versionsFollowConvention() {
        val registry = ParserRegistry.createDefault(zone)
        registry.all.forEach { p ->
            assertTrue(p.version, p.version.startsWith(p.parserKey + "-"))
        }
    }

    @Test
    fun registrySelectsByPackageThenConfiguredKeyThenGeneric() {
        val r = ParserRegistry.createDefault(zone)
        assertEquals("bca", r.select("com.bca", null).parserKey)
        assertEquals("bca", r.select("com.bca.mybca.omni.android", null).parserKey)
        assertEquals("bri", r.select("id.co.bri.brimo", null).parserKey)
        assertEquals("mandiri", r.select("id.bmri.livin", null).parserKey)
        assertEquals("bni", r.select("id.bni.wondr", null).parserKey)
        assertEquals("bni", r.select("src.com.bni", null).parserKey)
        assertEquals("bsi", r.select("com.bsm.activity2", null).parserKey)
        assertEquals("generic", r.select("com.bank.lain", null).parserKey)
        // parser_key dari konfigurasi server diutamakan bila dikenal
        assertEquals("bri", r.select("com.bank.lain", "BRI").parserKey)
        assertEquals("generic", r.select("com.bca", "generic").parserKey)
        // parser_key tidak dikenal -> berdasarkan package
        assertEquals("bca", r.select("com.bca", "tidak-ada").parserKey)
    }

    @Test
    fun timeParserHandlesZonesAndRejectsInvalid() {
        assertEquals(
            "2026-11-27T10:00:00.000+08:00",
            TimeParser.parse("27/11/2026 10:00", "pukul 10:00 WITA", zone),
        )
        assertEquals(
            "2026-11-27T10:00:00.000+09:00",
            TimeParser.parse("27-11-26 10.00", "10.00 WIT", zone),
        )
        assertEquals(
            "2026-11-27T10:00:05.000+07:00",
            TimeParser.parse("27/11/2026 10:00:05", "", zone),
        )
        assertNull("tanggal tidak valid", TimeParser.parse("31/02/2026 10:00", "", zone))
        assertNull("tanpa jam", TimeParser.parse("27/11/2026", "", zone))
    }

    @Test
    fun dedupeKeyIsStableSha256() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            Hashing.sha256Hex("abc"),
        )
        val a = Hashing.dedupeKey("com.bca", "Dana Masuk", "Rp 1", 1000L)
        assertEquals(a, Hashing.dedupeKey("com.bca", "Dana Masuk", "Rp 1", 1000L))
        assertNotEquals(a, Hashing.dedupeKey("com.bca", "Dana Masuk", "Rp 1", 1001L))
        assertEquals(64, a.length)
    }
}
