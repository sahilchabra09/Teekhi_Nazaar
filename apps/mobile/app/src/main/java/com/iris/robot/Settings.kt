package com.iris.robot

import android.content.Context
import android.annotation.SuppressLint
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import com.iris.robot.core.Protocol
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable data class RobotSettings(
    val hub: String = "192.168.1.10:3000",
    val robotEnabled: Boolean = false,
    val broker: String = "wss://broker.emqx.io:8084/mqtt",
    val espPassword: String = "",
    val brokerUser: String = "",
    val brokerPassword: String = "",
    val sessionToken: String = "",
    val allowLocalSessionHttp: Boolean = false,
    val accountToken: String = "",
    val accountEmail: String = "",
    val accountExpiresAt: Long = 0,
)

/** The full settings blob is encrypted; ESP/broker/session secrets never enter ordinary preferences. */
class SettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("iris-encrypted-settings", Context.MODE_PRIVATE)
    private val alias = "iris-settings-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun load(): RobotSettings {
        val stored = preferences.getString("settings", null) ?: return RobotSettings()
        val parts = stored.split(":")
        require(parts.size == 2) { "Saved settings are unreadable" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        return Protocol.json.decodeFromString(String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8))
    }
    @SuppressLint("UseKtx") // Need commit's success result before starting a session with persisted credentials.
    fun save(value: RobotSettings) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val bytes = cipher.doFinal(Protocol.json.encodeToString(value).toByteArray(Charsets.UTF_8))
        val encoded = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(bytes, Base64.NO_WRAP)
        check(preferences.edit().putString("settings", encoded).commit()) { "Could not save settings" }
    }
}
