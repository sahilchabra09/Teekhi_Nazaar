package com.iris.robot

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.speech.*
import com.iris.robot.core.*
import java.util.UUID

/** Explicit tap-to-recognize fallback. The RTC/AudioRecord owners must be released first. */
class AndroidRecognizer(
    private val context: Context,
    private val send: (Msg) -> Boolean,
    private val status: (String, Boolean) -> Unit,
    private val error: (String) -> Unit,
    private val submit: (String, String, Double?) -> Unit,
) : RecognitionListener, AutoCloseable {
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var blockedUntil = 0L
    private var requestId = ""
    fun capture(action: String, id: String) {
        when (action) {
            "start" -> { if (listening) return; requestId = id; tap() }
            "stop" -> if (requestId == id && listening) recognizer?.stopListening()
            "cancel" -> if (requestId == id) { recognizer?.cancel(); done() }
        }
    }
    fun tap() {
        if (SystemClock.elapsedRealtime() < blockedUntil) { send(SpeechState("failed", requestId)); requestId = ""; return }
        if (listening) { recognizer?.stopListening(); return }
        if (requestId.isBlank()) requestId = "u_${UUID.randomUUID()}"
        if (!SpeechRecognizer.isRecognitionAvailable(context)) { send(SpeechState("failed", requestId)); done(); error("No Android speech recognition service is installed"); return }
        if (recognizer == null) recognizer = SpeechRecognizer.createSpeechRecognizer(context).also { it.setRecognitionListener(this) }
        listening = true
        try {
            recognizer!!.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            })
            send(SpeechActivity(true)); status("Android STT listening", true)
        } catch (_: Exception) { send(SpeechState("failed", requestId)); done(); error("Android speech recognition could not start") }
    }
    fun pause() { blockedUntil = Long.MAX_VALUE; listening = false; recognizer?.cancel(); done() }
    fun resumeAfter() { blockedUntil = SystemClock.elapsedRealtime() + 500 }
    private fun done() { listening = false; requestId = ""; send(SpeechActivity(false)); status("Android STT: tap to talk", false) }
    override fun onResults(results: Bundle) {
        if (!listening || SystemClock.elapsedRealtime() < blockedUntil) return
        val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
        if (text.isNotEmpty()) {
            val confidence = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull()?.takeIf { it in 0f..1f }?.toDouble()
            submit(requestId, text, confidence)
        }
        else send(SpeechState("no_speech", requestId))
        done()
    }
    override fun onError(errorCode: Int) { if (listening) { send(SpeechState("failed", requestId)); done(); error("Android speech recognition error $errorCode; tap to retry") } }
    override fun onReadyForSpeech(params: Bundle?) = Unit
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = Unit
    override fun onPartialResults(partialResults: Bundle?) = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit
    override fun close() { listening = false; recognizer?.cancel(); recognizer?.destroy(); recognizer = null }
}
