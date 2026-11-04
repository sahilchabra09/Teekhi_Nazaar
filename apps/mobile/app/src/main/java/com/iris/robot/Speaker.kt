package com.iris.robot

import android.content.Context
import android.media.*
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.iris.robot.core.*

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class Speaker(
    context: Context,
    private val address: HubAddress,
    private val token: String,
    private val send: (Msg) -> Boolean,
    private val pauseListening: () -> Unit,
    private val resumeListening: () -> Unit,
    private val caption: (String, Boolean) -> Unit,
) : AutoCloseable {
    private val main = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(AudioManager::class.java)
    private val previousMode = manager.mode
    @Suppress("DEPRECATION") private val previousSpeaker = manager.isSpeakerphoneOn
    private val queue = ArrayDeque<Speak>()
    private val seen = LinkedHashSet<String>()
    private var current: Speak? = null
    private var synthesis: Call? = null
    private var captionCall: String? = null
    private var player: MediaPlayer? = null
    @Volatile private var closed = false
    private var started = false
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val cache = context.cacheDir
    private val io = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder().callTimeout(35, TimeUnit.SECONDS).readTimeout(35, TimeUnit.SECONDS).build()
    private var audioFile: File? = null
    init { manager.mode = AudioManager.MODE_IN_COMMUNICATION; routeSpeaker() }
    fun speak(message: Speak) {
        if (closed || message.speak_id in seen) return
        if (message.text.isBlank() || message.text.length > 1000 || queue.size >= 24) {
            send(TtsStatus(message.speak_id, "error", "Speech text or queue limit exceeded")); return
        }
        seen.add(message.speak_id); if (seen.size > 256) seen.remove(seen.first())
        queue.addLast(message); next()
    }
    private fun next() {
        if (closed || current != null || queue.isEmpty()) return
        val message = queue.removeFirst(); current = message; started = false
        pauseListening() // before preparation/tts.speak, not after the first audio sample
        captionCall = message.call_id
        caption(message.text, true); routeSpeaker()
        val body = JSONObject().put("text", message.text).toString().toRequestBody("application/json".toMediaType())
        val request = http.newCall(Request.Builder().url(address.http + "/api/mobile/tts")
            .header("Authorization", "Bearer $token").post(body).build())
        synthesis = request
        io.execute {
            var file: File? = null
            try {
                request.execute().use { response ->
                    check(response.isSuccessful) { "Deepgram voice failed (HTTP ${response.code})" }
                    val bytes = response.body?.bytes() ?: error("Empty voice response")
                    check(bytes.size in 44..12_000_000 && String(bytes.copyOfRange(0, 4)) == "RIFF") { "Invalid voice audio" }
                    file = File.createTempFile("iris-voice-", ".wav", cache).also { it.writeBytes(bytes) }
                }
                val readyFile = file!!
                main.post {
                    if (closed || current !== message) { readyFile.delete(); return@post }
                    audioFile = readyFile
                    try {
                        player = MediaPlayer().apply {
                            setAudioAttributes(attributes); setDataSource(readyFile.absolutePath)
                            setOnPreparedListener { if (!closed && current === message) { it.start(); began() } }
                            setOnCompletionListener { if (current === message) finish(null) }
                            setOnErrorListener { _, _, _ -> if (current === message) finish("Deepgram audio playback failed"); true }
                            prepareAsync()
                        }
                    } catch (_: Exception) { finish("Deepgram audio playback failed") }
                }
            } catch (e: Exception) {
                file?.delete()
                main.post { if (!closed && current === message) finish(e.message ?: "Deepgram voice unavailable") }
            }
        }
        main.postDelayed({ if (current === message) finish("Speech timed out") }, 90_000)
    }
    private fun began() {
        if (closed || started) return
        started = true; current?.let { send(TtsStatus(it.speak_id, "started")) }
    }
    fun cancelCall(callId: String) {
        queue.removeAll { item ->
            (item.call_id == callId).also { if (it) send(TtsStatus(item.speak_id, "error", "Conversation ended")) }
        }
        if (current?.call_id == callId) {
            finish("Conversation ended", clearCaption = true)
        } else if (captionCall == callId) {
            captionCall = null
            caption("", false)
        }
    }
    private fun finish(error: String?, clearCaption: Boolean = false) {
        if (closed) return
        val item = current ?: return
        current = null
        synthesis?.cancel(); synthesis = null
        player?.release(); player = null; audioFile?.delete(); audioFile = null
        send(TtsStatus(item.speak_id, if (error == null) "finished" else "error", error))
        if (queue.isNotEmpty()) next() else {
            if (clearCaption) captionCall = null
            caption(if (clearCaption) "" else item.text, false)
            resumeListening()
        }
    }
    @Suppress("DEPRECATION") private fun routeSpeaker() {
        if (Build.VERSION.SDK_INT >= 31) {
            manager.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }?.let { manager.setCommunicationDevice(it) }
        } else manager.isSpeakerphoneOn = true
    }
    override fun close() {
        closed = true; main.removeCallbacksAndMessages(null)
        current?.let { send(TtsStatus(it.speak_id, "error", "App stopped")) }
        queue.forEach { send(TtsStatus(it.speak_id, "error", "App stopped")) }; queue.clear()
        http.dispatcher.cancelAll(); io.shutdownNow(); http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll()
        player?.release(); player = null; audioFile?.delete(); audioFile = null
        if (Build.VERSION.SDK_INT >= 31) manager.clearCommunicationDevice() else @Suppress("DEPRECATION") run { manager.isSpeakerphoneOn = previousSpeaker }
        manager.mode = previousMode
    }
}
