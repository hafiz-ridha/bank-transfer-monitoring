package id.btm.monitor.domain

import android.os.Build
import id.btm.monitor.BuildConfig
import id.btm.monitor.core.UrlPolicy
import id.btm.monitor.data.ConfigRepository
import id.btm.monitor.data.net.ApiClient
import id.btm.monitor.data.net.ApiResult
import id.btm.monitor.data.net.RegisterRequest
import id.btm.monitor.data.prefs.AppPrefs
import id.btm.monitor.data.security.SecureTokenStore
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

sealed class RegistrationResult {
    data object Success : RegistrationResult()
    data class Failure(val message: String) : RegistrationResult()
}

/**
 * Pairing perangkat dengan kode 8 karakter dari dashboard (POST /devices/register).
 * Antrean lokal TIDAK dihapus saat pairing ulang; setelah berhasil, sinkronisasi dilanjutkan.
 */
class RegistrationRepository(
    private val prefs: AppPrefs,
    private val tokens: SecureTokenStore,
    private val api: ApiClient,
    private val config: ConfigRepository,
    private val onRegistered: suspend () -> Unit,
) {
    suspend fun register(baseUrlInput: String, pairingCodeInput: String, deviceNameInput: String?): RegistrationResult {
        val base = UrlPolicy.normalizeBase(baseUrlInput)
            ?: return RegistrationResult.Failure("URL server tidak valid. Contoh: https://api.contoh.co.id")
        UrlPolicy.check(base)?.let { return RegistrationResult.Failure(it) }

        val code = pairingCodeInput.uppercase().filter { it.isLetterOrDigit() }
        if (code.length !in 6..20) {
            return RegistrationResult.Failure("Kode pairing tidak valid. Masukkan 8 karakter dari dashboard.")
        }

        val request = RegisterRequest(
            pairingCode = code,
            deviceUuid = prefs.deviceUuid,
            deviceName = deviceNameInput?.trim()?.takeIf { it.isNotEmpty() }?.take(100),
            deviceModel = Build.MODEL?.take(100),
            manufacturer = Build.MANUFACTURER?.take(100),
            androidVersion = Build.VERSION.RELEASE?.take(40),
            appVersion = BuildConfig.VERSION_NAME,
        )

        return when (val r = api.register(base, request)) {
            is ApiResult.Success -> withContext(NonCancellable) {
                val body = r.body
                if (!tokens.saveToken(body.deviceToken)) {
                    return@withContext RegistrationResult.Failure(
                        "Registrasi berhasil tetapi token gagal disimpan secara aman. Coba lagi dengan kode pairing baru.",
                    )
                }
                prefs.clearPairing()
                prefs.apiBaseUrl = base
                prefs.serverDeviceId = body.deviceId
                prefs.deviceName = body.deviceName
                prefs.registeredAt = System.currentTimeMillis()
                prefs.needsRepair = false
                prefs.repairReason = null
                prefs.clockSkewDetected = false
                val cfg = body.config
                if (cfg != null) config.save(cfg) else config.refresh()
                onRegistered()
                RegistrationResult.Success
            }
            is ApiResult.HttpError -> RegistrationResult.Failure(
                when {
                    r.errorCode == "INVALID_PAIRING_CODE" -> "Kode pairing salah, sudah dipakai, atau kedaluwarsa (berlaku 24 jam). Minta kode baru dari dashboard."
                    r.code == 429 -> "Terlalu banyak percobaan. Tunggu 1 menit lalu coba lagi."
                    r.errorCode == "VALIDATION_ERROR" -> "Data registrasi ditolak server: ${r.message}"
                    r.code == 404 -> "Endpoint tidak ditemukan. Periksa URL server (harus mengarah ke backend, mis. https://api.contoh.co.id)."
                    else -> "Server menolak registrasi: ${r.describe()}"
                },
            )
            is ApiResult.NetworkError -> RegistrationResult.Failure("Tidak dapat terhubung ke server: ${r.message}")
        }
    }
}
