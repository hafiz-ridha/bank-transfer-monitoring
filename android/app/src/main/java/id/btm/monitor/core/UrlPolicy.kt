package id.btm.monitor.core

import id.btm.monitor.BuildConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Kebijakan URL server (PRD §10: HTTPS).
 * - Release: hanya https://.
 * - Debug: https://, atau http:// khusus localhost / 10.0.2.2 / *.local / LAN privat.
 *   (Network Security Config debug mengizinkan cleartext; pembatasan host dilakukan di sini.)
 */
object UrlPolicy {
    private const val API_SUFFIX = "/api/v1"

    /**
     * Menormalkan input pengguna menjadi base URL API, mis.
     * "api.contoh.co.id" -> "https://api.contoh.co.id/api/v1".
     */
    fun normalizeBase(input: String): String? {
        var s = input.trim().trimEnd('/')
        if (s.isEmpty()) return null
        if (!s.startsWith("http://", ignoreCase = true) && !s.startsWith("https://", ignoreCase = true)) {
            s = "https://$s"
        }
        if (!s.endsWith(API_SUFFIX)) s += API_SUFFIX
        val url = s.toHttpUrlOrNull() ?: return null
        return url.toString().trimEnd('/')
    }

    /** null bila URL diizinkan, atau pesan kesalahan (Bahasa Indonesia). */
    fun check(url: String): String? {
        val parsed = url.toHttpUrlOrNull() ?: return "URL server tidak valid"
        return check(parsed)
    }

    fun check(url: HttpUrl, allowCleartextPrivate: Boolean = BuildConfig.DEBUG): String? {
        if (url.isHttps) return null
        if (!allowCleartextPrivate) return "Hanya HTTPS yang diizinkan. Gunakan alamat https://"
        return if (isPrivateHost(url.host)) null
        else "HTTP (tanpa enkripsi) hanya diizinkan untuk localhost / jaringan lokal pada build debug"
    }

    fun isPrivateHost(host: String): Boolean {
        val h = host.lowercase()
        if (h == "localhost" || h == "10.0.2.2" || h.endsWith(".local") || h.endsWith(".localhost")) return true
        val parts = h.split('.')
        if (parts.size != 4) return false
        val o = parts.map { it.toIntOrNull() ?: return false }
        if (o.any { it !in 0..255 }) return false
        return o[0] == 127 || o[0] == 10 ||
            (o[0] == 172 && o[1] in 16..31) ||
            (o[0] == 192 && o[1] == 168)
    }
}
