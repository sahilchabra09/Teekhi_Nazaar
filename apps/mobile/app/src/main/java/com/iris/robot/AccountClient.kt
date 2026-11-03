package com.iris.robot

import com.iris.robot.core.HubAddress
import com.iris.robot.core.Protocol
import com.iris.robot.core.OAuthAttempt
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

@Serializable data class LinkedUser(val id: String, val email: String, val name: String)
@Serializable data class LinkedAccount(val token: String, val expires_at_ms: Long, val user: LinkedUser)
@Serializable data class AccountInfo(val expires_at_ms: Long, val user: LinkedUser)
@Serializable private data class OAuthStartRequest(val state: String, val code_challenge: String)
@Serializable data class OAuthStart(val authorization_url: String, val expires_at_ms: Long)
@Serializable private data class OAuthExchange(val code: String, val code_verifier: String)
class AccountExpired : IllegalStateException("Your session expired. Continue with Google to sign in again.")

/** Google OAuth uses the external browser and existing Better Auth Google provider.
 * The browser return is exchanged using the verifier kept in Keystore-encrypted settings. */
class AccountClient(private val settings: RobotSettings) : AutoCloseable {
    private val address = HubAddress.parse(settings.hub)
    private val client = OkHttpClient.Builder().callTimeout(12, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    init { requireBackendTransport(address, settings.allowLocalSessionHttp) }
    private fun request(path: String, json: String? = null, authenticated: Boolean = true): String {
        val builder = Request.Builder().url(address.http + path)
        if (authenticated) {
            if (settings.accountToken.isBlank()) throw AccountExpired()
            builder.header("Authorization", "Bearer ${settings.accountToken}")
        }
        if (json != null) builder.post(json.toRequestBody("application/json".toMediaType()))
        return client.newCall(builder.build()).execute().use { response ->
            if (response.code == 401) throw AccountExpired()
            require(response.isSuccessful) {
                if (response.code == 429) "Too many sign-in attempts. Wait one minute and try again."
                else if (response.code == 503) "Google sign-in is not configured or the account server is unavailable."
                else "Account server unavailable (HTTP ${response.code}). Check the laptop address."
            }
            val source = response.body?.source() ?: error("Empty account response")
            source.request(16_385)
            require(source.buffer.size <= 16_384) { "Invalid account response" }
            source.readUtf8()
        }
    }
    fun begin(attempt: OAuthAttempt): OAuthStart {
        val result = Protocol.json.decodeFromString<OAuthStart>(request("/api/mobile/oauth/start",
            Protocol.json.encodeToString(OAuthStartRequest(attempt.state, attempt.challenge)), false))
        val url = result.authorization_url.toHttpUrl()
        require(url.encodedPath == "/api/mobile/oauth/authorize" && url.username.isEmpty() && url.password.isEmpty()) { "Invalid Google sign-in URL" }
        requireBackendTransport(HubAddress.parse(url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString()), settings.allowLocalSessionHttp)
        require(result.expires_at_ms > System.currentTimeMillis()) { "Google sign-in expired. Please try again." }
        return result
    }
    fun complete(code: String, attempt: OAuthAttempt): LinkedAccount = Protocol.json.decodeFromString(request("/api/mobile/oauth/exchange",
        Protocol.json.encodeToString(OAuthExchange(code, attempt.verifier)), false))
    fun me(): AccountInfo = Protocol.json.decodeFromString(request("/api/mobile/me"))
    fun logout() { request("/api/mobile/logout", "{}") }
    override fun close() { client.dispatcher.cancelAll(); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
}

fun requireBackendTransport(address: HubAddress, allowLocalHttp: Boolean) {
    val url = address.http.toHttpUrl()
    val parts = url.host.split('.').map { it.toIntOrNull() }
    val privateV4 = parts.size == 4 && parts.all { it != null && it in 0..255 } &&
        (parts[0] == 10 || parts[0] == 127 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && parts[1]!! in 16..31))
    val local = privateV4 || url.host in setOf("localhost", "::1", "[::1]")
    require(url.isHttps || (allowLocalHttp && local)) { "Use HTTPS, or explicitly allow HTTP for your private laptop hotspot." }
}
