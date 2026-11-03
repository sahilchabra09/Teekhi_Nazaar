package com.iris.robot

import com.iris.robot.core.*
import com.iris.robot.core.Protocol
import kotlinx.coroutines.*
import okhttp3.*
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/** No outbound offline queue: stale signaling, motion and audio activity are never replayed. */
class HubClient(
    private val address: HubAddress,
    private val scope: CoroutineScope,
    private val onState: (Boolean, String) -> Unit,
    private val onMessage: (Msg) -> Unit,
    private val accountToken: String,
    private val onUnauthorized: () -> Unit,
) : AutoCloseable {
    private val client = OkHttpClient.Builder().pingInterval(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
    @Volatile private var socket: WebSocket? = null
    @Volatile private var open = false
    private var stopped = false
    private var attempt = 0
    private var generation = 0
    private var retry: Job? = null

    fun start() { stopped = false; connect() }
    private fun connect() {
        if (stopped) return
        val epoch = ++generation
        onState(false, if (attempt == 0) "Connecting" else "Reconnecting")
        socket = client.newWebSocket(Request.Builder().url(address.websocket).header("Authorization", "Bearer $accountToken").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                scope.launch(Dispatchers.Main.immediate) {
                    if (epoch != generation || stopped) { webSocket.close(1000, null); return@launch }
                    open = true
                    webSocket.send(Protocol.encode(Hello()))
                    onState(true, "Connected")
                }
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length > 2_000_000) return
                val msg = Protocol.decode(text) ?: return
                scope.launch(Dispatchers.Main.immediate) {
                    if (epoch == generation && !stopped) {
                        if (msg is PeerStatus) attempt = 0
                        onMessage(msg)
                    }
                }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (code == 1008 || code == 4001) unauthorized(epoch) else disconnected(epoch)
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (response?.code == 401 || response?.code == 403) unauthorized(epoch) else disconnected(epoch)
            }
        })
    }
    private fun unauthorized(epoch: Int) {
        scope.launch(Dispatchers.Main.immediate) {
            if (stopped || epoch != generation) return@launch
            stopped = true; open = false; retry?.cancel()
            onState(false, "Account link ended")
            onUnauthorized()
        }
    }
    private fun disconnected(epoch: Int) {
        scope.launch(Dispatchers.Main.immediate) {
            if (stopped || epoch != generation) return@launch
            generation++ // only one reconnect for this socket's terminal callbacks
            open = false; socket = null
            onState(false, "Hub offline")
            val delayMs = (500L shl attempt.coerceAtMost(6)).coerceAtMost(30_000) + Random.nextLong(250)
            attempt++
            retry?.cancel()
            retry = scope.launch { delay(delayMs); connect() }
        }
    }
    fun send(msg: Msg): Boolean {
        val ws = socket ?: return false
        if (!open) return false
        if (msg is Frame && ws.queueSize() > 256_000) return false
        if (ws.queueSize() > 2_000_000) { ws.cancel(); return false }
        return ws.send(Protocol.encode(msg))
    }
    override fun close() {
        stopped = true; generation++; open = false; retry?.cancel()
        socket?.close(1000, "App stopped"); socket = null
        client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
    }
}
