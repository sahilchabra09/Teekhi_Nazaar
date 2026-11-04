package com.iris.robot

import com.iris.robot.core.*
import com.iris.robot.core.Protocol
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Only the IRIS account credential reaches the phone; provider credentials stay on the server. */
class CloudSpeech(
    private val address: HubAddress, private val token: String, private val scope: CoroutineScope,
    private val state: (String) -> Unit, private val error: (String) -> Unit, private val unauthorized: () -> Unit,
) : AutoCloseable {
    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    @Volatile private var socket: WebSocket? = null
    @Volatile private var connected = false
    @Volatile private var closed = false
    @Volatile private var paused = false
    @Volatile private var busy = false
    private var reconnect: Job? = null
    init { connect() }
    private fun connect() {
        if (closed) return
        val url = address.http.replaceFirst("http", "ws") + "/api/mobile/speech"
        socket = http.newWebSocket(Request.Builder().url(url).header("Authorization", "Bearer $token").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (closed) { webSocket.close(1000, "Stopped"); return }
                connected = true; busy = false
                command(if (paused) "pause" else "resume")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (closed) return
                when (val message = Protocol.decode(text)) {
                    is SpeechState -> {
                        busy = message.state == "processing"
                        if (!paused) state(message.state)
                    }
                    is HubError -> { paused = true; error(message.message + ". Restart the session to retry.") }
                    else -> Unit
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connected = false
                if (closed) return
                if (response?.code == 401) { scope.launch(Dispatchers.Main.immediate) { unauthorized() }; return }
                if (response?.code == 503) { error("Deepgram is not configured on the server."); return }
                retry()
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { connected = false; if (!closed) retry() }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
        })
    }
    private fun retry() {
        state("reconnecting")
        reconnect?.cancel(); reconnect = scope.launch { delay(3000); connect() }
    }
    fun audio(bytes: ByteArray) {
        val ws = socket ?: return
        if (!connected || closed || paused || busy) return
        if (ws.queueSize() > 64000) { error("Speech connection is too slow; reconnecting."); ws.cancel(); return }
        ws.send(bytes.toByteString())
    }
    fun command(action: String, id: String = "") {
        if (action == "pause") paused = true
        if (action == "resume" || action == "start") paused = false
        socket?.send(JSONObject().put("action", action).put("request_id", id).toString())
    }
    override fun close() {
        closed = true; reconnect?.cancel(); socket?.cancel(); socket = null
        http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll()
    }
}
