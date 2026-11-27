package id.btm.monitor.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Status baris antrean (PRD §3.8). */
object OutboxStatus {
    const val PENDING = "pending"
    const val SENDING = "sending"
    /** Server mengonfirmasi accepted/duplicate. Baris dihapus otomatis setelah 24 jam. */
    const val SENT = "sent"
    /** Ditolak permanen (400 VALIDATION_ERROR / rejected tanpa retryable). Tidak di-retry otomatis. */
    const val FAILED = "failed"
}

object OutboxType {
    const val NOTIFICATION = "NOTIFICATION"
    const val DEVICE_EVENT = "DEVICE_EVENT"
}

/** Status sinkronisasi pada histori deteksi. */
object SyncStatus {
    const val PENDING = "pending"
    const val SENT = "sent"
    const val DUPLICATE = "duplicate"
    const val FAILED = "failed"
}

/**
 * Antrean keluar (outbox). Setiap event (notifikasi atau event perangkat) disimpan di sini
 * SEBELUM dikirim. event_id (UUID) unik dan dikirim ke server sebagai kunci idempotensi,
 * sehingga retry tidak menimbulkan transaksi ganda.
 */
@Entity(
    tableName = "outbox",
    indices = [
        Index(value = ["event_id"], unique = true),
        Index(value = ["status", "type", "next_attempt_at"]),
    ],
)
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "event_id") val eventId: String,
    @ColumnInfo(name = "type") val type: String,
    @ColumnInfo(name = "payload_json") val payloadJson: String,
    @ColumnInfo(name = "status") val status: String = OutboxStatus.PENDING,
    @ColumnInfo(name = "attempts") val attempts: Int = 0,
    @ColumnInfo(name = "next_attempt_at") val nextAttemptAt: Long = 0,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
    /** Ringkasan singkat untuk layar Antrean (tanpa isi notifikasi lengkap). */
    @ColumnInfo(name = "summary") val summary: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

/**
 * Histori deteksi (layar "Histori Deteksi"), disimpan 30 hari.
 * dedupe_key unik dipakai untuk mencegah notifikasi yang diposting ulang diproses dua kali.
 */
@Entity(
    tableName = "detections",
    indices = [
        Index(value = ["event_id"], unique = true),
        Index(value = ["dedupe_key"], unique = true),
        Index(value = ["received_at"]),
    ],
)
data class DetectionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "event_id") val eventId: String,
    @ColumnInfo(name = "dedupe_key") val dedupeKey: String,
    @ColumnInfo(name = "package_name") val packageName: String,
    @ColumnInfo(name = "notification_key") val notificationKey: String?,
    @ColumnInfo(name = "title_text") val titleText: String?,
    @ColumnInfo(name = "body_text") val bodyText: String?,
    @ColumnInfo(name = "posted_at") val postedAt: Long,
    @ColumnInfo(name = "received_at") val receivedAt: Long,
    @ColumnInfo(name = "captured_at") val capturedAt: Long,
    @ColumnInfo(name = "classification") val classification: String,
    @ColumnInfo(name = "parse_status") val parseStatus: String,
    @ColumnInfo(name = "parser_key") val parserKey: String?,
    @ColumnInfo(name = "parser_version") val parserVersion: String?,
    @ColumnInfo(name = "parse_error") val parseError: String?,
    @ColumnInfo(name = "bank_code") val bankCode: String?,
    @ColumnInfo(name = "account_alias") val accountAlias: String?,
    @ColumnInfo(name = "sender_name") val senderName: String?,
    @ColumnInfo(name = "amount") val amount: Long?,
    @ColumnInfo(name = "transaction_time") val transactionTime: String?,
    @ColumnInfo(name = "reference_number") val referenceNumber: String?,
    @ColumnInfo(name = "recipient_account") val recipientAccount: String?,
    @ColumnInfo(name = "notification_type") val notificationType: String?,
    @ColumnInfo(name = "sync_status") val syncStatus: String = SyncStatus.PENDING,
    @ColumnInfo(name = "transaction_code") val transactionCode: String? = null,
    @ColumnInfo(name = "synced_at") val syncedAt: Long? = null,
)

/** Hasil agregasi per package untuk layar Sumber Bank. */
data class PackageStat(
    val packageName: String,
    val lastAt: Long,
    val total: Int,
    val errors: Int,
)
