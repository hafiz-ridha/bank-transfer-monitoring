package id.btm.monitor.data

import id.btm.monitor.data.net.ApiClient
import id.btm.monitor.data.net.ApiResult
import id.btm.monitor.data.net.BankSourceDto
import id.btm.monitor.data.net.DeviceConfig
import id.btm.monitor.data.prefs.AppPrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

/**
 * Konfigurasi dari server (GET /devices/config), di-cache lokal agar listener tetap tahu
 * package bank mana yang aktif walau sedang offline atau baru reboot.
 */
class ConfigRepository(
    private val prefs: AppPrefs,
    private val api: ApiClient,
    private val json: Json,
) {
    private val mutex = Mutex()
    private val _config = MutableStateFlow(loadCached())
    val config: StateFlow<DeviceConfig?> = _config.asStateFlow()

    private fun loadCached(): DeviceConfig? {
        val raw = prefs.configJson ?: return null
        return try {
            json.decodeFromString(DeviceConfig.serializer(), raw)
        } catch (e: Exception) {
            null
        }
    }

    fun save(cfg: DeviceConfig) {
        prefs.configJson = json.encodeToString(DeviceConfig.serializer(), cfg)
        prefs.configVersion = cfg.configVersion
        prefs.configFetchedAt = System.currentTimeMillis()
        prefs.heartbeatIntervalSec = cfg.heartbeatIntervalSeconds.coerceIn(MIN_INTERVAL_SEC, MAX_INTERVAL_SEC)
        prefs.updateRequired = cfg.updateRequired
        prefs.minAppVersion = cfg.minAppVersion
        prefs.sendRawText = cfg.sendRawText
        _config.value = cfg
    }

    fun clear() {
        _config.value = null
    }

    /** Ambil ulang konfigurasi dari server. true bila berhasil. */
    suspend fun refresh(): Boolean = mutex.withLock {
        if (!prefs.canSync) return@withLock false
        when (val r = api.config()) {
            is ApiResult.Success -> {
                save(r.body)
                true
            }
            is ApiResult.HttpError -> false
            is ApiResult.NetworkError -> false
        }
    }

    /** Sumber bank aktif untuk package ini (prioritas is_default), atau null bila tidak dipilih. */
    fun activeSourceFor(packageName: String): BankSourceDto? {
        val list = _config.value?.bankSources?.filter { it.isActive && it.packageName == packageName }.orEmpty()
        return list.firstOrNull { it.isDefault } ?: list.firstOrNull()
    }

    fun isActivePackage(packageName: String): Boolean = activeSourceFor(packageName) != null

    companion object {
        const val MIN_INTERVAL_SEC = 30
        const val MAX_INTERVAL_SEC = 900
    }
}
