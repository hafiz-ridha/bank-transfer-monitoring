package id.btm.monitor.core

import java.security.MessageDigest

object Hashing {
    fun sha256Hex(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(digest.size * 2)
        for (b in digest) {
            sb.append((b.toInt() and 0xff).toString(16).padStart(2, '0'))
        }
        return sb.toString()
    }

    /**
     * dedupe_key sesuai kontrak API: sha256(package|title|text|notification.when).
     * title/text adalah teks mentah EXTRA_TITLE / EXTRA_TEXT (null dianggap string kosong).
     */
    fun dedupeKey(packageName: String, title: String?, text: String?, whenMs: Long): String =
        sha256Hex("$packageName|${title.orEmpty()}|${text.orEmpty()}|$whenMs")
}
