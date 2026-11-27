package id.btm.monitor.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Database lokal (Room SQLite). Versi 1.
 * Saat skema berubah: naikkan [version] dan tambahkan Migration — JANGAN memakai
 * fallbackToDestructiveMigration karena antrean yang belum terkirim akan hilang.
 */
@Database(
    entities = [OutboxEntity::class, DetectionEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun outboxDao(): OutboxDao
    abstract fun detectionDao(): DetectionDao

    companion object {
        fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "btm.db").build()
    }
}
