package id.btm.monitor.parser

import java.time.ZoneId

/** BCA mobile (com.bca) & myBCA (com.bca.mybca.omni.android). */
class BcaParser(zone: ZoneId = ZoneId.systemDefault()) : RuleBasedParser(ParserRules.BCA, zone)

/** BRImo (id.co.bri.brimo). */
class BriParser(zone: ZoneId = ZoneId.systemDefault()) : RuleBasedParser(ParserRules.BRI, zone)

/** Livin' by Mandiri (id.bmri.livin). */
class MandiriParser(zone: ZoneId = ZoneId.systemDefault()) : RuleBasedParser(ParserRules.MANDIRI, zone)

/** BNI Mobile Banking (src.com.bni) & wondr by BNI (id.bni.wondr). */
class BniParser(zone: ZoneId = ZoneId.systemDefault()) : RuleBasedParser(ParserRules.BNI, zone)

/** BSI Mobile (com.bsm.activity2). */
class BsiParser(zone: ZoneId = ZoneId.systemDefault()) : RuleBasedParser(ParserRules.BSI, zone)

/**
 * Parser generik konservatif untuk sumber bank lain yang didaftarkan di dashboard.
 * Hanya mengenali frasa transfer masuk eksplisit yang langsung diikuti nominal.
 */
class GenericParser(zone: ZoneId = ZoneId.systemDefault()) : RuleBasedParser(ParserRules.GENERIC, zone) {
    override fun canHandle(packageName: String): Boolean = true
}
