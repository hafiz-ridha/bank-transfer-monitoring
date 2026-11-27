package id.btm.monitor.core

import android.util.Log
import id.btm.monitor.BuildConfig

/**
 * Logging hanya aktif di build debug. JANGAN pernah memasukkan isi notifikasi (judul/teks),
 * token, atau kode pairing ke log — hanya metadata (package, klasifikasi, jumlah).
 */
object AppLog {
    private const val TAG = "BTM"

    fun d(message: String) {
        if (BuildConfig.DEBUG) Log.d(TAG, message)
    }

    fun w(message: String, error: Throwable? = null) {
        if (BuildConfig.DEBUG) Log.w(TAG, message, error)
    }
}
