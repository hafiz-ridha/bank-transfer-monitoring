package id.btm.monitor

import android.app.Application
import id.btm.monitor.core.Notifications
import id.btm.monitor.core.TimeUtil
import id.btm.monitor.data.ConfigRepository
import id.btm.monitor.data.db.AppDatabase
import id.btm.monitor.data.db.DetectionDao
import id.btm.monitor.data.db.OutboxDao
import id.btm.monitor.data.net.ApiClient
import id.btm.monitor.data.net.ApiEventsListener
import id.btm.monitor.data.net.ApiJson
import id.btm.monitor.data.prefs.AppPrefs
import id.btm.monitor.data.security.SecureTokenStore
import id.btm.monitor.domain.DeviceEventRecorder
import id.btm.monitor.domain.DeviceEventType
import id.btm.monitor.domain.HeartbeatManager
import id.btm.monitor.domain.HeartbeatTrigger
import id.btm.monitor.domain.NotificationProcessor
import id.btm.monitor.domain.RegistrationRepository
import id.btm.monitor.domain.StateReconciler
import id.btm.monitor.domain.StatusChecker
import id.btm.monitor.domain.SyncEngine
import id.btm.monitor.parser.ParserRegistry
import id.btm.monitor.service.NetworkMonitor
import id.btm.monitor.work.WorkScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/**
 * Dependency injection manual (tanpa Hilt). Satu instance per proses, dibuat di [BtmApp].
 * Juga berisi alur siklus hidup: start aplikasi, listener terhubung/terputus, jaringan berubah,
 * boot, dan rekonsiliasi saat aplikasi dibuka.
 */
class AppContainer(private val app: Application) : ApiEventsListener {

    val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val json: Json = ApiJson.instance
    val prefs = AppPrefs(app)
    val tokenStore = SecureTokenStore(app)
    val db: AppDatabase = AppDatabase.build(app)
    val outboxDao: OutboxDao = db.outboxDao()
    val detectionDao: DetectionDao = db.detectionDao()
    val api = ApiClient(prefs, tokenStore, json)
    val configRepo = ConfigRepository(prefs, api, json)
    val parsers: ParserRegistry = ParserRegistry.createDefault()
    val workScheduler = WorkScheduler(app)
    val events = DeviceEventRecorder(prefs, outboxDao, json, requestSync = { requestSync() })
    val syncEngine = SyncEngine(db, api, prefs, events, scheduleRetry = { delayMs -> workScheduler.scheduleRetry(delayMs) })
    val networkMonitor = NetworkMonitor(app, appScope) { connected -> onNetworkChanged(connected) }
    val statusChecker = StatusChecker(app, outboxDao, networkMonitor)
    val reconciler = StateReconciler(app, prefs, statusChecker, events)
    val heartbeat = HeartbeatManager(
        context = app,
        prefs = prefs,
        api = api,
        status = statusChecker,
        config = configRepo,
        scope = appScope,
        beforeSend = { reconciler.checkTransitions() },
        afterTick = { kickSyncIfDue() },
    )
    val processor = NotificationProcessor(db, prefs, configRepo, parsers, json, events, requestSync = { requestSync() })
    val registration = RegistrationRepository(prefs, tokenStore, api, configRepo, onRegistered = { onRegistered() })

    @Volatile
    private var lastResumeReconcileAt = 0L

    init {
        api.listener = this
    }

    // ------------------------------------------------------------------ sinkronisasi

    /** Dipanggil setiap ada event baru di antrean. */
    fun requestSync() {
        syncEngine.markDirty()
        workScheduler.enqueueSyncNow()
    }

    private suspend fun kickSyncIfDue() {
        if (prefs.canSync && outboxDao.countDue(System.currentTimeMillis()) > 0) requestSync()
    }

    // ------------------------------------------------------------------ siklus hidup

    /** Application.onCreate: proses dibuat (dibuka pengguna, di-bind sebagai listener, boot, alarm, worker). */
    fun onAppCreate() {
        Notifications.createChannels(app)
        networkMonitor.start()
        appScope.launch {
            reconciler.detectAppUpdate()
            if (prefs.canSync) {
                workScheduler.schedulePeriodic()
                // Beri waktu sistem memanggil onListenerConnected sebelum heartbeat pertama.
                delay(LOOP_START_DELAY_MS)
                heartbeat.startLoop()
                heartbeat.armAlarm()
                kickSyncIfDue()
            }
        }
    }

    fun onListenerConnected() {
        prefs.lastListenerConnectedAt = System.currentTimeMillis()
        appScope.launch {
            events.record(DeviceEventType.LISTENER_CONNECTED, "Listener notifikasi terhubung")
            if (prefs.canSync) {
                heartbeat.startLoop()
                heartbeat.armAlarm()
                configRepo.refresh()
                heartbeat.send(HeartbeatTrigger.SERVICE_CHANGE, force = true)
            }
        }
    }

    fun onListenerDisconnected() {
        prefs.lastListenerDisconnectedAt = System.currentTimeMillis()
        appScope.launch {
            events.record(
                DeviceEventType.LISTENER_DISCONNECTED,
                "Listener notifikasi terputus; requestRebind dipanggil",
            )
            heartbeat.send(HeartbeatTrigger.SERVICE_CHANGE, force = true)
        }
    }

    private suspend fun onNetworkChanged(connected: Boolean) {
        val current = if (connected) 1 else 0
        val previous = prefs.lastKnownNetwork
        prefs.lastKnownNetwork = current
        if (previous == current) return
        if (previous == -1) {
            if (connected) kickSyncIfDue()
            return
        }
        if (!connected) {
            // Disimpan lokal dengan occurred_at sekarang; terkirim saat jaringan pulih.
            events.record(DeviceEventType.NETWORK_LOST, "Koneksi internet terputus", syncNow = false)
        } else {
            events.record(DeviceEventType.NETWORK_RESTORED, "Koneksi internet pulih")
            requestSync()
            heartbeat.send(HeartbeatTrigger.NETWORK_RESTORED, force = true)
        }
    }

    /** Alarm heartbeat / worker periodik membangunkan proses. */
    suspend fun onBackgroundWake(trigger: String) {
        if (!prefs.canSync) return
        heartbeat.startLoop()
        reconciler.ensureListenerBound("background_wake")
        heartbeat.send(trigger)
        kickSyncIfDue()
    }

    /** BOOT_COMPLETED / MY_PACKAGE_REPLACED. APP_UPDATED dicatat oleh [StateReconciler.detectAppUpdate]. */
    suspend fun onSystemStart(isBoot: Boolean) {
        if (!prefs.canSync) return
        workScheduler.schedulePeriodic()
        heartbeat.startLoop()
        heartbeat.armAlarm()
        StateReconciler.requestRebind(app)
        if (isBoot) events.record(DeviceEventType.BOOT_COMPLETED, "Perangkat dinyalakan ulang", syncNow = false)
        val trigger = if (isBoot) HeartbeatTrigger.BOOT else HeartbeatTrigger.SERVICE_CHANGE
        // Jaringan sering belum siap tepat setelah boot: heartbeat juga dijadwalkan via WorkManager (butuh jaringan).
        workScheduler.enqueueHeartbeatNow(trigger)
        heartbeat.send(trigger, force = true)
        kickSyncIfDue()
    }

    /** Activity dibuat (bukan rotasi). */
    fun onAppOpened() {
        appScope.launch {
            events.record(DeviceEventType.APP_OPENED, "Aplikasi dibuka", syncNow = false)
        }
    }

    /** Activity onResume: rekonsiliasi status (izin, listener, antrean, jadwal) + heartbeat app_open. */
    fun reconcileOnResume() {
        val now = System.currentTimeMillis()
        if (now - lastResumeReconcileAt < RESUME_THROTTLE_MS) return
        lastResumeReconcileAt = now
        appScope.launch {
            if (!prefs.canSync) return@launch
            reconciler.checkTransitions()
            workScheduler.schedulePeriodic()
            heartbeat.startLoop()
            heartbeat.armAlarm()
            if (reconciler.ensureListenerBound("app_open")) delay(1_500L)
            configRepo.refresh()
            heartbeat.send(HeartbeatTrigger.APP_OPEN, force = true)
            kickSyncIfDue()
        }
    }

    private suspend fun onRegistered() {
        workScheduler.schedulePeriodic()
        heartbeat.startLoop()
        heartbeat.armAlarm()
        reconciler.checkTransitions()
        appScope.launch {
            heartbeat.send(HeartbeatTrigger.MANUAL, force = true)
            requestSync()
        }
    }

    /** Retensi lokal: histori deteksi 30 hari, baris antrean terkirim 24 jam. */
    suspend fun runMaintenanceIfDue() {
        val now = System.currentTimeMillis()
        if (now - prefs.lastCleanupAt < CLEANUP_INTERVAL_MS) return
        prefs.lastCleanupAt = now
        detectionDao.purgeOlderThan(now - DETECTION_RETENTION_MS)
        outboxDao.purgeSent(now - SENT_RETENTION_MS)
    }

    // ------------------------------------------------------------------ ApiEventsListener

    override fun onInvalidDeviceToken() {
        // Sinkronisasi berhenti dengan sendirinya (prefs.canSync == false). Antrean lokal dipertahankan.
        heartbeat.cancelAlarm()
    }

    override fun onClockSkew(serverTime: String?, newlyDetected: Boolean) {
        if (!newlyDetected) return
        appScope.launch {
            events.record(
                DeviceEventType.CLOCK_SKEW,
                "Jam perangkat berbeda terlalu jauh dari server",
                data = mapOf("server_time" to serverTime, "device_time" to TimeUtil.iso(System.currentTimeMillis())),
                syncNow = false,
            )
        }
    }

    override fun onAuthenticatedSuccess() {
        if (prefs.clockSkewDetected) {
            prefs.clockSkewDetected = false
            prefs.clockSkewServerTime = null
        }
    }

    private companion object {
        const val LOOP_START_DELAY_MS = 5_000L
        const val RESUME_THROTTLE_MS = 5_000L
        const val CLEANUP_INTERVAL_MS = 12 * 3_600_000L
        const val DETECTION_RETENTION_MS = 30L * 24 * 3_600_000L
        const val SENT_RETENTION_MS = 24 * 3_600_000L
    }
}
