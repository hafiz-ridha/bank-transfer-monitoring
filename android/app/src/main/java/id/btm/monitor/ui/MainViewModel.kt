package id.btm.monitor.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.btm.monitor.AppContainer
import id.btm.monitor.BtmApp
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.db.DetectionEntity
import id.btm.monitor.data.db.OutboxEntity
import id.btm.monitor.data.db.OutboxType
import id.btm.monitor.data.db.PackageStat
import id.btm.monitor.data.net.ApiResult
import id.btm.monitor.data.net.DeviceConfig
import id.btm.monitor.data.net.DeviceMeDto
import id.btm.monitor.data.prefs.PrefsView
import id.btm.monitor.domain.HeartbeatTrigger
import id.btm.monitor.domain.RegistrationResult
import id.btm.monitor.domain.StatusSnapshot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed class ServerDeviceState {
    data object Idle : ServerDeviceState()
    data object Loading : ServerDeviceState()
    data class Loaded(val device: DeviceMeDto, val at: Long) : ServerDeviceState()
    data class Error(val message: String) : ServerDeviceState()
}

class MainViewModel(application: Application) : AndroidViewModel(application) {
    val c: AppContainer = (application as BtmApp).container

    private val ticker = flow {
        while (true) {
            emit(System.currentTimeMillis())
            delay(3_000L)
        }
    }

    val prefs: StateFlow<PrefsView> = c.prefs.changes
        .map { c.prefs.snapshot() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, c.prefs.snapshot())

    /** Pemeriksaan nyata, diperbarui tiap 3 detik selama UI terlihat. null = belum diperiksa. */
    val status: StateFlow<StatusSnapshot?> = combine(ticker, c.prefs.changes) { _, _ -> c.statusChecker.snapshot() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), null)

    val config: StateFlow<DeviceConfig?> = c.configRepo.config

    val queue: StateFlow<List<OutboxEntity>> = c.outboxDao.observeUnsent(300)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), emptyList())

    val recentlySent: StateFlow<List<OutboxEntity>> = c.outboxDao.observeRecentlySent(50)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), emptyList())

    val unsentNotifications: StateFlow<Int> = c.outboxDao.observeUnsentCount(OutboxType.NOTIFICATION)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), 0)

    val failedNotifications: StateFlow<Int> = c.outboxDao.observeFailedCount(OutboxType.NOTIFICATION)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), 0)

    val detections: StateFlow<List<DetectionEntity>> = c.detectionDao.observeRecent(300)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), emptyList())

    val packageStats: StateFlow<List<PackageStat>> = c.detectionDao.observePackageStats()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val todayIncoming: StateFlow<Int> = flow {
        while (true) {
            emit(TimeUtil.startOfToday())
            delay(60_000L)
        }
    }
        .distinctUntilChanged()
        .flatMapLatest { since -> c.detectionDao.observeIncomingCountSince(since) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), 0)

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _serverDevice = MutableStateFlow<ServerDeviceState>(ServerDeviceState.Idle)
    val serverDevice: StateFlow<ServerDeviceState> = _serverDevice.asStateFlow()

    /** Pairing ulang manual dari Pengaturan (token lama tetap dipakai sampai pairing baru berhasil). */
    private val _repairMode = MutableStateFlow(false)
    val repairMode: StateFlow<Boolean> = _repairMode.asStateFlow()

    fun consumeMessage() {
        _message.value = null
    }

    fun register(url: String, code: String, name: String) {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            val result = c.registration.register(url, code, name)
            _busy.value = false
            when (result) {
                is RegistrationResult.Success -> {
                    _repairMode.value = false
                    _message.value = "Perangkat berhasil dipasangkan"
                }
                is RegistrationResult.Failure -> _message.value = result.message
            }
        }
    }

    fun startRepair() {
        _repairMode.value = true
    }

    fun cancelRepair() {
        _repairMode.value = false
    }

    fun syncNow() {
        c.appScope.launch {
            _busy.value = true
            val outcome = c.syncEngine.syncAll()
            _busy.value = false
            _message.value = outcome.describe()
        }
    }

    fun retryAllFailed() {
        c.appScope.launch {
            val n = c.syncEngine.retryAllFailed()
            _message.value = if (n > 0) "$n event dijadwalkan untuk dikirim ulang" else "Tidak ada event gagal"
            if (n > 0) c.requestSync()
        }
    }

    fun retryOne(id: Long) {
        c.appScope.launch {
            if (c.syncEngine.retryOne(id)) {
                _message.value = "Event dijadwalkan untuk dikirim ulang"
                c.requestSync()
            }
        }
    }

    fun sendHeartbeat() {
        c.appScope.launch {
            val ok = c.heartbeat.send(HeartbeatTrigger.MANUAL, force = true)
            _message.value = if (ok) "Heartbeat terkirim" else "Heartbeat gagal: ${c.prefs.lastHeartbeatResult ?: "-"}"
        }
    }

    fun refreshConfig() {
        c.appScope.launch {
            val ok = c.configRepo.refresh()
            _message.value = if (ok) "Konfigurasi diperbarui" else "Gagal mengambil konfigurasi dari server"
        }
    }

    fun loadServerDevice() {
        _serverDevice.value = ServerDeviceState.Loading
        viewModelScope.launch {
            _serverDevice.value = when (val r = c.api.deviceMe()) {
                is ApiResult.Success -> ServerDeviceState.Loaded(r.body, System.currentTimeMillis())
                is ApiResult.HttpError -> ServerDeviceState.Error(r.describe())
                is ApiResult.NetworkError -> ServerDeviceState.Error("Jaringan: ${r.message}")
            }
        }
    }

    fun setAutostartConfirmed(value: Boolean) {
        c.prefs.autostartConfirmed = value
    }
}
