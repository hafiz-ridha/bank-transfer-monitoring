package id.btm.monitor.service

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import id.btm.monitor.core.AppLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Memantau jaringan default (ConnectivityManager). Perubahan di-debounce 2 detik lalu
 * diteruskan ke [onChange] dengan status terbaru (true = ada jaringan berkemampuan INTERNET).
 */
class NetworkMonitor(
    context: Context,
    private val scope: CoroutineScope,
    private val onChange: suspend (connected: Boolean) -> Unit,
) {
    private val cm: ConnectivityManager? = context.getSystemService(ConnectivityManager::class.java)
    private var debounceJob: Job? = null
    private var started = false

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = schedule()
        override fun onLost(network: Network) = schedule()
        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) = schedule()
    }

    @Synchronized
    fun start() {
        if (started) return
        try {
            cm?.registerDefaultNetworkCallback(callback)
            started = true
        } catch (e: Exception) {
            AppLog.w("registerDefaultNetworkCallback gagal", e)
        }
    }

    fun isConnectedNow(): Boolean {
        val manager = cm ?: return false
        return try {
            val network = manager.activeNetwork ?: return false
            val caps = manager.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (e: Exception) {
            false
        }
    }

    @Synchronized
    private fun schedule() {
        debounceJob?.cancel()
        debounceJob = scope.launch {
            delay(DEBOUNCE_MS)
            val connected = isConnectedNow()
            // Jalankan di job terpisah agar pembatalan debounce berikutnya tidak memotong proses (heartbeat/sync).
            scope.launch { onChange(connected) }
        }
    }

    private companion object {
        const val DEBOUNCE_MS = 2_000L
    }
}
