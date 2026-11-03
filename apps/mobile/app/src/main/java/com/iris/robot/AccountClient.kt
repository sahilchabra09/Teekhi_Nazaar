package com.iris.robot

import com.iris.robot.core.HubAddress
import com.iris.robot.core.Protocol
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
@Serializable private data class LinkRequest(val code: String)
class AccountExpired : IllegalStateException("Your account link expired. Sign in again using a new code from your laptop.")

/** Native authorization uses a one-use code issued by the frontend's Better Auth session.
 * Both email/password and Google accounts use precisely the same account, without a
 * second password database or a Google client secret in the APK. */
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
                if (response.code == 429) "Too many link attempts. Wait one minute and try again."
                else "Account server unavailable (HTTP ${response.code}). Check the laptop address."
            }
            val source = response.body?.source() ?: error("Empty account response")
            source.request(16_385)
            require(source.buffer.size <= 16_384) { "Invalid account response" }
            source.readUtf8()
        }
    }
    fun link(code: String): LinkedAccount {
        val normalized = code.filterNot { it.isWhitespace() || it == '-' }.uppercase()
        require(normalized.matches(Regex("[A-F0-9]{12}"))) { "Enter the 12-character code shown on your laptop." }
        return try {
            Protocol.json.decodeFromString<LinkedAccount>(request("/api/mobile/link", Protocol.json.encodeToString(LinkRequest(normalized)), false))
        } catch (_: AccountExpired) { throw IllegalStateException("That code is invalid or expired. Click Link phone on your laptop to create another.") }
    }
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
