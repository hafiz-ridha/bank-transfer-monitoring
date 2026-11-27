package id.btm.monitor.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface OutboxDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(item: OutboxEntity): Long

    /** Baris pending yang sudah jatuh tempo, urut dari yang terlama. */
    @Query(
        "SELECT * FROM outbox WHERE type = :type AND status = 'pending' AND next_attempt_at <= :now " +
            "ORDER BY created_at ASC, id ASC LIMIT :limit",
    )
    suspend fun due(type: String, now: Long, limit: Int): List<OutboxEntity>

    @Query("UPDATE outbox SET status = 'sending', updated_at = :now WHERE id IN (:ids)")
    suspend fun markSending(ids: List<Long>, now: Long): Int

    @Query("UPDATE outbox SET status = 'sent', last_error = NULL, updated_at = :now WHERE id = :id")
    suspend fun markSent(id: Long, now: Long): Int

    /** Gagal sementara: kembali ke pending dengan jadwal backoff. */
    @Query(
        "UPDATE outbox SET status = 'pending', attempts = attempts + 1, next_attempt_at = :nextAt, " +
            "last_error = :error, updated_at = :now WHERE id = :id",
    )
    suspend fun markRetry(id: Long, nextAt: Long, error: String?, now: Long): Int

    /** Kembalikan ke pending tanpa menambah attempts (mis. token dicabut / jam tidak sinkron). */
    @Query(
        "UPDATE outbox SET status = 'pending', next_attempt_at = :nextAt, last_error = :error, " +
            "updated_at = :now WHERE id IN (:ids)",
    )
    suspend fun release(ids: List<Long>, nextAt: Long, error: String?, now: Long): Int

    /** Ditolak permanen: tidak di-retry otomatis, pengguna dapat mencoba ulang manual. */
    @Query("UPDATE outbox SET status = 'failed', attempts = attempts + 1, last_error = :error, updated_at = :now WHERE id = :id")
    suspend fun markFailed(id: Long, error: String?, now: Long): Int

    @Query("UPDATE outbox SET status = 'pending', next_attempt_at = 0, updated_at = :now WHERE status = 'failed'")
    suspend fun retryAllFailed(now: Long): Int

    @Query("UPDATE outbox SET status = 'pending', next_attempt_at = 0, updated_at = :now WHERE id = :id AND status = 'failed'")
    suspend fun retryFailed(id: Long, now: Long): Int

    @Query("SELECT event_id FROM outbox WHERE id = :id")
    suspend fun eventIdOf(id: Long): String?

    /** Baris 'sending' yang tertinggal (proses mati di tengah pengiriman) dikembalikan ke pending. */
    @Query("UPDATE outbox SET status = 'pending', updated_at = :now WHERE status = 'sending'")
    suspend fun resetStaleSending(now: Long): Int

    @Query("DELETE FROM outbox WHERE status = 'sent' AND updated_at < :before")
    suspend fun purgeSent(before: Long): Int

    @Query("SELECT COUNT(*) FROM outbox WHERE type = :type AND status IN ('pending', 'sending')")
    suspend fun countUnsent(type: String): Int

    @Query("SELECT COUNT(*) FROM outbox WHERE type = :type AND status = 'failed'")
    suspend fun countFailed(type: String): Int

    @Query("SELECT COUNT(*) FROM outbox WHERE status = 'pending' AND next_attempt_at <= :now")
    suspend fun countDue(now: Long): Int

    @Query("SELECT MIN(next_attempt_at) FROM outbox WHERE status = 'pending'")
    suspend fun nextAttemptAt(): Long?

    @Query("SELECT COUNT(*) FROM outbox WHERE type = :type AND status IN ('pending', 'sending')")
    fun observeUnsentCount(type: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox WHERE type = :type AND status = 'failed'")
    fun observeFailedCount(type: String): Flow<Int>

    @Query("SELECT * FROM outbox WHERE status != 'sent' ORDER BY created_at DESC LIMIT :limit")
    fun observeUnsent(limit: Int): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM outbox WHERE status = 'sent' ORDER BY updated_at DESC LIMIT :limit")
    fun observeRecentlySent(limit: Int): Flow<List<OutboxEntity>>
}
