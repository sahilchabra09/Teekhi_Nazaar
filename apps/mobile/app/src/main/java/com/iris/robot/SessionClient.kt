package com.iris.robot

import android.os.SystemClock
import com.iris.robot.core.*
import com.iris.robot.core.Protocol
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.util.concurrent.TimeUnit

class SessionClient(
    private val address: HubAddress,
    private val settings: RobotSettings,
    private val scope: CoroutineScope,
    private val grant: (SessionGrant, Long, Long) -> Unit,
    private val revoke: (String) -> Unit,
) : AutoCloseable {
    private val client = OkHttpClient.Builder().callTimeout(3, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    private var job: Job? = null
    fun start() {
        job?.cancel()
        job = scope.launch {
            val url = "${address.http}/api/mobile/session".toHttpUrl().newBuilder().addQueryParameter("device_id", "esp12e_carbot").build()
            if (settings.sessionToken.isBlank()) { revoke("Enter a backend session token in setup"); return@launch }
            if (!url.isHttps && !(settings.allowLocalSessionHttp && isLocalHost(url.host))) {
                revoke("Session authorization requires HTTPS; local bench HTTP must be enabled explicitly")
                return@launch
            }
            while (isActive) {
                val start = SystemClock.elapsedRealtime()
                try {
                    val response = withContext(Dispatchers.IO) {
                        client.newCall(Request.Builder().url(url).header("Authorization", "Bearer ${settings.sessionToken}").build()).execute().use { result ->
                            require(result.isSuccessful) { "Backend session unavailable (HTTP ${result.code})" }
                            val body = result.body ?: throw IllegalStateException("Empty session response")
                            val source = body.source()
                            source.request(16_385)
                            require(source.buffer.size <= 16_384) { "Invalid session response" }
                            val raw = source.readUtf8()
                            Protocol.json.decodeFromString<SessionGrant>(raw)
                        }
                    }
                    ensureActive()
                    val received = SystemClock.elapsedRealtime()
                    grant(response, received, received - start)
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { revoke("Session authorization unavailable; driving disarmed") }
                delay(2500)
            }
        }
    }
    private fun isLocalHost(host: String): Boolean {
        if (host in setOf("localhost", "::1", "[::1]")) return true
        val parts = host.split('.').map { it.toIntOrNull() ?: return false }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        return parts[0] == 10 || parts[0] == 127 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && parts[1] in 16..31)
    }
    override fun close() { job?.cancel(); client.dispatcher.cancelAll(); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
}
