package id.btm.monitor.domain

import androidx.room.withTransaction
import id.btm.monitor.core.AppLog
import id.btm.monitor.data.db.AppDatabase
import id.btm.monitor.data.db.OutboxEntity
import id.btm.monitor.data.db.OutboxType
import id.btm.monitor.data.db.SyncStatus
import id.btm.monitor.data.net.ApiClient
import id.btm.monitor.data.net.ApiResult
import id.btm.monitor.data.net.BatchResponse
import id.btm.monitor.data.net.EventResultDto
import id.btm.monitor.data.prefs.AppPrefs
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min
import kotlin.random.Random

/**
 * Mengirim antrean lokal ke server dengan semantik:
 *  - accepted / duplicate  -> 'sent' (dihapus otomatis setelah 24 jam)
 *  - rejected + retryable  -> retry dengan backoff eksponensial
 *  - rejected lainnya      -> 'failed' (tidak di-retry otomatis; bisa dicoba ulang manual)
 *  - HTTP 400 VALIDATION_ERROR -> 'failed'. Untuk batch, satu event invalid membuat SELURUH batch
 *    ditolak, sehingga batch dipecah dan dikirim satu per satu agar hanya event yang salah gagal.
 *  - jaringan / 5xx / 429  -> retry dengan backoff
 *  - 401 INVALID_DEVICE_TOKEN -> berhenti, antrean tetap disimpan, layar pairing ulang
 *  - 401 CLOCK_SKEW        -> berhenti, tampilkan peringatan jam, coba lagi nanti
 * Semua pengiriman diserialkan oleh [mutex]; baris 'sending' saat mulai pasti sisa crash.
 */
class SyncEngine(
    private val db: AppDatabase,
    private val api: ApiClient,
    private val prefs: AppPrefs,
    private val events: DeviceEventRecorder,
    private val scheduleRetry: (delayMs: Long) -> Unit,
) {
    private val mutex = Mutex()
    private val dirty = AtomicBoolean(false)
    private val outbox get() = db.outboxDao()
    private val detections get() = db.detectionDao()

    data class Outcome(val sent: Int, val failed: Int, val stopReason: String?) {
        fun describe(): String = when (stopReason) {
            STOP_NOT_PAIRED -> "Perangkat belum dipasangkan / token dicabut"
            STOP_INVALID_TOKEN -> "Token perangkat dicabut. Pasangkan ulang perangkat."
            STOP_CLOCK_SKEW -> "Jam perangkat tidak sinkron dengan server"
            STOP_NETWORK -> "Jaringan tidak tersedia. Terkirim $sent, akan dicoba lagi."
            STOP_SERVER -> "Server menolak sementara. Terkirim $sent, akan dicoba lagi."
            else -> if (sent == 0 && failed == 0) "Tidak ada antrean untuk dikirim" else "Terkirim $sent, gagal $failed"
        }
    }

    private class Batch(var sent: Int = 0, var failed: Int = 0, var stop: String? = null)

    /** Tandai ada data baru agar sinkronisasi yang sedang berjalan mengulang satu putaran lagi. */
    fun markDirty() = dirty.set(true)

    suspend fun syncAll(): Outcome = mutex.withLock {
        if (!prefs.canSync) return@withLock Outcome(0, 0, STOP_NOT_PAIRED)
        val reset = outbox.resetStaleSending(now())
        if (reset > 0) AppLog.d("reset $reset baris 'sending' yang tertinggal")

        val total = Batch()
        var rounds = 0
        do {
            dirty.set(false)
            // Notifikasi (transaksi) diprioritaskan, lalu event perangkat.
            drain(OutboxType.NOTIFICATION, NOTIFICATION_BATCH, total) { rows -> sendNotifications(rows) }
            if (total.stop == null) {
                drain(OutboxType.DEVICE_EVENT, EVENT_BATCH, total) { rows -> sendDeviceEvents(rows) }
            }
            rounds++
        } while (total.stop == null && dirty.get() && rounds < MAX_ROUNDS)

        afterSync(total)
        Outcome(total.sent, total.failed, total.stop)
    }

    private suspend fun drain(type: String, limit: Int, total: Batch, send: suspend (List<OutboxEntity>) -> Batch) {
        var loops = 0
        while (total.stop == null && loops < MAX_ROUNDS) {
            loops++
            val due = outbox.due(type, now(), limit)
            if (due.isEmpty()) return
            val chunk = limitBySize(due)
            val r = send(chunk)
            total.sent += r.sent
            total.failed += r.failed
            total.stop = r.stop
            if (r.sent == 0 && r.failed == 0 && r.stop == null) return // tidak ada kemajuan (semua dijadwalkan ulang)
        }
    }

    /** Batas ukuran body (server: 1 MB). */
    private fun limitBySize(rows: List<OutboxEntity>): List<OutboxEntity> {
        val out = mutableListOf<OutboxEntity>()
        var size = 0
        for (row in rows) {
            if (out.isNotEmpty() && size + row.payloadJson.length > MAX_BODY_CHARS) break
            out += row
            size += row.payloadJson.length + 1
        }
        return out
    }

    private fun bodyOf(rows: List<OutboxEntity>): String =
        rows.joinToString(separator = ",", prefix = "{\"events\":[", postfix = "]}") { it.payloadJson }

    // ------------------------------------------------------------------ notifications

    private suspend fun sendNotifications(rows: List<OutboxEntity>): Batch {
        outbox.markSending(rows.map { it.id }, now())
        return when (val r = api.notificationsBatchRaw(bodyOf(rows))) {
            is ApiResult.Success -> applyResults(rows, r.body, isNotification = true)
            is ApiResult.HttpError -> handleHttpError(rows, r) { single -> sendNotifications(single) }
            is ApiResult.NetworkError -> retryAll(rows, "Jaringan: ${r.message}", STOP_NETWORK)
        }
    }

    // ------------------------------------------------------------------ device events

    private suspend fun sendDeviceEvents(rows: List<OutboxEntity>): Batch {
        outbox.markSending(rows.map { it.id }, now())
        return when (val r = api.deviceEventsRaw(bodyOf(rows))) {
            is ApiResult.Success -> applyResults(rows, r.body, isNotification = false)
            is ApiResult.HttpError -> handleHttpError(rows, r) { single -> sendDeviceEvents(single) }
            is ApiResult.NetworkError -> retryAll(rows, "Jaringan: ${r.message}", STOP_NETWORK)
        }
    }

    // ------------------------------------------------------------------ result handling

    private suspend fun applyResults(rows: List<OutboxEntity>, body: BatchResponse, isNotification: Boolean): Batch {
        val byId: Map<String, EventResultDto> = body.results.filter { it.eventId != null }.associateBy { it.eventId!! }
        val batch = Batch()
        val t = now()
        db.withTransaction {
            for (row in rows) {
                val res = byId[row.eventId]
                when {
                    res == null -> {
                        outbox.markRetry(row.id, t + backoffMs(row.attempts), "Server tidak mengembalikan hasil untuk event ini", t)
                    }
                    res.status == "accepted" || res.status == "duplicate" -> {
                        outbox.markSent(row.id, t)
                        if (isNotification) {
                            val status = if (res.status == "accepted") SyncStatus.SENT else SyncStatus.DUPLICATE
                            detections.updateSync(row.eventId, status, res.transactionCode, t)
                        }
                        batch.sent++
                    }
                    res.status == "rejected" && res.retryable == true -> {
                        outbox.markRetry(row.id, t + backoffMs(row.attempts), res.error ?: "Ditolak sementara oleh server", t)
                    }
                    else -> {
                        outbox.markFailed(row.id, res.error ?: "Ditolak server (${res.status})", t)
                        if (isNotification) detections.setSyncStatus(row.eventId, SyncStatus.FAILED)
                        batch.failed++
                    }
                }
            }
        }
        return batch
    }

    private suspend fun handleHttpError(
        rows: List<OutboxEntity>,
        error: ApiResult.HttpError,
        sendSingle: suspend (List<OutboxEntity>) -> Batch,
    ): Batch {
        val t = now()
        val ids = rows.map { it.id }
        return when {
            error.isInvalidToken -> {
                outbox.release(ids, 0, "Token perangkat tidak valid / dicabut", t)
                Batch(stop = STOP_INVALID_TOKEN)
            }
            error.isClockSkew -> {
                outbox.release(ids, t + CLOCK_SKEW_RETRY_MS, "Jam perangkat tidak sinkron (CLOCK_SKEW)", t)
                Batch(stop = STOP_CLOCK_SKEW)
            }
            (error.isValidation || error.isPayloadTooLarge) && rows.size > 1 -> {
                // Pecah batch agar event yang valid tetap terkirim.
                outbox.release(ids, 0, null, t)
                val total = Batch()
                for (row in rows) {
                    val r = sendSingle(listOf(row))
                    total.sent += r.sent
                    total.failed += r.failed
                    if (r.stop != null) {
                        total.stop = r.stop
                        break
                    }
                }
                total
            }
            error.isValidation || error.isPayloadTooLarge -> {
                val row = rows.first()
                outbox.markFailed(row.id, "Ditolak server: ${error.message}".take(1000), t)
                if (row.type == OutboxType.NOTIFICATION) detections.setSyncStatus(row.eventId, SyncStatus.FAILED)
                Batch(failed = 1)
            }
            else -> retryAll(rows, error.describe(), STOP_SERVER)
        }
    }

    private suspend fun retryAll(rows: List<OutboxEntity>, message: String, stop: String): Batch {
        val t = now()
        db.withTransaction {
            for (row in rows) outbox.markRetry(row.id, t + backoffMs(row.attempts), message.take(1000), t)
        }
        return Batch(stop = stop)
    }

    // ------------------------------------------------------------------ after sync

    private suspend fun afterSync(total: Batch) {
        val t = now()
        if (total.sent > 0) {
            prefs.lastSuccessfulSyncAt = t
            if (prefs.syncFailing) {
                prefs.syncFailing = false
                events.record(DeviceEventType.SYNC_RECOVERED, "Sinkronisasi pulih", syncNow = false)
            }
        }
        when (total.stop) {
            STOP_NETWORK, STOP_SERVER -> {
                val msg = "Sinkronisasi gagal (${if (total.stop == STOP_NETWORK) "jaringan" else "server"}); antrean disimpan dan akan dikirim ulang"
                prefs.setLastError(msg)
                if (!prefs.syncFailing) {
                    prefs.syncFailing = true
                    // Dicatat ke antrean; terkirim saat koneksi pulih (riwayat sinkronisasi gagal).
                    events.record(DeviceEventType.SYNC_FAILED, msg, syncNow = false)
                }
            }
        }
        if (total.stop == STOP_INVALID_TOKEN) return
        // Jadwalkan percobaan berikutnya sesuai baris pending paling awal.
        val next = outbox.nextAttemptAt()
        if (next != null) scheduleRetry((next - t).coerceAtLeast(MIN_RETRY_DELAY_MS))
    }

    // ------------------------------------------------------------------ manual retry (layar Antrean)

    suspend fun retryAllFailed(): Int = db.withTransaction {
        detections.resetFailedToPending()
        outbox.retryAllFailed(now())
    }

    suspend fun retryOne(id: Long): Boolean = db.withTransaction {
        val eventId = outbox.eventIdOf(id)
        val n = outbox.retryFailed(id, now())
        if (n > 0 && eventId != null) detections.setSyncStatus(eventId, SyncStatus.PENDING)
        n > 0
    }

    private fun now() = System.currentTimeMillis()

    companion object {
        const val STOP_NOT_PAIRED = "not_paired"
        const val STOP_INVALID_TOKEN = "invalid_token"
        const val STOP_CLOCK_SKEW = "clock_skew"
        const val STOP_NETWORK = "network"
        const val STOP_SERVER = "server"

        private const val NOTIFICATION_BATCH = 100 // batas server
        private const val EVENT_BATCH = 200 // batas server
        private const val MAX_BODY_CHARS = 700_000 // server bodyLimit 1 MB
        private const val MAX_ROUNDS = 50
        private const val CLOCK_SKEW_RETRY_MS = 5 * 60_000L
        private const val MIN_RETRY_DELAY_MS = 10_000L
        private const val BACKOFF_BASE_MS = 30_000L
        private const val BACKOFF_MAX_MS = 30 * 60_000L

        /** 30 dtk, 1 mnt, 2 mnt, ... maks 30 mnt, + jitter 0-20%. */
        fun backoffMs(attempts: Int): Long {
            val exp = BACKOFF_BASE_MS * (1L shl min(attempts.coerceAtLeast(0), 6))
            val capped = min(exp, BACKOFF_MAX_MS)
            return capped + (capped * 0.2 * Random.nextDouble()).toLong()
        }
    }
}
