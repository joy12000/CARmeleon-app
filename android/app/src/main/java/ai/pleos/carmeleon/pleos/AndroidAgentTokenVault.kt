package ai.pleos.carmeleon.pleos

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import ai.pleos.carmeleon.agent.AgentTokenVault
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only encrypted bearer material is written to app-private preferences; Android backup is disabled. */
class AndroidAgentTokenVault(context: Context) : AgentTokenVault {
    private val prefs = context.getSharedPreferences("carmeleon-agent", Context.MODE_PRIVATE)
    private val alias = "carmeleon.agent.session.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized override fun read(): String? = runCatching {
        val stored = prefs.getString("token", null) ?: return null
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }.getOrElse { prefs.edit().remove("token").apply(); null }
    @Synchronized override fun write(token: String?) {
        if (token == null) { prefs.edit().remove("token").apply(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit().putString("token", Base64.encodeToString(encrypted, Base64.NO_WRAP)).apply()
    }
}
