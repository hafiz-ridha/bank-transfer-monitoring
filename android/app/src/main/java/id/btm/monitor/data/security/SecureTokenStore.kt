package id.btm.monitor.data.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Penyimpanan device_token terenkripsi (PRD §10 "Penyimpanan token secara aman").
 *
 * - Kunci AES-256/GCM dibuat di AndroidKeyStore (tidak dapat diekspor dari perangkat).
 * - Yang disimpan di SharedPreferences hanya IV + ciphertext (Base64).
 * - Tidak memakai EncryptedSharedPreferences (deprecated).
 * - Jika kunci hilang/rusak (mis. data dipindah ke HP lain), dekripsi gagal -> null ->
 *   aplikasi meminta pairing ulang.
 */
class SecureTokenStore(context: Context) {
    private val sp = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    @Volatile
    private var cached: String? = null

    @Synchronized
    fun saveToken(token: String): Boolean {
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
            val ok = sp.edit()
                .putString(K_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString(K_CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .commit()
            if (ok) cached = token
            ok
        } catch (e: Exception) {
            false
        }
    }

    @Synchronized
    fun loadToken(): String? {
        cached?.let { return it }
        val ivB64 = sp.getString(K_IV, null) ?: return null
        val ctB64 = sp.getString(K_CIPHERTEXT, null) ?: return null
        return try {
            val key = existingKey() ?: return null
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, Base64.decode(ivB64, Base64.NO_WRAP)))
            val plain = String(cipher.doFinal(Base64.decode(ctB64, Base64.NO_WRAP)), Charsets.UTF_8)
            cached = plain
            plain
        } catch (e: Exception) {
            null
        }
    }

    fun hasToken(): Boolean = sp.contains(K_CIPHERTEXT)

    @Synchronized
    fun clearToken() {
        cached = null
        sp.edit().clear().commit()
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(KEY_ALIAS, null) as? SecretKey

    private fun getOrCreateKey(): SecretKey {
        existingKey()?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private companion object {
        const val FILE = "btm_secure"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "btm_device_token_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
        const val K_IV = "token_iv"
        const val K_CIPHERTEXT = "token_ct"
    }
}
