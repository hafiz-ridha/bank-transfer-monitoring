package id.btm.monitor.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface DetectionDao {

    /** -1 bila dedupe_key / event_id sudah ada (notifikasi diposting ulang). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(item: DetectionEntity): Long

    @Query("SELECT EXISTS(SELECT 1 FROM detections WHERE dedupe_key = :key)")
    suspend fun existsDedupe(key: String): Boolean

    @Query(
        "UPDATE detections SET sync_status = :status, transaction_code = :transactionCode, synced_at = :syncedAt " +
            "WHERE event_id = :eventId",
    )
    suspend fun updateSync(eventId: String, status: String, transactionCode: String?, syncedAt: Long?): Int

    @Query("UPDATE detections SET sync_status = :status WHERE event_id = :eventId")
    suspend fun setSyncStatus(eventId: String, status: String): Int

    /** Dipanggil sebelum outbox.retryAllFailed agar status histori ikut kembali ke pending. */
    @Query(
        "UPDATE detections SET sync_status = 'pending' WHERE event_id IN " +
            "(SELECT event_id FROM outbox WHERE status = 'failed')",
    )
    suspend fun resetFailedToPending(): Int

    @Query("SELECT * FROM detections ORDER BY received_at DESC, id DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<DetectionEntity>>

    @Query(
        "SELECT COUNT(*) FROM detections WHERE classification = 'INCOMING_TRANSFER' " +
            "AND parse_status = 'PARSED' AND received_at >= :since",
    )
    fun observeIncomingCountSince(since: Long): Flow<Int>

    @Query(
        "SELECT package_name AS packageName, MAX(received_at) AS lastAt, COUNT(*) AS total, " +
            "SUM(CASE WHEN parse_status = 'ERROR' THEN 1 ELSE 0 END) AS errors " +
            "FROM detections GROUP BY package_name",
    )
    fun observePackageStats(): Flow<List<PackageStat>>

    @Query("DELETE FROM detections WHERE received_at < :before")
    suspend fun purgeOlderThan(before: Long): Int
}
