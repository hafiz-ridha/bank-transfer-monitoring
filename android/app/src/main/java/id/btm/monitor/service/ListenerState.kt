package id.btm.monitor.service

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Status koneksi listener di memori proses. Bernilai false setelah proses dibuat ulang sampai
 * sistem memanggil onListenerConnected — sehingga tidak pernah melaporkan "terhubung" palsu.
 * Waktu terakhir terhubung/terputus disimpan permanen di AppPrefs.
 */
object ListenerState {
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    val isConnected: Boolean get() = _connected.value

    fun set(value: Boolean) {
        _connected.value = value
    }
}
