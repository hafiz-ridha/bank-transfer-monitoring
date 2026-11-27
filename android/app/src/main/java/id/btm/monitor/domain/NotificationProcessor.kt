package id.btm.monitor.domain

import androidx.room.withTransaction
import id.btm.monitor.core.AppLog
import id.btm.monitor.core.Hashing
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.ConfigRepository
import id.btm.monitor.data.db.AppDatabase
import id.btm.monitor.data.db.DetectionEntity
import id.btm.monitor.data.db.OutboxEntity
import id.btm.monitor.data.db.OutboxType
import id.btm.monitor.data.db.SyncStatus
import id.btm.monitor.data.net.NotificationEventDto
import id.btm.monitor.data.net.ParsedDto
import id.btm.monitor.data.prefs.AppPrefs
import id.btm.monitor.parser.ParseResult
import id.btm.monitor.parser.ParseStatus
import id.btm.monitor.parser.ParserRegistry
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID

/** Data mentah yang diambil dari StatusBarNotification (hanya untuk package bank yang dipilih). */
data class RawNotification(
    val packageName: String,
    val notificationKey: String?,
    val title: String?,
    val text: String?,
    val bigText: String?,
    /** Notification.when (dipakai untuk dedupe_key). */
    val whenMs: Long,
    /** StatusBarNotification.postTime: kapan notifikasi diterima perangkat. */
    val postTime: Long,
)

/**
 * Alur: filter sumber aktif -> dedupe -> parse -> simpan ke Room (histori + antrean) DALAM SATU
 * TRANSAKSI -> baru memicu sinkronisasi. Event tidak pernah hilang walau jaringan/proses mati
 * setelah tersimpan.
 */
class NotificationProcessor(
    private val db: AppDatabase,
    private val prefs: AppPrefs,
    private val config: ConfigRepository,
    private val registry: ParserRegistry,
    private val json: Json,
    private val events: DeviceEventRecorder,
    private val requestSync: () -> Unit,
) {
    private val mutex = Mutex()

    /** true bila notifikasi baru disimpan ke antrean. */
    suspend fun process(raw: RawNotification): Boolean = mutex.withLock {
        val source = config.activeSourceFor(raw.packageName) ?: return@withLock false
        val dedupeKey = Hashing.dedupeKey(raw.packageName, raw.title, raw.text, raw.whenMs)
        if (db.detectionDao().existsDedupe(dedupeKey)) return@withLock false

        val parser = registry.select(raw.packageName, source.parserKey)
        val body = combineBody(raw.text, raw.bigText)
        val result: ParseResult = try {
            parser.parse(raw.title, body)
        } catch (e: Exception) {
            ParseResult.error(parser.bankCode, "Parser gagal (${e.javaClass.simpleName})")
        }

        val now = System.currentTimeMillis()
        val eventId = UUID.randomUUID().toString()
        val postedAt = if (raw.whenMs > 0) raw.whenMs else raw.postTime
        val f = result.fields
        val bankCode = source.bankCode ?: f?.bankCode
        val transactionTime = sanitizeTransactionTime(f?.transactionTime, raw.postTime)
        val sendRaw = prefs.sendRawText && !result.redactRawText

        val parsed = f?.let {
            ParsedDto(
                bankCode = bankCode?.take(30),
                senderName = it.senderName?.take(300),
                amount = it.amount,
                transactionTime = transactionTime,
                referenceNumber = it.referenceNumber?.take(120),
                recipientAccount = it.recipientAccount?.take(60),
                notificationType = it.notificationType?.take(60),
            )
        }
        val payload = NotificationEventDto(
            eventId = eventId,
            packageName = raw.packageName,
            notificationKey = raw.notificationKey?.take(500),
            dedupeKey = dedupeKey,
            title = if (sendRaw) raw.title?.take(2000) else null,
            text = if (sendRaw) raw.text?.take(8000) else null,
            bigText = if (sendRaw) raw.bigText?.take(8000) else null,
            postedAt = TimeUtil.iso(postedAt),
            receivedAt = TimeUtil.iso(raw.postTime),
            classification = result.classification.name,
            parseStatus = result.parseStatus.name,
            parserKey = parser.parserKey,
            parserVersion = parser.version,
            parseError = result.parseError?.take(2000),
            parsed = parsed,
        )

        val detection = DetectionEntity(
            eventId = eventId,
            dedupeKey = dedupeKey,
            packageName = raw.packageName,
            notificationKey = raw.notificationKey,
            titleText = if (result.redactRawText) REDACTED else raw.title?.take(500),
            bodyText = if (result.redactRawText) REDACTED else body?.take(2000),
            postedAt = postedAt,
            receivedAt = raw.postTime,
            capturedAt = now,
            classification = result.classification.name,
            parseStatus = result.parseStatus.name,
            parserKey = parser.parserKey,
            parserVersion = parser.version,
            parseError = result.parseError,
            bankCode = bankCode,
            accountAlias = source.accountAlias,
            senderName = f?.senderName,
            amount = f?.amount,
            transactionTime = transactionTime,
            referenceNumber = f?.referenceNumber,
            recipientAccount = f?.recipientAccount,
            notificationType = f?.notificationType,
            syncStatus = SyncStatus.PENDING,
        )
        val outboxRow = OutboxEntity(
            eventId = eventId,
            type = OutboxType.NOTIFICATION,
            payloadJson = json.encodeToString(NotificationEventDto.serializer(), payload),
            summary = summaryOf(bankCode ?: raw.packageName, result),
            createdAt = now,
            updatedAt = now,
        )

        val inserted = db.withTransaction {
            val id = db.detectionDao().insert(detection)
            if (id == -1L) {
                false
            } else {
                db.outboxDao().insert(outboxRow)
                true
            }
        }
        if (!inserted) return@withLock false

        if (raw.postTime > prefs.lastNotificationAt) prefs.lastNotificationAt = raw.postTime
        AppLog.d("notifikasi ${raw.packageName}: ${result.classification}/${result.parseStatus}")

        if (result.parseStatus == ParseStatus.ERROR) {
            // Metadata saja (tanpa teks notifikasi) untuk riwayat error parser di dashboard.
            events.record(
                type = DeviceEventType.PARSER_ERROR,
                message = "Format notifikasi ${raw.packageName} tidak dikenali (${parser.version})",
                data = mapOf(
                    "package_name" to raw.packageName,
                    "parser_version" to parser.version,
                    "event_id" to eventId,
                    "parse_error" to result.parseError?.take(300),
                ),
                syncNow = false,
            )
        }
        requestSync()
        true
    }

    /**
     * Teks yang di-parse: bigText biasanya berisi pesan lengkap; text bisa berupa versi terpotong.
     */
    private fun combineBody(text: String?, bigText: String?): String? = when {
        bigText.isNullOrBlank() -> text
        text.isNullOrBlank() -> bigText
        bigText.contains(text.trim()) -> bigText
        else -> "$text\n$bigText"
    }

    /**
     * Waktu transaksi dari teks hanya dipakai bila masuk akal terhadap waktu notifikasi diterima
     * (tidak lebih dari 10 menit setelahnya dan tidak lebih dari 24 jam sebelumnya). Matching di server
     * mengutamakan transaction_time, jadi nilai yang salah lebih berbahaya daripada null.
     */
    private fun sanitizeTransactionTime(iso: String?, postTime: Long): String? {
        val t = TimeUtil.parseIsoToEpoch(iso) ?: return null
        val tooLate = t - postTime > 10 * 60_000L
        val tooEarly = postTime - t > 24 * 3_600_000L
        return if (tooLate || tooEarly) null else iso
    }

    private fun summaryOf(label: String, r: ParseResult): String {
        val amount = r.fields?.amount?.let { " Rp " + NumberFormat.getIntegerInstance(LOCALE_ID).format(it) }.orEmpty()
        return "$label • ${r.classification.name}/${r.parseStatus.name}$amount"
    }

    companion object {
        const val REDACTED = "[disamarkan: kode OTP/verifikasi]"
        private val LOCALE_ID: Locale = Locale.forLanguageTag("id-ID")
    }
}
