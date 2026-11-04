package com.iris.robot

import com.iris.robot.core.HubAddress
import com.iris.robot.core.HubError
import com.iris.robot.core.Protocol
import com.iris.robot.core.SpeechState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import okhttp3.*
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A socket belongs to one approved turn. A lost socket ends that turn. */
class CloudSpeech(
    private val address: HubAddress, private val token: String, private val scope: CoroutineScope,
    private val state: (SpeechState) -> Unit, private val error: (String) -> Unit, private val unauthorized: () -> Unit,
) : AutoCloseable {
    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).callTimeout(90, TimeUnit.SECONDS).build()
    private var socket: WebSocket? = null
    private var upload: Call? = null
    private var activeId: String? = null
    private var capturing = false

    private fun command(action: String, id: String) =
        JSONObject().put("action", action).put("request_id", id).toString()

    @Synchronized fun start(id: String) {
        if (activeId != null) return
        activeId = id
        capturing = true
        val url = address.http.replaceFirst("http", "ws") + "/api/mobile/speech"
        socket = http.newWebSocket(Request.Builder().url(url).header("Authorization", "Bearer $token").build(), object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                when (val message = Protocol.decode(text)) {
                    is SpeechState -> if (message.request_id == id) {
                        synchronized(this@CloudSpeech) {
                            if (activeId == id && message.state in setOf("processing", "ready", "failed", "no_speech")) capturing = false
                        }
                        scope.launch { if (activeId == id) state(message) }
                    }
                    is HubError -> failed(id, message.message)
                    else -> Unit
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                failed(id, "Speech connection failed", response?.code == 401)
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
                failed(id, "Speech connection ended")
            }
        }).also { it.send(command("start", id)) }
    }

    @Synchronized fun audio(id: String, bytes: ByteArray) {
        val ws = socket ?: return
        if (activeId != id || !capturing) return
        if (ws.queueSize() > 64_000 || !ws.send(bytes.toByteString())) {
            capturing = false
            ws.cancel()
            failed(id, "Speech connection could not keep up")
        }
    }

    @Synchronized fun stop(id: String) {
        if (activeId != id || !capturing) return
        capturing = false
        socket?.send(command("stop", id))
    }

    /** Android recognition posts a transcript once, under the same approved request ID. */
    @Synchronized fun transcript(id: String, text: String, confidence: Double?) {
        if (activeId != null) return
        activeId = id
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("utterance_id", id).addFormDataPart("text", text)
            .addFormDataPart("confidence", (confidence ?: -1.0).toString()).build()
        val call = http.newCall(Request.Builder().url(address.http + "/api/utterance")
            .header("Authorization", "Bearer $token").post(body).build())
        upload = call
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { failed(id, "Speech upload failed") }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) failed(id, "Speech upload failed (HTTP ${it.code})", it.code == 401)
                    // The hub delivers the authoritative ready or no_speech result for this ID.
                }
            }
        })
    }

    private fun failed(id: String, message: String, expired: Boolean = false) {
        scope.launch {
            if (activeId != id) return@launch
            error(message)
            state(SpeechState("failed", id))
            if (expired) unauthorized()
        }
    }

    @Synchronized fun end(id: String) {
        if (activeId != id) return
        activeId = null
        capturing = false
        socket?.cancel(); socket = null
        upload?.cancel(); upload = null
    }

    override fun close() {
        activeId?.let(::end)
        http.dispatcher.executorService.shutdown()
        http.connectionPool.evictAll()
    }
}
