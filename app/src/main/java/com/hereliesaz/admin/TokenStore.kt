package com.hereliesaz.admin

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class TokenStore(context: Context) {
    private val prefs = context.getSharedPreferences("admin_secure", Context.MODE_PRIVATE)
    fun hasToken(): Boolean = load().isNotBlank()
    fun save(token: String) {
        val clean = token.trim()
        if (clean.isBlank()) { clear(); return }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(clean.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString(KEY_TOKEN, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }
    fun load(): String {
        migrateLegacyTokenIfNeeded()
        val payload = prefs.getString(KEY_TOKEN, null) ?: return ""
        val iv = prefs.getString(KEY_IV, null) ?: return ""
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) {
            clear(); ""
        }
    }
    fun clear() {
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_IV)
            .remove(LEGACY_KEY_TOKEN)
            .remove(LEGACY_KEY_IV)
            .apply()
    }

    private fun migrateLegacyTokenIfNeeded() {
        if (prefs.contains(KEY_TOKEN) && prefs.contains(KEY_IV)) return
        val legacyPayload = prefs.getString(LEGACY_KEY_TOKEN, null) ?: return
        val legacyIv = prefs.getString(LEGACY_KEY_IV, null) ?: return
        try {
            val legacyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val legacyKey = legacyStore.getKey(LEGACY_KEY_ALIAS, null) as? SecretKey ?: return
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                legacyKey,
                GCMParameterSpec(128, Base64.decode(legacyIv, Base64.NO_WRAP)),
            )
            val plaintext = String(
                cipher.doFinal(Base64.decode(legacyPayload, Base64.NO_WRAP)),
                Charsets.UTF_8,
            )
            save(plaintext)
            prefs.edit().remove(LEGACY_KEY_TOKEN).remove(LEGACY_KEY_IV).apply()
        } catch (_: Exception) {
            // Leave legacy values untouched if migration cannot be completed.
        }
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generateKey()
        }
    }
    companion object {
        private const val KEY_ALIAS = "hereliesaz_admin_gh_token"
        private const val KEY_TOKEN = "gh_token"
        private const val KEY_IV = "gh_token_iv"
        private const val LEGACY_KEY_ALIAS = "hereliesaz_admin_github_pat"
        private const val LEGACY_KEY_TOKEN = "github_pat"
        private const val LEGACY_KEY_IV = "github_pat_iv"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
