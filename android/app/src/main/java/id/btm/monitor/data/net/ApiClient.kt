package id.btm.monitor.data.net

import id.btm.monitor.core.UrlPolicy
import id.btm.monitor.data.prefs.AppPrefs
import id.btm.monitor.data.security.SecureTokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Hasil pemanggilan API. */
sealed class ApiResult<out T> {
    data class Success<T>(val code: Int, val body: T) : ApiResult<T>()

    data class HttpError(
        val code: Int,
        val errorCode: String?,
        val message: String,
        val serverTime: String? = null,
    ) : ApiResult<Nothing>() {
        val isInvalidToken: Boolean get() = code == 401 && errorCode == "INVALID_DEVICE_TOKEN"
        val isClockSkew: Boolean get() = code == 401 && errorCode == "CLOCK_SKEW"
        val isValidation: Boolean get() = code == 400 && errorCode == "VALIDATION_ERROR"
        val isPayloadTooLarge: Boolean get() = code == 413
        fun describe(): String = "HTTP $code${errorCode?.let { " $it" } ?: ""}: $message"
    }

    /** Jaringan gagal / timeout / URL ditolak kebijakan. */
    data class NetworkError(val message: String) : ApiResult<Nothing>()
}

/** Callback global untuk kondisi yang harus ditangani di mana pun terjadi. */
interface ApiEventsListener {
    fun onInvalidDeviceToken()
    fun onClockSkew(serverTime: String?, newlyDetected: Boolean)
    fun onAuthenticatedSuccess()
}

/**
 * Klien HTTP untuk endpoint Android (docs/API.md bagian A).
 * Header untuk semua endpoint kecuali register:
 *   Authorization: Bearer <device_token>
 *   X-Request-Time: <epoch ms>
 */
class ApiClient(
    private val prefs: AppPrefs,
    private val tokens: SecureTokenStore,
    private val json: Json,
) {
    @Volatile
    var listener: ApiEventsListener? = null

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    suspend fun register(baseUrl: String, request: RegisterRequest): ApiResult<RegisterResponse> =
        execute(
            baseUrl = baseUrl,
            method = "POST",
            path = "/devices/register",
            body = json.encodeToString(RegisterRequest.serializer(), request),
            authenticated = false,
            deserializer = RegisterResponse.serializer(),
        )

    suspend fun config(): ApiResult<DeviceConfig> =
        execute(null, "GET", "/devices/config", null, true, DeviceConfig.serializer())

    suspend fun heartbeat(request: HeartbeatRequest): ApiResult<HeartbeatResponse> =
        execute(
            null, "POST", "/devices/heartbeat",
            json.encodeToString(HeartbeatRequest.serializer(), request), true, HeartbeatResponse.serializer(),
        )

    /** Body sudah berupa JSON `{"events":[...]}` (payload antrean disimpan sebagai JSON). */
    suspend fun deviceEventsRaw(bodyJson: String): ApiResult<BatchResponse> =
        execute(null, "POST", "/devices/events", bodyJson, true, BatchResponse.serializer())

    suspend fun notificationsBatchRaw(bodyJson: String): ApiResult<BatchResponse> =
        execute(null, "POST", "/notifications/batch", bodyJson, true, BatchResponse.serializer())

    suspend fun deviceMe(): ApiResult<DeviceMeDto> =
        execute(null, "GET", "/devices/me", null, true, DeviceMeDto.serializer())

    private suspend fun <T> execute(
        baseUrl: String?,
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
        deserializer: DeserializationStrategy<T>,
    ): ApiResult<T> = withContext(Dispatchers.IO) {
        val base = baseUrl ?: prefs.apiBaseUrl
            ?: return@withContext ApiResult.NetworkError("URL server belum diatur")
        val url = (base.trimEnd('/') + path).toHttpUrlOrNull()
            ?: return@withContext ApiResult.NetworkError("URL server tidak valid")
        UrlPolicy.check(url)?.let { return@withContext ApiResult.NetworkError(it) }

        val builder = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("X-Request-Time", System.currentTimeMillis().toString())

        if (authenticated) {
            val token = tokens.loadToken()
            if (token == null) {
                // Token tidak dapat dibaca (mis. kunci Keystore hilang): perlakukan seperti token dicabut.
                if (prefs.isRegistered && !prefs.needsRepair) {
                    prefs.markNeedsRepair("Token perangkat tidak dapat dibaca dari penyimpanan aman. Pasangkan ulang perangkat.")
                    listener?.onInvalidDeviceToken()
                }
                return@withContext ApiResult.HttpError(401, "INVALID_DEVICE_TOKEN", "Token perangkat tidak tersedia")
            }
            builder.header("Authorization", "Bearer $token")
        }

        if (method == "GET") {
            builder.get()
        } else {
            builder.method(method, (body ?: "{}").toRequestBody(jsonMedia))
        }

        try {
            http.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    val decoded = try {
                        json.decodeFromString(deserializer, text)
                    } catch (e: Exception) {
                        return@withContext ApiResult.HttpError(
                            response.code, "BAD_RESPONSE", "Respons server tidak dapat dibaca",
                        )
                    }
                    if (authenticated) listener?.onAuthenticatedSuccess()
                    ApiResult.Success(response.code, decoded)
                } else {
                    val err = try {
                        json.decodeFromString(ErrorEnvelope.serializer(), text).error
                    } catch (e: Exception) {
                        null
                    }
                    val serverTime = try {
                        (err?.details as? JsonObject)?.get("server_time")?.jsonPrimitive?.contentOrNull
                    } catch (e: Exception) {
                        null
                    }
                    val result = ApiResult.HttpError(
                        code = response.code,
                        errorCode = err?.code,
                        message = err?.message ?: "HTTP ${response.code}",
                        serverTime = serverTime,
                    )
                    if (authenticated) handleGlobal(result)
                    result
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e.message ?: e.javaClass.simpleName)
        } catch (e: IllegalStateException) {
            ApiResult.NetworkError(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun handleGlobal(error: ApiResult.HttpError) {
        when {
            error.isInvalidToken -> {
                if (prefs.isRegistered && !prefs.needsRepair) {
                    prefs.markNeedsRepair("Token perangkat tidak valid atau sudah dicabut dari dashboard. Masukkan kode pairing baru.")
                    listener?.onInvalidDeviceToken()
                }
            }
            error.isClockSkew -> {
                val newly = prefs.markClockSkew(error.serverTime)
                listener?.onClockSkew(error.serverTime, newly)
            }
        }
    }
}
