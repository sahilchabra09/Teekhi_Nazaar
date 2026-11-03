package com.iris.robot

import android.content.Context
import android.media.*
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.iris.robot.core.*
import java.net.URI
import java.util.Locale

class Speaker(
    context: Context,
    private val address: HubAddress,
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
    private var player: MediaPlayer? = null
    private var ready = false
    private var failed = false
    private var closed = false
    private var started = false
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private var tts: TextToSpeech? = null

    init {
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        routeSpeaker()
        tts = TextToSpeech(context.applicationContext) { status -> main.post {
            if (closed) return@post
            ready = status == TextToSpeech.SUCCESS
            if (ready) {
                val language = tts!!.setLanguage(Locale.US)
                ready = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED
                tts!!.setAudioAttributes(attributes); tts!!.setSpeechRate(0.95f)
            }
            failed = !ready
            next()
        } }
        tts!!.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) { main.post { if (current?.speak_id == id) began() } }
            override fun onDone(id: String) { main.post { if (current?.speak_id == id) finish(null) } }
            @Deprecated("Android callback") override fun onError(id: String) { main.post { if (current?.speak_id == id) finish("Device speech failed") } }
            override fun onError(id: String, errorCode: Int) { main.post { if (current?.speak_id == id) finish("Device speech error $errorCode") } }
        })
        main.postDelayed({
            if (!closed && !ready && !failed) { failed = true; next() }
        }, 10_000)
    }
    fun speak(message: Speak) {
        if (closed || message.speak_id in seen) return
        if (message.text.isBlank() || message.text.length > 4000 || queue.size >= 24) {
            send(TtsStatus(message.speak_id, "error", "Speech text or queue limit exceeded")); return
        }
        seen.add(message.speak_id); if (seen.size > 256) seen.remove(seen.first())
        queue.addLast(message); next()
    }
    private fun next() {
        if (closed || current != null || queue.isEmpty()) return
        if (!ready && !failed && queue.first().audio_url == null) return
        val message = queue.removeFirst(); current = message; started = false
        pauseListening() // before preparation/tts.speak, not after the first audio sample
        caption(message.text, true); routeSpeaker()
        if (message.audio_url != null) {
            try {
                val uri = URI(address.http + "/").resolve(message.audio_url)
                require(uri.scheme in setOf("http", "https") && uri.userInfo == null)
                player = MediaPlayer().apply {
                    setAudioAttributes(attributes); setDataSource(uri.toString())
                    setOnPreparedListener { if (!closed && current?.speak_id == message.speak_id) { it.start(); began() } }
                    setOnCompletionListener { finish(null) }
                    setOnErrorListener { _, _, _ -> finish("Audio URL playback failed"); true }
                    prepareAsync()
                }
                main.postDelayed({ if (current?.speak_id == message.speak_id && !started) finish("Audio preparation timed out") }, 10_000)
            } catch (_: Exception) { finish("Invalid or unavailable audio URL") }
        } else if (!ready) finish("Install an English text-to-speech voice in Android settings")
        else if (tts!!.speak(message.text, TextToSpeech.QUEUE_ADD, null, message.speak_id) == TextToSpeech.ERROR) finish("Speech could not start")
        main.postDelayed({ if (current?.speak_id == message.speak_id) { tts?.stop(); finish("Speech timed out") } }, 90_000)
    }
    private fun began() {
        if (closed || started) return
        started = true; current?.let { send(TtsStatus(it.speak_id, "started")) }
    }
    private fun finish(error: String?) {
        if (closed) return
        val item = current ?: return
        player?.release(); player = null
        send(TtsStatus(item.speak_id, if (error == null) "finished" else "error", error))
        current = null
        if (queue.isNotEmpty()) next() else { caption(item.text, false); resumeListening() }
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
        tts?.stop(); tts?.shutdown(); player?.release(); player = null
        if (Build.VERSION.SDK_INT >= 31) manager.clearCommunicationDevice() else @Suppress("DEPRECATION") run { manager.isSpeakerphoneOn = previousSpeaker }
        manager.mode = previousMode
    }
}
